import "server-only";
import { requireRole, type AuthContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import { wouldCreateCycle } from "@/lib/blast-radius";
import { loadImpact, loadObservations, type ImpactView, type IncidentImpact } from "@/lib/investigation/load";
import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/domain/errors";
import { assetSchema, dependencySchema, incidentAssetStatusSchema } from "@/lib/validation/schemas";
import { assetOrThrow, evidenceOrThrow, incidentOrThrow } from "./guards";

export async function listAssets(ctx: AuthContext) {
  const assets = await prisma.asset.findMany({
    where: { organizationId: ctx.organizationId },
    include: { _count: { select: { consumerOf: true, providerFor: true } } },
    orderBy: { name: "asc" },
    take: 2000,
  });
  return assets.map((a) => ({
    id: a.id,
    name: a.name,
    provider: a.provider,
    assetType: a.assetType,
    description: a.description,
    owner: a.owner,
    criticality: a.criticality,
    externalResourceId: a.externalResourceId,
    isSynthetic: a.isSynthetic,
    updatedAt: a.updatedAt.toISOString(),
    dependsOnCount: a._count.consumerOf,
    consumerCount: a._count.providerFor,
  }));
}

export async function listDependencies(ctx: AuthContext) {
  const deps = await prisma.dependency.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "asc" },
    take: 10_000,
  });
  return deps.map((d) => ({
    id: d.id,
    consumerAssetId: d.consumerAssetId,
    providerAssetId: d.providerAssetId,
    relationshipType: d.relationshipType,
    description: d.description,
  }));
}

export async function createAsset(ctx: AuthContext, raw: unknown) {
  requireRole(ctx, "ANALYST");
  const input = assetSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const clash = await tx.asset.findFirst({ where: { organizationId: ctx.organizationId, name: input.name } });
    if (clash) throw new AppError("CONFLICT", `An asset named "${input.name}" already exists.`);
    const asset = await tx.asset.create({ data: { ...input, organizationId: ctx.organizationId } });
    await writeAudit(tx, ctx, {
      action: "asset.created",
      entityType: "Asset",
      entityId: asset.id,
      summary: `Added asset ${asset.name}`,
      metadata: { provider: asset.provider, criticality: asset.criticality },
    });
    return asset;
  });
}

export async function updateAsset(ctx: AuthContext, assetId: string, raw: unknown) {
  requireRole(ctx, "ANALYST");
  const input = assetSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const current = await assetOrThrow(tx, ctx, assetId);
    if (input.name !== current.name) {
      const clash = await tx.asset.findFirst({ where: { organizationId: ctx.organizationId, name: input.name } });
      if (clash) throw new AppError("CONFLICT", `An asset named "${input.name}" already exists.`);
    }
    const asset = await tx.asset.update({ where: { id: current.id }, data: input });
    await writeAudit(tx, ctx, {
      action: "asset.updated",
      entityType: "Asset",
      entityId: asset.id,
      summary: `Updated asset ${asset.name}`,
      metadata: { provider: asset.provider, criticality: asset.criticality },
    });
    return asset;
  });
}

export async function createDependency(ctx: AuthContext, raw: unknown) {
  requireRole(ctx, "ANALYST");
  const input = dependencySchema.parse(raw);
  if (input.consumerAssetId === input.providerAssetId) {
    throw new AppError("VALIDATION_ERROR", "An asset cannot depend on itself.", [
      { path: "providerAssetId", message: "Choose a different provider asset." },
    ]);
  }
  return prisma.$transaction(async (tx) => {
    const consumer = await assetOrThrow(tx, ctx, input.consumerAssetId);
    const provider = await assetOrThrow(tx, ctx, input.providerAssetId);
    const existing = await tx.dependency.findMany({ where: { organizationId: ctx.organizationId } });
    if (existing.some((d) => d.consumerAssetId === consumer.id && d.providerAssetId === provider.id)) {
      throw new AppError("CONFLICT", `${consumer.name} already depends on ${provider.name}.`);
    }
    const createsCycle = wouldCreateCycle(existing, consumer.id, provider.id);
    const dependency = await tx.dependency.create({
      data: {
        organizationId: ctx.organizationId,
        consumerAssetId: consumer.id,
        providerAssetId: provider.id,
        relationshipType: "DEPENDS_ON",
        description: input.description ?? null,
      },
    });
    await writeAudit(tx, ctx, {
      action: "dependency.created",
      entityType: "Dependency",
      entityId: dependency.id,
      summary: `${consumer.name} depends on ${provider.name}${createsCycle ? " (creates a dependency cycle)" : ""}`,
      metadata: { consumer: consumer.name, provider: provider.name, createsCycle },
    });
    return { dependency, createsCycle };
  });
}

export async function deleteDependency(ctx: AuthContext, dependencyId: string) {
  requireRole(ctx, "ANALYST");
  return prisma.$transaction(async (tx) => {
    const dep = await tx.dependency.findFirst({
      where: { id: dependencyId, organizationId: ctx.organizationId },
      include: { consumer: true, provider: true },
    });
    if (!dep) throw notFound("Dependency");
    await tx.dependency.delete({ where: { id: dep.id } });
    await writeAudit(tx, ctx, {
      action: "dependency.deleted",
      entityType: "Dependency",
      entityId: dep.id,
      summary: `Removed dependency: ${dep.consumer.name} depends on ${dep.provider.name}`,
      metadata: { consumer: dep.consumer.name, provider: dep.provider.name },
    });
    return { ok: true };
  });
}

/** Records the analyst-observed status of an asset for an incident; non-UNKNOWN requires evidence. */
export async function setIncidentAssetStatus(ctx: AuthContext, incidentId: string, raw: unknown) {
  requireRole(ctx, "ANALYST");
  const input = incidentAssetStatusSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const incident = await incidentOrThrow(tx, ctx, incidentId);
    const asset = await assetOrThrow(tx, ctx, input.assetId);
    let observedAt: Date | null = null;
    if (input.observedStatus !== "UNKNOWN") {
      if (!input.statusEvidenceId) {
        throw new AppError("VALIDATION_ERROR", "Select the evidence that supports this status.", [
          { path: "statusEvidenceId", message: "Evidence is required for a recorded status." },
        ]);
      }
      const ev = await evidenceOrThrow(tx, ctx, input.statusEvidenceId);
      if (ev.incidentId !== incident.id) {
        throw new AppError("VALIDATION_ERROR", "The selected evidence belongs to a different incident.");
      }
      observedAt = ev.observedAt;
    }
    const row = await tx.incidentAsset.upsert({
      where: { incidentId_assetId: { incidentId: incident.id, assetId: asset.id } },
      create: {
        organizationId: ctx.organizationId,
        incidentId: incident.id,
        assetId: asset.id,
        observedStatus: input.observedStatus,
        observedAt,
        statusEvidenceId: input.observedStatus === "UNKNOWN" ? null : input.statusEvidenceId,
      },
      update: {
        observedStatus: input.observedStatus,
        observedAt,
        statusEvidenceId: input.observedStatus === "UNKNOWN" ? null : input.statusEvidenceId,
      },
    });
    await writeAudit(tx, ctx, {
      action: "incident.asset_status_recorded",
      entityType: "IncidentAsset",
      entityId: row.id,
      summary: `${incident.caseNumber}: ${asset.name} observed ${input.observedStatus.toLowerCase()}`,
      metadata: { caseNumber: incident.caseNumber, asset: asset.name, status: input.observedStatus, evidenceId: input.statusEvidenceId ?? null },
    });
    return row;
  });
}

export type { ImpactView, IncidentImpact } from "@/lib/investigation/load";

/** Evidence-backed asset observations for an incident (org-scoped). */
export function incidentObservations(ctx: Pick<AuthContext, "organizationId">, incidentId: string) {
  return loadObservations(prisma, ctx.organizationId, incidentId);
}

/** Blast radius for one incident; verifies the incident belongs to the caller's organisation first. */
export async function computeIncidentImpact(ctx: AuthContext, incidentId: string, view: ImpactView = "peak"): Promise<IncidentImpact> {
  await incidentOrThrow(prisma, ctx, incidentId);
  return loadImpact(prisma, ctx.organizationId, incidentId, view);
}
