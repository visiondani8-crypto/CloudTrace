import "server-only";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { requireRole, type AuthContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { formatEvidenceRef } from "@/lib/domain/enums";
import { AppError } from "@/lib/domain/errors";
import {
  parseImportFile,
  sanitiseFilename,
  sourceKey,
  validateImportRows,
  type ImportFormat,
  type ValidationSummary,
} from "@/lib/evidence/import";
import { normaliseEvidence } from "@/lib/evidence/normalise";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { annotationSchema, evidenceListSchema, manualEvidenceSchema } from "@/lib/validation/schemas";
import { assetOrThrow, evidenceOrThrow, incidentOrThrow, memberNameMap, nextEvidenceRef } from "./guards";

export interface EvidenceRow {
  id: string;
  ref: string;
  refNumber: number;
  incidentId: string;
  caseNumber: string;
  assetId: string | null;
  assetName: string | null;
  title: string;
  category: string;
  provenance: string;
  sourceName: string;
  sourceUri: string | null;
  sourceEventId: string | null;
  sha256: string;
  observedAt: string;
  ingestedAt: string;
  isSynthetic: boolean;
  confidenceLevel: string;
  assetStatus: string | null;
  annotationCount: number;
  importFilename: string | null;
}

const rowInclude = {
  incident: { select: { caseNumber: true } },
  asset: { select: { name: true } },
  importJob: { select: { filename: true } },
  _count: { select: { annotations: true } },
} satisfies Prisma.EvidenceInclude;

type RowSource = Prisma.EvidenceGetPayload<{ include: typeof rowInclude }>;

function toRow(e: RowSource): EvidenceRow {
  return {
    id: e.id,
    ref: formatEvidenceRef(e.refNumber),
    refNumber: e.refNumber,
    incidentId: e.incidentId,
    caseNumber: e.incident.caseNumber,
    assetId: e.assetId,
    assetName: e.asset?.name ?? null,
    title: e.title,
    category: e.category,
    provenance: e.provenance,
    sourceName: e.sourceName,
    sourceUri: e.sourceUri,
    sourceEventId: e.sourceEventId,
    sha256: e.sha256,
    observedAt: e.observedAt.toISOString(),
    ingestedAt: e.ingestedAt.toISOString(),
    isSynthetic: e.isSynthetic,
    confidenceLevel: e.confidenceLevel,
    assetStatus: e.assetStatus,
    annotationCount: e._count.annotations,
    importFilename: e.importJob?.filename ?? null,
  };
}

function parseDateBound(value: string | undefined, end: boolean): Date | undefined {
  if (!value) return undefined;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T${end ? "23:59:59.999" : "00:00:00"}Z`) : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function listEvidence(ctx: AuthContext, raw: z.input<typeof evidenceListSchema>) {
  const f = evidenceListSchema.parse(raw);
  const page = f.page ?? 1;
  const pageSize = f.pageSize ?? 20;
  const from = parseDateBound(f.from, false);
  const to = parseDateBound(f.to, true);
  const refMatch = f.q?.match(/^EV-?(\d{1,7})$/i);

  const where: Prisma.EvidenceWhereInput = {
    organizationId: ctx.organizationId,
    ...(f.incidentId ? { incidentId: f.incidentId } : {}),
    ...(f.provenance ? { provenance: f.provenance } : {}),
    ...(f.assetId ? { assetId: f.assetId } : {}),
    ...(from || to ? { observedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(f.q
      ? {
          OR: [
            { title: { contains: f.q } },
            { sourceName: { contains: f.q } },
            { sourceEventId: { contains: f.q } },
            { sha256: { startsWith: f.q.toLowerCase() } },
            { incident: { caseNumber: { contains: f.q } } },
            { asset: { name: { contains: f.q } } },
            ...(refMatch ? [{ refNumber: Number.parseInt(refMatch[1], 10) }] : []),
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.evidence.count({ where }),
    prisma.evidence.findMany({
      where,
      include: rowInclude,
      orderBy: [{ observedAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { items: rows.map(toRow), total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function listIncidentEvidence(ctx: AuthContext, incidentId: string): Promise<EvidenceRow[]> {
  await incidentOrThrow(prisma, ctx, incidentId);
  const rows = await prisma.evidence.findMany({
    where: { organizationId: ctx.organizationId, incidentId },
    include: rowInclude,
    orderBy: [{ observedAt: "asc" }, { id: "asc" }],
    take: 2000,
  });
  return rows.map(toRow);
}

export async function getEvidenceDetail(ctx: AuthContext, evidenceId: string) {
  const e = await prisma.evidence.findFirst({
    where: { id: evidenceId, organizationId: ctx.organizationId },
    include: {
      ...rowInclude,
      annotations: { orderBy: { createdAt: "asc" } },
      timeline: { select: { id: true, title: true, occurredAt: true } },
      importJob: { select: { filename: true, fileSha256: true, createdAt: true } },
    },
  });
  if (!e) throw new AppError("NOT_FOUND", "Evidence not found.");
  const names = await memberNameMap(prisma, ctx);
  let rawMetadata: Record<string, unknown> | null = null;
  try {
    rawMetadata = e.rawMetadataJson ? (JSON.parse(e.rawMetadataJson) as Record<string, unknown>) : null;
  } catch {
    rawMetadata = null;
  }
  return {
    ...toRow(e),
    contentText: e.contentText,
    createdByName: e.createdById ? (names.get(e.createdById) ?? "Former member") : null,
    importJob: e.importJob
      ? { filename: e.importJob.filename, fileSha256: e.importJob.fileSha256, createdAt: e.importJob.createdAt.toISOString() }
      : null,
    rawMetadata,
    timelineEvents: e.timeline.map((t) => ({ id: t.id, title: t.title, occurredAt: t.occurredAt.toISOString() })),
    annotations: e.annotations.map((a) => ({
      id: a.id,
      text: a.text,
      authorName: names.get(a.authorId) ?? "Former member",
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export type EvidenceDetail = Awaited<ReturnType<typeof getEvidenceDetail>>;

export async function createManualEvidence(ctx: AuthContext, incidentId: string, raw: unknown) {
  requireRole(ctx, "ANALYST");
  const input = manualEvidenceSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const incident = await incidentOrThrow(tx, ctx, incidentId);
    const asset = input.assetId ? await assetOrThrow(tx, ctx, input.assetId) : null;
    const normalised = normaliseEvidence({
      incidentCaseNumber: incident.caseNumber,
      observedAt: input.observedAt,
      title: input.title,
      category: input.category,
      sourceName: input.sourceName,
      sourceEventId: input.sourceEventId ?? "",
      assetName: asset?.name ?? "",
      provenance: input.provenance,
      contentText: input.contentText,
      sourceUri: input.sourceUri ?? "",
      confidenceLevel: input.confidenceLevel ?? "",
      assetStatus: input.assetStatus ?? "",
    });
    if (!normalised.ok) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Evidence is invalid.",
        normalised.errors.map((m) => ({ message: m })),
      );
    }
    const v = normalised.value;
    if (v.sourceEventId) {
      const dup = await tx.evidence.findFirst({
        where: { organizationId: ctx.organizationId, sourceName: v.sourceName, sourceEventId: v.sourceEventId },
      });
      if (dup) throw new AppError("CONFLICT", `Evidence ${formatEvidenceRef(dup.refNumber)} already uses this source event ID.`);
    }
    const refNumber = await nextEvidenceRef(tx, ctx);
    const evidence = await tx.evidence.create({
      data: {
        organizationId: ctx.organizationId,
        refNumber,
        incidentId: incident.id,
        assetId: asset?.id ?? null,
        title: v.title,
        category: v.category,
        provenance: v.provenance,
        sourceName: v.sourceName,
        sourceUri: v.sourceUri,
        sourceEventId: v.sourceEventId,
        contentText: v.contentText,
        sha256: v.sha256,
        observedAt: v.observedAt,
        isSynthetic: v.isSynthetic,
        confidenceLevel: v.confidenceLevel,
        assetStatus: v.assetStatus,
        createdById: ctx.userId,
        rawMetadataJson: JSON.stringify({ entry: "manual" }),
      },
    });
    await tx.timelineEvent.create({
      data: {
        organizationId: ctx.organizationId,
        incidentId: incident.id,
        evidenceId: evidence.id,
        assetId: evidence.assetId,
        occurredAt: evidence.observedAt,
        eventType: evidence.category,
        title: evidence.title,
        description: evidence.contentText.slice(0, 280),
        sourceClass: evidence.provenance,
        createdById: ctx.userId,
      },
    });
    if (asset) {
      await tx.incidentAsset.upsert({
        where: { incidentId_assetId: { incidentId: incident.id, assetId: asset.id } },
        create: { organizationId: ctx.organizationId, incidentId: incident.id, assetId: asset.id },
        update: {},
      });
    }
    await tx.incident.update({ where: { id: incident.id }, data: { updatedAt: new Date() } });
    await writeAudit(tx, ctx, {
      action: "evidence.created",
      entityType: "Evidence",
      entityId: evidence.id,
      summary: `${incident.caseNumber}: added ${formatEvidenceRef(refNumber)} ${evidence.title}`,
      metadata: { caseNumber: incident.caseNumber, provenance: evidence.provenance, sha256: evidence.sha256 },
    });
    return evidence;
  });
}

export async function addAnnotation(ctx: AuthContext, evidenceId: string, raw: unknown) {
  requireRole(ctx, "ANALYST");
  const input = annotationSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const evidence = await evidenceOrThrow(tx, ctx, evidenceId);
    const annotation = await tx.evidenceAnnotation.create({
      data: { organizationId: ctx.organizationId, evidenceId: evidence.id, authorId: ctx.userId, text: input.text },
    });
    await writeAudit(tx, ctx, {
      action: "evidence.annotated",
      entityType: "Evidence",
      entityId: evidence.id,
      summary: `Annotated ${formatEvidenceRef(evidence.refNumber)}`,
      metadata: { length: input.text.length },
    });
    return annotation;
  });
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export type ImportMode = "ATOMIC" | "PARTIAL";

export interface ImportPreview {
  filename: string;
  format: ImportFormat;
  fileSha256: string;
  fileErrors: string[];
  summary: Omit<ValidationSummary, "rows">;
  rows: {
    rowNumber: number;
    status: string;
    errors: string[];
    duplicateReason?: string;
    title?: string;
    observedAt?: string;
    provenance?: string;
    category?: string;
    assetName?: string | null;
    sha256?: string;
  }[];
}

export interface ImportResult extends ImportPreview {
  importJobId: string | null;
  outcome: "COMPLETED" | "REJECTED" | "PREVIEW";
  mode: ImportMode;
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  auditEntryId: string | null;
}

/**
 * Validates and (unless dryRun) stores an evidence file for one incident.
 * ATOMIC (default): any invalid row rejects the whole file — nothing is written.
 * PARTIAL: valid rows are stored; invalid rows are reported and not stored.
 * Duplicates of already-stored records are skipped and reported in both modes.
 */
export async function importEvidence(
  ctx: AuthContext,
  incidentId: string,
  file: { filename: string; bytes: Uint8Array },
  options: { mode: ImportMode; dryRun: boolean },
): Promise<ImportResult> {
  requireRole(ctx, "ANALYST");
  const limited = rateLimit(`import:${ctx.userId}`, LIMITS.importPerUser.limit, LIMITS.importPerUser.windowMs);
  if (!limited.allowed) throw new AppError("RATE_LIMITED", `Too many imports. Try again in ${limited.retryAfterSeconds}s.`);

  const filename = sanitiseFilename(file.filename);
  if (!filename) {
    throw new AppError("VALIDATION_ERROR", "File name must end in .csv or .json and contain only letters, digits, spaces, dots, dashes or brackets.");
  }

  const incident = await incidentOrThrow(prisma, ctx, incidentId);
  const parsed = parseImportFile(filename, file.bytes);

  const [assets, existingKeys, existingHashes] = await Promise.all([
    prisma.asset.findMany({ where: { organizationId: ctx.organizationId }, select: { id: true, name: true } }),
    prisma.evidence.findMany({
      where: { organizationId: ctx.organizationId, sourceEventId: { not: null } },
      select: { sourceName: true, sourceEventId: true },
    }),
    prisma.evidence.findMany({ where: { organizationId: ctx.organizationId, incidentId }, select: { sha256: true } }),
  ]);

  const summary = validateImportRows(parsed.rows, {
    targetCaseNumber: incident.caseNumber,
    assetsByName: new Map(assets.map((a) => [a.name.toLowerCase(), a])),
    existingSourceKeys: new Set(existingKeys.map((e) => sourceKey(e.sourceName, e.sourceEventId!))),
    existingHashes: new Set(existingHashes.map((e) => e.sha256)),
  });

  const { rows: validated, ...counts } = summary;
  const preview: ImportPreview = {
    filename,
    format: parsed.format,
    fileSha256: parsed.fileSha256,
    fileErrors: parsed.fileErrors,
    summary: counts,
    rows: validated.slice(0, 1000).map((r) => ({
      rowNumber: r.rowNumber,
      status: r.status,
      errors: r.errors,
      duplicateReason: r.duplicateReason,
      title: r.value?.title,
      observedAt: r.value?.observedAt.toISOString(),
      provenance: r.value?.provenance,
      category: r.value?.category,
      assetName: r.value?.assetName,
      sha256: r.value?.sha256,
    })),
  };

  const fileRejected = parsed.fileErrors.length > 0 || summary.total === 0;
  const atomicRejected = options.mode === "ATOMIC" && summary.invalid > 0;

  if (options.dryRun) {
    return {
      ...preview,
      importJobId: null,
      outcome: "PREVIEW",
      mode: options.mode,
      acceptedCount: fileRejected || atomicRejected ? 0 : summary.valid,
      rejectedCount: fileRejected ? summary.total : options.mode === "ATOMIC" && summary.invalid > 0 ? summary.total - summary.duplicates : summary.invalid,
      duplicateCount: summary.duplicates,
      auditEntryId: null,
    };
  }

  const toInsert = fileRejected || atomicRejected ? [] : validated.filter((r) => r.status === "VALID");
  const outcome: "COMPLETED" | "REJECTED" = fileRejected || atomicRejected ? "REJECTED" : "COMPLETED";
  const rejectedCount = outcome === "REJECTED" ? summary.total - (fileRejected ? 0 : summary.duplicates) : summary.invalid;
  const errors = [
    ...parsed.fileErrors.map((m) => ({ row: 0, message: m })),
    ...validated.filter((r) => r.status === "INVALID").flatMap((r) => r.errors.map((m) => ({ row: r.rowNumber, message: m }))),
  ].slice(0, 500);

  return prisma.$transaction(async (tx) => {
    const job = await tx.importJob.create({
      data: {
        organizationId: ctx.organizationId,
        incidentId: incident.id,
        filename,
        fileSha256: parsed.fileSha256,
        format: parsed.format,
        mode: options.mode,
        outcome,
        totalRows: summary.total,
        acceptedCount: toInsert.length,
        rejectedCount,
        duplicateCount: summary.duplicates,
        errorsJson: JSON.stringify(errors),
        createdById: ctx.userId,
      },
    });

    let ref = await nextEvidenceRef(tx, ctx);
    const assetIdsTouched = new Set<string>();
    for (const row of toInsert) {
      const v = row.value!;
      const evidence = await tx.evidence.create({
        data: {
          organizationId: ctx.organizationId,
          refNumber: ref++,
          incidentId: incident.id,
          assetId: v.assetId,
          title: v.title,
          category: v.category,
          provenance: v.provenance,
          sourceName: v.sourceName,
          sourceUri: v.sourceUri,
          sourceEventId: v.sourceEventId,
          contentText: v.contentText,
          sha256: v.sha256,
          observedAt: v.observedAt,
          isSynthetic: v.isSynthetic,
          confidenceLevel: v.confidenceLevel,
          assetStatus: v.assetStatus,
          createdById: ctx.userId,
          importJobId: job.id,
          rawMetadataJson: JSON.stringify({ entry: "import", filename, format: parsed.format, rowNumber: row.rowNumber }),
        },
      });
      await tx.timelineEvent.create({
        data: {
          organizationId: ctx.organizationId,
          incidentId: incident.id,
          evidenceId: evidence.id,
          assetId: evidence.assetId,
          occurredAt: evidence.observedAt,
          eventType: evidence.category,
          title: evidence.title,
          description: evidence.contentText.slice(0, 280),
          sourceClass: evidence.provenance,
          createdById: ctx.userId,
        },
      });
      if (evidence.assetId) assetIdsTouched.add(evidence.assetId);
    }
    for (const assetId of assetIdsTouched) {
      await tx.incidentAsset.upsert({
        where: { incidentId_assetId: { incidentId: incident.id, assetId } },
        create: { organizationId: ctx.organizationId, incidentId: incident.id, assetId },
        update: {},
      });
    }
    if (toInsert.length) await tx.incident.update({ where: { id: incident.id }, data: { updatedAt: new Date() } });

    const audit = await writeAudit(tx, ctx, {
      action: outcome === "COMPLETED" ? "evidence.imported" : "evidence.import_rejected",
      entityType: "ImportJob",
      entityId: job.id,
      summary: `${incident.caseNumber}: ${outcome === "COMPLETED" ? "imported" : "rejected import of"} ${filename} — ${toInsert.length} accepted, ${rejectedCount} rejected, ${summary.duplicates} duplicates skipped`,
      metadata: {
        caseNumber: incident.caseNumber,
        filename,
        fileSha256: parsed.fileSha256,
        mode: options.mode,
        accepted: toInsert.length,
        rejected: rejectedCount,
        duplicates: summary.duplicates,
      },
    });

    return {
      ...preview,
      importJobId: job.id,
      outcome,
      mode: options.mode,
      acceptedCount: toInsert.length,
      rejectedCount,
      duplicateCount: summary.duplicates,
      auditEntryId: audit.id,
    };
  });
}

export async function listImportJobs(ctx: AuthContext, incidentId?: string) {
  const jobs = await prisma.importJob.findMany({
    where: { organizationId: ctx.organizationId, ...(incidentId ? { incidentId } : {}) },
    include: { incident: { select: { caseNumber: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return jobs.map((j) => ({
    id: j.id,
    caseNumber: j.incident.caseNumber,
    filename: j.filename,
    format: j.format,
    mode: j.mode,
    outcome: j.outcome,
    acceptedCount: j.acceptedCount,
    rejectedCount: j.rejectedCount,
    duplicateCount: j.duplicateCount,
    createdAt: j.createdAt.toISOString(),
  }));
}
