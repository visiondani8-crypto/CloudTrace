import Papa from "papaparse";
import { normaliseEvidence, sha256Hex, type CanonicalEvidence } from "./normalise";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MiB
export const MAX_IMPORT_ROWS = 5_000;

export const REQUIRED_CSV_HEADERS = [
  "incidentCaseNumber",
  "observedAt",
  "title",
  "category",
  "sourceName",
  "sourceEventId",
  "assetName",
  "provenance",
  "contentText",
  "sourceUri",
] as const;

export const OPTIONAL_HEADERS = ["confidenceLevel", "assetStatus"] as const;
const KNOWN_HEADERS = new Set<string>([...REQUIRED_CSV_HEADERS, ...OPTIONAL_HEADERS]);

export type ImportFormat = "CSV" | "JSON";

export interface ParsedFile {
  format: ImportFormat;
  fileSha256: string;
  rows: Record<string, unknown>[];
  fileErrors: string[];
}

const SAFE_FILENAME = /^[\w .()\-]{1,120}\.(csv|json)$/i;

export function detectFormat(filename: string): ImportFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) return "CSV";
  if (lower.endsWith(".json")) return "JSON";
  return null;
}

export function sanitiseFilename(filename: string): string | null {
  const base = filename.split(/[\\/]/).pop() ?? "";
  return SAFE_FILENAME.test(base) ? base : null;
}

/** Parses an uploaded file into raw row objects without interpreting values. */
export function parseImportFile(filename: string, bytes: Uint8Array): ParsedFile {
  const fileSha256 = sha256Hex(bytes);
  const format = detectFormat(filename);
  const fileErrors: string[] = [];
  if (!format) return { format: "CSV", fileSha256, rows: [], fileErrors: ["File must have a .csv or .json extension."] };
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    return { format, fileSha256, rows: [], fileErrors: ["File exceeds the 5 MiB import limit."] };
  }
  if (bytes.byteLength === 0) return { format, fileSha256, rows: [], fileErrors: ["File is empty."] };

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return { format, fileSha256, rows: [], fileErrors: ["File is not valid UTF-8 text."] };
  }

  if (format === "JSON") {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (err) {
      return {
        format,
        fileSha256,
        rows: [],
        fileErrors: [`Invalid JSON: ${err instanceof Error ? err.message.slice(0, 160) : "parse error"}`],
      };
    }
    if (!Array.isArray(data)) {
      return { format, fileSha256, rows: [], fileErrors: ["JSON import must be an array of evidence objects."] };
    }
    if (data.length > MAX_IMPORT_ROWS) {
      return { format, fileSha256, rows: [], fileErrors: [`Import is limited to ${MAX_IMPORT_ROWS} rows per file.`] };
    }
    const rows = data.map((item) =>
      item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : { __invalid: true },
    );
    return { format, fileSha256, rows, fileErrors };
  }

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
    preview: MAX_IMPORT_ROWS + 1,
  });
  const headers = result.meta.fields ?? [];
  const missing = REQUIRED_CSV_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    fileErrors.push(`Missing required CSV headers: ${missing.join(", ")}.`);
  }
  const unknown = headers.filter((h) => !KNOWN_HEADERS.has(h));
  if (unknown.length > 0) {
    fileErrors.push(`Unknown CSV headers: ${unknown.slice(0, 10).join(", ")}.`);
  }
  if (result.data.length > MAX_IMPORT_ROWS) {
    fileErrors.push(`Import is limited to ${MAX_IMPORT_ROWS} rows per file.`);
  }
  for (const e of result.errors.slice(0, 20)) {
    fileErrors.push(`CSV parse error${typeof e.row === "number" ? ` at row ${e.row + 1}` : ""}: ${e.message}`);
  }
  return { format, fileSha256, rows: fileErrors.length ? [] : result.data, fileErrors };
}

export interface ImportContext {
  targetCaseNumber: string;
  /** lower-cased asset name → asset */
  assetsByName: Map<string, { id: string; name: string }>;
  /** `${sourceName}\u0000${sourceEventId}` keys already stored in this organisation */
  existingSourceKeys: Set<string>;
  /** canonical hashes of evidence already stored for the target incident */
  existingHashes: Set<string>;
}

export type RowStatus = "VALID" | "INVALID" | "DUPLICATE";

export interface ValidatedRow {
  /** 1-based data row number (header line excluded) */
  rowNumber: number;
  status: RowStatus;
  errors: string[];
  duplicateReason?: string;
  value?: CanonicalEvidence & { assetId: string | null };
}

export interface ValidationSummary {
  rows: ValidatedRow[];
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  provenanceCounts: Record<string, number>;
}

export const sourceKey = (sourceName: string, sourceEventId: string) => `${sourceName}\u0000${sourceEventId}`;

/**
 * Validates every row. Rows are never dropped silently: each row is reported
 * as VALID, INVALID (with reasons) or DUPLICATE (already stored; skipped).
 */
export function validateImportRows(rows: Record<string, unknown>[], ctx: ImportContext): ValidationSummary {
  const seenSourceKeys = new Map<string, number>();
  const seenHashes = new Map<string, number>();
  const out: ValidatedRow[] = [];
  const provenanceCounts: Record<string, number> = {};

  rows.forEach((raw, index) => {
    const rowNumber = index + 1;
    if ("__invalid" in raw) {
      out.push({ rowNumber, status: "INVALID", errors: ["Row must be a JSON object."] });
      return;
    }
    const result = normaliseEvidence(raw);
    if (!result.ok) {
      out.push({ rowNumber, status: "INVALID", errors: result.errors });
      return;
    }
    const v = result.value;
    const errors: string[] = [];

    if (!v.incidentCaseNumber) {
      errors.push("incidentCaseNumber is required");
    } else if (v.incidentCaseNumber !== ctx.targetCaseNumber) {
      errors.push(
        `incidentCaseNumber ${v.incidentCaseNumber} does not match the selected incident ${ctx.targetCaseNumber}`,
      );
    }

    let assetId: string | null = null;
    if (v.assetName) {
      const asset = ctx.assetsByName.get(v.assetName.toLowerCase());
      if (!asset) errors.push(`assetName "${v.assetName}" is not an asset in this workspace`);
      else assetId = asset.id;
    }

    if (v.sourceEventId) {
      const key = sourceKey(v.sourceName, v.sourceEventId);
      const firstRow = seenSourceKeys.get(key);
      if (firstRow !== undefined) errors.push(`Duplicate sourceName + sourceEventId of row ${firstRow} in this file`);
      else seenSourceKeys.set(key, rowNumber);
    }
    const firstHashRow = seenHashes.get(v.sha256);
    if (firstHashRow !== undefined) errors.push(`Identical to row ${firstHashRow} in this file`);
    else seenHashes.set(v.sha256, rowNumber);

    if (errors.length > 0) {
      out.push({ rowNumber, status: "INVALID", errors });
      return;
    }

    provenanceCounts[v.provenance] = (provenanceCounts[v.provenance] ?? 0) + 1;

    if (v.sourceEventId && ctx.existingSourceKeys.has(sourceKey(v.sourceName, v.sourceEventId))) {
      out.push({
        rowNumber,
        status: "DUPLICATE",
        errors: [],
        duplicateReason: "Already stored (same sourceName and sourceEventId) — will be skipped",
        value: { ...v, assetId },
      });
      return;
    }
    if (ctx.existingHashes.has(v.sha256)) {
      out.push({
        rowNumber,
        status: "DUPLICATE",
        errors: [],
        duplicateReason: "Identical canonical record already stored for this incident — will be skipped",
        value: { ...v, assetId },
      });
      return;
    }
    out.push({ rowNumber, status: "VALID", errors: [], value: { ...v, assetId } });
  });

  return {
    rows: out,
    total: out.length,
    valid: out.filter((r) => r.status === "VALID").length,
    invalid: out.filter((r) => r.status === "INVALID").length,
    duplicates: out.filter((r) => r.status === "DUPLICATE").length,
    provenanceCounts,
  };
}
