import "server-only";
import { requireRole, type AuthContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import { correlateEvents, RELATION_LABELS, sortChronologically } from "@/lib/correlation";
import { prisma, type Tx } from "@/lib/db";
import { formatEvidenceRef } from "@/lib/domain/enums";
import { AppError, notFound } from "@/lib/domain/errors";
import {
  hypothesisSchema,
  hypothesisUpdateSchema,
  noteSchema,
  taskSchema,
  taskUpdateSchema,
  timelineEntrySchema,
} from "@/lib/validation/schemas";
import { assetOrThrow, evidenceIdsInIncident, incidentOrThrow, memberNameMap, memberOrThrow } from "./guards";

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface TimelineItem {
  id: string;
  occurredAt: string;
  ingestedAt: string;
  title: string;
  description: string | null;
  eventType: string;
  sourceClass: string;
  verified: boolean;
  evidenceId: string | null;
  evidenceRef: string | null;
  sourceName: string | null;
  sourceEventId: string | null;
  sha256: string | null;
  confidenceLevel: string | null;
  assetId: string | null;
  assetName: string | null;
  related: { eventId: string; reason: string }[];
}

export async function getTimeline(ctx: AuthContext, incidentId: string): Promise<TimelineItem[]> {
  await incidentOrThrow(prisma, ctx, incidentId);
  const events = await prisma.timelineEvent.findMany({
    where: { organizationId: ctx.organizationId, incidentId },
    include: {
      evidence: {
        select: {
          id: true,
          refNumber: true,
          sourceName: true,
          sourceEventId: true,
          sha256: true,
          confidenceLevel: true,
          provenance: true,
          ingestedAt: true,
        },
      },
      asset: { select: { name: true } },
    },
    take: 5000,
  });
  const related = correlateEvents(
    events.map((e) => ({
      id: e.id,
      occurredAt: e.occurredAt,
      assetId: e.assetId,
      sourceEventId: e.evidence?.sourceEventId ?? null,
    })),
  );
  return sortChronologically(events).map((e) => ({
    id: e.id,
    occurredAt: e.occurredAt.toISOString(),
    ingestedAt: (e.evidence?.ingestedAt ?? e.createdAt).toISOString(),
    title: e.title,
    description: e.description,
    eventType: e.eventType,
    sourceClass: e.evidence?.provenance ?? e.sourceClass,
    verified: !!e.evidence,
    evidenceId: e.evidence?.id ?? null,
    evidenceRef: e.evidence ? formatEvidenceRef(e.evidence.refNumber) : null,
    sourceName: e.evidence?.sourceName ?? null,
    sourceEventId: e.evidence?.sourceEventId ?? null,
    sha256: e.evidence?.sha256 ?? null,
    confidenceLevel: e.evidence?.confidenceLevel ?? null,
    assetId: e.assetId,
    assetName: e.asset?.name ?? null,
    related: (related.get(e.id) ?? []).map((r) => ({ eventId: r.eventId, reason: RELATION_LABELS[r.reason] })),
  }));
}

/** Adds an analyst-entered event with no evidence; it is always displayed as unverified. */
export async function addTimelineEntry(ctx: AuthContext, incidentId: string, raw: unknown) {
  requireRole(ctx, "ANALYST");
  const input = timelineEntrySchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const incident = await incidentOrThrow(tx, ctx, incidentId);
    if (input.assetId) await assetOrThrow(tx, ctx, input.assetId);
    const event = await tx.timelineEvent.create({
      data: {
        organizationId: ctx.organizationId,
        incidentId: incident.id,
        assetId: input.assetId ?? null,
        occurredAt: input.occurredAt,
        eventType: "ANALYST_ENTRY",
        title: input.title,
        description: input.description ?? null,
        sourceClass: "ANALYST_NOTE",
        createdById: ctx.userId,
      },
    });
    await writeAudit(tx, ctx, {
      action: "timeline.entry_added",
      entityType: "TimelineEvent",
      entityId: event.id,
      summary: `${incident.caseNumber}: analyst-entered timeline event "${event.title}" (unverified)`,
      metadata: { caseNumber: incident.caseNumber },
    });
    return event;
  });
}

// ---------------------------------------------------------------------------
// Hypotheses
// ---------------------------------------------------------------------------

export async function listHypotheses(ctx: AuthContext, incidentId: string) {
  await incidentOrThrow(prisma, ctx, incidentId);
  const [rows, names] = await Promise.all([
    prisma.hypothesis.findMany({
      where: { organizationId: ctx.organizationId, incidentId },
      include: { evidence: { include: { evidence: { select: { id: true, refNumber: true, title: true, provenance: true } } } } },
      orderBy: { updatedAt: "desc" },
    }),
    memberNameMap(prisma, ctx),
  ]);
  const statusOrder: Record<string, number> = { SUPPORTED: 0, OPEN: 1, UNRESOLVED: 2, REJECTED: 3 };
  const confidenceOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return rows
    .map((h) => ({
      id: h.id,
      title: h.title,
      description: h.description,
      confidence: h.confidence,
      status: h.status,
      note: h.note,
      createdByName: names.get(h.createdById) ?? "Former member",
      createdAt: h.createdAt.toISOString(),
      updatedAt: h.updatedAt.toISOString(),
      supporting: h.evidence
        .filter((l) => l.relation === "SUPPORTING")
        .map((l) => ({ id: l.evidence.id, ref: formatEvidenceRef(l.evidence.refNumber), title: l.evidence.title, provenance: l.evidence.provenance })),
      contradicting: h.evidence
        .filter((l) => l.relation === "CONTRADICTING")
        .map((l) => ({ id: l.evidence.id, ref: formatEvidenceRef(l.evidence.refNumber), title: l.evidence.title, provenance: l.evidence.provenance })),
    }))
    .sort(
      (a, b) =>
        (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) ||
        (confidenceOrder[a.confidence] ?? 9) - (confidenceOrder[b.confidence] ?? 9) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
}

export type HypothesisView = Awaited<ReturnType<typeof listHypotheses>>[number];

const SUPPORTED_NEEDS_EVIDENCE = "A hypothesis can only be marked Supported when at least one supporting evidence item is linked.";

async function replaceHypothesisLinks(tx: Tx, ctx: AuthContext, hypothesisId: string, supporting: string[], contradicting: string[]) {
  await tx.hypothesisEvidence.deleteMany({ where: { hypothesisId, organizationId: ctx.organizationId } });
  const data = [
    ...supporting.map((evidenceId) => ({ evidenceId, relation: "SUPPORTING" })),
    ...contradicting.map((evidenceId) => ({ evidenceId, relation: "CONTRADICTING" })),
  ].map((d) => ({ ...d, organizationId: ctx.organizationId, hypothesisId }));
  if (data.length) await tx.hypothesisEvidence.createMany({ data });
}

export async function createHypothesis(ctx: AuthContext, incidentId: string, raw: unknown) {
  requireRole(ctx, "ANALYST");
  const input = hypothesisSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const incident = await incidentOrThrow(tx, ctx, incidentId);
    const supporting = await evidenceIdsInIncident(tx, ctx, incident.id, input.supportingEvidenceIds, "supportingEvidenceIds");
    const contradicting = await evidenceIdsInIncident(tx, ctx, incident.id, input.contradictingEvidenceIds, "contradictingEvidenceIds");
    if (input.status === "SUPPORTED" && supporting.length === 0) {
      throw new AppError("VALIDATION_ERROR", SUPPORTED_NEEDS_EVIDENCE, [{ path: "status", message: SUPPORTED_NEEDS_EVIDENCE }]);
    }
    const hypothesis = await tx.hypothesis.create({
      data: {
        organizationId: ctx.organizationId,
        incidentId: incident.id,
        title: input.title,
        description: input.description,
        confidence: input.confidence,
        status: input.status,
        note: input.note ?? null,
        createdById: ctx.userId,
      },
    });
    await replaceHypothesisLinks(tx, ctx, hypothesis.id, supporting, contradicting);
    await writeAudit(tx, ctx, {
      action: "hypothesis.created",
      entityType: "Hypothesis",
      entityId: hypothesis.id,
      summary: `${incident.caseNumber}: hypothesis "${hypothesis.title}" (${hypothesis.status.toLowerCase()}, ${hypothesis.confidence.toLowerCase()} confidence)`,
      metadata: { caseNumber: incident.caseNumber, supporting: supporting.length, contradicting: contradicting.length },
    });
    return hypothesis;
  });
}

export async function updateHypothesis(ctx: AuthContext, incidentId: string, raw: unknown) {
  requireRole(ctx, "ANALYST");
  const input = hypothesisUpdateSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const incident = await incidentOrThrow(tx, ctx, incidentId);
    const current = await tx.hypothesis.findFirst({
      where: { id: input.id, organizationId: ctx.organizationId, incidentId: incident.id },
      include: { evidence: true },
    });
    if (!current) throw notFound("Hypothesis");

    const supporting =
      input.supportingEvidenceIds !== undefined
        ? await evidenceIdsInIncident(tx, ctx, incident.id, input.supportingEvidenceIds, "supportingEvidenceIds")
        : current.evidence.filter((l) => l.relation === "SUPPORTING").map((l) => l.evidenceId);
    const contradicting =
      input.contradictingEvidenceIds !== undefined
        ? await evidenceIdsInIncident(tx, ctx, incident.id, input.contradictingEvidenceIds, "contradictingEvidenceIds")
        : current.evidence.filter((l) => l.relation === "CONTRADICTING").map((l) => l.evidenceId);
    const status = input.status ?? current.status;
    if (status === "SUPPORTED" && supporting.length === 0) {
      throw new AppError("VALIDATION_ERROR", SUPPORTED_NEEDS_EVIDENCE, [{ path: "status", message: SUPPORTED_NEEDS_EVIDENCE }]);
    }
    const updated = await tx.hypothesis.update({
      where: { id: current.id },
      data: {
        title: input.title ?? current.title,
        description: input.description ?? current.description,
        confidence: input.confidence ?? current.confidence,
        status,
        note: input.note === undefined ? current.note : input.note,
      },
    });
    if (input.supportingEvidenceIds !== undefined || input.contradictingEvidenceIds !== undefined) {
      await replaceHypothesisLinks(tx, ctx, current.id, supporting, contradicting);
    }
    const changes: string[] = [];
    if (updated.status !== current.status) changes.push(`status ${current.status} → ${updated.status}`);
    if (updated.confidence !== current.confidence) changes.push(`confidence ${current.confidence} → ${updated.confidence}`);
    if (input.supportingEvidenceIds !== undefined || input.contradictingEvidenceIds !== undefined) changes.push("evidence links");
    if (updated.title !== current.title || updated.description !== current.description || updated.note !== current.note) changes.push("text");
    await writeAudit(tx, ctx, {
      action: "hypothesis.updated",
      entityType: "Hypothesis",
      entityId: current.id,
      summary: `${incident.caseNumber}: hypothesis "${updated.title}" — ${changes.join(", ") || "no changes"}`,
      metadata: { caseNumber: incident.caseNumber, supporting: supporting.length, contradicting: contradicting.length },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Response tasks (bookkeeping only — nothing executes against external systems)
// ---------------------------------------------------------------------------

export async function listTasks(ctx: AuthContext, incidentId: string) {
  await incidentOrThrow(prisma, ctx, incidentId);
  const [rows, names] = await Promise.all([
    prisma.responseTask.findMany({
      where: { organizationId: ctx.organizationId, incidentId },
      include: { evidence: { include: { evidence: { select: { id: true, refNumber: true } } } } },
      orderBy: [{ createdAt: "asc" }],
    }),
    memberNameMap(prisma, ctx),
  ]);
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    priority: t.priority,
    status: t.status,
    assigneeId: t.assigneeId,
    assigneeName: t.assigneeId ? (names.get(t.assigneeId) ?? "Former member") : null,
    dueAt: t.dueAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    createdByName: names.get(t.createdById) ?? "Former member",
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    evidence: t.evidence.map((l) => ({ id: l.evidence.id, ref: formatEvidenceRef(l.evidence.refNumber) })),
  }));
}

export type TaskView = Awaited<ReturnType<typeof listTasks>>[number];

export async function createTask(ctx: AuthContext, incidentId: string, raw: unknown) {
  requireRole(ctx, "ANALYST");
  const input = taskSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const incident = await incidentOrThrow(tx, ctx, incidentId);
    if (input.assigneeId) await memberOrThrow(tx, ctx, input.assigneeId, "Assignee");
    const evidenceIds = await evidenceIdsInIncident(tx, ctx, incident.id, input.evidenceIds, "evidenceIds");
    const task = await tx.responseTask.create({
      data: {
        organizationId: ctx.organizationId,
        incidentId: incident.id,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        status: input.status,
        assigneeId: input.assigneeId ?? null,
        dueAt: input.dueAt ?? null,
        completedAt: input.status === "DONE" ? new Date() : null,
        createdById: ctx.userId,
      },
    });
    if (evidenceIds.length) {
      await tx.taskEvidence.createMany({
        data: evidenceIds.map((evidenceId) => ({ organizationId: ctx.organizationId, taskId: task.id, evidenceId })),
      });
    }
    await writeAudit(tx, ctx, {
      action: "task.created",
      entityType: "ResponseTask",
      entityId: task.id,
      summary: `${incident.caseNumber}: task "${task.title}" (${task.priority.toLowerCase()} priority)`,
      metadata: { caseNumber: incident.caseNumber, status: task.status },
    });
    return task;
  });
}

export async function updateTask(ctx: AuthContext, incidentId: string, raw: unknown) {
  requireRole(ctx, "ANALYST");
  const input = taskUpdateSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const incident = await incidentOrThrow(tx, ctx, incidentId);
    const current = await tx.responseTask.findFirst({
      where: { id: input.id, organizationId: ctx.organizationId, incidentId: incident.id },
    });
    if (!current) throw notFound("Task");
    if (input.assigneeId) await memberOrThrow(tx, ctx, input.assigneeId, "Assignee");
    const status = input.status ?? current.status;
    const updated = await tx.responseTask.update({
      where: { id: current.id },
      data: {
        title: input.title ?? current.title,
        description: input.description === undefined ? current.description : input.description,
        priority: input.priority ?? current.priority,
        status,
        assigneeId: input.assigneeId === undefined ? current.assigneeId : input.assigneeId,
        dueAt: input.dueAt === undefined ? current.dueAt : input.dueAt,
        completedAt: status === "DONE" ? (current.completedAt ?? new Date()) : null,
      },
    });
    if (input.evidenceIds !== undefined) {
      const ids = await evidenceIdsInIncident(tx, ctx, incident.id, input.evidenceIds, "evidenceIds");
      await tx.taskEvidence.deleteMany({ where: { taskId: current.id, organizationId: ctx.organizationId } });
      if (ids.length) {
        await tx.taskEvidence.createMany({
          data: ids.map((evidenceId) => ({ organizationId: ctx.organizationId, taskId: current.id, evidenceId })),
        });
      }
    }
    await writeAudit(tx, ctx, {
      action: updated.status !== current.status ? "task.status_changed" : "task.updated",
      entityType: "ResponseTask",
      entityId: current.id,
      summary:
        updated.status !== current.status
          ? `${incident.caseNumber}: task "${updated.title}" ${current.status} → ${updated.status}`
          : `${incident.caseNumber}: task "${updated.title}" updated`,
      metadata: { caseNumber: incident.caseNumber, from: current.status, to: updated.status },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function listNotes(ctx: AuthContext, incidentId: string) {
  await incidentOrThrow(prisma, ctx, incidentId);
  const [rows, names] = await Promise.all([
    prisma.investigationNote.findMany({
      where: { organizationId: ctx.organizationId, incidentId },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    memberNameMap(prisma, ctx),
  ]);
  return rows.map((n) => ({
    id: n.id,
    text: n.text,
    authorName: names.get(n.authorId) ?? "Former member",
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function createNote(ctx: AuthContext, incidentId: string, raw: unknown) {
  requireRole(ctx, "ANALYST");
  const input = noteSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const incident = await incidentOrThrow(tx, ctx, incidentId);
    const note = await tx.investigationNote.create({
      data: { organizationId: ctx.organizationId, incidentId: incident.id, authorId: ctx.userId, text: input.text },
    });
    await tx.incident.update({ where: { id: incident.id }, data: { updatedAt: new Date() } });
    await writeAudit(tx, ctx, {
      action: "note.created",
      entityType: "InvestigationNote",
      entityId: note.id,
      summary: `${incident.caseNumber}: analyst note added`,
      metadata: { caseNumber: incident.caseNumber, length: input.text.length },
    });
    return note;
  });
}
