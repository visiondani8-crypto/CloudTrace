"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertTriangle, Download, Plus } from "lucide-react";
import { EvidenceChip } from "@/components/evidence/EvidenceInspector";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { SelectField, TextField, TextareaField, UtcDateTimeField } from "@/components/ui/fields";
import { useToast } from "@/components/ui/Toast";
import { Banner, ConfidenceBadge, EmptyState, Mono, Panel, ProvenanceBadge, Tag } from "@/components/ui/primitives";
import { api, fieldErrors } from "@/lib/client/api";
import { CONFIDENCE_LEVELS, EVIDENCE_CATEGORIES, PROVENANCES } from "@/lib/domain/enums";
import { formatUtc, fromUtcInputValue } from "@/lib/domain/time";
import type { TimelineItem } from "@/lib/services/investigation";
import { CATEGORY_LABELS, CONFIDENCE_LABELS, PROVENANCE_LABELS, textOf } from "@/lib/ui/labels";

export interface ConflictInfo {
  assetName: string;
  evidenceIds: { id: string; ref: string }[];
}

export function TimelineTab({
  incidentId,
  caseNumber,
  items,
  assets,
  conflicts,
  canEdit,
}: {
  incidentId: string;
  caseNumber: string;
  items: TimelineItem[];
  assets: { id: string; name: string }[];
  conflicts: ConflictInfo[];
  canEdit: boolean;
}) {
  const [provenance, setProvenance] = useState("");
  const [category, setCategory] = useState("");
  const [asset, setAsset] = useState("");
  const [confidence, setConfidence] = useState("");
  const [sort, setSort] = useState<"observed_asc" | "observed_desc" | "ingested_asc" | "ingested_desc">("observed_asc");
  const [adding, setAdding] = useState(false);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const filtered = useMemo(() => {
    const out = items.filter(
      (i) =>
        (!provenance || i.sourceClass === provenance) &&
        (!category || i.eventType === category) &&
        (!asset || i.assetId === asset) &&
        (!confidence || i.confidenceLevel === confidence),
    );
    const key = sort.startsWith("observed") ? "occurredAt" : "ingestedAt";
    out.sort((a, b) => a[key].localeCompare(b[key]) || a.id.localeCompare(b.id));
    if (sort.endsWith("desc")) out.reverse();
    return out;
  }, [items, provenance, category, asset, confidence, sort]);
  const dirty = provenance || category || asset || confidence;

  return (
    <Panel
      flush
      title="Investigation timeline"
      description="Ordered by event time (UTC), not upload time, unless you choose ingestion order."
      actions={
        <>
          <ButtonLink size="sm" href={`/api/incidents/${incidentId}/timeline?format=csv`} download icon={<Download />}>
            Export timeline CSV
          </ButtonLink>
          {canEdit && (
            <Button size="sm" icon={<Plus />} onClick={() => setAdding(true)}>
              Add analyst entry
            </Button>
          )}
        </>
      }
    >
      <div className="sticky top-0 z-[1] flex flex-wrap items-end gap-3 border-b border-line bg-surface p-4">
        <Filter label="Provenance" value={provenance} onChange={setProvenance} options={PROVENANCES.map((p) => ({ value: p, label: PROVENANCE_LABELS[p].label }))} />
        <Filter label="Category" value={category} onChange={setCategory} options={[...EVIDENCE_CATEGORIES, "ANALYST_ENTRY"].map((c) => ({ value: c, label: c === "ANALYST_ENTRY" ? "Analyst entry" : CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS] }))} />
        <Filter label="Asset" value={asset} onChange={setAsset} options={assets.map((a) => ({ value: a.id, label: a.name }))} />
        <Filter label="Confidence" value={confidence} onChange={setConfidence} options={CONFIDENCE_LEVELS.map((c) => ({ value: c, label: CONFIDENCE_LABELS[c].label }))} />
        <div>
          <label className="ct-field-label" htmlFor="tl-sort">
            Order
          </label>
          <select id="tl-sort" className="ct-field min-w-[200px]" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="observed_asc">Observed UTC · oldest first</option>
            <option value="observed_desc">Observed UTC · newest first</option>
            <option value="ingested_asc">Ingested UTC · oldest first</option>
            <option value="ingested_desc">Ingested UTC · newest first</option>
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2 text-[12px] text-fg-2" aria-live="polite">
          {filtered.length} of {items.length} events
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => { setProvenance(""); setCategory(""); setAsset(""); setConfidence(""); }}>
              Reset
            </Button>
          )}
        </div>
      </div>

      {conflicts.length > 0 && (
        <div className="border-b border-line p-4">
          {conflicts.map((c) => (
            <Banner key={c.assetName} tone="warning" icon={<AlertTriangle size={14} />}>
              Conflicting observations for {c.assetName}: both failure and healthy observations exist. The newest is used for impact; both are retained.{" "}
              <span className="inline-flex flex-wrap gap-1 align-middle">
                {c.evidenceIds.map((e) => (
                  <EvidenceChip key={e.id} id={e.id} label={e.ref} />
                ))}
              </span>
            </Banner>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState title="No events recorded.">Add evidence or import a CSV/JSON file to build the timeline.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState title="No results match these filters." />
      ) : (
        <ol aria-label={`${caseNumber} timeline`}>
          {filtered.map((t) => (
            <li key={t.id} className="ct-timeline-row">
              <div>
                <div className="ct-timeline-time">{formatUtc(sort.startsWith("observed") ? t.occurredAt : t.ingestedAt)}</div>
                <div className="mt-0.5 text-[11px] text-fg-2">{sort.startsWith("observed") ? "observed" : "ingested"}</div>
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-medium leading-5">{t.title}</div>
                {t.description && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[18px] text-fg-2">{t.description}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <ProvenanceBadge value={t.sourceClass} />
                  <Tag>{t.eventType === "ANALYST_ENTRY" ? "Analyst entry" : textOf(CATEGORY_LABELS, t.eventType)}</Tag>
                  {t.confidenceLevel && <ConfidenceBadge value={t.confidenceLevel} />}
                  {t.assetName && <Tag>{t.assetName}</Tag>}
                  {t.evidenceId ? (
                    <EvidenceChip id={t.evidenceId} label={t.evidenceRef!} title={t.title} />
                  ) : (
                    <Tag tone="warning">Analyst-entered / unverified</Tag>
                  )}
                </div>
                {t.sourceName && (
                  <p className="mt-1.5 text-[11.5px] text-fg-2">
                    Source: {t.sourceName}
                    {t.sha256 && (
                      <>
                        {" "}
                        · SHA-256 <Mono title={t.sha256}>{t.sha256.slice(0, 12)}…</Mono>
                      </>
                    )}
                  </p>
                )}
                {t.related.length > 0 && (
                  <p className="mt-1 text-[11.5px] text-fg-2">
                    Related (not causal):{" "}
                    {t.related.map((r, i) => {
                      const other = byId.get(r.eventId);
                      return (
                        <span key={`${r.eventId}-${r.reason}`}>
                          {i > 0 && "; "}
                          {other?.evidenceRef ?? other?.title ?? "event"} — {r.reason}
                        </span>
                      );
                    })}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {canEdit && <AddEntryDialog open={adding} onClose={() => setAdding(false)} incidentId={incidentId} assets={assets} />}
    </Panel>
  );
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const id = `tl-${label.toLowerCase()}`;
  return (
    <div>
      <label className="ct-field-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="ct-field min-w-[150px]" value={value} onChange={(e) => onChange(e.target.value)}>
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

function AddEntryDialog({ open, onClose, incidentId, assets }: { open: boolean; onClose: () => void; incidentId: string; assets: { id: string; name: string }[] }) {
  const router = useRouter();
  const notify = useToast();
  const [form, setForm] = useState({ title: "", description: "", occurredAt: "", assetId: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const occurredAt = fromUtcInputValue(form.occurredAt);
    if (!occurredAt) return setErrors({ occurredAt: "Enter when the event occurred (UTC)." });
    setBusy(true);
    const res = await api(`/api/incidents/${incidentId}/timeline`, {
      body: { title: form.title, description: form.description || null, occurredAt, assetId: form.assetId || null },
    });
    setBusy(false);
    if (!res.ok) return setErrors({ ...fieldErrors(res.error), _: res.error.message });
    notify("Analyst entry added. It is shown as unverified because no evidence is attached.");
    setForm({ title: "", description: "", occurredAt: "", assetId: "" });
    onClose();
    router.refresh();
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dirty={!!form.title && !busy}
      title="Add analyst entry"
      description="Use for events with no system record (e.g. a bridge call). It is labelled Analyst-entered / unverified."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="tl-entry" loading={busy}>
            Add entry
          </Button>
        </>
      }
    >
      <form id="tl-entry" className="flex flex-col gap-4" onSubmit={save} noValidate>
        {errors._ && <Banner tone="danger">{errors._}</Banner>}
        <TextField label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={errors.title} />
        <UtcDateTimeField label="Occurred at" required value={form.occurredAt} onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} error={errors.occurredAt} />
        <SelectField label="Asset" value={form.assetId} onChange={(e) => setForm({ ...form, assetId: e.target.value })} options={assets.map((a) => ({ value: a.id, label: a.name }))} placeholder="None" />
        <TextareaField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} error={errors.description} />
      </form>
    </Dialog>
  );
}
