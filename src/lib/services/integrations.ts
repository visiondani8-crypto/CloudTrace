import "server-only";
import { requireRole, type AuthContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import { getAiConfig, getMicrosoftConfig, redactSecrets } from "@/lib/config";
import { prisma } from "@/lib/db";
import { formatEvidenceRef, MICROSOFT_PROVIDER, type ConnectionStatus } from "@/lib/domain/enums";
import { AppError, notFound } from "@/lib/domain/errors";
import { canonicalEvidenceHash, sanitiseText } from "@/lib/evidence/normalise";
import { fetchServiceHealth, GraphError } from "@/lib/integrations/microsoft/graph";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { attachIssueSchema } from "@/lib/validation/schemas";
import { incidentOrThrow, nextEvidenceRef } from "./guards";

export const MICROSOFT_SCOPE = "ServiceHealth.Read.All";
const TENANT_NOTICE_SOURCE = "Microsoft 365 service health (authorised tenant, Graph)";

export interface MicrosoftStatusView {
  status: ConnectionStatus;
  configured: boolean;
  assignedToThisWorkspace: boolean;
  problems: string[];
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  lastErrorCode: string | null;
  issueCount: number;
  overviewCount: number;
  permission: string;
}

export interface IntegrationStatus {
  local: { status: "ACTIVE" };
  microsoft: MicrosoftStatusView;
  ai: { status: "CONNECTED" | "NOT_CONFIGURED"; model: string | null; problem: string | null };
}

/** Truthful connection states. Nothing is reported as connected without a recorded successful sync. */
export async function getIntegrationStatus(ctx: AuthContext): Promise<IntegrationStatus> {
  const ms = getMicrosoftConfig();
  const ai = getAiConfig();
  const assigned = ms.configured && ms.organizationSlug === ctx.organizationSlug;
  const conn = await prisma.providerConnection.findUnique({
    where: { organizationId_provider: { organizationId: ctx.organizationId, provider: MICROSOFT_PROVIDER } },
  });
  let meta: { issueCount?: number; overviewCount?: number } = {};
  try {
    meta = conn ? (JSON.parse(conn.metadataJson) as typeof meta) : {};
  } catch {
    meta = {};
  }

  let status: ConnectionStatus = "NOT_CONFIGURED";
  if (assigned) {
    if (conn?.status === "SYNCING") status = "SYNCING";
    else if (conn?.status === "ERROR") status = "ERROR";
    else if (conn?.lastSyncAt) status = "CONNECTED";
    else status = "READY";
  }
  const problems = ms.configured && !assigned ? ["The connector is configured for a different workspace."] : ms.problems;

  return {
    local: { status: "ACTIVE" },
    microsoft: {
      status,
      configured: ms.configured,
      assignedToThisWorkspace: assigned,
      problems: ms.credentialsPresent || ms.configured ? problems : [],
      lastSyncAt: assigned ? (conn?.lastSyncAt?.toISOString() ?? null) : null,
      lastAttemptAt: assigned ? (conn?.lastAttemptAt?.toISOString() ?? null) : null,
      lastErrorCode: assigned ? (conn?.lastErrorCode ?? null) : null,
      issueCount: assigned ? (meta.issueCount ?? 0) : 0,
      overviewCount: assigned ? (meta.overviewCount ?? 0) : 0,
      permission: MICROSOFT_SCOPE,
    },
    ai: {
      status: ai.configured ? "CONNECTED" : "NOT_CONFIGURED",
      model: ai.configured ? ai.model : null,
      problem: ai.configured ? null : ai.problem,
    },
  };
}

/** Owner-only manual sync of tenant service-health issues. Preserves existing data on failure. */
export async function syncMicrosoft(ctx: AuthContext, fetchImpl?: typeof fetch) {
  requireRole(ctx, "OWNER");
  const ms = getMicrosoftConfig();
  if (!ms.configured) {
    throw new AppError("NOT_CONFIGURED", "Microsoft 365 service health is not configured. Local analysis remains available.");
  }
  if (ms.organizationSlug !== ctx.organizationSlug) {
    throw new AppError("FORBIDDEN", "The Microsoft connector is assigned to a different workspace.");
  }
  const limited = rateLimit(`sync:${ctx.organizationId}`, LIMITS.syncPerOrg.limit, LIMITS.syncPerOrg.windowMs);
  if (!limited.allowed) throw new AppError("RATE_LIMITED", `Sync rate limit reached. Try again in ${limited.retryAfterSeconds}s.`);

  const key = { organizationId_provider: { organizationId: ctx.organizationId, provider: MICROSOFT_PROVIDER } };
  const startedAt = new Date();
  await prisma.providerConnection.upsert({
    where: key,
    create: { organizationId: ctx.organizationId, provider: MICROSOFT_PROVIDER, status: "SYNCING", lastAttemptAt: startedAt },
    update: { status: "SYNCING", lastAttemptAt: startedAt },
  });

  try {
    const { overviews, issues } = await fetchServiceHealth(ms, fetchImpl);
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    await prisma.$transaction(async (tx) => {
      for (const issue of issues) {
        if (!issue.id) continue;
        const lastModified = issue.lastModifiedDateTime ? new Date(issue.lastModifiedDateTime) : null;
        const existing = await tx.providerServiceIssue.findUnique({
          where: { organizationId_provider_externalId: { organizationId: ctx.organizationId, provider: MICROSOFT_PROVIDER, externalId: issue.id } },
        });
        const data = {
          service: sanitiseText(issue.service ?? "Unknown service").slice(0, 200),
          title: sanitiseText(issue.title ?? issue.id).slice(0, 500),
          status: sanitiseText(issue.status ?? "unknown").slice(0, 80),
          classification: issue.classification ? sanitiseText(issue.classification).slice(0, 80) : null,
          impactDescription: issue.impactDescription ? sanitiseText(issue.impactDescription).slice(0, 4000) : null,
          startDateTime: issue.startDateTime ? new Date(issue.startDateTime) : null,
          endDateTime: issue.endDateTime ? new Date(issue.endDateTime) : null,
          lastModifiedDateTime: lastModified,
          isResolved: !!issue.isResolved,
          retrievedAt: startedAt,
        };
        if (!existing) {
          await tx.providerServiceIssue.create({
            data: { ...data, organizationId: ctx.organizationId, provider: MICROSOFT_PROVIDER, externalId: issue.id },
          });
          created++;
        } else if (!lastModified || !existing.lastModifiedDateTime || lastModified > existing.lastModifiedDateTime) {
          await tx.providerServiceIssue.update({ where: { id: existing.id }, data });
          updated++;
        } else {
          unchanged++;
        }
      }
      await tx.providerConnection.update({
        where: key,
        data: {
          status: "CONNECTED",
          lastSyncAt: new Date(),
          lastErrorCode: null,
          metadataJson: JSON.stringify({
            issueCount: issues.length,
            overviewCount: overviews.length,
            degradedServices: overviews.filter((o) => o.status && o.status !== "serviceOperational").map((o) => o.service).slice(0, 50),
            permission: MICROSOFT_SCOPE,
          }),
        },
      });
      await writeAudit(tx, ctx, {
        action: "integration.sync_succeeded",
        entityType: "ProviderConnection",
        summary: `Microsoft 365 service health sync: ${issues.length} issues (${created} new, ${updated} updated, ${unchanged} unchanged)`,
        metadata: { created, updated, unchanged, overviews: overviews.length },
      });
    });
    return { ok: true, issueCount: issues.length, created, updated, unchanged };
  } catch (error) {
    const code = error instanceof GraphError ? error.code : "SYNC_FAILED";
    const message = error instanceof GraphError ? error.message : "Sync failed unexpectedly.";
    await prisma.providerConnection.update({ where: key, data: { status: "ERROR", lastErrorCode: code } });
    await writeAudit(prisma, ctx, {
      action: "integration.sync_failed",
      entityType: "ProviderConnection",
      summary: `Microsoft 365 service health sync failed (${code}); existing data preserved`,
      metadata: { code },
    });
    if (!(error instanceof GraphError)) console.error(`[sync] ${redactSecrets(String(error)).slice(0, 300)}`);
    throw new AppError("UPSTREAM_ERROR", `${message} (${code}). Existing data was preserved.`);
  }
}

export async function listProviderIssues(ctx: AuthContext) {
  const issues = await prisma.providerServiceIssue.findMany({
    where: { organizationId: ctx.organizationId, provider: MICROSOFT_PROVIDER },
    orderBy: [{ lastModifiedDateTime: "desc" }],
    take: 100,
  });
  return issues.map((i) => ({
    id: i.id,
    externalId: i.externalId,
    service: i.service,
    title: i.title,
    status: i.status,
    classification: i.classification,
    isResolved: i.isResolved,
    startDateTime: i.startDateTime?.toISOString() ?? null,
    lastModifiedDateTime: i.lastModifiedDateTime?.toISOString() ?? null,
    retrievedAt: i.retrievedAt.toISOString(),
  }));
}

/**
 * Attaches a tenant service-health issue to an incident as evidence. The
 * record proves the tenant was notified; it does not set any asset status.
 */
export async function attachIssueToIncident(ctx: AuthContext, raw: unknown) {
  requireRole(ctx, "ANALYST");
  const input = attachIssueSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const issue = await tx.providerServiceIssue.findFirst({ where: { id: input.issueId, organizationId: ctx.organizationId } });
    if (!issue) throw notFound("Service health issue");
    const incident = await incidentOrThrow(tx, ctx, input.incidentId);
    const sourceEventId = `${issue.externalId}@${issue.lastModifiedDateTime?.toISOString() ?? issue.retrievedAt.toISOString()}`;
    const dup = await tx.evidence.findFirst({
      where: { organizationId: ctx.organizationId, sourceName: TENANT_NOTICE_SOURCE, sourceEventId },
    });
    if (dup) throw new AppError("CONFLICT", `This issue version is already stored as ${formatEvidenceRef(dup.refNumber)}.`);
    const observedAt = issue.lastModifiedDateTime ?? issue.startDateTime ?? issue.retrievedAt;
    const title = `Tenant service-health notice ${issue.externalId}: ${issue.title}`.slice(0, 300);
    const contentText = [
      `Service: ${issue.service}`,
      `Status: ${issue.status}${issue.isResolved ? " (resolved)" : ""}`,
      issue.classification ? `Classification: ${issue.classification}` : null,
      issue.impactDescription ? `Impact: ${issue.impactDescription}` : null,
      "Retrieved read-only from Microsoft Graph for this tenant. A tenant notice does not prove that dependent assets failed.",
    ]
      .filter(Boolean)
      .join("\n");
    const sha256 = canonicalEvidenceHash({
      observedAt,
      title,
      category: "PROVIDER_NOTICE",
      provenance: "CUSTOMER_OBSERVED",
      sourceName: TENANT_NOTICE_SOURCE,
      sourceEventId,
      assetName: null,
      contentText,
      sourceUri: "https://admin.microsoft.com/Adminportal/Home#/servicehealth",
    });
    const evidence = await tx.evidence.create({
      data: {
        organizationId: ctx.organizationId,
        refNumber: await nextEvidenceRef(tx, ctx),
        incidentId: incident.id,
        title,
        category: "PROVIDER_NOTICE",
        provenance: "CUSTOMER_OBSERVED",
        sourceName: TENANT_NOTICE_SOURCE,
        sourceUri: "https://admin.microsoft.com/Adminportal/Home#/servicehealth",
        sourceEventId,
        contentText,
        sha256,
        observedAt,
        isSynthetic: false,
        confidenceLevel: "CONFIRMED_BY_SOURCE",
        createdById: ctx.userId,
        rawMetadataJson: JSON.stringify({ entry: "microsoft-graph", externalId: issue.externalId }),
      },
    });
    await tx.timelineEvent.create({
      data: {
        organizationId: ctx.organizationId,
        incidentId: incident.id,
        evidenceId: evidence.id,
        occurredAt: observedAt,
        eventType: "PROVIDER_NOTICE",
        title,
        description: issue.impactDescription?.slice(0, 280) ?? null,
        sourceClass: "CUSTOMER_OBSERVED",
        createdById: ctx.userId,
      },
    });
    await writeAudit(tx, ctx, {
      action: "evidence.created",
      entityType: "Evidence",
      entityId: evidence.id,
      summary: `${incident.caseNumber}: attached tenant service-health issue ${issue.externalId}`,
      metadata: { caseNumber: incident.caseNumber, externalId: issue.externalId },
    });
    return evidence;
  });
}
