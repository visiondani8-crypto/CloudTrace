import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ASSET_ASSERTION_STATUSES,
  CONFIDENCE_LEVELS,
  EVIDENCE_CATEGORIES,
  PROVENANCES,
  type AssetAssertionStatus,
  type ConfidenceLevel,
  type EvidenceCategory,
  type Provenance,
} from "@/lib/domain/enums";
import { ISO_WITH_ZONE } from "@/lib/domain/time";

export const LIMITS = {
  titleMax: 300,
  contentMax: 20_000,
  sourceNameMax: 200,
  sourceEventIdMax: 200,
  uriMax: 2_000,
  assetNameMax: 200,
  caseNumberMax: 40,
} as const;

/**
 * Strips control characters (except tab and newline), normalises line endings
 * and trims. Content is stored and rendered as plain text — never as HTML.
 */
export function sanitiseText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

const optionalTrimmed = (max: number, label: string) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (typeof v === "string" ? sanitiseText(v) : ""))
    .refine((v) => v.length <= max, `${label} must be at most ${max} characters`)
    .transform((v) => (v.length === 0 ? null : v));

const requiredText = (max: number, label: string) =>
  z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} must be text` })
    .transform(sanitiseText)
    .refine((v) => v.length > 0, `${label} is required`)
    .refine((v) => v.length <= max, `${label} must be at most ${max} characters`);

const enumField = <T extends readonly [string, ...string[]]>(values: T, label: string) =>
  z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} must be text` })
    .transform((v) => v.trim().toUpperCase())
    .refine((v): v is T[number] => (values as readonly string[]).includes(v), {
      message: `${label} must be one of ${values.join(", ")}`,
    })
    .transform((v) => v as T[number]);

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T, label: string) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (typeof v === "string" ? v.trim().toUpperCase() : ""))
    .refine((v) => v === "" || (values as readonly string[]).includes(v), {
      message: `${label} must be one of ${values.join(", ")}`,
    })
    .transform((v) => (v === "" ? null : (v as T[number])));

/** Only http(s) references are accepted. They are never fetched by the server. */
export function isSafeReferenceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Raw evidence row as received from CSV/JSON import or the manual form. */
export const rawEvidenceSchema = z
  .object({
    incidentCaseNumber: optionalTrimmed(LIMITS.caseNumberMax, "incidentCaseNumber"),
    observedAt: z
      .string({ required_error: "observedAt is required", invalid_type_error: "observedAt must be text" })
      .transform((v) => v.trim())
      .refine((v) => v.length > 0, "observedAt is required")
      .refine(
        (v) => v.length === 0 || ISO_WITH_ZONE.test(v),
        "observedAt must be ISO-8601 with a time zone (e.g. 2026-11-12T16:20:00Z); local times are ambiguous",
      )
      .refine((v) => !ISO_WITH_ZONE.test(v) || !Number.isNaN(new Date(v).getTime()), "observedAt is not a valid date"),
    title: requiredText(LIMITS.titleMax, "title"),
    category: enumField(EVIDENCE_CATEGORIES, "category"),
    sourceName: requiredText(LIMITS.sourceNameMax, "sourceName"),
    sourceEventId: optionalTrimmed(LIMITS.sourceEventIdMax, "sourceEventId"),
    assetName: optionalTrimmed(LIMITS.assetNameMax, "assetName"),
    provenance: enumField(PROVENANCES, "provenance"),
    contentText: requiredText(LIMITS.contentMax, "contentText"),
    sourceUri: optionalTrimmed(LIMITS.uriMax, "sourceUri").refine(
      (v) => v === null || isSafeReferenceUrl(v),
      "sourceUri must be an http(s) URL",
    ),
    confidenceLevel: optionalEnum(CONFIDENCE_LEVELS, "confidenceLevel"),
    assetStatus: optionalEnum(ASSET_ASSERTION_STATUSES, "assetStatus"),
  })
  .superRefine((row, ctx) => {
    if (row.provenance === "PUBLIC_REPORTED" && !row.sourceUri) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceUri"],
        message: "PUBLIC_REPORTED evidence must cite a sourceUri",
      });
    }
    if (row.assetStatus && !row.assetName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assetStatus"],
        message: "assetStatus requires an assetName",
      });
    }
  });

export interface CanonicalEvidence {
  incidentCaseNumber: string | null;
  observedAt: Date;
  title: string;
  category: EvidenceCategory;
  sourceName: string;
  sourceEventId: string | null;
  assetName: string | null;
  provenance: Provenance;
  contentText: string;
  sourceUri: string | null;
  confidenceLevel: ConfidenceLevel;
  assetStatus: AssetAssertionStatus | null;
  isSynthetic: boolean;
  sha256: string;
}

export type NormaliseResult = { ok: true; value: CanonicalEvidence } | { ok: false; errors: string[] };

/**
 * Hash choice (documented): SHA-256 over a canonical JSON document with a fixed
 * key order — schema version, observedAt (ISO UTC), title, category, provenance,
 * sourceName, sourceEventId, assetName, contentText, sourceUri. This proves the
 * stored record has not changed since ingestion; it is not a chain of custody
 * for the original upstream system. Imports also store the raw file SHA-256.
 */
export function canonicalEvidenceHash(e: Omit<CanonicalEvidence, "sha256" | "isSynthetic" | "confidenceLevel" | "assetStatus" | "incidentCaseNumber">): string {
  const canonical = JSON.stringify([
    "cloudtrace-evidence-v1",
    e.observedAt.toISOString(),
    e.title,
    e.category,
    e.provenance,
    e.sourceName,
    e.sourceEventId,
    e.assetName,
    e.contentText,
    e.sourceUri,
  ]);
  return sha256Hex(canonical);
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function normaliseEvidence(raw: unknown): NormaliseResult {
  const parsed = rawEvidenceSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => i.message),
    };
  }
  const r = parsed.data;
  const base = {
    observedAt: new Date(r.observedAt),
    title: r.title,
    category: r.category,
    provenance: r.provenance,
    sourceName: r.sourceName,
    sourceEventId: r.sourceEventId,
    assetName: r.assetName,
    contentText: r.contentText,
    sourceUri: r.sourceUri,
  };
  return {
    ok: true,
    value: {
      ...base,
      incidentCaseNumber: r.incidentCaseNumber,
      confidenceLevel: r.confidenceLevel ?? "UNVERIFIED",
      assetStatus: r.assetStatus,
      isSynthetic: r.provenance === "SYNTHETIC",
      sha256: canonicalEvidenceHash(base),
    },
  };
}
