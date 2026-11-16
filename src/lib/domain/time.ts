// Forensic timestamps are always presented in UTC with an explicit label.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-11-12 16:20 UTC` — data tables and timelines. */
export function formatUtc(value: Date | string | null | undefined, opts: { seconds?: boolean } = {}): string {
  const d = toDate(value);
  if (!d) return "—";
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )}`;
  return `${base}${opts.seconds ? `:${pad(d.getUTCSeconds())}` : ""} UTC`;
}

/** `12 Nov 2026 · 16:20 UTC` — prose. */
export function formatUtcLong(value: Date | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )} UTC`;
}

/** `12 Nov 2026` */
export function formatUtcDate(value: Date | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `12–13 Nov 2026` style range for headers. */
export function formatUtcRange(start: Date | string | null | undefined, end: Date | string | null | undefined): string {
  const s = toDate(start);
  const e = toDate(end);
  if (!s && !e) return "Start time not recorded";
  if (s && !e) return `From ${formatUtcDate(s)}`;
  if (!s && e) return `Until ${formatUtcDate(e)}`;
  if (s!.getUTCFullYear() === e!.getUTCFullYear() && s!.getUTCMonth() === e!.getUTCMonth()) {
    if (s!.getUTCDate() === e!.getUTCDate()) return formatUtcDate(s);
    return `${s!.getUTCDate()}–${e!.getUTCDate()} ${MONTHS[s!.getUTCMonth()]} ${s!.getUTCFullYear()}`;
  }
  return `${formatUtcDate(s)} – ${formatUtcDate(e)}`;
}

/** `2026-11-12` (UTC day key) */
export function utcDayKey(value: Date | string): string {
  const d = toDate(value)!;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * ISO-8601 timestamp with an explicit time zone designator (Z or ±hh:mm).
 * Local timestamps without an offset are rejected as ambiguous.
 */
export const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

export function parseZonedIso(value: string): Date | null {
  if (!ISO_WITH_ZONE.test(value.trim())) return null;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Value for <input type="datetime-local"> interpreted as UTC. */
export function toUtcInputValue(value: Date | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return "";
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )}`;
}

/** Converts a datetime-local value (entered as UTC) into an ISO string with Z. */
export function fromUtcInputValue(value: string): string | null {
  if (!value) return null;
  const iso = value.length === 16 ? `${value}:00Z` : `${value}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
