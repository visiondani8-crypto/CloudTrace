/**
 * Builds an immutable report snapshot document from case data. Pure function:
 * the caller loads data (org-scoped) and persists the result as a versioned
 * ReportSnapshot. The snapshot embeds copies of every cited evidence record so
 * later changes never alter what an earlier version said.
 */

import type { AnalysisOutput } from "@/lib/analysis/types";
import type { BlastRadiusResult } from "@/lib/blast-radius";
import { formatEvidenceRef } from "@/lib/domain/enums";
import { formatUtc } from "@/lib/domain/time";
import {
  CLASSIFICATION_LABELS,
  IMPACT_LABELS,
  PROVENANCE_LABELS,
  SEVERITY_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  labelOf,
  textOf,
} from "@/lib/ui/labels";

export const REPORT_SCHEMA = "cloudtrace-report-v1";

export interface ReportBundle {
  version: number;
  generatedAt: Date;
  generatedBy: string;
  organizationName: string;
  incident: {
    id: string;
    caseNumber: string;
    title: string;
    description: string;
    type: string;
    severity: string;
    status: string;
    classification: string;
    startedAt: Date | null;
    resolvedAt: Date | null;
    ownerName: string | null;
    dataLabel: string | null;
    isDemo: boolean;
  };
  assets: { id: string; name: string; provider: string; criticality: string; inScope: boolean }[];
  evidence: {
    id: string;
    refNumber: number;
    title: string;
    category: string;
    provenance: string;
    sourceName: string;
    sourceUri: string | null;
    sourceEventId: string | null;
    observedAt: Date;
    ingestedAt: Date;
    sha256: string;
    isSynthetic: boolean;
    confidenceLevel: string;
    assetName: string | null;
  }[];
  timeline: {
    id: string;
    occurredAt: Date;
    title: string;
    description: string | null;
    sourceClass: string;
    evidenceId: string | null;
    assetName: string | null;
  }[];
  impact: BlastRadiusResult;
  hypotheses: {
    id: string;
    title: string;
    description: string;
    status: string;
    confidence: string;
    note: string | null;
    createdBy: string;
    updatedAt: Date;
    supportingEvidenceIds: string[];
    contradictingEvidenceIds: string[];
  }[];
  tasks: {
    id: string;
    title: string;
    status: string;
    priority: string;
    assignee: string | null;
    dueAt: Date | null;
    completedAt: Date | null;
  }[];
  notes: { author: string; createdAt: Date; text: string }[];
  sources: { title: string; url: string; publisher: string | null; retrievedAt: Date; status: string; note: string | null }[];
  analysis: (AnalysisOutput & { mode: string; generatedAt: Date; modelId: string | null; computedForReport: boolean }) | null;
}

export interface ReportContent {
  schema: typeof REPORT_SCHEMA;
  version: number;
  generatedAt: string;
  generatedBy: string;
  organization: string;
  title: string;
  dataNotice: { containsSimulated: boolean; containsPublicReports: boolean; lines: string[] };
  identification: {
    caseNumber: string;
    title: string;
    period: string;
    severity: string;
    status: string;
    type: string;
    owner: string | null;
    dataLabel: string | null;
  };
  scope: { description: string; assetsInScope: { name: string; provider: string; criticality: string }[] };
  executiveSummary: {
    classification: string;
    classificationNote: string;
    analystConclusion: string;
    analysisMode: string;
    analysisGeneratedAt: string | null;
    providerStatements: { ref: string; title: string; sourceName: string; sourceUri: string | null }[];
  };
  known: { statement: string; evidenceRefs: string[] }[];
  unverified: string[];
  timeline: {
    eventId: string;
    occurredAt: string;
    title: string;
    description: string | null;
    evidenceRef: string | null;
    provenance: string;
    sourceName: string | null;
    asset: string | null;
    verification: string;
  }[];
  impact: {
    assessedAt: string | null;
    confirmed: { asset: string; basis: string; evidenceRefs: string[]; reason: string }[];
    providerReported: { asset: string; evidenceRefs: string[]; reason: string }[];
    atRisk: { asset: string; path: string[]; reason: string }[];
    healthy: { asset: string; evidenceRefs: string[]; reason: string }[];
    unknown: string[];
    cycles: string[][];
  };
  hypotheses: {
    title: string;
    description: string;
    status: string;
    confidence: string;
    note: string | null;
    owner: string;
    updatedAt: string;
    supportingRefs: string[];
    contradictingRefs: string[];
  }[];
  responseActions: {
    statement: string;
    tasks: { title: string; status: string; priority: string; assignee: string | null; dueAt: string | null; completedAt: string | null }[];
  };
  recommendations: string[];
  analystNotes: { author: string; createdAt: string; text: string }[];
  limitations: string[];
  references: {
    sources: { title: string; url: string; publisher: string | null; retrievedAt: string; status: string; note: string | null }[];
    evidence: {
      ref: string;
      id: string;
      title: string;
      category: string;
      provenance: string;
      sourceName: string;
      sourceUri: string | null;
      sourceEventId: string | null;
      observedAt: string;
      ingestedAt: string;
      sha256: string;
      simulated: boolean;
      confidence: string;
      asset: string | null;
    }[];
  };
}

export function buildReportContent(b: ReportBundle): ReportContent {
  const refById = new Map(b.evidence.map((e) => [e.id, formatEvidenceRef(e.refNumber)]));
  const evidenceById = new Map(b.evidence.map((e) => [e.id, e]));
  const nameById = new Map(b.assets.map((a) => [a.id, a.name]));
  const refs = (ids: string[]) => ids.map((id) => refById.get(id)).filter((x): x is string => !!x);

  const containsSimulated = b.evidence.some((e) => e.isSynthetic);
  const containsPublicReports = b.evidence.some((e) => e.provenance === "PUBLIC_REPORTED");
  const noticeLines: string[] = [];
  if (containsSimulated) {
    noticeLines.push(
      "SIMULATED DATA: this report includes simulated company events. They are not observed Microsoft tenant or customer activity.",
    );
  }
  if (containsPublicReports) {
    noticeLines.push(
      "PUBLIC REPORTS: provider-reported details are taken from public communications and are not independently verified from internal provider telemetry. Preliminary reports may be superseded.",
    );
  }
  if (b.incident.isDemo) noticeLines.push("DEMONSTRATION WORKSPACE: this is not a live investigation of a real organisation.");

  const analysis = b.analysis;
  const classification = labelOf(CLASSIFICATION_LABELS, b.incident.classification).label;
  const classificationNote =
    b.incident.classification === "PROVIDER_TECHNICAL"
      ? "Analyst classification: provider technical disruption, based on provider communications. The provider's stated cause is a provider-reported explanation, not an independently verified root cause."
      : b.incident.classification === "SECURITY_SUSPECTED"
        ? "Analyst classification: security suspected. Compromise is not confirmed; analyst review of the evidence is ongoing."
        : b.incident.classification === "CONFIRMED_SECURITY"
          ? "Analyst classification: confirmed security incident, set explicitly by a human analyst after evidence review."
          : `Analyst classification: ${classification}.`;

  const impacts = Object.values(b.impact.impacts);
  const impact = {
    assessedAt: b.impact.assessedAt,
    confirmed: impacts
      .filter((i) => i.state === "CONFIRMED_AFFECTED" && !i.providerReported)
      .map((i) => ({
        asset: nameById.get(i.assetId) ?? i.assetId,
        basis: i.basis ? labelOf(PROVENANCE_LABELS, i.basis).label : "—",
        evidenceRefs: refs(i.evidence.map((r) => r.evidenceId)),
        reason: i.reason,
      })),
    providerReported: impacts
      .filter((i) => i.providerReported)
      .map((i) => ({
        asset: nameById.get(i.assetId) ?? i.assetId,
        evidenceRefs: refs(i.evidence.map((r) => r.evidenceId)),
        reason: i.reason,
      })),
    atRisk: impacts
      .filter((i) => i.state === "POTENTIALLY_AFFECTED")
      .map((i) => ({
        asset: nameById.get(i.assetId) ?? i.assetId,
        path: (i.path ?? []).map((id) => nameById.get(id) ?? id),
        reason: i.reason,
      })),
    healthy: impacts
      .filter((i) => i.state === "CONFIRMED_HEALTHY")
      .map((i) => ({
        asset: nameById.get(i.assetId) ?? i.assetId,
        evidenceRefs: refs(i.evidence.map((r) => r.evidenceId)),
        reason: i.reason,
      })),
    unknown: impacts.filter((i) => i.state === "UNKNOWN").map((i) => nameById.get(i.assetId) ?? i.assetId),
    cycles: b.impact.cycles.map((c) => c.map((id) => nameById.get(id) ?? id)),
  };

  const limitations = [
    ...(analysis?.limitations ?? []),
    "CloudTrace records evidence and analyst decisions. It does not perform forensic imaging or verify provider-internal telemetry.",
    "SHA-256 values prove the stored evidence record is unchanged since ingestion; they are not a chain of custody for upstream systems.",
    "Dependency 'at risk' states indicate possible downstream effects only.",
  ];
  if (containsSimulated) limitations.push("Simulated records are demonstration data and must not be treated as real observations.");
  if (b.evidence.every((e) => e.provenance !== "CUSTOMER_OBSERVED")) {
    limitations.push("No observations from the organisation's own authorised systems are recorded for this case.");
  }

  const recommendations = [
    ...(analysis?.recommendedActions.map((a) => {
      const r = refs(a.reasonEvidenceIds);
      return r.length ? `${a.description} (${r.join(", ")})` : a.description;
    }) ?? []),
    "Keep dependency mappings current so at-risk assessments reflect real service relationships.",
    "Record customer-side health observations during provider incidents to distinguish impact from risk.",
  ];

  return {
    schema: REPORT_SCHEMA,
    version: b.version,
    generatedAt: b.generatedAt.toISOString(),
    generatedBy: b.generatedBy,
    organization: b.organizationName,
    title: `${b.incident.caseNumber} — Post-incident investigation report v${b.version}`,
    dataNotice: { containsSimulated, containsPublicReports, lines: noticeLines },
    identification: {
      caseNumber: b.incident.caseNumber,
      title: b.incident.title,
      period: `${b.incident.startedAt ? formatUtc(b.incident.startedAt) : "Start not recorded"} → ${
        b.incident.resolvedAt ? formatUtc(b.incident.resolvedAt) : "Not resolved"
      }`,
      severity: labelOf(SEVERITY_LABELS, b.incident.severity).label,
      status: labelOf(STATUS_LABELS, b.incident.status).label,
      type: textOf(TYPE_LABELS, b.incident.type),
      owner: b.incident.ownerName,
      dataLabel: b.incident.dataLabel,
    },
    scope: {
      description: b.incident.description,
      assetsInScope: b.assets
        .filter((a) => a.inScope)
        .map((a) => ({ name: a.name, provider: a.provider, criticality: a.criticality })),
    },
    executiveSummary: {
      classification,
      classificationNote,
      analystConclusion: analysis?.summary ?? "No analysis available.",
      analysisMode: analysis
        ? analysis.mode === "CLAUDE"
          ? `Claude analysis${analysis.modelId ? ` (${analysis.modelId})` : ""}`
          : `Rule-based analysis${analysis.computedForReport ? " (computed at report generation)" : ""}`
        : "None",
      analysisGeneratedAt: analysis ? analysis.generatedAt.toISOString() : null,
      providerStatements: b.evidence
        .filter((e) => e.provenance === "PUBLIC_REPORTED")
        .map((e) => ({
          ref: formatEvidenceRef(e.refNumber),
          title: e.title,
          sourceName: e.sourceName,
          sourceUri: e.sourceUri,
        })),
    },
    known: (analysis?.facts ?? []).map((f) => ({ statement: f.statement, evidenceRefs: refs(f.evidenceIds) })),
    unverified: analysis?.unknowns ?? [],
    timeline: b.timeline.map((t) => {
      const ev = t.evidenceId ? evidenceById.get(t.evidenceId) : undefined;
      return {
        eventId: t.id,
        occurredAt: t.occurredAt.toISOString(),
        title: t.title,
        description: t.description,
        evidenceRef: ev ? formatEvidenceRef(ev.refNumber) : null,
        provenance: ev ? labelOf(PROVENANCE_LABELS, ev.provenance).label : labelOf(PROVENANCE_LABELS, t.sourceClass).label,
        sourceName: ev?.sourceName ?? null,
        asset: t.assetName,
        verification: ev ? "Evidence-linked" : "Analyst-entered / unverified",
      };
    }),
    impact,
    hypotheses: b.hypotheses.map((h) => ({
      title: h.title,
      description: h.description,
      status: h.status,
      confidence: h.confidence,
      note: h.note,
      owner: h.createdBy,
      updatedAt: h.updatedAt.toISOString(),
      supportingRefs: refs(h.supportingEvidenceIds),
      contradictingRefs: refs(h.contradictingEvidenceIds),
    })),
    responseActions: {
      statement:
        "Response tasks are manual follow-ups recorded by analysts. CloudTrace has not executed any containment or change against external systems.",
      tasks: b.tasks.map((t) => ({
        title: t.title,
        status: t.status,
        priority: t.priority,
        assignee: t.assignee,
        dueAt: t.dueAt ? t.dueAt.toISOString() : null,
        completedAt: t.completedAt ? t.completedAt.toISOString() : null,
      })),
    },
    recommendations,
    analystNotes: b.notes.map((n) => ({ author: n.author, createdAt: n.createdAt.toISOString(), text: n.text })),
    limitations,
    references: {
      sources: b.sources.map((s) => ({
        title: s.title,
        url: s.url,
        publisher: s.publisher,
        retrievedAt: s.retrievedAt.toISOString(),
        status: s.status,
        note: s.note,
      })),
      evidence: b.evidence.map((e) => ({
        ref: formatEvidenceRef(e.refNumber),
        id: e.id,
        title: e.title,
        category: e.category,
        provenance: e.provenance,
        sourceName: e.sourceName,
        sourceUri: e.sourceUri,
        sourceEventId: e.sourceEventId,
        observedAt: e.observedAt.toISOString(),
        ingestedAt: e.ingestedAt.toISOString(),
        sha256: e.sha256,
        simulated: e.isSynthetic,
        confidence: e.confidenceLevel,
        asset: e.assetName,
      })),
    },
  };
}

export const IMPACT_SECTION_LABELS = IMPACT_LABELS;

/** Plain-text executive summary for the "Copy summary" action. */
export function reportSummaryText(c: ReportContent): string {
  return [
    `${c.identification.caseNumber} — ${c.identification.title} (report v${c.version})`,
    `Severity: ${c.identification.severity} · Status: ${c.identification.status} · Classification: ${c.executiveSummary.classification}`,
    "",
    c.executiveSummary.analystConclusion,
    "",
    ...c.dataNotice.lines,
    `Generated ${formatUtc(c.generatedAt)} by ${c.generatedBy} · ${c.executiveSummary.analysisMode}`,
  ].join("\n");
}

export function reportTimelineCsvRows(c: ReportContent): { headers: string[]; rows: unknown[][] } {
  return {
    headers: [
      "case_number",
      "report_version",
      "event_id",
      "occurred_at_utc",
      "title",
      "description",
      "evidence_ref",
      "provenance",
      "source_name",
      "asset",
      "verification",
    ],
    rows: c.timeline.map((t) => [
      c.identification.caseNumber,
      c.version,
      t.eventId,
      t.occurredAt,
      t.title,
      t.description ?? "",
      t.evidenceRef ?? "",
      t.provenance,
      t.sourceName ?? "",
      t.asset ?? "",
      t.verification,
    ]),
  };
}
