import "server-only";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { requireRole, type AuthContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  canTransition,
  isOneOf,
  INCIDENT_STATUSES,
  SEVERITIES,
  type Classification,
  type IncidentStatus,
  type Severity,
} from "@/lib/domain/enums";
import { AppError } from "@/lib/domain/errors";
import { CLASSIFICATION_LABELS, SEVERITY_LABELS, STATUS_LABELS, labelOf } from "@/lib/ui/labels";
import { createIncidentSchema, incidentListSchema, updateIncidentSchema } from "@/lib/validation/schemas";
import { incidentOrThrow, memberNameMap, memberOrThrow } from "./guards";

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const MAX_IN_MEMORY_SORT = 5000;

export type IncidentListFilters = z.input<typeof incidentListSchema>;

export interface IncidentListItem {
  id: string;
  caseNumber: string;
  title: string;
  type: string;
  severity: string;
  status: string;
  classification: string;
  ownerId: string | null;
  ownerName: string | null;
  updatedAt: string;
  startedAt: string | null;
  evidenceCount: number;
  isDemo: boolean;
  dataLabel: string | null;
}

const toArray = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export async function listIncidents(ctx: AuthContext, raw: IncidentListFilters) {
  const f = incidentListSchema.parse(raw);
  const page = f.page ?? 1;
  const pageSize = f.pageSize ?? 20;
  const severities = toArray(f.severity);
  const statuses = toArray(f.status);

  const where: Prisma.IncidentWhereInput = {
    organizationId: ctx.organizationId,
    ...(severities.length ? { severity: { in: severities } } : {}),
    ...(statuses.length ? { status: { in: statuses } } : {}),
    ...(f.type ? { type: f.type } : {}),
    ...(f.ownerId ? { ownerId: f.ownerId } : {}),
    ...(f.q
      ? { OR: [{ caseNumber: { contains: f.q } }, { title: { contains: f.q } }, { description: { contains: f.q } }] }
      : {}),
  };

  const total = await prisma.incident.count({ where });
  const sort = f.sort ?? "updated_desc";
  const include = { _count: { select: { evidence: true } } } as const;

  let rows;
  if (sort === "severity") {
    // Severity is stored as text; rank in memory over a bounded result set.
    const all = await prisma.incident.findMany({ where, include, take: MAX_IN_MEMORY_SORT, orderBy: { updatedAt: "desc" } });
    all.sort(
      (a, b) =>
        (SEVERITY_RANK[b.severity as Severity] ?? 0) - (SEVERITY_RANK[a.severity as Severity] ?? 0) ||
        b.updatedAt.getTime() - a.updatedAt.getTime(),
    );
    rows = all.slice((page - 1) * pageSize, page * pageSize);
  } else {
    const orderBy: Prisma.IncidentOrderByWithRelationInput =
      sort === "updated_asc" ? { updatedAt: "asc" } : sort === "case" ? { caseNumber: "asc" } : { updatedAt: "desc" };
    rows = await prisma.incident.findMany({ where, include, orderBy, skip: (page - 1) * pageSize, take: pageSize });
  }

  const names = await memberNameMap(prisma, ctx);
  const items: IncidentListItem[] = rows.map((i) => ({
    id: i.id,
    caseNumber: i.caseNumber,
    title: i.title,
    type: i.type,
    severity: i.severity,
    status: i.status,
    classification: i.classification,
    ownerId: i.ownerId,
    ownerName: i.ownerId ? (names.get(i.ownerId) ?? null) : null,
    updatedAt: i.updatedAt.toISOString(),
    startedAt: i.startedAt?.toISOString() ?? null,
    evidenceCount: i._count.evidence,
    isDemo: i.isDemo,
    dataLabel: i.dataLabel,
  }));
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getIncident(ctx: AuthContext, incidentId: string) {
  const incident = await incidentOrThrow(prisma, ctx, incidentId);
  const [names, evidenceCount, scope, sources] = await Promise.all([
    memberNameMap(prisma, ctx),
    prisma.evidence.count({ where: { organizationId: ctx.organizationId, incidentId } }),
    prisma.incidentAsset.findMany({
      where: { organizationId: ctx.organizationId, incidentId },
      include: { asset: { select: { id: true, name: true, provider: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.incidentSource.findMany({ where: { organizationId: ctx.organizationId, incidentId }, orderBy: { retrievedAt: "asc" } }),
  ]);
  return {
    ...incident,
    ownerName: incident.ownerId ? (names.get(incident.ownerId) ?? null) : null,
    evidenceCount,
    scopeAssets: scope.map((s) => ({
      incidentAssetId: s.id,
      assetId: s.assetId,
      name: s.asset.name,
      provider: s.asset.provider,
      observedStatus: s.observedStatus,
      observedAt: s.observedAt,
      statusEvidenceId: s.statusEvidenceId,
    })),
    sources,
  };
}

async function nextCaseNumber(tx: Prisma.TransactionClient, organizationId: string, year: number): Promise<string> {
  const prefix = `CT-${year}-`;
  const existing = await tx.incident.findMany({
    where: { organizationId, caseNumber: { startsWith: prefix } },
    select: { caseNumber: true },
  });
  const max = existing.reduce((m, i) => Math.max(m, Number.parseInt(i.caseNumber.slice(prefix.length), 10) || 0), 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

const DEFAULT_CLASSIFICATION: Record<string, Classification> = {
  PROVIDER_OUTAGE: "UNDETERMINED",
  SECURITY_SUSPICION: "SECURITY_SUSPECTED",
  CONFIGURATION_FAILURE: "UNDETERMINED",
  OTHER: "UNDETERMINED",
};

export async function createIncident(ctx: AuthContext, raw: unknown) {
  requireRole(ctx, "ANALYST");
  const input = createIncidentSchema.parse(raw);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        if (input.ownerId) await memberOrThrow(tx, ctx, input.ownerId, "Owner");
        const assetIds = [...new Set(input.assetIds)];
        if (assetIds.length) {
          const found = await tx.asset.count({ where: { id: { in: assetIds }, organizationId: ctx.organizationId } });
          if (found !== assetIds.length) {
            throw new AppError("VALIDATION_ERROR", "Some selected services are not part of this workspace.", [
              { path: "assetIds", message: "Unknown service selected." },
            ]);
          }
        }
        const caseNumber = await nextCaseNumber(tx, ctx.organizationId, new Date().getUTCFullYear());
        const incident = await tx.incident.create({
          data: {
            organizationId: ctx.organizationId,
            caseNumber,
            title: input.title,
            description: input.description,
            type: input.type,
            severity: input.severity,
            status: "OPEN",
            classification: DEFAULT_CLASSIFICATION[input.type] ?? "UNDETERMINED",
            startedAt: input.startedAt ?? null,
            ownerId: input.ownerId ?? ctx.userId,
            createdById: ctx.userId,
            isDemo: false,
          },
        });
        if (assetIds.length) {
          await tx.incidentAsset.createMany({
            data: assetIds.map((assetId) => ({ organizationId: ctx.organizationId, incidentId: incident.id, assetId })),
          });
        }
        await writeAudit(tx, ctx, {
          action: "incident.created",
          entityType: "Incident",
          entityId: incident.id,
          summary: `Created ${caseNumber}: ${incident.title}`,
          metadata: { caseNumber, type: incident.type, severity: incident.severity, assetCount: assetIds.length },
        });
        return incident;
      });
    } catch (error) {
      // Concurrent case-number allocation: retry with the next number.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && attempt < 2) continue;
      throw error;
    }
  }
  throw new AppError("CONFLICT", "Could not allocate a case number. Try again.");
}

export async function updateIncident(ctx: AuthContext, incidentId: string, raw: unknown) {
  requireRole(ctx, "ANALYST");
  const input = updateIncidentSchema.parse(raw);

  return prisma.$transaction(async (tx) => {
    const current = await incidentOrThrow(tx, ctx, incidentId);
    const data: Prisma.IncidentUpdateInput = {};
    const changes: string[] = [];

    if (input.status && input.status !== current.status) {
      if (!isOneOf(INCIDENT_STATUSES, current.status) || !canTransition(current.status as IncidentStatus, input.status)) {
        throw new AppError("VALIDATION_ERROR", `Cannot move a case from ${current.status} to ${input.status}.`, [
          { path: "status", message: "Allowed: Open → Investigating → Monitoring → Resolved; re-open to Investigating." },
        ]);
      }
      data.status = input.status;
      if (input.status === "RESOLVED") data.resolvedAt = input.resolvedAt ?? current.resolvedAt ?? new Date();
      if (current.status === "RESOLVED" && input.status === "INVESTIGATING") data.resolvedAt = null;
    }

    if (input.classification && input.classification !== current.classification) {
      if (input.classification === "CONFIRMED_SECURITY") {
        if (!input.classificationJustification || input.classificationJustification.length < 10) {
          throw new AppError("VALIDATION_ERROR", "Confirming a security incident requires a written evidence review.", [
            {
              path: "classificationJustification",
              message: "Describe the evidence you reviewed (at least 10 characters).",
            },
          ]);
        }
      }
      data.classification = input.classification;
    }

    if (input.ownerId !== undefined && input.ownerId !== current.ownerId) {
      if (input.ownerId) await memberOrThrow(tx, ctx, input.ownerId, "Owner");
      data.ownerId = input.ownerId;
      changes.push("owner");
    }
    if (input.severity && input.severity !== current.severity && isOneOf(SEVERITIES, input.severity)) {
      data.severity = input.severity;
    }
    if (input.title && input.title !== current.title) {
      data.title = input.title;
      changes.push("title");
    }
    if (input.description !== undefined && input.description !== current.description) {
      data.description = input.description;
      changes.push("description");
    }
    if (input.type && input.type !== current.type) {
      data.type = input.type;
      changes.push("type");
    }
    if (input.startedAt !== undefined && input.startedAt?.getTime() !== current.startedAt?.getTime()) {
      data.startedAt = input.startedAt;
      changes.push("start time");
    }
    if (input.resolvedAt !== undefined && !data.resolvedAt && input.resolvedAt?.getTime() !== current.resolvedAt?.getTime()) {
      data.resolvedAt = input.resolvedAt;
      changes.push("resolved time");
    }

    if (Object.keys(data).length === 0) return current;
    const updated = await tx.incident.update({ where: { id: current.id }, data });

    if (data.status) {
      await writeAudit(tx, ctx, {
        action: "incident.status_changed",
        entityType: "Incident",
        entityId: current.id,
        summary: `${current.caseNumber} status ${labelOf(STATUS_LABELS, current.status).label} → ${labelOf(STATUS_LABELS, updated.status).label}`,
        metadata: { caseNumber: current.caseNumber, from: current.status, to: updated.status },
      });
    }
    if (data.severity) {
      await writeAudit(tx, ctx, {
        action: "incident.severity_changed",
        entityType: "Incident",
        entityId: current.id,
        summary: `${current.caseNumber} severity ${labelOf(SEVERITY_LABELS, current.severity).label} → ${labelOf(SEVERITY_LABELS, updated.severity).label}`,
        metadata: { caseNumber: current.caseNumber, from: current.severity, to: updated.severity },
      });
    }
    if (data.classification) {
      await writeAudit(tx, ctx, {
        action: "incident.classification_changed",
        entityType: "Incident",
        entityId: current.id,
        summary: `${current.caseNumber} classification → ${labelOf(CLASSIFICATION_LABELS, updated.classification).label}`,
        metadata: {
          caseNumber: current.caseNumber,
          from: current.classification,
          to: updated.classification,
          justification: input.classificationJustification ?? null,
        },
      });
    }
    if (changes.length) {
      await writeAudit(tx, ctx, {
        action: "incident.updated",
        entityType: "Incident",
        entityId: current.id,
        summary: `${current.caseNumber} updated: ${changes.join(", ")}`,
        metadata: { caseNumber: current.caseNumber, fields: changes },
      });
    }
    return updated;
  });
}

export async function listMembers(ctx: AuthContext) {
  const members = await prisma.membership.findMany({
    where: { organizationId: ctx.organizationId },
    include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
    orderBy: { createdAt: "asc" },
  });
  return members.map((m) => ({
    membershipId: m.id,
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
    joinedAt: m.createdAt.toISOString(),
  }));
}
