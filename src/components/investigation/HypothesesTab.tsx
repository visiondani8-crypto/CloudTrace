"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { EvidenceChip } from "@/components/evidence/EvidenceInspector";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { CheckboxList, SelectField, TextField, TextareaField } from "@/components/ui/fields";
import { useToast } from "@/components/ui/Toast";
import { Banner, EmptyState, HypothesisConfidenceBadge, HypothesisStatusBadge, Mono, Panel, ProvenanceBadge, Tag } from "@/components/ui/primitives";
import { api, fieldErrors } from "@/lib/client/api";
import { HYPOTHESIS_CONFIDENCES, HYPOTHESIS_STATUSES } from "@/lib/domain/enums";
import { formatUtc } from "@/lib/domain/time";
import type { HypothesisView } from "@/lib/services/investigation";
import { HYPOTHESIS_CONFIDENCE_LABELS, HYPOTHESIS_STATUS_LABELS } from "@/lib/ui/labels";

interface EvidenceOption {
  id: string;
  ref: string;
  title: string;
  provenance: string;
}
interface Suggestion {
  statement: string;
  confidence: string;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
}

export function HypothesesTab({
  incidentId,
  hypotheses,
  evidence,
  suggestions,
  suggestionMode,
  canEdit,
}: {
  incidentId: string;
  hypotheses: HypothesisView[];
  evidence: EvidenceOption[];
  suggestions: Suggestion[];
  suggestionMode: string | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<HypothesisView | "new" | Suggestion | null>(null);
  const counts = HYPOTHESIS_STATUSES.map((s) => ({ status: s, n: hypotheses.filter((h) => h.status === s).length }));
  const refOf = new Map(evidence.map((e) => [e.id, e]));
  const adoptable = suggestions.filter((s) => !hypotheses.some((h) => h.title === s.statement));

  return (
    <div className="ct-analysis-grid">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="ct-section-title">Hypotheses</h2>
          {canEdit && (
            <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>
              New hypothesis
            </Button>
          )}
        </div>
        {hypotheses.length === 0 ? (
          <Panel>
            <EmptyState title="No hypotheses recorded.">Add one with supporting evidence.</EmptyState>
          </Panel>
        ) : (
          hypotheses.map((h) => (
            <article key={h.id} className="ct-panel" aria-labelledby={`h-${h.id}`}>
              <div className="ct-panel-body">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 id={`h-${h.id}`} className="text-[14px] font-[650] leading-[21px]">
                    {h.title}
                  </h3>
                  {canEdit && (
                    <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEditing(h)} aria-label={`Edit hypothesis: ${h.title}`}>
                      Edit
                    </Button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <HypothesisStatusBadge value={h.status} />
                  <HypothesisConfidenceBadge value={h.confidence} />
                  {h.status !== "SUPPORTED" && h.status !== "REJECTED" && <Tag tone="warning">Hypothesis — not verified</Tag>}
                </div>
                {h.description && <p className="mt-3 text-[13px] leading-5">{h.description}</p>}
                {h.note && <p className="ct-support mt-2">Analyst note: {h.note}</p>}
                <div className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-fg-2">Supporting evidence</div>
                    <div className="flex flex-wrap gap-1">
                      {h.supporting.length ? h.supporting.map((e) => <EvidenceChip key={e.id} id={e.id} label={e.ref} title={e.title} />) : <span className="text-fg-2">None</span>}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-fg-2">Contradicting evidence</div>
                    <div className="flex flex-wrap gap-1">
                      {h.contradicting.length ? h.contradicting.map((e) => <EvidenceChip key={e.id} id={e.id} label={e.ref} title={e.title} />) : <span className="text-fg-2">None</span>}
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-[11.5px] text-fg-2">
                  {h.createdByName} · added <Mono>{formatUtc(h.createdAt)}</Mono> · updated <Mono>{formatUtc(h.updatedAt)}</Mono>
                </p>
              </div>
            </article>
          ))
        )}
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Summary">
          <ul className="flex flex-col gap-2 text-[13px]">
            {counts.map((c) => (
              <li key={c.status} className="flex items-center justify-between">
                <HypothesisStatusBadge value={c.status} />
                <span className="ct-mono">{c.n}</span>
              </li>
            ))}
          </ul>
          <p className="ct-support mt-3">Marking a hypothesis Supported requires linked supporting evidence. Nothing is promoted to a root cause automatically.</p>
        </Panel>
        {adoptable.length > 0 && (
          <Panel title="Analysis suggestions" description="Generated suggestions are not reviewed. Adopt one to create an Open hypothesis you can edit.">
            <ul className="flex flex-col gap-3">
              {adoptable.map((s, i) => (
                <li key={i} className="rounded-[6px] border border-line bg-raised p-3">
                  <Tag>{suggestionMode === "CLAUDE" ? "AI SUGGESTION · NOT REVIEWED" : "RULE-BASED SUGGESTION · NOT REVIEWED"}</Tag>
                  <p className="mt-2 text-[12.5px] leading-[19px]">{s.statement}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {s.supportingEvidenceIds.map((id) => (refOf.get(id) ? <EvidenceChip key={id} id={id} label={refOf.get(id)!.ref} /> : null))}
                  </div>
                  {canEdit && (
                    <Button className="mt-2" size="sm" onClick={() => setEditing(s)}>
                      Review and adopt
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
      {canEdit && <HypothesisDialog incidentId={incidentId} target={editing} onClose={() => setEditing(null)} evidence={evidence} />}
    </div>
  );
}

function HypothesisDialog({ incidentId, target, onClose, evidence }: { incidentId: string; target: HypothesisView | "new" | Suggestion | null; onClose: () => void; evidence: EvidenceOption[] }) {
  const router = useRouter();
  const notify = useToast();
  const existing = target && target !== "new" && "id" in target ? target : null;
  const suggestion = target && target !== "new" && !("id" in target) ? target : null;
  const blank = { title: "", description: "", confidence: "LOW", status: "OPEN", note: "", supporting: [] as string[], contradicting: [] as string[] };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setErrors({});
    setFormError(null);
    if (existing) {
      setForm({
        title: existing.title,
        description: existing.description,
        confidence: existing.confidence,
        status: existing.status,
        note: existing.note ?? "",
        supporting: existing.supporting.map((e) => e.id),
        contradicting: existing.contradicting.map((e) => e.id),
      });
    } else if (suggestion) {
      setForm({
        ...blank,
        title: suggestion.statement.slice(0, 300),
        confidence: suggestion.confidence,
        supporting: suggestion.supportingEvidenceIds.filter((id) => evidence.some((e) => e.id === id)),
        contradicting: suggestion.contradictingEvidenceIds.filter((id) => evidence.some((e) => e.id === id)),
        note: "Adopted from an unreviewed analysis suggestion.",
      });
    } else setForm(blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (form.title.trim().length < 3) return setErrors({ title: "Statement must be at least 3 characters." });
    if (form.status === "SUPPORTED" && form.supporting.length === 0) {
      return setErrors({ status: "A hypothesis can only be marked Supported when at least one supporting evidence item is linked." });
    }
    setBusy(true);
    setFormError(null);
    const body = {
      title: form.title,
      description: form.description,
      confidence: form.confidence,
      status: form.status,
      note: form.note || null,
      supportingEvidenceIds: form.supporting,
      contradictingEvidenceIds: form.contradicting,
    };
    const res = existing
      ? await api(`/api/incidents/${incidentId}/hypotheses`, { method: "PATCH", body: { id: existing.id, ...body } })
      : await api(`/api/incidents/${incidentId}/hypotheses`, { body });
    setBusy(false);
    if (!res.ok) {
      setErrors(fieldErrors(res.error));
      setFormError(res.error.message);
      return;
    }
    notify(existing ? "Hypothesis updated. Changes saved." : "Hypothesis saved and recorded in the audit log.");
    onClose();
    router.refresh();
  }

  const evidenceItems = evidence.map((e) => ({
    value: e.id,
    label: (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Mono>{e.ref}</Mono> {e.title} <ProvenanceBadge value={e.provenance} />
      </span>
    ),
  }));

  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      dirty={!busy && form.title !== (existing?.title ?? suggestion?.statement.slice(0, 300) ?? "")}
      title={existing ? "Edit hypothesis" : "New hypothesis"}
      description="Link the evidence that supports or contradicts the statement."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="hypothesis-form" loading={busy}>
            {existing ? "Save changes" : "Save hypothesis"}
          </Button>
        </>
      }
    >
      <form id="hypothesis-form" className="flex flex-col gap-4" onSubmit={save} noValidate>
        {formError && <Banner tone="danger">{formError}</Banner>}
        <TextField label="Statement" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={errors.title} maxLength={300} />
        <TextareaField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} error={errors.description} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Confidence" value={form.confidence} onChange={(e) => setForm({ ...form, confidence: e.target.value })} options={HYPOTHESIS_CONFIDENCES.map((c) => ({ value: c, label: HYPOTHESIS_CONFIDENCE_LABELS[c].label }))} />
          <SelectField label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={HYPOTHESIS_STATUSES.map((s) => ({ value: s, label: HYPOTHESIS_STATUS_LABELS[s].label }))} error={errors.status} />
        </div>
        <CheckboxList legend="Supporting evidence" items={evidenceItems} selected={form.supporting} onChange={(v) => setForm({ ...form, supporting: v })} emptyText="No evidence in this incident yet." error={errors.supportingEvidenceIds} />
        <CheckboxList legend="Contradicting evidence" items={evidenceItems} selected={form.contradicting} onChange={(v) => setForm({ ...form, contradicting: v })} emptyText="No evidence in this incident yet." error={errors.contradictingEvidenceIds} />
        <TextareaField label="Analyst note / caveat" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} help='For example: "provider-reported preliminary explanation".' />
      </form>
    </Dialog>
  );
}
