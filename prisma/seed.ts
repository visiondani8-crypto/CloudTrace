/**
 * Idempotent demo seed. Re-running it never duplicates organisations, users,
 * incidents, evidence, edges, hypotheses, tasks, notes or reports, and it does
 * not overwrite changes analysts have made to existing seeded records.
 *
 *   npm run db:seed
 *
 * Refuses to run with unsafe defaults (placeholder/short password, or
 * NODE_ENV=production without ALLOW_DEMO_SEED=true).
 */

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { runRuleBasedAnalysis } from "../src/lib/analysis/rule-based";
import { canonicalEvidenceHash, sha256Hex } from "../src/lib/evidence/normalise";
import { assembleReport, loadAnalysisInput } from "../src/lib/investigation/load";
import {
  ASSETS,
  DEPENDENCIES,
  INCIDENTS,
  ISOLATION_INCIDENT,
  ISOLATION_ORG,
  ISOLATION_USER,
  ORG,
  USERS,
} from "./seed-data";

const SYSTEM_ACTOR = "Demo seed";

export function assertSafeSeedEnvironment(password: string | undefined): string {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Refusing to seed demo accounts with NODE_ENV=production. Set ALLOW_DEMO_SEED=true only for a disposable demo.");
  }
  if (!password || password.startsWith("replace-this") || password.length < 12) {
    throw new Error(
      "DEMO_SEED_PASSWORD must be set in .env to a unique value of at least 12 characters (the placeholder is rejected).",
    );
  }
  return password;
}

async function audit(db: PrismaClient, organizationId: string, action: string, entityType: string, entityId: string, summary: string) {
  await db.auditEntry.create({
    data: { organizationId, actorId: null, actorLabel: SYSTEM_ACTOR, action, entityType, entityId, summary, metadataJson: "{}" },
  });
}

async function upsertUser(db: PrismaClient, email: string, name: string, passwordHash: string) {
  return db.user.upsert({ where: { email }, create: { email, name, passwordHash }, update: { passwordHash } });
}

async function nextRef(db: PrismaClient, organizationId: string) {
  const agg = await db.evidence.aggregate({ where: { organizationId }, _max: { refNumber: true } });
  return (agg._max.refNumber ?? 0) + 1;
}

export interface SeedSummary {
  organizationId: string;
  isolationOrganizationId: string;
  created: Record<string, number>;
}

export async function seedDatabase(db: PrismaClient, password: string, log: (msg: string) => void = () => {}): Promise<SeedSummary> {
  const created: Record<string, number> = {};
  const bump = (k: string) => (created[k] = (created[k] ?? 0) + 1);
  const passwordHash = await bcrypt.hash(password, 12);

  // --- Organisation and users ------------------------------------------------
  const org = await db.organization.upsert({ where: { slug: ORG.slug }, create: ORG, update: {} });
  const users = new Map<string, string>();
  for (const u of USERS) {
    const user = await upsertUser(db, u.email, u.name, passwordHash);
    users.set(u.email, user.id);
    const existing = await db.membership.findUnique({ where: { organizationId_userId: { organizationId: org.id, userId: user.id } } });
    if (!existing) {
      await db.membership.create({ data: { organizationId: org.id, userId: user.id, role: u.role } });
      bump("memberships");
    }
  }

  // --- Assets and dependencies -----------------------------------------------
  const assetIds = new Map<string, string>();
  for (const a of ASSETS) {
    const existing = await db.asset.findUnique({ where: { organizationId_name: { organizationId: org.id, name: a.name } } });
    const asset =
      existing ??
      (await db.asset.create({
        data: {
          organizationId: org.id,
          name: a.name,
          provider: a.provider,
          assetType: a.assetType,
          owner: a.owner,
          criticality: a.criticality,
          description: a.description,
          isSynthetic: a.isSynthetic,
        },
      }));
    if (!existing) bump("assets");
    assetIds.set(a.key, asset.id);
  }
  for (const d of DEPENDENCIES) {
    const consumerAssetId = assetIds.get(d.consumer)!;
    const providerAssetId = assetIds.get(d.provider)!;
    const key = { organizationId_consumerAssetId_providerAssetId: { organizationId: org.id, consumerAssetId, providerAssetId } };
    if (!(await db.dependency.findUnique({ where: key }))) {
      await db.dependency.create({
        data: { organizationId: org.id, consumerAssetId, providerAssetId, relationshipType: "DEPENDS_ON", description: d.description },
      });
      bump("dependencies");
    }
  }

  // --- Incidents ---------------------------------------------------------------
  for (const spec of INCIDENTS) {
    let incident = await db.incident.findUnique({ where: { organizationId_caseNumber: { organizationId: org.id, caseNumber: spec.caseNumber } } });
    if (!incident) {
      incident = await db.incident.create({
        data: {
          organizationId: org.id,
          caseNumber: spec.caseNumber,
          title: spec.title,
          description: spec.description,
          type: spec.type,
          severity: spec.severity,
          status: spec.status,
          classification: spec.classification,
          startedAt: spec.startedAt ? new Date(spec.startedAt) : null,
          resolvedAt: spec.resolvedAt ? new Date(spec.resolvedAt) : null,
          ownerId: users.get(spec.owner) ?? null,
          isDemo: true,
          dataLabel: spec.dataLabel,
        },
      });
      bump("incidents");
      await audit(db, org.id, "incident.created", "Incident", incident.id, `Seeded demonstration case ${spec.caseNumber}`);
    }
    const incidentId = incident.id;

    for (const key of spec.scope) {
      const assetId = assetIds.get(key)!;
      await db.incidentAsset.upsert({
        where: { incidentId_assetId: { incidentId, assetId } },
        create: { organizationId: org.id, incidentId, assetId },
        update: {},
      });
    }

    for (const s of spec.sources) {
      await db.incidentSource.upsert({
        where: { incidentId_url: { incidentId, url: s.url } },
        create: { ...s, organizationId: org.id, incidentId, retrievedAt: new Date("2026-11-16T00:00:00Z") },
        update: {},
      });
    }

    const evidenceIds = new Map<string, string>();
    for (const e of spec.evidence) {
      const where = { organizationId_sourceName_sourceEventId: { organizationId: org.id, sourceName: e.sourceName, sourceEventId: e.sourceEventId } };
      let evidence = await db.evidence.findUnique({ where });
      if (!evidence) {
        const assetId = e.asset ? assetIds.get(e.asset)! : null;
        const assetName = e.asset ? ASSETS.find((a) => a.key === e.asset)!.name : null;
        const observedAt = new Date(e.observedAt);
        evidence = await db.evidence.create({
          data: {
            organizationId: org.id,
            refNumber: await nextRef(db, org.id),
            incidentId,
            assetId,
            title: e.title,
            category: e.category,
            provenance: e.provenance,
            sourceName: e.sourceName,
            sourceUri: e.sourceUri,
            sourceEventId: e.sourceEventId,
            contentText: e.contentText,
            sha256: canonicalEvidenceHash({
              observedAt,
              title: e.title,
              category: e.category as never,
              provenance: e.provenance,
              sourceName: e.sourceName,
              sourceEventId: e.sourceEventId,
              assetName,
              contentText: e.contentText,
              sourceUri: e.sourceUri,
            }),
            observedAt,
            isSynthetic: e.provenance === "SYNTHETIC",
            confidenceLevel: e.confidenceLevel,
            assetStatus: e.assetStatus,
            rawMetadataJson: JSON.stringify({ entry: "seed", scenario: spec.caseNumber }),
          },
        });
        await db.timelineEvent.create({
          data: {
            organizationId: org.id,
            incidentId,
            evidenceId: evidence.id,
            assetId,
            occurredAt: observedAt,
            eventType: e.category,
            title: e.title,
            description: e.contentText.slice(0, 280),
            sourceClass: e.provenance,
          },
        });
        bump("evidence");
      }
      evidenceIds.set(e.key, evidence.id);
    }

    for (const ev of spec.analystEvents) {
      const occurredAt = new Date(ev.occurredAt);
      const exists = await db.timelineEvent.findFirst({ where: { organizationId: org.id, incidentId, title: ev.title, occurredAt } });
      if (!exists) {
        await db.timelineEvent.create({
          data: {
            organizationId: org.id,
            incidentId,
            assetId: ev.asset ? assetIds.get(ev.asset)! : null,
            occurredAt,
            eventType: "ANALYST_ENTRY",
            title: ev.title,
            description: ev.description,
            sourceClass: "ANALYST_NOTE",
            createdById: users.get(spec.owner) ?? null,
          },
        });
        bump("timelineEntries");
      }
    }

    for (const h of spec.hypotheses) {
      if (await db.hypothesis.findFirst({ where: { organizationId: org.id, incidentId, title: h.title } })) continue;
      const hypothesis = await db.hypothesis.create({
        data: {
          organizationId: org.id,
          incidentId,
          title: h.title,
          description: h.description,
          confidence: h.confidence,
          status: h.status,
          note: h.note,
          createdById: users.get(h.author)!,
        },
      });
      const links = [
        ...h.supporting.map((k) => ({ evidenceId: evidenceIds.get(k)!, relation: "SUPPORTING" })),
        ...h.contradicting.map((k) => ({ evidenceId: evidenceIds.get(k)!, relation: "CONTRADICTING" })),
      ];
      if (links.length) {
        await db.hypothesisEvidence.createMany({
          data: links.map((l) => ({ ...l, organizationId: org.id, hypothesisId: hypothesis.id })),
        });
      }
      bump("hypotheses");
    }

    for (const t of spec.tasks) {
      if (await db.responseTask.findFirst({ where: { organizationId: org.id, incidentId, title: t.title } })) continue;
      const task = await db.responseTask.create({
        data: {
          organizationId: org.id,
          incidentId,
          title: t.title,
          description: t.description,
          priority: t.priority,
          status: t.status,
          assigneeId: t.assignee ? (users.get(t.assignee) ?? null) : null,
          dueAt: t.dueAt ? new Date(t.dueAt) : null,
          completedAt: t.completedAt ? new Date(t.completedAt) : null,
          createdById: users.get(spec.owner)!,
        },
      });
      if (t.evidence.length) {
        await db.taskEvidence.createMany({
          data: t.evidence.map((k) => ({ organizationId: org.id, taskId: task.id, evidenceId: evidenceIds.get(k)! })),
        });
      }
      bump("tasks");
    }

    for (const n of spec.notes) {
      if (await db.investigationNote.findFirst({ where: { organizationId: org.id, incidentId, text: n.text } })) continue;
      await db.investigationNote.create({
        data: { organizationId: org.id, incidentId, authorId: users.get(n.author)!, text: n.text },
      });
      bump("notes");
    }
  }

  // --- Initial rule-based analysis and report v1 for CT-2026-001 --------------
  const historical = await db.incident.findUniqueOrThrow({
    where: { organizationId_caseNumber: { organizationId: org.id, caseNumber: "CT-2026-001" } },
  });
  const hasAnalysis = await db.investigationAnalysis.count({ where: { incidentId: historical.id } });
  if (!hasAnalysis) {
    const input = await loadAnalysisInput(db, org.id, historical.id);
    const run = runRuleBasedAnalysis(input);
    const stored = await db.investigationAnalysis.create({
      data: {
        organizationId: org.id,
        incidentId: historical.id,
        mode: "RULE_BASED",
        summary: run.summary,
        classificationHint: run.classificationSuggestion,
        factsJson: JSON.stringify(run.facts),
        hypothesesJson: JSON.stringify(run.hypotheses),
        unknownsJson: JSON.stringify(run.unknowns),
        recommendationsJson: JSON.stringify(run.recommendedActions),
        limitationsJson: JSON.stringify(run.limitations),
        usedEvidenceIdsJson: JSON.stringify(input.evidence.map((e) => e.id)),
      },
    });
    await audit(db, org.id, "analysis.run", "InvestigationAnalysis", stored.id, "CT-2026-001: rule-based analysis (seeded)");
    bump("analyses");

    if (!(await db.reportSnapshot.count({ where: { incidentId: historical.id } }))) {
      const analyst = USERS.find((u) => u.role === "ANALYST")!;
      const content = await assembleReport(db, { organizationId: org.id, generatedBy: analyst.name }, historical.id, 1, {
        ...run,
        mode: "RULE_BASED",
        modelId: null,
        generatedAt: stored.generatedAt,
        computedForReport: false,
      });
      const contentJson = JSON.stringify(content);
      const report = await db.reportSnapshot.create({
        data: {
          organizationId: org.id,
          incidentId: historical.id,
          version: 1,
          title: content.title,
          createdById: users.get(analyst.email)!,
          generatedAt: new Date(content.generatedAt),
          contentJson,
          contentSha256: sha256Hex(contentJson),
        },
      });
      await audit(db, org.id, "report.generated", "ReportSnapshot", report.id, "CT-2026-001: generated report v1 (seeded)");
      bump("reports");
    }
  }

  // --- Isolation organisation (cross-tenant tests) -----------------------------
  const iso = await db.organization.upsert({ where: { slug: ISOLATION_ORG.slug }, create: ISOLATION_ORG, update: {} });
  const isoUser = await upsertUser(db, ISOLATION_USER.email, ISOLATION_USER.name, passwordHash);
  if (!(await db.membership.findUnique({ where: { organizationId_userId: { organizationId: iso.id, userId: isoUser.id } } }))) {
    await db.membership.create({ data: { organizationId: iso.id, userId: isoUser.id, role: ISOLATION_USER.role } });
  }
  const isoAsset =
    (await db.asset.findUnique({ where: { organizationId_name: { organizationId: iso.id, name: ISOLATION_INCIDENT.asset.name } } })) ??
    (await db.asset.create({ data: { ...ISOLATION_INCIDENT.asset, organizationId: iso.id, isSynthetic: true } }));
  let isoIncident = await db.incident.findUnique({
    where: { organizationId_caseNumber: { organizationId: iso.id, caseNumber: ISOLATION_INCIDENT.caseNumber } },
  });
  if (!isoIncident) {
    isoIncident = await db.incident.create({
      data: {
        organizationId: iso.id,
        caseNumber: ISOLATION_INCIDENT.caseNumber,
        title: ISOLATION_INCIDENT.title,
        description: ISOLATION_INCIDENT.description,
        type: "OTHER",
        severity: "LOW",
        status: "OPEN",
        classification: "UNDETERMINED",
        startedAt: new Date(ISOLATION_INCIDENT.evidence.observedAt),
        ownerId: isoUser.id,
        isDemo: true,
        dataLabel: "SIMULATED ISOLATION FIXTURE",
      },
    });
    bump("incidents");
  }
  const isoEvidenceKey = {
    organizationId_sourceName_sourceEventId: {
      organizationId: iso.id,
      sourceName: ISOLATION_INCIDENT.evidence.sourceName,
      sourceEventId: ISOLATION_INCIDENT.evidence.sourceEventId,
    },
  };
  if (!(await db.evidence.findUnique({ where: isoEvidenceKey }))) {
    const observedAt = new Date(ISOLATION_INCIDENT.evidence.observedAt);
    const ev = ISOLATION_INCIDENT.evidence;
    await db.evidence.create({
      data: {
        organizationId: iso.id,
        refNumber: await nextRef(db, iso.id),
        incidentId: isoIncident.id,
        assetId: isoAsset.id,
        title: ev.title,
        category: "HEALTH_EVENT",
        provenance: "SYNTHETIC",
        sourceName: ev.sourceName,
        sourceEventId: ev.sourceEventId,
        contentText: ev.contentText,
        sha256: canonicalEvidenceHash({
          observedAt,
          title: ev.title,
          category: "HEALTH_EVENT",
          provenance: "SYNTHETIC",
          sourceName: ev.sourceName,
          sourceEventId: ev.sourceEventId,
          assetName: isoAsset.name,
          contentText: ev.contentText,
          sourceUri: null,
        }),
        observedAt,
        isSynthetic: true,
        confidenceLevel: "UNVERIFIED",
        assetStatus: "DEGRADED",
      },
    });
    bump("evidence");
  }

  log(
    Object.keys(created).length
      ? `Seed created: ${Object.entries(created)
          .map(([k, v]) => `${v} ${k}`)
          .join(", ")}.`
      : "Seed already applied — nothing new to create (existing records left unchanged).",
  );
  return { organizationId: org.id, isolationOrganizationId: iso.id, created };
}

async function main() {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* .env is optional when variables are provided by the shell */
  }
  const password = assertSafeSeedEnvironment(process.env.DEMO_SEED_PASSWORD);
  const db = new PrismaClient();
  try {
    await seedDatabase(db, password, console.log);
    console.log(`Demo accounts: ${USERS.map((u) => `${u.email} (${u.role})`).join(", ")}; password = DEMO_SEED_PASSWORD from .env.`);
    console.log(`Isolation test account: ${ISOLATION_USER.email} (separate organisation).`);
  } finally {
    await db.$disconnect();
  }
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && /seed\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
