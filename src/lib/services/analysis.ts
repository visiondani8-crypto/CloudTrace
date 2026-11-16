import "server-only";
import { requireRole, type AuthContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import { ClaudeAnalysisError, runClaudeAnalysis } from "@/lib/analysis/claude";
import { runRuleBasedAnalysis } from "@/lib/analysis/rule-based";
import type { AnalysisInput, AnalysisOutput, AnalysisRun } from "@/lib/analysis/types";
import { getAiConfig } from "@/lib/config";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/domain/errors";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { loadAnalysisInput } from "@/lib/investigation/load";
import { incidentOrThrow } from "./guards";

/** Assembles the org- and incident-scoped input for either analysis engine. */
export async function buildAnalysisInput(ctx: AuthContext, incidentId: string): Promise<AnalysisInput> {
  await incidentOrThrow(prisma, ctx, incidentId);
  return loadAnalysisInput(prisma, ctx.organizationId, incidentId);
}

export async function analyzeIncident(ctx: AuthContext, incidentId: string, options: { preferClaude?: boolean } = {}) {
  requireRole(ctx, "ANALYST");
  const limited = rateLimit(`analyze:${ctx.userId}`, LIMITS.analyzePerUser.limit, LIMITS.analyzePerUser.windowMs);
  if (!limited.allowed) {
    throw new AppError("RATE_LIMITED", `Analysis rate limit reached. Try again in ${limited.retryAfterSeconds}s.`);
  }
  const incident = await incidentOrThrow(prisma, ctx, incidentId);
  const input = await buildAnalysisInput(ctx, incidentId);

  let run: AnalysisRun;
  const ai = getAiConfig();
  if (ai.configured && options.preferClaude !== false) {
    try {
      const { output, modelId } = await runClaudeAnalysis(input);
      run = { ...output, mode: "CLAUDE", modelId, errorStatus: null, usedEvidenceIds: input.evidence.map((e) => e.id) };
    } catch (error) {
      const status = error instanceof ClaudeAnalysisError ? error.status : "CLAUDE_FAILED";
      const fallback = runRuleBasedAnalysis(input);
      run = {
        ...fallback,
        limitations: [
          `Claude analysis was requested but failed (${status}); this is the deterministic rule-based fallback.`,
          ...fallback.limitations,
        ],
        mode: "RULE_BASED",
        modelId: null,
        errorStatus: status,
        usedEvidenceIds: input.evidence.map((e) => e.id),
      };
    }
  } else {
    run = { ...runRuleBasedAnalysis(input), mode: "RULE_BASED", modelId: null, errorStatus: null, usedEvidenceIds: input.evidence.map((e) => e.id) };
  }

  return prisma.$transaction(async (tx) => {
    const stored = await tx.investigationAnalysis.create({
      data: {
        organizationId: ctx.organizationId,
        incidentId: incident.id,
        mode: run.mode,
        summary: run.summary,
        classificationHint: run.classificationSuggestion,
        factsJson: JSON.stringify(run.facts),
        hypothesesJson: JSON.stringify(run.hypotheses),
        unknownsJson: JSON.stringify(run.unknowns),
        recommendationsJson: JSON.stringify(run.recommendedActions),
        limitationsJson: JSON.stringify(run.limitations),
        usedEvidenceIdsJson: JSON.stringify(run.usedEvidenceIds),
        modelId: run.modelId,
        errorStatus: run.errorStatus,
        createdById: ctx.userId,
      },
    });
    await writeAudit(tx, ctx, {
      action: "analysis.run",
      entityType: "InvestigationAnalysis",
      entityId: stored.id,
      summary: `${incident.caseNumber}: ${run.mode === "CLAUDE" ? "Claude" : "rule-based"} analysis over ${run.usedEvidenceIds.length} evidence items${
        run.errorStatus ? ` (Claude unavailable: ${run.errorStatus})` : ""
      }`,
      metadata: { caseNumber: incident.caseNumber, mode: run.mode, modelId: run.modelId, errorStatus: run.errorStatus },
    });
    return toAnalysisView(stored);
  });
}

type StoredAnalysis = Awaited<ReturnType<typeof prisma.investigationAnalysis.findFirst>>;

function parseList<T>(json: string): T[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export function toAnalysisView(a: NonNullable<StoredAnalysis>) {
  return {
    id: a.id,
    mode: a.mode as AnalysisRun["mode"],
    generatedAt: a.generatedAt.toISOString(),
    summary: a.summary,
    classificationSuggestion: a.classificationHint as AnalysisOutput["classificationSuggestion"] | null,
    facts: parseList<AnalysisOutput["facts"][number]>(a.factsJson),
    hypotheses: parseList<AnalysisOutput["hypotheses"][number]>(a.hypothesesJson),
    unknowns: parseList<string>(a.unknownsJson),
    recommendedActions: parseList<AnalysisOutput["recommendedActions"][number]>(a.recommendationsJson),
    limitations: parseList<string>(a.limitationsJson),
    usedEvidenceIds: parseList<string>(a.usedEvidenceIdsJson),
    modelId: a.modelId,
    errorStatus: a.errorStatus,
  };
}

export type AnalysisView = ReturnType<typeof toAnalysisView>;

export async function latestAnalysis(ctx: AuthContext, incidentId: string): Promise<AnalysisView | null> {
  const a = await prisma.investigationAnalysis.findFirst({
    where: { organizationId: ctx.organizationId, incidentId },
    orderBy: { generatedAt: "desc" },
  });
  return a ? toAnalysisView(a) : null;
}
