import "server-only";
import type { AuthContext } from "@/lib/auth/context";
import type { Tx } from "@/lib/db";
import { AppError, notFound } from "@/lib/domain/errors";

type Scope = Pick<AuthContext, "organizationId">;

/**
 * Organisation-scoped lookups. A record that exists in another organisation is
 * reported exactly like a missing record (404) so foreign IDs reveal nothing.
 */
export async function incidentOrThrow(tx: Tx, ctx: Scope, incidentId: string) {
  const incident = await tx.incident.findFirst({ where: { id: incidentId, organizationId: ctx.organizationId } });
  if (!incident) throw notFound("Incident");
  return incident;
}

export async function assetOrThrow(tx: Tx, ctx: Scope, assetId: string) {
  const asset = await tx.asset.findFirst({ where: { id: assetId, organizationId: ctx.organizationId } });
  if (!asset) throw notFound("Asset");
  return asset;
}

export async function evidenceOrThrow(tx: Tx, ctx: Scope, evidenceId: string) {
  const evidence = await tx.evidence.findFirst({ where: { id: evidenceId, organizationId: ctx.organizationId } });
  if (!evidence) throw notFound("Evidence");
  return evidence;
}

/** Verifies the user is a member of the current organisation (for owner/assignee fields). */
export async function memberOrThrow(tx: Tx, ctx: Scope, userId: string, label = "User") {
  const membership = await tx.membership.findFirst({ where: { userId, organizationId: ctx.organizationId } });
  if (!membership) {
    throw new AppError("VALIDATION_ERROR", `${label} is not a member of this workspace.`, [
      { path: "userId", message: `${label} is not a member of this workspace.` },
    ]);
  }
  return membership;
}

/** Every evidence ID must belong to this organisation and incident. */
export async function evidenceIdsInIncident(tx: Tx, ctx: Scope, incidentId: string, ids: string[], path: string) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return unique;
  const found = await tx.evidence.findMany({
    where: { id: { in: unique }, organizationId: ctx.organizationId, incidentId },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    const ok = new Set(found.map((f) => f.id));
    const missing = unique.filter((i) => !ok.has(i));
    throw new AppError("VALIDATION_ERROR", "Some evidence references are not linked to this incident.", [
      { path, message: `Unknown evidence for this incident: ${missing.slice(0, 5).join(", ")}` },
    ]);
  }
  return unique;
}

export async function memberNameMap(tx: Tx, ctx: Scope): Promise<Map<string, string>> {
  const members = await tx.membership.findMany({
    where: { organizationId: ctx.organizationId },
    include: { user: { select: { id: true, name: true } } },
  });
  return new Map(members.map((m) => [m.user.id, m.user.name]));
}

export async function nextEvidenceRef(tx: Tx, ctx: Scope): Promise<number> {
  const agg = await tx.evidence.aggregate({ where: { organizationId: ctx.organizationId }, _max: { refNumber: true } });
  return (agg._max.refNumber ?? 0) + 1;
}
