import { beforeAll, describe, expect, it } from "vitest";
import { analyzeIncident } from "@/lib/services/analysis";
import { computeIncidentImpact, createAsset, createDependency, deleteDependency } from "@/lib/services/assets";
import { addAnnotation, createManualEvidence, getEvidenceDetail, importEvidence, listEvidence, listIncidentEvidence } from "@/lib/services/evidence";
import { createIncident, getIncident, listIncidents, updateIncident } from "@/lib/services/incidents";
import { syncMicrosoft } from "@/lib/services/integrations";
import { createHypothesis, createNote, createTask, getTimeline } from "@/lib/services/investigation";
import { generateReport, getReport, listReports } from "@/lib/services/reports";
import { globalSearch, listAudit, updateMemberRole, updateOrganization } from "@/lib/services/workspace";
import { contextFor, db, ensureSeeded, expectAppError, HARBOR, incidentId, NORTHSTAR } from "./helpers";

let harborIncident: string;
let harborEvidence: string;
let harborAsset: string;
let harborUser: string;
let northstarIncident: string;

beforeAll(async () => {
  await ensureSeeded();
  harborIncident = await incidentId(HARBOR, "CT-2026-001");
  northstarIncident = await incidentId(NORTHSTAR, "CT-2026-001");
  const harborOrg = await db.organization.findUniqueOrThrow({ where: { slug: HARBOR } });
  harborEvidence = (await db.evidence.findFirstOrThrow({ where: { organizationId: harborOrg.id } })).id;
  harborAsset = (await db.asset.findFirstOrThrow({ where: { organizationId: harborOrg.id } })).id;
  harborUser = (await db.user.findUniqueOrThrow({ where: { email: "isolation.owner@cloudtrace.local" } })).id;
});

describe("cross-organisation isolation", () => {
  it("lists only the caller's organisation and hides foreign records by ID (404, not 403)", async () => {
    const owner = await contextFor("owner@cloudtrace.local");
    const list = await listIncidents(owner, { pageSize: 100 });
    expect(list.items.map((i) => i.id)).not.toContain(harborIncident);
    expect(list.items.some((i) => i.caseNumber === "CT-2026-001")).toBe(true); // same case number, own org only

    await expectAppError(getIncident(owner, harborIncident), "NOT_FOUND");
    await expectAppError(updateIncident(owner, harborIncident, { severity: "LOW" }), "NOT_FOUND");
    await expectAppError(listIncidentEvidence(owner, harborIncident), "NOT_FOUND");
    await expectAppError(getTimeline(owner, harborIncident), "NOT_FOUND");
    await expectAppError(getEvidenceDetail(owner, harborEvidence), "NOT_FOUND");
    await expectAppError(computeIncidentImpact(owner, harborIncident), "NOT_FOUND");
    await expectAppError(generateReport(owner, harborIncident), "NOT_FOUND");
    await expectAppError(createNote(owner, harborIncident, { text: "x" }), "NOT_FOUND");
    await expectAppError(
      importEvidence(owner, harborIncident, { filename: "x.csv", bytes: new Uint8Array([1]) }, { mode: "ATOMIC", dryRun: true }),
      "NOT_FOUND",
    );
  });

  it("rejects references to foreign assets, evidence and users inside own records", async () => {
    const analyst = await contextFor("analyst@cloudtrace.local");
    const ownAsset = (await db.asset.findFirstOrThrow({ where: { organizationId: analyst.organizationId } })).id;
    await expectAppError(createDependency(analyst, { consumerAssetId: ownAsset, providerAssetId: harborAsset }), "NOT_FOUND");
    await expectAppError(
      createHypothesis(analyst, northstarIncident, { title: "Foreign evidence", confidence: "LOW", supportingEvidenceIds: [harborEvidence] }),
      "VALIDATION_ERROR",
    );
    await expectAppError(createTask(analyst, northstarIncident, { title: "Foreign assignee", priority: "LOW", assigneeId: harborUser }), "VALIDATION_ERROR");
    await expectAppError(
      createIncident(analyst, { title: "Foreign scope", description: "d", type: "OTHER", severity: "LOW", assetIds: [harborAsset] }),
      "VALIDATION_ERROR",
    );
    await expectAppError(
      createManualEvidence(analyst, northstarIncident, {
        title: "t",
        category: "OTHER",
        provenance: "ANALYST_NOTE",
        sourceName: "s",
        observedAt: "2026-11-12T10:00:00Z",
        contentText: "c",
        assetId: harborAsset,
      }),
      "NOT_FOUND",
    );
  });

  it("does not leak foreign records through search, evidence vault or reports", async () => {
    const owner = await contextFor("owner@cloudtrace.local");
    const search = await globalSearch(owner, "Harbor");
    expect(search.incidents).toHaveLength(0);
    expect(search.assets).toHaveLength(0);
    expect(search.evidence).toHaveLength(0);
    const vault = await listEvidence(owner, { q: "HARBOR-SYN" });
    expect(vault.total).toBe(0);
    const harborOwner = await contextFor("isolation.owner@cloudtrace.local");
    const ownReports = await listReports(owner);
    expect(ownReports.length).toBeGreaterThan(0);
    await expectAppError(getReport(harborOwner, ownReports[0].id), "NOT_FOUND");
  });
});

describe("role enforcement on the server", () => {
  it("viewer cannot perform any write", async () => {
    const viewer = await contextFor("viewer@cloudtrace.local");
    const ownAssets = await db.asset.findMany({ where: { organizationId: viewer.organizationId }, take: 2 });
    const evidence = await db.evidence.findFirstOrThrow({ where: { organizationId: viewer.organizationId } });
    const dep = await db.dependency.findFirstOrThrow({ where: { organizationId: viewer.organizationId } });
    const writes: Promise<unknown>[] = [
      createIncident(viewer, { title: "Nope", description: "d", type: "OTHER", severity: "LOW" }),
      updateIncident(viewer, northstarIncident, { severity: "LOW" }),
      createManualEvidence(viewer, northstarIncident, {}),
      importEvidence(viewer, northstarIncident, { filename: "x.csv", bytes: new Uint8Array([1]) }, { mode: "ATOMIC", dryRun: true }),
      addAnnotation(viewer, evidence.id, { text: "x" }),
      analyzeIncident(viewer, northstarIncident),
      generateReport(viewer, northstarIncident),
      createHypothesis(viewer, northstarIncident, { title: "x", confidence: "LOW" }),
      createTask(viewer, northstarIncident, { title: "xxx", priority: "LOW" }),
      createNote(viewer, northstarIncident, { text: "x" }),
      createAsset(viewer, { name: "x", provider: "OTHER", assetType: "x", criticality: "LOW" }),
      createDependency(viewer, { consumerAssetId: ownAssets[0].id, providerAssetId: ownAssets[1].id }),
      deleteDependency(viewer, dep.id),
      listAudit(viewer, {}),
      updateOrganization(viewer, { name: "x" }),
    ];
    for (const write of writes) await expectAppError(write, "FORBIDDEN");
  });

  it("owner-only operations reject analysts", async () => {
    const analyst = await contextFor("analyst@cloudtrace.local");
    await expectAppError(updateOrganization(analyst, { name: "Renamed" }), "FORBIDDEN");
    await expectAppError(syncMicrosoft(analyst), "FORBIDDEN");
    const membership = await db.membership.findFirstOrThrow({ where: { organizationId: analyst.organizationId, role: "VIEWER" } });
    await expectAppError(updateMemberRole(analyst, { membershipId: membership.id, role: "OWNER" }), "FORBIDDEN");
  });

  it("a workspace keeps at least one owner", async () => {
    const harborOwner = await contextFor("isolation.owner@cloudtrace.local");
    const own = await db.membership.findFirstOrThrow({ where: { organizationId: harborOwner.organizationId, userId: harborOwner.userId } });
    await expectAppError(updateMemberRole(harborOwner, { membershipId: own.id, role: "VIEWER" }), "CONFLICT");
  });
});
