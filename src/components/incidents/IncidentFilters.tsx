"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useDebounced } from "@/components/ui/interactive";
import { INCIDENT_STATUSES, INCIDENT_TYPES, SEVERITIES } from "@/lib/domain/enums";
import { SEVERITY_LABELS, STATUS_LABELS, TYPE_LABELS } from "@/lib/ui/labels";

/** Filter toolbar; all state lives in the URL so back/forward and reload restore it. */
export function IncidentFilters({ total }: { total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const debouncedQ = useDebounced(q, 300);

  const update = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    next.delete("page");
    router.push(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };

  useEffect(() => {
    if ((params.get("q") ?? "") === debouncedQ) return;
    update((p) => (debouncedQ ? p.set("q", debouncedQ) : p.delete("q")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const multi = (key: string) => params.getAll(key);
  const toggle = (key: string, value: string) =>
    update((p) => {
      const current = p.getAll(key);
      p.delete(key);
      const nextValues = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      nextValues.forEach((v) => p.append(key, v));
    });
  const dirty = ["q", "severity", "status", "type", "sort"].some((k) => params.has(k));

  return (
    <div className="flex flex-col gap-3 border-b border-line p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[220px] flex-1">
          <label htmlFor="incident-search" className="ct-field-label">
            Search
          </label>
          <Search size={14} className="pointer-events-none absolute bottom-[13px] left-2.5 text-fg-2" aria-hidden="true" />
          <input
            id="incident-search"
            type="search"
            className="ct-field pl-8"
            placeholder="Case number or title, e.g. CT-2026-001"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="incident-type" className="ct-field-label">
            Type
          </label>
          <select id="incident-type" className="ct-field min-w-[180px]" value={params.get("type") ?? ""} onChange={(e) => update((p) => (e.target.value ? p.set("type", e.target.value) : p.delete("type")))}>
            <option value="">All types</option>
            {INCIDENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="incident-sort" className="ct-field-label">
            Sort
          </label>
          <select id="incident-sort" className="ct-field min-w-[170px]" value={params.get("sort") ?? "updated_desc"} onChange={(e) => update((p) => (e.target.value === "updated_desc" ? p.delete("sort") : p.set("sort", e.target.value)))}>
            <option value="updated_desc">Latest update first</option>
            <option value="updated_asc">Oldest update first</option>
            <option value="severity">Severity (highest first)</option>
            <option value="case">Case number</option>
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="mr-1 float-left text-[11px] font-bold uppercase tracking-[0.6px] text-fg-2">Severity</legend>
          {SEVERITIES.slice()
            .reverse()
            .map((s) => (
              <button key={s} type="button" className="ct-tag cursor-pointer" aria-pressed={multi("severity").includes(s)} data-tone={multi("severity").includes(s) ? "info" : undefined} onClick={() => toggle("severity", s)}>
                {SEVERITY_LABELS[s].label}
              </button>
            ))}
        </fieldset>
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="mr-1 float-left text-[11px] font-bold uppercase tracking-[0.6px] text-fg-2">Status</legend>
          {INCIDENT_STATUSES.map((s) => (
            <button key={s} type="button" className="ct-tag cursor-pointer" aria-pressed={multi("status").includes(s)} data-tone={multi("status").includes(s) ? "info" : undefined} onClick={() => toggle("status", s)}>
              {STATUS_LABELS[s].label}
            </button>
          ))}
        </fieldset>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[12px] text-fg-2" aria-live="polite">
            {total} {total === 1 ? "incident" : "incidents"}
          </span>
          {dirty && (
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw />}
              onClick={() => {
                setQ("");
                router.push(pathname, { scroll: false });
              }}
            >
              Reset filters
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function Pager({ page, pageCount, pageSize, sizes = [20, 50, 100] }: { page: number; pageCount: number; pageSize: number; sizes?: number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const go = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    router.push(`${pathname}?${next}`, { scroll: false });
  };
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[12px] text-fg-2" aria-label="Pagination">
      <label className="flex items-center gap-2">
        Rows per page
        <select className="ct-field min-h-[30px] w-auto py-1 text-[12px]" value={pageSize} onChange={(e) => go((p) => { p.set("pageSize", e.target.value); p.delete("page"); })}>
          {sizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2">
        <span>
          Page {page} of {pageCount}
        </span>
        <Button size="sm" disabled={page <= 1} onClick={() => go((p) => p.set("page", String(page - 1)))}>
          Previous
        </Button>
        <Button size="sm" disabled={page >= pageCount} onClick={() => go((p) => p.set("page", String(page + 1)))}>
          Next
        </Button>
      </div>
    </nav>
  );
}
