"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FileUp, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { SelectField, TextField, TextareaField, UtcDateTimeField } from "@/components/ui/fields";
import { useToast } from "@/components/ui/Toast";
import { Banner, Mono, ProvenanceBadge, Tag } from "@/components/ui/primitives";
import { api, fieldErrors } from "@/lib/client/api";
import { ASSET_ASSERTION_STATUSES, CONFIDENCE_LEVELS, EVIDENCE_CATEGORIES, PROVENANCES } from "@/lib/domain/enums";
import { formatUtc, fromUtcInputValue } from "@/lib/domain/time";
import { CATEGORY_LABELS, CONFIDENCE_LABELS, OBSERVED_STATUS_LABELS, PROVENANCE_LABELS } from "@/lib/ui/labels";

const MAX_BYTES = 5 * 1024 * 1024;

export interface IncidentOption {
  id: string;
  caseNumber: string;
  title: string;
}

export function AddEvidenceButton({ incidents, fixedIncidentId, assets }: { incidents: IncidentOption[]; fixedIncidentId?: string; assets: { id: string; name: string }[] }) {
  const router = useRouter();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const blank = {
    incidentId: fixedIncidentId ?? "",
    title: "",
    category: "APP_LOG",
    provenance: "CUSTOMER_OBSERVED",
    sourceName: "",
    sourceEventId: "",
    sourceUri: "",
    observedAt: "",
    assetId: "",
    assetStatus: "",
    confidenceLevel: "UNVERIFIED",
    contentText: "",
  };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!form.incidentId) local.incidentId = "Select the incident this evidence belongs to.";
    if (!form.title.trim()) local.title = "Title is required.";
    if (!form.sourceName.trim()) local.sourceName = "Source is required.";
    if (!form.contentText.trim()) local.contentText = "Content is required.";
    const observedAt = fromUtcInputValue(form.observedAt);
    if (!observedAt) local.observedAt = "Enter when this was observed (UTC).";
    if (form.provenance === "PUBLIC_REPORTED" && !form.sourceUri.trim()) local.sourceUri = "Public reports must cite a source URL.";
    if (form.assetStatus && !form.assetId) local.assetStatus = "Select the asset this status applies to.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    setFormError(null);
    const res = await api<{ ref: string; sha256: string }>(`/api/incidents/${form.incidentId}/evidence`, {
      body: {
        title: form.title,
        category: form.category,
        provenance: form.provenance,
        sourceName: form.sourceName,
        sourceEventId: form.sourceEventId || null,
        sourceUri: form.sourceUri || null,
        observedAt,
        contentText: form.contentText,
        assetId: form.assetId || null,
        assetStatus: form.assetStatus || null,
        confidenceLevel: form.confidenceLevel,
      },
    });
    setBusy(false);
    if (!res.ok) {
      setErrors(fieldErrors(res.error));
      setFormError(res.error.details?.map((d) => d.message).join(" ") || res.error.message);
      return;
    }
    notify(`Evidence ${res.data.ref} stored with SHA-256 ${res.data.sha256.slice(0, 12)}…`);
    setForm(blank);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button icon={<Plus />} onClick={() => setOpen(true)}>
        {fixedIncidentId ? "Add evidence" : "Add record"}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        dirty={(!!form.title || !!form.contentText) && !busy}
        title="Add evidence"
        description="Evidence is immutable once stored; later notes are added as annotations."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" form="add-evidence" loading={busy}>
              Store evidence
            </Button>
          </>
        }
      >
        <form id="add-evidence" className="grid gap-4 sm:grid-cols-2" onSubmit={save} noValidate>
          {formError && (
            <div className="sm:col-span-2">
              <Banner tone="danger">{formError}</Banner>
            </div>
          )}
          {!fixedIncidentId && (
            <SelectField
              className="sm:col-span-2"
              label="Incident"
              required
              value={form.incidentId}
              onChange={(e) => set("incidentId", e.target.value)}
              options={incidents.map((i) => ({ value: i.id, label: `${i.caseNumber} · ${i.title}` }))}
              placeholder="Select incident"
              error={errors.incidentId}
            />
          )}
          <TextField className="sm:col-span-2" label="Title" required value={form.title} onChange={(e) => set("title", e.target.value)} error={errors.title} maxLength={300} />
          <SelectField label="Provenance" required value={form.provenance} onChange={(e) => set("provenance", e.target.value)} options={PROVENANCES.map((p) => ({ value: p, label: PROVENANCE_LABELS[p].label }))} help={PROVENANCE_LABELS[form.provenance as keyof typeof PROVENANCE_LABELS]?.description} />
          <SelectField label="Category" required value={form.category} onChange={(e) => set("category", e.target.value)} options={EVIDENCE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} />
          <TextField label="Source" required value={form.sourceName} onChange={(e) => set("sourceName", e.target.value)} error={errors.sourceName} placeholder="e.g. CRM application log" />
          <TextField label="Source event ID" mono value={form.sourceEventId} onChange={(e) => set("sourceEventId", e.target.value)} error={errors.sourceEventId} help="Used for de-duplication when present." />
          <TextField className="sm:col-span-2" label="Source URL" type="url" value={form.sourceUri} onChange={(e) => set("sourceUri", e.target.value)} error={errors.sourceUri} help="Reference only — CloudTrace never fetches it." />
          <UtcDateTimeField label="Observed at" required value={form.observedAt} onChange={(e) => set("observedAt", e.target.value)} error={errors.observedAt} />
          <SelectField label="Confidence" value={form.confidenceLevel} onChange={(e) => set("confidenceLevel", e.target.value)} options={CONFIDENCE_LEVELS.map((c) => ({ value: c, label: CONFIDENCE_LABELS[c].label }))} />
          <SelectField label="Linked asset" value={form.assetId} onChange={(e) => set("assetId", e.target.value)} options={assets.map((a) => ({ value: a.id, label: a.name }))} placeholder="None" />
          <SelectField
            label="Observed asset status"
            value={form.assetStatus}
            onChange={(e) => set("assetStatus", e.target.value)}
            options={ASSET_ASSERTION_STATUSES.map((s) => ({ value: s, label: OBSERVED_STATUS_LABELS[s].label }))}
            placeholder="No status assertion"
            error={errors.assetStatus}
            help="Only set when this record directly shows the asset's health."
          />
          <TextareaField className="sm:col-span-2" label="Content" required value={form.contentText} onChange={(e) => set("contentText", e.target.value)} error={errors.contentText} help="Stored and displayed as plain text." maxLength={20000} />
        </form>
      </Dialog>
    </>
  );
}

interface PreviewRow {
  rowNumber: number;
  status: string;
  errors: string[];
  duplicateReason?: string;
  title?: string;
  observedAt?: string;
  provenance?: string;
  assetName?: string | null;
  sha256?: string;
}
interface ImportResponse {
  filename: string;
  format: string;
  fileSha256: string;
  fileErrors: string[];
  summary: { total: number; valid: number; invalid: number; duplicates: number; provenanceCounts: Record<string, number> };
  rows: PreviewRow[];
  outcome: "COMPLETED" | "REJECTED" | "PREVIEW";
  mode: "ATOMIC" | "PARTIAL";
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  importJobId: string | null;
  auditEntryId: string | null;
}

export function ImportWizardButton({ incidents, fixedIncidentId }: { incidents: IncidentOption[]; fixedIncidentId?: string }) {
  const router = useRouter();
  const notify = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [incidentId, setIncidentId] = useState(fixedIncidentId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"ATOMIC" | "PARTIAL">("ATOMIC");
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setMode("ATOMIC");
    if (!fixedIncidentId) setIncidentId("");
  };

  async function send(dryRun: boolean, chosen: File, chosenMode = mode) {
    const form = new FormData();
    form.set("file", chosen);
    form.set("mode", chosenMode);
    form.set("dryRun", String(dryRun));
    setBusy(true);
    setError(null);
    const res = await api<ImportResponse>(`/api/incidents/${incidentId}/import`, { form });
    setBusy(false);
    if (res.ok) return res.data;
    setError(res.status === 403 ? "Your role allows viewing, not editing." : res.error.message);
    return null;
  }

  async function choose(f: File | null) {
    setPreview(null);
    setResult(null);
    setError(null);
    if (!f) return;
    if (!/\.(csv|json)$/i.test(f.name)) return setError("Choose a .csv or .json file.");
    if (f.size > MAX_BYTES) return setError(`This file is ${(f.size / 1048576).toFixed(1)} MiB. The import limit is 5 MiB.`);
    if (!incidentId) return setError("Select the target incident first.");
    setFile(f);
    const p = await send(true, f);
    if (p) setPreview(p);
  }

  async function confirm() {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("mode", mode);
    form.set("dryRun", "false");
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/incidents/${incidentId}/import`, { method: "POST", body: form, credentials: "same-origin" });
    const json = (await res.json().catch(() => null)) as ImportResponse | { error: { message: string } } | null;
    setBusy(false);
    if (!json || "error" in json) {
      setError(json && "error" in json ? json.error.message : "Import failed. No evidence was written.");
      return;
    }
    setResult(json);
    if (json.outcome === "COMPLETED") {
      notify("Evidence imported. Review the accepted and rejected row counts.");
      router.refresh();
    } else {
      notify("Import rejected — no evidence was written.", "warning");
    }
  }

  const canConfirm = preview && preview.fileErrors.length === 0 && preview.summary.total > 0 && !(mode === "ATOMIC" && preview.summary.invalid > 0) && preview.summary.valid > 0;

  return (
    <>
      <Button variant={fixedIncidentId ? "secondary" : "primary"} icon={<Upload />} onClick={() => setOpen(true)}>
        {fixedIncidentId ? "Import CSV/JSON" : "Import evidence"}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          reset();
        }}
        size="wide"
        title="Import CSV/JSON"
        description="File → preview → validation → confirm → result. Nothing is stored until you confirm."
        footer={
          result ? (
            <Button
              variant="primary"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" disabled={!canConfirm} loading={busy && !!preview} loadingLabel="Importing…" onClick={confirm}>
                {preview ? `Import ${preview.summary.valid} valid ${preview.summary.valid === 1 ? "row" : "rows"}` : "Import"}
              </Button>
            </>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {!fixedIncidentId && (
            <SelectField
              label="1. Target incident"
              required
              value={incidentId}
              onChange={(e) => {
                setIncidentId(e.target.value);
                setFile(null);
                setPreview(null);
              }}
              options={incidents.map((i) => ({ value: i.id, label: `${i.caseNumber} · ${i.title}` }))}
              placeholder="Select incident"
              help="Each row's incidentCaseNumber must match this incident."
            />
          )}
          {!result && (
            <div
              className="ct-dropzone"
              data-active={dragging}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void choose(e.dataTransfer.files?.[0] ?? null);
              }}
            >
              <FileUp size={22} className="mx-auto text-fg-2" aria-hidden="true" />
              <p className="mt-2 text-[13px]">{fixedIncidentId ? "Choose" : "2. Choose"} a CSV or JSON file (max 5 MiB) or drop it here.</p>
              <p className="ct-support mt-1">
                Required columns: <Mono>incidentCaseNumber, observedAt, title, category, sourceName, sourceEventId, assetName, provenance, contentText, sourceUri</Mono>. Optional:{" "}
                <Mono>confidenceLevel, assetStatus</Mono>. Times must be ISO-8601 with a time zone.
              </p>
              <input ref={fileInput} type="file" accept=".csv,.json,text/csv,application/json" className="ct-sr-only" id="import-file" onChange={(e) => void choose(e.target.files?.[0] ?? null)} />
              <Button className="mt-3" size="sm" onClick={() => fileInput.current?.click()} disabled={!incidentId} loading={busy && !preview} loadingLabel="Validating…">
                Browse files
              </Button>
              {file && <p className="mt-2 text-[12px] text-fg-2">Selected: <Mono>{file.name}</Mono> ({(file.size / 1024).toFixed(1)} KiB)</p>}
            </div>
          )}
          {error && <Banner tone="danger">{error}</Banner>}

          {(result ?? preview) && <ImportSummary data={(result ?? preview)!} final={!!result} />}

          {preview && !result && preview.fileErrors.length === 0 && (
            <fieldset>
              <legend className="ct-field-label">3. Import mode</legend>
              <div className="flex flex-col gap-2 text-[13px]">
                <label className="flex items-start gap-2">
                  <input type="radio" name="mode" className="mt-1" checked={mode === "ATOMIC"} onChange={() => setMode("ATOMIC")} />
                  <span>
                    <strong className="font-semibold">All-or-nothing (default)</strong> — if any row is invalid, nothing is stored.
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" name="mode" className="mt-1" checked={mode === "PARTIAL"} onChange={() => setMode("PARTIAL")} />
                  <span>
                    <strong className="font-semibold">Accept valid rows</strong> — invalid rows are rejected and reported; valid rows are stored.
                  </span>
                </label>
              </div>
              {mode === "ATOMIC" && preview.summary.invalid > 0 && (
                <p className="ct-field-error">This file has invalid rows. Fix them, or choose “Accept valid rows” to import only the valid ones.</p>
              )}
            </fieldset>
          )}
        </div>
      </Dialog>
    </>
  );
}

function ImportSummary({ data, final }: { data: ImportResponse; final: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {final && (
        <Banner tone={data.outcome === "COMPLETED" ? undefined : "warning"}>
          {data.outcome === "COMPLETED"
            ? `Import completed: ${data.acceptedCount} accepted, ${data.rejectedCount} rejected, ${data.duplicateCount} duplicates skipped.`
            : `Import rejected: no evidence was written. ${data.rejectedCount} rows rejected, ${data.duplicateCount} duplicates.`}{" "}
          Recorded in the audit log{data.importJobId ? <> (import job <Mono>{data.importJobId}</Mono>)</> : null}.
        </Banner>
      )}
      {data.fileErrors.length > 0 && (
        <Banner tone="danger">
          <ul className="list-disc pl-4">
            {data.fileErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Banner>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <Mono className="text-fg-2">{data.filename}</Mono>
        <Tag>{data.format}</Tag>
        <Tag>{data.summary.total} rows</Tag>
        <Tag tone="success">{data.summary.valid} valid</Tag>
        <Tag tone={data.summary.invalid ? "danger" : undefined}>{data.summary.invalid} invalid</Tag>
        <Tag tone={data.summary.duplicates ? "warning" : undefined}>{data.summary.duplicates} duplicates</Tag>
        {Object.entries(data.summary.provenanceCounts).map(([p, n]) => (
          <span key={p} className="inline-flex items-center gap-1">
            <ProvenanceBadge value={p} /> <span className="text-fg-2">×{n}</span>
          </span>
        ))}
      </div>
      <p className="text-[11.5px] text-fg-2">
        File SHA-256: <Mono className="break-all">{data.fileSha256}</Mono>. Row numbers exclude the header line.
      </p>
      {data.rows.length > 0 && (
        <div className="ct-table-wrap max-h-72 overflow-y-auto rounded-[6px] border border-line">
          <table className="ct-table">
            <caption className="ct-sr-only">Import validation preview</caption>
            <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col">Result</th>
                <th scope="col">Observed (UTC)</th>
                <th scope="col">Title</th>
                <th scope="col">Provenance</th>
                <th scope="col">Asset</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.rowNumber}>
                  <td className="ct-mono">{r.rowNumber}</td>
                  <td>
                    {r.status === "VALID" ? (
                      <Tag tone="success">Valid</Tag>
                    ) : r.status === "DUPLICATE" ? (
                      <Tag tone="warning" title={r.duplicateReason}>
                        Duplicate
                      </Tag>
                    ) : (
                      <Tag tone="danger">Invalid</Tag>
                    )}
                    {r.errors.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-[11.5px] text-red">
                        {r.errors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    )}
                    {r.duplicateReason && <p className="mt-1 text-[11.5px] text-fg-2">{r.duplicateReason}</p>}
                  </td>
                  <td className="ct-mono whitespace-nowrap text-[12px]">{r.observedAt ? formatUtc(r.observedAt) : "—"}</td>
                  <td>{r.title ?? "—"}</td>
                  <td>{r.provenance ? <ProvenanceBadge value={r.provenance} /> : "—"}</td>
                  <td>{r.assetName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
