import { describe, expect, it } from "vitest";
import { runRuleBasedAnalysis } from "@/lib/analysis/rule-based";
import { sanitiseClaudeOutput } from "@/lib/analysis/claude";
import type { AnalysisEvidence, AnalysisInput } from "@/lib/analysis/types";
import { computeBlastRadius, peakImpactTime } from "@/lib/blast-radius";
import { correlateEvents, sortChronologically } from "@/lib/correlation";
import { canTransition } from "@/lib/domain/enums";
import { csvCell, safeFilename, toCsv } from "@/lib/reports/csv";

const ev = (over: Partial<AnalysisEvidence> & { id: string; ref: string }): AnalysisEvidence => ({
  title: "event",
  category: "APP_LOG",
  provenance: "SYNTHETIC",
  sourceName: "fixture",
  observedAt: new Date("2026-11-12T17:00:00Z"),
  assetId: null,
  assetName: null,
  assetStatus: null,
  contentText: "",
  confidenceLevel: "UNVERIFIED",
  ...over,
});

function outageInput(): AnalysisInput {
  const assets = [
    { id: "exo", name: "Exchange Online" },
    { id: "crm", name: "CRM Email Sync" },
    { id: "outlook", name: "Outlook Mail Access" },
    { id: "portal", name: "Azure-hosted Customer Portal" },
  ];
  const evidence = [
    ev({ id: "e1", ref: "EV-0001", title: "Provider-reported disruption", category: "PROVIDER_NOTICE", provenance: "PUBLIC_REPORTED", assetId: "exo", assetName: "Exchange Online", assetStatus: "DEGRADED", observedAt: new Date("2026-11-12T16:20:00Z") }),
    ev({ id: "e2", ref: "EV-0002", title: "CRM 503", assetId: "crm", assetName: "CRM Email Sync", assetStatus: "DEGRADED", observedAt: new Date("2026-11-12T17:04:00Z") }),
  ];
  const observations = evidence.map((e) => ({ assetId: e.assetId!, status: e.assetStatus as "DEGRADED", observedAt: e.observedAt, evidenceId: e.id, provenance: e.provenance }));
  const impact = computeBlastRadius(assets, [
    { consumerAssetId: "crm", providerAssetId: "exo" },
    { consumerAssetId: "outlook", providerAssetId: "exo" },
  ], observations, { asOf: peakImpactTime(observations) });
  return {
    incident: { caseNumber: "CT-2026-001", title: "M365", type: "PROVIDER_OUTAGE", classification: "PROVIDER_TECHNICAL", status: "RESOLVED", severity: "HIGH" },
    evidence,
    assets,
    impact,
    hypotheses: [],
    openTasks: [{ title: "x", status: "OPEN" }],
  };
}

describe("rule-based analysis", () => {
  it("summarises provider outage without unsupported causation or attack attribution", () => {
    const out = runRuleBasedAnalysis(outageInput());
    expect(out.classificationSuggestion).toBe("PROVIDER_TECHNICAL");
    expect(out.summary).toMatch(/provider-reported/i);
    expect(out.summary).toMatch(/Simulated customer observations record failures on CRM Email Sync/);
    expect(out.summary).toMatch(/Outlook Mail Access as at risk/);
    expect(out.summary).toMatch(/Attribution to a cyberattack is not supported/);
    expect(out.summary).not.toMatch(/Azure-hosted Customer Portal/);
    expect(out.facts.every((f) => f.evidenceIds.length > 0)).toBe(true);
    expect(out.unknowns.join(" ")).toMatch(/not independently verified/);
  });

  it("never escalates suspicious sign-ins beyond SECURITY_SUSPECTED", () => {
    const input = outageInput();
    input.evidence = [
      ev({ id: "a1", ref: "EV-0010", category: "AUTH_EVENT", title: "Failed sign-in", contentText: "Failed login from 192.0.2.25" }),
      ev({ id: "a2", ref: "EV-0011", category: "AUTH_EVENT", title: "Successful sign-in", contentText: "Successful login from 198.51.100.17", observedAt: new Date("2026-11-12T17:05:00Z") }),
    ];
    input.impact = computeBlastRadius(input.assets, [], []);
    const out = runRuleBasedAnalysis(input);
    expect(out.classificationSuggestion).toBe("SECURITY_SUSPECTED");
    expect(out.summary).toMatch(/does not by itself establish account compromise/);
    expect(out.unknowns.join(" ")).toMatch(/198\.51\.100\.17/);
  });

  it("handles a case with no evidence", () => {
    const input = outageInput();
    input.evidence = [];
    expect(runRuleBasedAnalysis(input).classificationSuggestion).toBe("UNDETERMINED");
  });
});

describe("Claude output validation", () => {
  it("drops claims that cite unknown evidence and maps refs to ids", () => {
    const input = outageInput();
    const out = sanitiseClaudeOutput(
      {
        summary: "s",
        classificationSuggestion: "PROVIDER_TECHNICAL",
        facts: [
          { statement: "real", evidenceRefs: ["ev-0001"] },
          { statement: "invented", evidenceRefs: ["EV-9999"] },
        ],
        hypotheses: [{ statement: "h", confidence: "LOW", supportingEvidenceRefs: [], contradictingEvidenceRefs: [] }],
        unknowns: [],
        recommendedActions: [{ description: "do", reasonEvidenceRefs: ["EV-0002", "bogus"] }],
        limitations: [],
      },
      input,
    );
    expect(out.facts).toEqual([{ statement: "real", evidenceIds: ["e1"] }]);
    expect(out.hypotheses).toEqual([]);
    expect(out.recommendedActions[0].reasonEvidenceIds).toEqual(["e2"]);
    expect(out.limitations.join(" ")).toMatch(/2 model claim\(s\) were removed/);
  });
});

describe("correlation", () => {
  it("sorts by event time with id tie-break, not ingestion order", () => {
    const events = [
      { id: "b", occurredAt: new Date("2026-11-12T17:00:00Z") },
      { id: "a", occurredAt: new Date("2026-11-12T17:00:00Z") },
      { id: "c", occurredAt: new Date("2026-11-12T16:00:00Z") },
    ];
    expect(sortChronologically(events).map((e) => e.id)).toEqual(["c", "a", "b"]);
    expect(sortChronologically(events, "desc").map((e) => e.id)).toEqual(["b", "a", "c"]);
  });

  it("relates same-asset events within ±15 minutes and same source event ids", () => {
    const rel = correlateEvents([
      { id: "1", occurredAt: new Date("2026-11-12T17:00:00Z"), assetId: "crm", sourceEventId: null },
      { id: "2", occurredAt: new Date("2026-11-12T17:10:00Z"), assetId: "crm", sourceEventId: "S" },
      { id: "3", occurredAt: new Date("2026-11-12T17:40:00Z"), assetId: "crm", sourceEventId: "S" },
    ]);
    expect(rel.get("1")).toEqual([{ eventId: "2", reason: "SAME_ASSET_WINDOW" }]);
    expect(rel.get("3")).toEqual([{ eventId: "2", reason: "SAME_SOURCE_EVENT_ID" }]);
  });
});

describe("CSV export", () => {
  it("quotes values and neutralises spreadsheet formulas", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("+1")).toBe(`"'+1"`);
    expect(csvCell("-2")).toBe(`"'-2"`);
    expect(csvCell("@cmd")).toBe(`"'@cmd"`);
    expect(toCsv(["a"], [["x,y"]])).toBe('"a"\r\n"x,y"\r\n');
    expect(safeFilename('CT-2026-001 "v1"/../x.csv')).toBe("CT-2026-001-v1-..-x.csv");
  });
});

describe("status workflow", () => {
  it("follows OPEN → INVESTIGATING → MONITORING → RESOLVED and allows re-open", () => {
    expect(canTransition("OPEN", "INVESTIGATING")).toBe(true);
    expect(canTransition("OPEN", "RESOLVED")).toBe(false);
    expect(canTransition("MONITORING", "RESOLVED")).toBe(true);
    expect(canTransition("RESOLVED", "INVESTIGATING")).toBe(true);
    expect(canTransition("RESOLVED", "OPEN")).toBe(false);
  });
});
