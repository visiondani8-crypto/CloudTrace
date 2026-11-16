"use client";

import { useMemo, useState } from "react";
import { AddEvidenceButton, ImportWizardButton } from "@/components/evidence/EvidenceForms";
import { EvidenceTable } from "@/components/evidence/EvidenceTable";
import { Button } from "@/components/ui/Button";
import { EmptyState, Mono, Panel, Tag } from "@/components/ui/primitives";
import { PROVENANCES } from "@/lib/domain/enums";
import { formatUtc } from "@/lib/domain/time";
import type { EvidenceRow } from "@/lib/services/evidence";
import { PROVENANCE_LABELS } from "@/lib/ui/labels";

export function EvidenceTab({
  incident,
  rows,
  assets,
  imports,
  canEdit,
}: {
  incident: { id: string; caseNumber: string; title: string };
  rows: EvidenceRow[];
  assets: { id: string; name: string }[];
  imports: { id: string; filename: string; outcome: string; acceptedCount: number; rejectedCount: number; duplicateCount: number; createdAt: string; mode: string }[];
  canEdit: boolean;
}) {
  const [q, setQ] = useState("");
  const [provenance, setProvenance] = useState("");
  const [source, setSource] = useState("");
  const [asset, setAsset] = useState("");
  const [date, setDate] = useState("");
  const sources = useMemo(() => [...new Set(rows.map((r) => r.sourceName))].sort(), [rows]);
  const filtered = rows.filter((r) => {
    const needle = q.trim().toLowerCase();
    return (
      (!needle || r.ref.toLowerCase().includes(needle) || r.sha256.startsWith(needle) || r.id.toLowerCase().includes(needle) || r.title.toLowerCase().includes(needle)) &&
      (!provenance || r.provenance === provenance) &&
      (!source || r.sourceName === source) &&
      (!asset || r.assetId === asset) &&
      (!date || r.observedAt.slice(0, 10) === date)
    );
  });
  const dirty = q || provenance || source || asset || date;

  return (
    <div className="flex flex-col gap-4">
      <Panel
        flush
        title={
          <>
            Evidence <Tag className="ml-1">{rows.length}</Tag>
          </>
        }
        description="PUBLIC REPORT, SIMULATED and CUSTOMER OBSERVED records are labelled on every row. Select a row to inspect hashes and sources."
        actions={
          canEdit ? (
            <>
              <AddEvidenceButton incidents={[incident]} fixedIncidentId={incident.id} assets={assets} />
              <ImportWizardButton incidents={[incident]} fixedIncidentId={incident.id} />
            </>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div className="min-w-[200px] flex-1">
            <label htmlFor="ev-q" className="ct-field-label">
              Hash / ID / title
            </label>
            <input id="ev-q" type="search" className="ct-field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="EV-0003 or SHA-256 prefix" />
          </div>
          <SelectBox id="ev-prov" label="Provenance" value={provenance} onChange={setProvenance} options={PROVENANCES.map((p) => ({ value: p, label: PROVENANCE_LABELS[p].label }))} />
          <SelectBox id="ev-src" label="Source" value={source} onChange={setSource} options={sources.map((s) => ({ value: s, label: s }))} />
          <SelectBox id="ev-asset" label="Asset" value={asset} onChange={setAsset} options={assets.map((a) => ({ value: a.id, label: a.name }))} />
          <div>
            <label htmlFor="ev-date" className="ct-field-label">
              Observed (UTC date)
            </label>
            <input id="ev-date" type="date" className="ct-field" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="ml-auto flex items-center gap-2 text-[12px] text-fg-2" aria-live="polite">
            {filtered.length} of {rows.length}
            {dirty && (
              <Button size="sm" variant="ghost" onClick={() => { setQ(""); setProvenance(""); setSource(""); setAsset(""); setDate(""); }}>
                Reset
              </Button>
            )}
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No evidence linked to this incident.">{canEdit ? "Add evidence or import a CSV/JSON file." : "Evidence added by analysts will appear here."}</EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState title="No results match these filters." />
        ) : (
          <EvidenceTable rows={filtered} />
        )}
      </Panel>
      {imports.length > 0 && (
        <Panel title="Import history" description="Every import attempt is recorded, including rejected files.">
          <ul className="flex flex-col gap-2 text-[12.5px]">
            {imports.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-2">
                <Mono className="text-fg-2">{formatUtc(j.createdAt)}</Mono>
                <Mono>{j.filename}</Mono>
                <Tag tone={j.outcome === "COMPLETED" ? "success" : "warning"}>{j.outcome === "COMPLETED" ? "Completed" : "Rejected"}</Tag>
                <span className="text-fg-2">
                  {j.mode === "ATOMIC" ? "all-or-nothing" : "partial"} · {j.acceptedCount} accepted · {j.rejectedCount} rejected · {j.duplicateCount} duplicates
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function SelectBox({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label htmlFor={id} className="ct-field-label">
        {label}
      </label>
      <select id={id} className="ct-field min-w-[150px] max-w-[240px]" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
