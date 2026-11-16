"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { FileText, Link2, Pencil, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { SelectField, TextField, TextareaField, UtcDateTimeField } from "@/components/ui/fields";
import { Menu, MenuItem, Tabs } from "@/components/ui/interactive";
import { useToast } from "@/components/ui/Toast";
import { Banner } from "@/components/ui/primitives";
import { api, fieldErrors } from "@/lib/client/api";
import { CLASSIFICATIONS, INCIDENT_TYPES, SEVERITIES, STATUS_TRANSITIONS, type IncidentStatus } from "@/lib/domain/enums";
import { fromUtcInputValue, toUtcInputValue } from "@/lib/domain/time";
import { CLASSIFICATION_LABELS, SEVERITY_LABELS, STATUS_LABELS, TYPE_LABELS } from "@/lib/ui/labels";

export interface CaseSummary {
  id: string;
  caseNumber: string;
  title: string;
  description: string;
  type: string;
  severity: string;
  status: string;
  classification: string;
  ownerId: string | null;
  startedAt: string | null;
  resolvedAt: string | null;
}

export function RememberCase({ id }: { id: string }) {
  useEffect(() => {
    document.cookie = `ct_last_case=${encodeURIComponent(id)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
  }, [id]);
  return null;
}

export function AnalyzeButton({ incidentId, aiConfigured }: { incidentId: string; aiConfigured: boolean }) {
  const router = useRouter();
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      icon={<Sparkles />}
      loading={busy}
      loadingLabel="Analyzing…"
      title={aiConfigured ? "Runs Claude analysis with rule-based fallback" : "Runs deterministic rule-based analysis (no AI key configured)"}
      onClick={async () => {
        setBusy(true);
        const res = await api<{ analysis: { mode: string; errorStatus: string | null } }>(`/api/incidents/${incidentId}/analyze`, { body: {} });
        setBusy(false);
        if (!res.ok) return notify(res.error.message, "danger");
        const a = res.data.analysis;
        if (a.errorStatus) notify(`Claude analysis unavailable (${a.errorStatus}); rule-based analysis saved instead.`, "warning");
        else notify(a.mode === "CLAUDE" ? "Claude analysis saved. Review before relying on it." : "Rule-based analysis saved.");
        router.refresh();
      }}
    >
      Analyze evidence
    </Button>
  );
}

export function GenerateReportButton({ incidentId, basePath, hasEvidence, label = "Generate report", variant = "primary" }: { incidentId: string; basePath: string; hasEvidence: boolean; label?: string; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      icon={<FileText />}
      loading={busy}
      loadingLabel="Generating…"
      disabled={!hasEvidence}
      title={hasEvidence ? undefined : "Add at least one evidence item before generating a report."}
      onClick={async () => {
        setBusy(true);
        const res = await api<{ id: string; version: number }>(`/api/incidents/${incidentId}/reports`, { body: {} });
        setBusy(false);
        if (!res.ok) return notify(res.error.message, "danger");
        notify(`Report v${res.data.version} generated as an immutable snapshot.`);
        router.push(`${basePath}/${incidentId}?tab=report&report=${res.data.id}`, { scroll: false });
        router.refresh();
      }}
    >
      {label}
    </Button>
  );
}

export function StatusControl({ incident }: { incident: CaseSummary }) {
  const router = useRouter();
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const allowed = STATUS_TRANSITIONS[incident.status as IncidentStatus] ?? [];
  return (
    <select
        aria-label="Status"
        className="ct-field min-h-[32px] py-1 text-[12.5px]"
        value={incident.status}
        disabled={busy}
        onChange={async (e) => {
          const status = e.target.value;
          setBusy(true);
          const res = await api(`/api/incidents/${incident.id}`, { method: "PATCH", body: { status } });
          setBusy(false);
          if (!res.ok) return notify(res.error.message, "danger");
          notify(`Status changed to ${STATUS_LABELS[status as IncidentStatus].label}. Recorded in the audit log.`);
          router.refresh();
        }}
      >
        <option value={incident.status}>{STATUS_LABELS[incident.status as IncidentStatus]?.label ?? incident.status}</option>
        {allowed.map((s) => (
          <option key={s} value={s}>
            → {STATUS_LABELS[s].label}
            {incident.status === "RESOLVED" ? " (re-open)" : ""}
          </option>
        ))}
      </select>
  );
}

export function CaseMenu({ incident, members, canEdit }: { incident: CaseSummary; members: { userId: string; name: string; role: string }[]; canEdit: boolean }) {
  const notify = useToast();
  const [editing, setEditing] = useState(false);
  return (
    <>
      <Menu label="More case actions">
        {(close) => (
          <>
            {canEdit && (
              <MenuItem
                icon={<Pencil />}
                onSelect={() => {
                  close();
                  setEditing(true);
                }}
              >
                Edit case details
              </MenuItem>
            )}
            <MenuItem
              icon={<Link2 />}
              onSelect={async () => {
                close();
                try {
                  await navigator.clipboard.writeText(`${window.location.origin}/investigations/${incident.id}`);
                  notify("Case link copied. Only members of this workspace can open it.");
                } catch {
                  notify("Clipboard access was blocked by the browser.", "warning");
                }
              }}
            >
              Copy link
            </MenuItem>
          </>
        )}
      </Menu>
      {canEdit && <EditCaseDialog open={editing} onClose={() => setEditing(false)} incident={incident} members={members} />}
    </>
  );
}

function EditCaseDialog({ open, onClose, incident, members }: { open: boolean; onClose: () => void; incident: CaseSummary; members: { userId: string; name: string; role: string }[] }) {
  const router = useRouter();
  const notify = useToast();
  const initial = {
    title: incident.title,
    description: incident.description,
    type: incident.type,
    severity: incident.severity,
    classification: incident.classification,
    classificationJustification: "",
    ownerId: incident.ownerId ?? "",
    startedAt: toUtcInputValue(incident.startedAt),
  };
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setForm(initial);
      setErrors({});
      setFormError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const confirming = form.classification === "CONFIRMED_SECURITY" && incident.classification !== "CONFIRMED_SECURITY";
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    const body: Record<string, unknown> = {
      title: form.title,
      description: form.description,
      type: form.type,
      severity: form.severity,
      classification: form.classification,
      ownerId: form.ownerId || null,
      startedAt: form.startedAt ? fromUtcInputValue(form.startedAt) : null,
    };
    if (confirming) body.classificationJustification = form.classificationJustification;
    const res = await api(`/api/incidents/${incident.id}`, { method: "PATCH", body });
    setBusy(false);
    if (!res.ok) {
      setErrors(fieldErrors(res.error));
      setFormError(res.error.message);
      return;
    }
    notify("Changes saved.");
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dirty={dirty && !busy}
      title={`Edit ${incident.caseNumber}`}
      description="Changes to severity, status and classification are recorded in the audit log."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="edit-case" loading={busy}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-case" onSubmit={save} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <div className="sm:col-span-2">
            <Banner tone="danger">{formError}</Banner>
          </div>
        )}
        <TextField className="sm:col-span-2" label="Title" required value={form.title} onChange={(e) => set("title", e.target.value)} error={errors.title} />
        <TextareaField className="sm:col-span-2" label="Description" required value={form.description} onChange={(e) => set("description", e.target.value)} error={errors.description} />
        <SelectField label="Type" value={form.type} onChange={(e) => set("type", e.target.value)} options={INCIDENT_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))} />
        <SelectField
          label="Severity"
          value={form.severity}
          onChange={(e) => set("severity", e.target.value)}
          options={SEVERITIES.slice()
            .reverse()
            .map((s) => ({ value: s, label: SEVERITY_LABELS[s].label }))}
        />
        <SelectField
          label="Classification"
          value={form.classification}
          onChange={(e) => set("classification", e.target.value)}
          options={CLASSIFICATIONS.map((c) => ({ value: c, label: CLASSIFICATION_LABELS[c].label }))}
          help="Analysis may suggest a classification; only an analyst decides it."
          error={errors.classification}
        />
        <SelectField
          label="Owner"
          value={form.ownerId}
          onChange={(e) => set("ownerId", e.target.value)}
          options={members.filter((m) => m.role !== "VIEWER").map((m) => ({ value: m.userId, label: m.name }))}
          placeholder="Unassigned"
          error={errors.ownerId}
        />
        <UtcDateTimeField label="Start time" value={form.startedAt} onChange={(e) => set("startedAt", e.target.value)} error={errors.startedAt} />
        {confirming && (
          <div className="sm:col-span-2">
            <Banner tone="warning">
              Confirming a security incident is a human decision. Describe the evidence you reviewed; it is stored in the audit log.
            </Banner>
            <TextareaField
              className="mt-3"
              label="Evidence review justification"
              required
              value={form.classificationJustification}
              onChange={(e) => set("classificationJustification", e.target.value)}
              error={errors.classificationJustification}
            />
          </div>
        )}
      </form>
    </Dialog>
  );
}

export type WorkspaceTab = "overview" | "timeline" | "evidence" | "dependency" | "hypotheses" | "tasks" | "report";

export function WorkspaceTabs({ tab, counts }: { tab: WorkspaceTab; counts: Partial<Record<WorkspaceTab, number>> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<WorkspaceTab | null>(null);
  const tabs: { value: WorkspaceTab; label: string; count?: number }[] = [
    { value: "overview", label: "Overview" },
    { value: "timeline", label: "Timeline", count: counts.timeline },
    { value: "evidence", label: "Evidence", count: counts.evidence },
    { value: "dependency", label: "Dependency impact" },
    { value: "hypotheses", label: "Hypotheses", count: counts.hypotheses },
    { value: "tasks", label: "Response tasks", count: counts.tasks },
    { value: "report", label: "Report", count: counts.report },
  ];
  return (
    <div className="relative">
      <Tabs
        label="Investigation sections"
        tabs={tabs}
        value={pending && target ? target : tab}
        onChange={(value) => {
          const next = new URLSearchParams();
          if (value !== "overview") next.set("tab", value);
          const keep = params.get("view");
          if (keep && value === "dependency") next.set("view", keep);
          setTarget(value);
          startTransition(() => router.push(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false }));
        }}
      />
      <p className="ct-support absolute right-0 top-3 hidden sm:block" role="status" aria-live="polite">
        {pending && target ? `Loading ${tabs.find((t) => t.value === target)?.label.toLowerCase()}…` : ""}
      </p>
    </div>
  );
}
