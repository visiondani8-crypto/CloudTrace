import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normaliseEvidence, sanitiseText } from "@/lib/evidence/normalise";
import { MAX_IMPORT_BYTES, parseImportFile, sanitiseFilename, validateImportRows, type ImportContext } from "@/lib/evidence/import";

const enc = (s: string) => new TextEncoder().encode(s);

const validRow = {
  incidentCaseNumber: "CT-2026-001",
  observedAt: "2026-11-12T17:04:00Z",
  title: "CRM 503",
  category: "APP_LOG",
  sourceName: "Synthetic CRM",
  sourceEventId: "X-1",
  assetName: "CRM Email Sync",
  provenance: "SYNTHETIC",
  contentText: "HTTP 503 from upstream",
  sourceUri: "",
};

function ctx(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    targetCaseNumber: "CT-2026-001",
    assetsByName: new Map([["crm email sync", { id: "asset-crm", name: "CRM Email Sync" }]]),
    existingSourceKeys: new Set(),
    existingHashes: new Set(),
    ...overrides,
  };
}

describe("normaliseEvidence", () => {
  it("produces a canonical record with UTC date, provenance and SHA-256", () => {
    const r = normaliseEvidence({ ...validRow, observedAt: "2026-11-12T18:04:00+01:00" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.observedAt.toISOString()).toBe("2026-11-12T17:04:00.000Z");
    expect(r.value.isSynthetic).toBe(true);
    expect(r.value.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.value.confidenceLevel).toBe("UNVERIFIED");
    // Same instant expressed in a different zone hashes identically.
    const z = normaliseEvidence(validRow);
    expect(z.ok && z.value.sha256).toBe(r.value.sha256);
  });

  it("rejects ambiguous local timestamps and unknown enums with specific messages", () => {
    const r = normaliseEvidence({ ...validRow, observedAt: "2026-11-12 17:04", provenance: "LIVE_TELEMETRY" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/time zone/);
    expect(r.errors.join(" ")).toMatch(/provenance must be one of/);
  });

  it("requires public reports to cite a source URL and rejects non-http URLs", () => {
    const pub = normaliseEvidence({ ...validRow, provenance: "PUBLIC_REPORTED" });
    expect(pub.ok).toBe(false);
    const js = normaliseEvidence({ ...validRow, sourceUri: "javascript:alert(1)" });
    expect(js.ok).toBe(false);
  });

  it("keeps HTML as inert text and strips control characters", () => {
    expect(sanitiseText("  <script>alert(1)</script>\u0000\r\nnext ")).toBe("<script>alert(1)</script>\nnext");
  });
});

describe("parseImportFile", () => {
  it("parses the supplied CSV fixture", () => {
    const bytes = readFileSync("fixtures/synthetic_signins.csv");
    const parsed = parseImportFile("synthetic_signins.csv", new Uint8Array(bytes));
    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.format).toBe("CSV");
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.fileSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("parses the supplied JSON fixture", () => {
    const bytes = readFileSync("fixtures/public_plus_simulated_case.json");
    const parsed = parseImportFile("public_plus_simulated_case.json", new Uint8Array(bytes));
    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.rows).toHaveLength(4);
  });

  it("rejects missing headers, oversized files, non-arrays and bad extensions", () => {
    expect(parseImportFile("x.csv", enc("a,b\n1,2")).fileErrors[0]).toMatch(/Missing required CSV headers/);
    expect(parseImportFile("x.json", enc('{"a":1}')).fileErrors[0]).toMatch(/array/);
    expect(parseImportFile("x.txt", enc("hello")).fileErrors[0]).toMatch(/\.csv or \.json/);
    expect(parseImportFile("big.csv", new Uint8Array(MAX_IMPORT_BYTES + 1)).fileErrors[0]).toMatch(/5 MiB/);
  });

  it("sanitises file names", () => {
    expect(sanitiseFilename("../../etc/evil.csv")).toBe("evil.csv");
    expect(sanitiseFilename("a<b>.csv")).toBeNull();
  });
});

describe("validateImportRows", () => {
  it("reports every row with row-specific errors and never drops rows", () => {
    const rows = [
      validRow,
      { ...validRow, sourceEventId: "X-2", observedAt: "" },
      { ...validRow, sourceEventId: "X-3", category: "MAGIC" },
      { ...validRow, sourceEventId: "X-4", incidentCaseNumber: "CT-2026-999" },
      { ...validRow, sourceEventId: "X-5", assetName: "Unknown asset" },
      { ...validRow }, // duplicate of row 1 in file
    ];
    const summary = validateImportRows(rows, ctx());
    expect(summary.total).toBe(6);
    expect(summary.valid).toBe(1);
    expect(summary.invalid).toBe(5);
    expect(summary.rows[1].errors.join(" ")).toMatch(/observedAt is required/);
    expect(summary.rows[2].errors.join(" ")).toMatch(/category/);
    expect(summary.rows[3].errors.join(" ")).toMatch(/does not match the selected incident/);
    expect(summary.rows[4].errors.join(" ")).toMatch(/not an asset in this workspace/);
    expect(summary.rows[5].errors.join(" ")).toMatch(/row 1/);
  });

  it("marks already-stored records as duplicates (skipped, not rejected)", () => {
    const summary = validateImportRows([validRow], ctx({ existingSourceKeys: new Set(["Synthetic CRM\u0000X-1"]) }));
    expect(summary.duplicates).toBe(1);
    expect(summary.rows[0].status).toBe("DUPLICATE");
  });

  it("resolves asset names case-insensitively", () => {
    const summary = validateImportRows([{ ...validRow, assetName: "crm EMAIL sync" }], ctx());
    expect(summary.rows[0].value?.assetId).toBe("asset-crm");
  });
});
