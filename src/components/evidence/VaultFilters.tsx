"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useDebounced } from "@/components/ui/interactive";
import { PROVENANCES } from "@/lib/domain/enums";
import { PROVENANCE_LABELS } from "@/lib/ui/labels";

export function VaultFilters({ incidents, assets, total }: { incidents: { id: string; caseNumber: string }[]; assets: { id: string; name: string }[]; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const debounced = useDebounced(q, 300);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    next.delete("evidence");
    router.push(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };
  useEffect(() => {
    if ((params.get("q") ?? "") !== debounced) update("q", debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const dirty = ["q", "incidentId", "provenance", "assetId", "from", "to"].some((k) => params.has(k));
  const select = (key: string, label: string, options: { value: string; label: string }[], all: string) => (
    <div>
      <label htmlFor={`vault-${key}`} className="ct-field-label">
        {label}
      </label>
      <select id={`vault-${key}`} className="ct-field min-w-[150px] max-w-[240px]" value={params.get(key) ?? ""} onChange={(e) => update(key, e.target.value)}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
      <div className="min-w-[220px] flex-1">
        <label htmlFor="vault-q" className="ct-field-label">
          Search
        </label>
        <input id="vault-q" type="search" className="ct-field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, source, case, asset, EV-0001 or SHA-256 prefix" />
      </div>
      {select("incidentId", "Incident", incidents.map((i) => ({ value: i.id, label: i.caseNumber })), "All incidents")}
      {select("provenance", "Provenance", PROVENANCES.map((p) => ({ value: p, label: PROVENANCE_LABELS[p].label })), "All")}
      {select("assetId", "Asset", assets.map((a) => ({ value: a.id, label: a.name })), "All assets")}
      <div>
        <label htmlFor="vault-from" className="ct-field-label">
          Observed from (UTC)
        </label>
        <input id="vault-from" type="date" className="ct-field" value={params.get("from") ?? ""} onChange={(e) => update("from", e.target.value)} />
      </div>
      <div>
        <label htmlFor="vault-to" className="ct-field-label">
          Observed to (UTC)
        </label>
        <input id="vault-to" type="date" className="ct-field" value={params.get("to") ?? ""} onChange={(e) => update("to", e.target.value)} />
      </div>
      <div className="ml-auto flex items-center gap-2 text-[12px] text-fg-2" aria-live="polite">
        {total} {total === 1 ? "record" : "records"}
        {dirty && (
          <Button size="sm" variant="ghost" onClick={() => { setQ(""); router.push(pathname, { scroll: false }); }}>
            Reset filters
          </Button>
        )}
      </div>
    </div>
  );
}
