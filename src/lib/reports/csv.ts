/**
 * CSV writer with RFC 4180 quoting and spreadsheet formula-injection
 * protection: cells beginning with =, +, -, @, tab or carriage return are
 * prefixed with an apostrophe so spreadsheet software treats them as text.
 */

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) text = "";
  else if (value instanceof Date) text = value.toISOString();
  else text = String(value);
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}

/** Produces a download-safe file name (ASCII letters, digits, dot, dash, underscore). */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned.slice(0, 100) || "export";
}

export function csvResponseHeaders(filename: string): HeadersInit {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${safeFilename(filename)}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
