/**
 * Org-scoped data loaders shared by the services and the seed script. Every
 * query filters by organizationId. Takes the database client as a parameter so
 * it can run outside the Next.js server runtime (seed, tests).
 */

import type { Prisma } from "@prisma/client";
import type { AnalysisInput, AnalysisOutput } from "@/lib/analysis/types";
import { computeBlastRadius, peakImpactTime, type BlastRadiusResult, type Observation, type ObservationStatus } from "@/lib/blast-radius";
import {
  formatEvidenceRef,
  isOneOf,
  PROVENANCES,
  type Classification,
  type EvidenceCategory,
  type IncidentStatus,
  type IncidentType,
  type Provenance,
  type Severity,
} from "@/lib/domain/enums";
import { buildReportContent, type ReportContent } from "@/lib/reports/build";

type Db = Prisma.TransactionClient;

export type ImpactView = "peak" | "latest";

export interface IncidentImpact {
  view: ImpactView;
  asOf: string | null;
  result: BlastRadiusResult;
  observations: (Omit<Observation, "observedAt"> & { observedAt: string })[];
}

/** Evidence-backed asset observations: evidence assertions plus analyst-recorded statuses. */
export async function loadObservations(db: Db, organizationId: string, incidentId: string): Promise<Observation[]> {
  const [evidence, recorded] = await Promise.all([
    db.evidence.findMany({
      where: { organizationId, incidentId, assetId: { not: null }, assetStatus: { not: null } },
      select: { id: true, assetId: true, assetStatus: true, observedAt: true, provenance: true },
    }),
    db.incidentAsset.findMany({
      where: { organizationId, incidentId, observedStatus: { not: "UNKNOWN" }, statusEvidenceId: { not: null } },
    }),
  ]);
  const observations: Observation[] = [];
  const seen = new Set<string>();
  for (const e of evidence) {
    if (!e.assetId || !e.assetStatus || !isOneOf(PROVENANCES, e.provenance)) continue;
    observations.push({
      assetId: e.assetId,
      status: e.assetStatus as ObservationStatus,
      observedAt: e.observedAt,
      evidenceId: e.id,
      provenance: e.provenance as Provenance,
    });
    seen.add(`${e.id}:${e.assetId}`);
  }
  const linked = await db.evidence.findMany({
    where: { id: { in: recorded.map((r) => r.statusEvidenceId!) }, organizationId, incidentId },
    select: { id: true, observedAt: true, provenance: true },
  });
  const byId = new Map(linked.map((e) => [e.id, e]));
  for (const r of recorded) {
    const ev = byId.get(r.statusEvidenceId!);
    if (!ev || seen.has(`${ev.id}:${r.assetId}`) || !isOneOf(PROVENANCES, ev.provenance)) continue;
    observations.push({
      assetId: r.assetId,
      status: r.observedStatus as ObservationStatus,
      observedAt: r.observedAt ?? ev.observedAt,
      evidenceId: ev.id,
      provenance: ev.provenance as Provenance,
    });
  }
  return observations;
}

/**
 * Blast radius for one incident. "peak" assesses at the latest failure
 * observation (incident impact); "latest" considers every observation.
 */
export async function loadImpact(db: Db, organizationId: string, incidentId: string, view: ImpactView = "peak"): Promise<IncidentImpact> {
  const [assets, deps, observations] = await Promise.all([
    db.asset.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    db.dependency.findMany({ where: { organizationId }, select: { id: true, consumerAssetId: true, providerAssetId: true } }),
    loadObservations(db, organizationId, incidentId),
  ]);
  const asOf = view === "peak" ? peakImpactTime(observations) : null;
  const result = computeBlastRadius(assets, deps, observations, { asOf });
  return {
    view,
    asOf: asOf?.toISOString() ?? null,
    result,
    observations: observations.map((o) => ({ ...o, observedAt: o.observedAt.toISOString() })),
  };
}

export async function loadAnalysisInput(db: Db, organizationId: string, incidentId: string): Promise<AnalysisInput> {
  const incident = await db.incident.findFirstOrThrow({ where: { id: incidentId, organizationId } });
  const [evidence, assets, impact, hypotheses, tasks] = await Promise.all([
    db.evidence.findMany({
      where: { organizationId, incidentId },
      include: { asset: { select: { name: true } } },
      orderBy: [{ observedAt: "asc" }, { id: "asc" }],
      take: 2000,
    }),
    db.asset.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    loadImpact(db, organizationId, incidentId, "peak"),
    db.hypothesis.findMany({ where: { organizationId, incidentId }, include: { evidence: true } }),
    db.responseTask.findMany({ where: { organizationId, incidentId }, select: { title: true, status: true } }),
  ]);
  return {
    incident: {
      caseNumber: incident.caseNumber,
      title: incident.title,
      type: incident.type as IncidentType,
      classification: incident.classification as Classification,
      status: incident.status as IncidentStatus,
      severity: incident.severity as Severity,
    },
    evidence: evidence.map((e) => ({
      id: e.id,
      ref: formatEvidenceRef(e.refNumber),
      title: e.title,
      category: e.category as EvidenceCategory,
      provenance: e.provenance as Provenance,
      sourceName: e.sourceName,
      observedAt: e.observedAt,
      assetId: e.assetId,
      assetName: e.asset?.name ?? null,
      assetStatus: e.assetStatus,
      contentText: e.contentText,
      confidenceLevel: e.confidenceLevel,
    })),
    assets,
    impact: impact.result,
    hypotheses: hypotheses.map((h) => ({
      title: h.title,
      status: h.status as AnalysisInput["hypotheses"][number]["status"],
      confidence: h.confidence as AnalysisInput["hypotheses"][number]["confidence"],
      supportingEvidenceIds: h.evidence.filter((l) => l.relation === "SUPPORTING").map((l) => l.evidenceId),
      contradictingEvidenceIds: h.evidence.filter((l) => l.relation === "CONTRADICTING").map((l) => l.evidenceId),
    })),
    openTasks: tasks,
  };
}

export type ReportAnalysis = AnalysisOutput & { mode: string; generatedAt: Date; modelId: string | null; computedForReport: boolean };

async function memberNames(db: Db, organizationId: string) {
  const members = await db.membership.findMany({ where: { organizationId }, include: { user: { select: { id: true, name: true } } } });
  return new Map(members.map((m) => [m.user.id, m.user.name]));
}

/** Loads everything a report snapshot cites and builds the immutable content document. */
export async function assembleReport(
  db: Db,
  scope: { organizationId: string; generatedBy: string },
  incidentId: string,
  version: number,
  analysis: ReportAnalysis,
): Promise<ReportContent> {
  const { organizationId } = scope;
  const incident = await db.incident.findFirstOrThrow({ where: { id: incidentId, organizationId } });
  const [names, org, assets, scopeRows, evidence, timeline, impact, hypotheses, tasks, notes, sources] = await Promise.all([
    memberNames(db, organizationId),
    db.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    db.asset.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    db.incidentAsset.findMany({ where: { organizationId, incidentId }, select: { assetId: true } }),
    db.evidence.findMany({
      where: { organizationId, incidentId },
      include: { asset: { select: { name: true } } },
      orderBy: [{ observedAt: "asc" }, { id: "asc" }],
    }),
    db.timelineEvent.findMany({
      where: { organizationId, incidentId },
      include: { asset: { select: { name: true } } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    }),
    loadImpact(db, organizationId, incidentId, "peak"),
    db.hypothesis.findMany({ where: { organizationId, incidentId }, include: { evidence: true }, orderBy: { createdAt: "asc" } }),
    db.responseTask.findMany({ where: { organizationId, incidentId }, orderBy: { createdAt: "asc" } }),
    db.investigationNote.findMany({ where: { organizationId, incidentId }, orderBy: { createdAt: "asc" } }),
    db.incidentSource.findMany({ where: { organizationId, incidentId }, orderBy: { retrievedAt: "asc" } }),
  ]);

  const inScope = new Set(scopeRows.map((s) => s.assetId));
  const touched = new Set([
    ...inScope,
    ...evidence.map((e) => e.assetId).filter((x): x is string => !!x),
    ...Object.values(impact.result.impacts)
      .filter((i) => i.state !== "UNKNOWN")
      .map((i) => i.assetId),
  ]);

  return buildReportContent({
    version,
    generatedAt: new Date(),
    generatedBy: scope.generatedBy,
    organizationName: org.name,
    incident: {
      id: incident.id,
      caseNumber: incident.caseNumber,
      title: incident.title,
      description: incident.description,
      type: incident.type,
      severity: incident.severity,
      status: incident.status,
      classification: incident.classification,
      startedAt: incident.startedAt,
      resolvedAt: incident.resolvedAt,
      ownerName: incident.ownerId ? (names.get(incident.ownerId) ?? null) : null,
      dataLabel: incident.dataLabel,
      isDemo: incident.isDemo,
    },
    assets: assets
      .filter((a) => touched.has(a.id))
      .map((a) => ({ id: a.id, name: a.name, provider: a.provider, criticality: a.criticality, inScope: inScope.has(a.id) })),
    evidence: evidence.map((e) => ({
      id: e.id,
      refNumber: e.refNumber,
      title: e.title,
      category: e.category,
      provenance: e.provenance,
      sourceName: e.sourceName,
      sourceUri: e.sourceUri,
      sourceEventId: e.sourceEventId,
      observedAt: e.observedAt,
      ingestedAt: e.ingestedAt,
      sha256: e.sha256,
      isSynthetic: e.isSynthetic,
      confidenceLevel: e.confidenceLevel,
      assetName: e.asset?.name ?? null,
    })),
    timeline: timeline.map((t) => ({
      id: t.id,
      occurredAt: t.occurredAt,
      title: t.title,
      description: t.description,
      sourceClass: t.sourceClass,
      evidenceId: t.evidenceId,
      assetName: t.asset?.name ?? null,
    })),
    impact: impact.result,
    hypotheses: hypotheses.map((h) => ({
      id: h.id,
      title: h.title,
      description: h.description,
      status: h.status,
      confidence: h.confidence,
      note: h.note,
      createdBy: names.get(h.createdById) ?? "Former member",
      updatedAt: h.updatedAt,
      supportingEvidenceIds: h.evidence.filter((l) => l.relation === "SUPPORTING").map((l) => l.evidenceId),
      contradictingEvidenceIds: h.evidence.filter((l) => l.relation === "CONTRADICTING").map((l) => l.evidenceId),
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      assignee: t.assigneeId ? (names.get(t.assigneeId) ?? "Former member") : null,
      dueAt: t.dueAt,
      completedAt: t.completedAt,
    })),
    notes: notes.map((n) => ({ author: names.get(n.authorId) ?? "Former member", createdAt: n.createdAt, text: n.text })),
    sources: sources.map((s) => ({
      title: s.title,
      url: s.url,
      publisher: s.publisher,
      retrievedAt: s.retrievedAt,
      status: s.status,
      note: s.note,
    })),
    analysis,
  });
}
