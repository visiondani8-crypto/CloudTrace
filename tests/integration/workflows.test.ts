import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { analyzeIncident } from "@/lib/services/analysis";
import { computeIncidentImpact, createDependency } from "@/lib/services/assets";
import { importEvidence, listIncidentEvidence } from "@/lib/services/evidence";
import { createIncident, updateIncident } from "@/lib/services/incidents";
import { getIntegrationStatus, syncMicrosoft } from "@/lib/services/integrations";
import { createHypothesis, createNote, getTimeline, updateHypothesis } from "@/lib/services/investigation";
import { generateReport, getReport } from "@/lib/services/reports";
import { listAudit } from "@/lib/services/workspace";
import { clearGraphTokenCache } from "@/lib/integrations/microsoft/graph";
import { resetRateLimits } from "@/lib/rate-limit";
import { seedDatabase } from "../../prisma/seed";
import { contextFor, db, ensureSeeded, expectAppError, incidentId, NORTHSTAR, TEST_PASSWORD } from "./helpers";

const enc = (s: string) => new TextEncoder().encode(s);
const HEADER = "incidentCaseNumber,observedAt,title,category,sourceName,sourceEventId,assetName,provenance,contentText,sourceUri";

beforeAll(async () => {
  await ensureSeeded();
});
afterEach(() => resetRateLimits());

describe("seed", () => {
  it("is idempotent", async () => {
    const before = await Promise.all([db.incident.count(), db.evidence.count(), db.dependency.count(), db.reportSnapshot.count(), db.hypothesis.count()]);
    const result = await seedDatabase(db, TEST_PASSWORD);
    const after = await Promise.all([db.incident.count(), db.evidence.count(), db.dependency.count(), db.reportSnapshot.count(), db.hypothesis.count()]);
    expect(after).toEqual(before);
    expect(result.created).toEqual({});
  });

  it("labels the historical case as a provider technical outage and every non-public record as synthetic", async () => {
    const org = await db.organization.findUniqueOrThrow({ where: { slug: NORTHSTAR } });
    const ct1 = await db.incident.findUniqueOrThrow({ where: { organizationId_caseNumber: { organizationId: org.id, caseNumber: "CT-2026-001" } } });
    expect(ct1.classification).toBe("PROVIDER_TECHNICAL");
    expect(ct1.status).toBe("RESOLVED");
    const evidence = await db.evidence.findMany({ where: { organizationId: org.id } });
    for (const e of evidence) {
      if (e.provenance === "PUBLIC_REPORTED") expect(e.sourceUri).toMatch(/^https:\/\//);
      else expect(e.isSynthetic).toBe(true);
    }
    const ct2 = await db.incident.findUniqueOrThrow({ where: { organizationId_caseNumber: { organizationId: org.id, caseNumber: "CT-2026-002" } } });
    expect(ct2.classification).toBe("SECURITY_SUSPECTED");
  });
});

describe("incident workflow", () => {
  it("creates a persisted case with an audited, enforced status workflow", async () => {
    const analyst = await contextFor("analyst@cloudtrace.local");
    const incident = await createIncident(analyst, {
      title: "Test degradation",
      description: "Created by an integration test",
      type: "CONFIGURATION_FAILURE",
      severity: "MEDIUM",
      startedAt: "2026-11-16T08:00:00Z",
    });
    expect(incident.caseNumber).toMatch(new RegExp(`^CT-${new Date().getUTCFullYear()}-\\d{3}$`));
    expect(incident.status).toBe("OPEN");
    await expectAppError(updateIncident(analyst, incident.id, { status: "RESOLVED" }), "VALIDATION_ERROR");
    await updateIncident(analyst, incident.id, { status: "INVESTIGATING" });
    await createNote(analyst, incident.id, { text: "Investigating the change window." });
    const audit = await listAudit(analyst, { entity: incident.id, pageSize: 50 });
    const statusEntry = audit.items.find((a) => a.action === "incident.status_changed");
    expect(statusEntry?.actorLabel).toBe(analyst.userName);
    expect(Date.parse(statusEntry!.createdAt)).not.toBeNaN();
  });

  it("requires a written justification before confirming a security incident", async () => {
    const analyst = await contextFor("analyst@cloudtrace.local");
    const id = await incidentId(NORTHSTAR, "CT-2026-002");
    await expectAppError(updateIncident(analyst, id, { classification: "CONFIRMED_SECURITY" }), "VALIDATION_ERROR");
  });
});

describe("evidence import", () => {
  it("imports valid CSV, then skips duplicates on re-import", async () => {
    const analyst = await contextFor("analyst@cloudtrace.local");
    const id = await incidentId(NORTHSTAR, "CT-2026-003");
    const csv = `${HEADER}\nCT-2026-003,2026-11-15T10:20:00Z,Synthetic probe failure,HEALTH_EVENT,Synthetic test probe,TEST-PROBE-1,Portal API Gateway,SYNTHETIC,"Probe saw =1+2 HTTP 502",\n`;
    const first = await importEvidence(analyst, id, { filename: "probe.csv", bytes: enc(csv) }, { mode: "ATOMIC", dryRun: false });
    expect(first.outcome).toBe("COMPLETED");
    expect(first.acceptedCount).toBe(1);
    const again = await importEvidence(analyst, id, { filename: "probe.csv", bytes: enc(csv) }, { mode: "ATOMIC", dryRun: false });
    expect(again.acceptedCount).toBe(0);
    expect(again.duplicateCount).toBe(1);
    const rows = await listIncidentEvidence(analyst, id);
    const stored = rows.find((r) => r.sourceEventId === "TEST-PROBE-1")!;
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.provenance).toBe("SYNTHETIC");
  });

  it("rejects a file with one invalid row atomically, without partial writes, and records the attempt", async () => {
    const analyst = await contextFor("analyst@cloudtrace.local");
    const id = await incidentId(NORTHSTAR, "CT-2026-003");
    const before = await db.evidence.count({ where: { incidentId: id } });
    const csv = [
      HEADER,
      "CT-2026-003,2026-11-15T11:00:00Z,Valid row,APP_LOG,Synthetic test,ATOMIC-1,,SYNTHETIC,ok,",
      "CT-2026-003,,Missing time,APP_LOG,Synthetic test,ATOMIC-2,,SYNTHETIC,bad,",
      "CT-2026-003,2026-11-15T11:05:00Z,Bad enum,APP_LOG,Synthetic test,ATOMIC-3,,LIVE,bad,",
    ].join("\n");
    const result = await importEvidence(analyst, id, { filename: "mixed.csv", bytes: enc(csv) }, { mode: "ATOMIC", dryRun: false });
    expect(result.outcome).toBe("REJECTED");
    expect(result.acceptedCount).toBe(0);
    expect(result.rows.find((r) => r.rowNumber === 2)?.errors.join(" ")).toMatch(/observedAt is required/);
    expect(result.rows.find((r) => r.rowNumber === 3)?.errors.join(" ")).toMatch(/provenance must be one of/);
    expect(await db.evidence.count({ where: { incidentId: id } })).toBe(before);
    expect(await db.importJob.count({ where: { id: result.importJobId!, outcome: "REJECTED" } })).toBe(1);

    const partial = await importEvidence(analyst, id, { filename: "mixed.csv", bytes: enc(csv) }, { mode: "PARTIAL", dryRun: false });
    expect(partial.outcome).toBe("COMPLETED");
    expect(partial.acceptedCount).toBe(1);
    expect(partial.rejectedCount).toBe(2);
  });

  it("recognises the supplied fixtures as already-seeded duplicates", async () => {
    const analyst = await contextFor("analyst@cloudtrace.local");
    const ct1 = await incidentId(NORTHSTAR, "CT-2026-001");
    const json = await importEvidence(
      analyst,
      ct1,
      { filename: "public_plus_simulated_case.json", bytes: new Uint8Array(readFileSync("fixtures/public_plus_simulated_case.json")) },
      { mode: "ATOMIC", dryRun: true },
    );
    expect(json.fileErrors).toEqual([]);
    expect(json.summary.duplicates).toBe(4);
    const ct2 = await incidentId(NORTHSTAR, "CT-2026-002");
    const csv = await importEvidence(
      analyst,
      ct2,
      { filename: "synthetic_signins.csv", bytes: new Uint8Array(readFileSync("fixtures/synthetic_signins.csv")) },
      { mode: "ATOMIC", dryRun: true },
    );
    expect(csv.summary.duplicates).toBe(3);
  });

  it("rejects oversized files", async () => {
    const analyst = await contextFor("analyst@cloudtrace.local");
    const id = await incidentId(NORTHSTAR, "CT-2026-003");
    const result = await importEvidence(analyst, id, { filename: "big.csv", bytes: new Uint8Array(5 * 1024 * 1024 + 1) }, { mode: "ATOMIC", dryRun: false });
    expect(result.outcome).toBe("REJECTED");
    expect(result.fileErrors.join(" ")).toMatch(/5 MiB/);
  });
});

describe("timeline, impact and hypotheses", () => {
  it("orders the timeline by event time and links evidence", async () => {
    const owner = await contextFor("owner@cloudtrace.local");
    const items = await getTimeline(owner, await incidentId(NORTHSTAR, "CT-2026-001"));
    const times = items.map((i) => i.occurredAt);
    expect([...times].sort()).toEqual(times);
    expect(items.filter((i) => i.evidenceId).every((i) => i.sha256 && i.sourceName)).toBe(true);
    expect(items.some((i) => !i.verified)).toBe(true); // analyst-entered event
  });

  it("keeps the independent Azure portal unknown and distinguishes at-risk from confirmed", async () => {
    const owner = await contextFor("owner@cloudtrace.local");
    const id = await incidentId(NORTHSTAR, "CT-2026-001");
    const assets = await db.asset.findMany({ where: { organizationId: owner.organizationId } });
    const byName = (n: string) => assets.find((a) => a.name === n)!.id;
    const peak = await computeIncidentImpact(owner, id, "peak");
    expect(peak.result.impacts[byName("Azure-hosted Customer Portal")].state).toBe("UNKNOWN");
    expect(peak.result.impacts[byName("CRM Email Sync")].state).toBe("CONFIRMED_AFFECTED");
    expect(peak.result.impacts[byName("Outlook Mail Access")].state).toBe("POTENTIALLY_AFFECTED");
    expect(peak.result.impacts[byName("Finance Approval Workflow")].path).toHaveLength(3);
    expect(peak.result.impacts[byName("Exchange Online")].providerReported).toBe(true);
    const latest = await computeIncidentImpact(owner, id, "latest");
    expect(latest.result.impacts[byName("CRM Email Sync")].state).toBe("CONFIRMED_HEALTHY");
    expect(latest.result.impacts[byName("CRM Email Sync")].conflict).toBe(true);
  });

  it("blocks Supported without supporting evidence", async () => {
    const analyst = await contextFor("analyst@cloudtrace.local");
    const id = await incidentId(NORTHSTAR, "CT-2026-002");
    await expectAppError(createHypothesis(analyst, id, { title: "Supported with nothing", confidence: "HIGH", status: "SUPPORTED" }), "VALIDATION_ERROR");
    const h = await createHypothesis(analyst, id, { title: "Needs evidence first", confidence: "LOW" });
    await expectAppError(updateHypothesis(analyst, id, { id: h.id, status: "SUPPORTED" }), "VALIDATION_ERROR");
    const evidence = await db.evidence.findFirstOrThrow({ where: { incidentId: id } });
    const updated = await updateHypothesis(analyst, id, { id: h.id, status: "SUPPORTED", supportingEvidenceIds: [evidence.id] });
    expect(updated.status).toBe("SUPPORTED");
  });

  it("accepts dependency cycles but reports them, and rejects self-dependencies", async () => {
    const analyst = await contextFor("analyst@cloudtrace.local");
    const assets = await db.asset.findMany({ where: { organizationId: analyst.organizationId } });
    const id = (n: string) => assets.find((a) => a.name === n)!.id;
    await expectAppError(createDependency(analyst, { consumerAssetId: id("CRM Email Sync"), providerAssetId: id("CRM Email Sync") }), "VALIDATION_ERROR");
    const created = await createDependency(analyst, { consumerAssetId: id("Exchange Online"), providerAssetId: id("Teams Calendar Sync") });
    expect(created.createsCycle).toBe(true);
    const impact = await computeIncidentImpact(analyst, await incidentId(NORTHSTAR, "CT-2026-001"), "peak");
    expect(impact.result.cycles.length).toBeGreaterThan(0);
    await db.dependency.delete({ where: { id: created.dependency.id } });
  });
});

describe("analysis", () => {
  it("runs rule-based analysis without an API key", async () => {
    const analyst = await contextFor("analyst@cloudtrace.local");
    const run = await analyzeIncident(analyst, await incidentId(NORTHSTAR, "CT-2026-001"));
    expect(run.mode).toBe("RULE_BASED");
    expect(run.errorStatus).toBeNull();
    expect(run.summary).toMatch(/Attribution to a cyberattack is not supported/);
  });

  it("falls back to rule-based analysis when Claude is configured but unreachable", async () => {
    const analyst = await contextFor("analyst@cloudtrace.local");
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-a-real-key";
    process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:9";
    try {
      const run = await analyzeIncident(analyst, await incidentId(NORTHSTAR, "CT-2026-002"));
      expect(run.mode).toBe("RULE_BASED");
      expect(run.errorStatus).toMatch(/^CLAUDE_/);
      expect(run.classificationSuggestion).toBe("SECURITY_SUSPECTED");
    } finally {
      process.env.ANTHROPIC_API_KEY = "";
      delete process.env.ANTHROPIC_BASE_URL;
    }
  });
});

describe("reports", () => {
  it("creates sequential immutable snapshots", async () => {
    const analyst = await contextFor("analyst@cloudtrace.local");
    const id = await incidentId(NORTHSTAR, "CT-2026-002");
    const v1 = await generateReport(analyst, id);
    const firstSnapshot = await getReport(analyst, v1.id);
    await createNote(analyst, id, { text: "Owner confirmed travel; continue MFA review." });
    await updateIncident(analyst, id, { severity: "LOW" });
    const v2 = await generateReport(analyst, id);
    expect(v2.version).toBe(v1.version + 1);
    const reread = await getReport(analyst, v1.id);
    expect(reread.sha256).toBe(firstSnapshot.sha256);
    expect(reread.content).toEqual(firstSnapshot.content);
    const second = await getReport(analyst, v2.id);
    expect(second.content.identification.severity).toMatch(/Low/);
    expect(second.content.dataNotice.containsSimulated).toBe(true);
    expect(second.content.references.evidence.every((e) => /^[0-9a-f]{64}$/.test(e.sha256))).toBe(true);
  });

  it("requires evidence before a report can be generated", async () => {
    const analyst = await contextFor("analyst@cloudtrace.local");
    const empty = await createIncident(analyst, { title: "No evidence yet", description: "d", type: "OTHER", severity: "LOW" });
    await expectAppError(generateReport(analyst, empty.id), "CONFLICT");
  });
});

describe("Microsoft 365 connector", () => {
  const graphFetch = (issues: object[], fail = false) =>
    (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("login.microsoftonline.com")) {
        return new Response(JSON.stringify({ access_token: "token-value-never-logged", expires_in: 3600 }), { status: 200 });
      }
      if (fail) return new Response("{}", { status: 403 });
      if (url.includes("healthOverviews")) return new Response(JSON.stringify({ value: [{ id: "Exchange", service: "Exchange Online", status: "serviceDegradation" }] }), { status: 200 });
      return new Response(JSON.stringify({ value: issues }), { status: 200 });
    }) as typeof fetch;

  it("reports Not configured without credentials and refuses to sync", async () => {
    const owner = await contextFor("owner@cloudtrace.local");
    expect((await getIntegrationStatus(owner)).microsoft.status).toBe("NOT_CONFIGURED");
    await expectAppError(syncMicrosoft(owner), "NOT_CONFIGURED");
  });

  it("syncs read-only issues without duplicates and preserves data on failure", async () => {
    Object.assign(process.env, {
      MS_TENANT_ID: "contoso.onmicrosoft.com",
      MS_CLIENT_ID: "11111111-2222-3333-4444-555555555555",
      MS_CLIENT_SECRET: "super-secret-client-value",
      MS_CONNECTOR_ORGANIZATION_SLUG: NORTHSTAR,
    });
    clearGraphTokenCache();
    try {
      const owner = await contextFor("owner@cloudtrace.local");
      expect((await getIntegrationStatus(owner)).microsoft.status).toBe("READY");
      const issue = { id: "EX0000001", title: "Test issue", service: "Exchange Online", status: "serviceRestored", isResolved: true, lastModifiedDateTime: "2026-11-13T16:10:00Z" };
      const first = await syncMicrosoft(owner, graphFetch([issue]));
      expect(first.created).toBe(1);
      const second = await syncMicrosoft(owner, graphFetch([issue]));
      expect(second.created).toBe(0);
      expect(second.unchanged).toBe(1);
      expect(await db.providerServiceIssue.count({ where: { organizationId: owner.organizationId } })).toBe(1);
      expect((await getIntegrationStatus(owner)).microsoft.status).toBe("CONNECTED");

      await expectAppError(syncMicrosoft(owner, graphFetch([], true)), "UPSTREAM_ERROR");
      expect(await db.providerServiceIssue.count({ where: { organizationId: owner.organizationId } })).toBe(1);
      expect((await getIntegrationStatus(owner)).microsoft.status).toBe("ERROR");

      const harbor = await contextFor("isolation.owner@cloudtrace.local");
      await expectAppError(syncMicrosoft(harbor, graphFetch([issue])), "FORBIDDEN");

      const audit = await db.auditEntry.findMany({ where: { organizationId: owner.organizationId } });
      const dump = JSON.stringify(audit);
      expect(dump).not.toContain("super-secret-client-value");
      expect(dump).not.toContain("token-value-never-logged");
    } finally {
      for (const k of ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_CONNECTOR_ORGANIZATION_SLUG"]) process.env[k] = "";
      await db.providerConnection.deleteMany({});
      await db.providerServiceIssue.deleteMany({});
    }
  });
});
