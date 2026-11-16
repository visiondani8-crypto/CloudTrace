import "server-only";
import { Prisma } from "@prisma/client";
import { requireRole, type AuthContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import { runRuleBasedAnalysis } from "@/lib/analysis/rule-based";
import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/domain/errors";
import { sha256Hex } from "@/lib/evidence/normalise";
import type { ReportContent } from "@/lib/reports/build";
import { assembleReport, type ReportAnalysis } from "@/lib/investigation/load";
import { buildAnalysisInput, latestAnalysis } from "./analysis";
import { incidentOrThrow, memberNameMap } from "./guards";

export async function generateReport(ctx: AuthContext, incidentId: string) {
  requireRole(ctx, "ANALYST");
  const incident = await incidentOrThrow(prisma, ctx, incidentId);
  const evidenceCount = await prisma.evidence.count({ where: { organizationId: ctx.organizationId, incidentId } });
  if (evidenceCount === 0) {
    throw new AppError("CONFLICT", "Add at least one evidence item before generating a report.");
  }

  // Embed the latest stored analysis; otherwise compute a deterministic one now.
  const stored = await latestAnalysis(ctx, incidentId);
  const analysis: ReportAnalysis = stored
    ? {
        ...stored,
        classificationSuggestion: stored.classificationSuggestion ?? "UNDETERMINED",
        generatedAt: new Date(stored.generatedAt),
        computedForReport: false,
      }
    : {
        ...runRuleBasedAnalysis(await buildAnalysisInput(ctx, incidentId)),
        mode: "RULE_BASED",
        modelId: null,
        generatedAt: new Date(),
        computedForReport: true,
      };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const last = await tx.reportSnapshot.aggregate({ where: { incidentId: incident.id }, _max: { version: true } });
        const version = (last._max.version ?? 0) + 1;
        const content = await assembleReport(
          tx,
          { organizationId: ctx.organizationId, generatedBy: ctx.userName },
          incident.id,
          version,
          analysis,
        );
        const contentJson = JSON.stringify(content);
        const report = await tx.reportSnapshot.create({
          data: {
            organizationId: ctx.organizationId,
            incidentId: incident.id,
            version,
            title: content.title,
            createdById: ctx.userId,
            generatedAt: new Date(content.generatedAt),
            contentJson,
            contentSha256: sha256Hex(contentJson),
          },
        });
        await writeAudit(tx, ctx, {
          action: "report.generated",
          entityType: "ReportSnapshot",
          entityId: report.id,
          summary: `${incident.caseNumber}: generated report v${version}`,
          metadata: { caseNumber: incident.caseNumber, version, sha256: report.contentSha256 },
        });
        return { id: report.id, version };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && attempt < 2) continue;
      throw error;
    }
  }
  throw new AppError("CONFLICT", "Could not allocate a report version. Try again.");
}

export async function listReports(ctx: AuthContext, filters: { incidentId?: string; from?: string; to?: string } = {}) {
  const from = filters.from ? new Date(`${filters.from}T00:00:00Z`) : undefined;
  const to = filters.to ? new Date(`${filters.to}T23:59:59.999Z`) : undefined;
  const reports = await prisma.reportSnapshot.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(filters.incidentId ? { incidentId: filters.incidentId } : {}),
      ...(from && !Number.isNaN(from.getTime()) ? { generatedAt: { gte: from } } : {}),
      ...(to && !Number.isNaN(to.getTime()) ? { generatedAt: { lte: to } } : {}),
    },
    include: { incident: { select: { caseNumber: true, title: true, isDemo: true, dataLabel: true } } },
    orderBy: [{ generatedAt: "desc" }],
    take: 200,
  });
  const names = await memberNameMap(prisma, ctx);
  return reports.map((r) => {
    let simulated = false;
    let publicReports = false;
    try {
      const notice = (JSON.parse(r.contentJson) as ReportContent).dataNotice;
      simulated = notice.containsSimulated;
      publicReports = notice.containsPublicReports;
    } catch {
      /* content stays opaque */
    }
    return {
      id: r.id,
      incidentId: r.incidentId,
      caseNumber: r.incident.caseNumber,
      incidentTitle: r.incident.title,
      title: r.title,
      version: r.version,
      generatedAt: r.generatedAt.toISOString(),
      generatedBy: names.get(r.createdById) ?? "Former member",
      sha256: r.contentSha256,
      simulated,
      publicReports,
    };
  });
}

export type ReportListItem = Awaited<ReturnType<typeof listReports>>[number];

export async function getReport(ctx: AuthContext, reportId: string) {
  const r = await prisma.reportSnapshot.findFirst({
    where: { id: reportId, organizationId: ctx.organizationId },
    include: { incident: { select: { caseNumber: true, title: true } } },
  });
  if (!r) throw notFound("Report");
  const versions = await prisma.reportSnapshot.findMany({
    where: { organizationId: ctx.organizationId, incidentId: r.incidentId },
    select: { id: true, version: true, generatedAt: true },
    orderBy: { version: "desc" },
  });
  return {
    id: r.id,
    incidentId: r.incidentId,
    caseNumber: r.incident.caseNumber,
    version: r.version,
    generatedAt: r.generatedAt.toISOString(),
    sha256: r.contentSha256,
    content: JSON.parse(r.contentJson) as ReportContent,
    versions: versions.map((v) => ({ id: v.id, version: v.version, generatedAt: v.generatedAt.toISOString() })),
  };
}

export type ReportView = Awaited<ReturnType<typeof getReport>>;

export async function recordReportExport(ctx: AuthContext, report: ReportView, format: string) {
  await writeAudit(prisma, ctx, {
    action: "report.exported",
    entityType: "ReportSnapshot",
    entityId: report.id,
    summary: `${report.caseNumber}: exported report v${report.version} as ${format.toUpperCase()}`,
    metadata: { caseNumber: report.caseNumber, version: report.version, format },
  });
}
