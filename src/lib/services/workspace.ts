import "server-only";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { requireRole, type AuthContext } from "@/lib/auth/context";
import { hashPassword } from "@/lib/auth/password";
import { writeAudit } from "@/lib/audit";
import { computeBlastRadius } from "@/lib/blast-radius";
import { demoUserCreationAllowed } from "@/lib/config";
import { prisma } from "@/lib/db";
import { formatEvidenceRef, type Severity } from "@/lib/domain/enums";
import { AppError, notFound } from "@/lib/domain/errors";
import { utcDayKey } from "@/lib/domain/time";
import { auditListSchema, demoUserSchema, orgUpdateSchema, profileUpdateSchema, roleUpdateSchema } from "@/lib/validation/schemas";
import { incidentObservations } from "./assets";
import { memberNameMap } from "./guards";

// ---------------------------------------------------------------------------
// Audit log (Owner or Analyst). Append-only: no update or delete functions exist.
// ---------------------------------------------------------------------------

export async function listAudit(ctx: AuthContext, raw: z.input<typeof auditListSchema>) {
  requireRole(ctx, "ANALYST", "The audit log is available to analysts and owners.");
  const f = auditListSchema.parse(raw);
  const page = f.page ?? 1;
  const pageSize = f.pageSize ?? 25;
  const from = f.from ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(f.from) ? `${f.from}T00:00:00Z` : f.from) : undefined;
  const to = f.to ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(f.to) ? `${f.to}T23:59:59.999Z` : f.to) : undefined;
  const where: Prisma.AuditEntryWhereInput = {
    organizationId: ctx.organizationId,
    ...(f.actorId ? { actorId: f.actorId } : {}),
    ...(f.action ? { action: { startsWith: f.action } } : {}),
    ...(f.entity ? { OR: [{ entityId: f.entity }, { summary: { contains: f.entity } }] } : {}),
    ...(f.q ? { summary: { contains: f.q } } : {}),
    ...((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))
      ? {
          createdAt: {
            ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
            ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
          },
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.auditEntry.count({ where }),
    prisma.auditEntry.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      actorId: r.actorId,
      actorLabel: r.actorLabel ?? "System",
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      summary: r.summary,
      metadata: safeJson(r.metadataJson),
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function safeJson(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const AUDIT_ACTION_CLASSES = [
  { value: "incident", label: "Incidents" },
  { value: "evidence", label: "Evidence & imports" },
  { value: "timeline", label: "Timeline" },
  { value: "hypothesis", label: "Hypotheses" },
  { value: "task", label: "Response tasks" },
  { value: "note", label: "Notes" },
  { value: "analysis", label: "Analysis" },
  { value: "report", label: "Reports & exports" },
  { value: "asset", label: "Assets" },
  { value: "dependency", label: "Dependencies" },
  { value: "integration", label: "Integrations" },
  { value: "membership", label: "Members & roles" },
  { value: "organization", label: "Workspace" },
  { value: "session", label: "Sessions" },
] as const;

// ---------------------------------------------------------------------------
// Command overview
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

export async function getOverview(ctx: AuthContext, rangeDays: number) {
  const [incidents, assets, deps, evidence, timeline, names] = await Promise.all([
    prisma.incident.findMany({
      where: { organizationId: ctx.organizationId },
      include: { _count: { select: { evidence: true } } },
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
    prisma.asset.findMany({ where: { organizationId: ctx.organizationId }, select: { id: true, name: true } }),
    prisma.dependency.findMany({ where: { organizationId: ctx.organizationId }, select: { consumerAssetId: true, providerAssetId: true } }),
    prisma.evidence.findMany({
      where: { organizationId: ctx.organizationId },
      select: { incidentId: true, provenance: true, sourceUri: true, sourceEventId: true, assetId: true },
      take: 20_000,
    }),
    prisma.timelineEvent.findMany({
      where: { organizationId: ctx.organizationId },
      select: { occurredAt: true, sourceClass: true, evidence: { select: { provenance: true } } },
      take: 20_000,
    }),
    memberNameMap(prisma, ctx),
  ]);

  const active = incidents.filter((i) => i.status !== "RESOLVED");
  const confirmed = new Set<string>();
  const atRisk = new Set<string>();
  for (const incident of active) {
    const observations = await incidentObservations(ctx, incident.id);
    const result = computeBlastRadius(assets, deps, observations);
    for (const impact of Object.values(result.impacts)) {
      if (impact.state === "CONFIRMED_AFFECTED" && !impact.providerReported) confirmed.add(impact.assetId);
      if (impact.state === "POTENTIALLY_AFFECTED") atRisk.add(impact.assetId);
    }
  }
  for (const id of confirmed) atRisk.delete(id);

  // Event activity per UTC day, ending at the latest recorded event (seeded data is historical).
  const latest = timeline.reduce<Date | null>((m, t) => (!m || t.occurredAt > m ? t.occurredAt : m), null);
  const end = latest ?? new Date();
  const days: string[] = [];
  for (let i = rangeDays - 1; i >= 0; i--) days.push(utcDayKey(new Date(end.getTime() - i * 86_400_000)));
  const series = days.map((day) => ({ day, PUBLIC_REPORTED: 0, CUSTOMER_OBSERVED: 0, SYNTHETIC: 0, ANALYST_NOTE: 0 }));
  const byDay = new Map(series.map((s) => [s.day, s]));
  for (const t of timeline) {
    const bucket = byDay.get(utcDayKey(t.occurredAt));
    if (!bucket) continue;
    const prov = (t.evidence?.provenance ?? t.sourceClass) as keyof (typeof series)[number];
    if (prov in bucket && prov !== "day") (bucket[prov] as number)++;
  }

  // Evidence quality: explainable ratios, withheld when there is no evidence.
  const total = evidence.length;
  const quality =
    total === 0
      ? null
      : {
          total,
          traceable: evidence.filter((e) => e.sourceUri || e.sourceEventId).length,
          assetLinked: evidence.filter((e) => e.assetId).length,
          nonSimulated: evidence.filter((e) => e.provenance !== "SYNTHETIC").length,
          customerObserved: evidence.filter((e) => e.provenance === "CUSTOMER_OBSERVED").length,
          incidentsWithEvidence: new Set(evidence.map((e) => e.incidentId)).size,
          incidentCount: incidents.length,
        };

  const priority = [...incidents]
    .sort(
      (a, b) =>
        Number(a.status === "RESOLVED") - Number(b.status === "RESOLVED") ||
        (SEVERITY_RANK[b.severity as Severity] ?? 0) - (SEVERITY_RANK[a.severity as Severity] ?? 0) ||
        b.updatedAt.getTime() - a.updatedAt.getTime(),
    )
    .slice(0, 8)
    .map((i) => ({
      id: i.id,
      caseNumber: i.caseNumber,
      title: i.title,
      type: i.type,
      severity: i.severity,
      status: i.status,
      classification: i.classification,
      updatedAt: i.updatedAt.toISOString(),
      ownerName: i.ownerId ? (names.get(i.ownerId) ?? null) : null,
      evidenceCount: i._count.evidence,
      dataLabel: i.dataLabel,
    }));

  return {
    counts: {
      open: active.length,
      investigating: incidents.filter((i) => i.status === "INVESTIGATING").length,
      confirmedAffected: confirmed.size,
      atRisk: atRisk.size,
      total: incidents.length,
    },
    hasDemoData: incidents.some((i) => i.isDemo),
    activity: { days: series, end: end.toISOString(), hasData: timeline.length > 0, rangeDays },
    quality,
    priority,
  };
}

// ---------------------------------------------------------------------------
// Global search (scoped to the active organisation)
// ---------------------------------------------------------------------------

export async function globalSearch(ctx: AuthContext, rawQuery: string) {
  const q = rawQuery.trim().slice(0, 100);
  if (q.length < 2) return { incidents: [], assets: [], evidence: [] };
  const refMatch = q.match(/^EV-?(\d{1,7})$/i);
  const [incidents, assets, evidence] = await Promise.all([
    prisma.incident.findMany({
      where: { organizationId: ctx.organizationId, OR: [{ caseNumber: { contains: q } }, { title: { contains: q } }] },
      select: { id: true, caseNumber: true, title: true, status: true },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    prisma.asset.findMany({
      where: { organizationId: ctx.organizationId, name: { contains: q } },
      select: { id: true, name: true, provider: true },
      take: 5,
    }),
    prisma.evidence.findMany({
      where: {
        organizationId: ctx.organizationId,
        OR: [
          { title: { contains: q } },
          { sourceEventId: { contains: q } },
          { sha256: { startsWith: q.toLowerCase() } },
          ...(refMatch ? [{ refNumber: Number.parseInt(refMatch[1], 10) }] : []),
        ],
      },
      select: { id: true, refNumber: true, title: true, incidentId: true, provenance: true },
      orderBy: { observedAt: "desc" },
      take: 5,
    }),
  ]);
  return {
    incidents,
    assets,
    evidence: evidence.map((e) => ({ ...e, ref: formatEvidenceRef(e.refNumber) })),
  };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getWorkspace(ctx: AuthContext) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
  const [incidents, evidence, demo] = await Promise.all([
    prisma.incident.count({ where: { organizationId: ctx.organizationId } }),
    prisma.evidence.count({ where: { organizationId: ctx.organizationId } }),
    prisma.incident.count({ where: { organizationId: ctx.organizationId, isDemo: true } }),
  ]);
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    createdAt: org.createdAt.toISOString(),
    incidentCount: incidents,
    evidenceCount: evidence,
    demoIncidentCount: demo,
    database: (process.env.DATABASE_URL ?? "").startsWith("file:") ? "SQLite (local file)" : "External database",
    demoUserCreation: demoUserCreationAllowed(),
  };
}

export async function updateOrganization(ctx: AuthContext, raw: unknown) {
  requireRole(ctx, "OWNER");
  const input = orgUpdateSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const before = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
    const org = await tx.organization.update({ where: { id: ctx.organizationId }, data: { name: input.name } });
    await writeAudit(tx, ctx, {
      action: "organization.renamed",
      entityType: "Organization",
      entityId: org.id,
      summary: `Workspace renamed from "${before.name}" to "${org.name}"`,
    });
    return org;
  });
}

export async function updateMemberRole(ctx: AuthContext, raw: unknown) {
  requireRole(ctx, "OWNER");
  const input = roleUpdateSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { id: input.membershipId, organizationId: ctx.organizationId },
      include: { user: true },
    });
    if (!membership) throw notFound("Member");
    if (membership.role === input.role) return membership;
    if (membership.role === "OWNER") {
      const owners = await tx.membership.count({ where: { organizationId: ctx.organizationId, role: "OWNER" } });
      if (owners <= 1) throw new AppError("CONFLICT", "A workspace must keep at least one owner.");
    }
    const updated = await tx.membership.update({ where: { id: membership.id }, data: { role: input.role } });
    await writeAudit(tx, ctx, {
      action: "membership.role_changed",
      entityType: "Membership",
      entityId: membership.id,
      summary: `${membership.user.name} role ${membership.role} → ${input.role}`,
      metadata: { userId: membership.userId, from: membership.role, to: input.role },
    });
    return updated;
  });
}

export async function createDemoUser(ctx: AuthContext, raw: unknown) {
  requireRole(ctx, "OWNER");
  if (!demoUserCreationAllowed()) {
    throw new AppError("FORBIDDEN", "Local demo user creation is disabled in this environment.");
  }
  const input = demoUserSchema.parse(raw);
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email: input.email } });
    if (existing) throw new AppError("CONFLICT", "An account with this email already exists.");
    const user = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash } });
    const membership = await tx.membership.create({
      data: { organizationId: ctx.organizationId, userId: user.id, role: input.role },
    });
    await writeAudit(tx, ctx, {
      action: "membership.created",
      entityType: "Membership",
      entityId: membership.id,
      summary: `Created local demo user ${user.email} as ${input.role}`,
      metadata: { userId: user.id, role: input.role },
    });
    return { userId: user.id, membershipId: membership.id };
  });
}

export async function updateProfile(ctx: AuthContext, raw: unknown) {
  const input = profileUpdateSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: ctx.userId }, data: { name: input.name } });
    await writeAudit(tx, ctx, {
      action: "membership.profile_updated",
      entityType: "User",
      entityId: user.id,
      summary: `${user.email} updated display name`,
    });
    return { id: user.id, name: user.name };
  });
}

export async function recordOrgSwitch(ctx: AuthContext, organizationId: string) {
  const membership = ctx.memberships.find((m) => m.organizationId === organizationId);
  if (!membership) throw notFound("Workspace");
  await writeAudit(prisma, { ...ctx, organizationId }, {
    action: "session.workspace_selected",
    entityType: "Organization",
    entityId: organizationId,
    summary: `${ctx.userName} switched to workspace ${membership.organizationName}`,
  });
  return membership;
}
