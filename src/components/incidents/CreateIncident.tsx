"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { CheckboxList, SelectField, TextField, TextareaField, UtcDateTimeField } from "@/components/ui/fields";
import { useToast } from "@/components/ui/Toast";
import { Banner } from "@/components/ui/primitives";
import { api, fieldErrors } from "@/lib/client/api";
import { INCIDENT_TYPES, SEVERITIES } from "@/lib/domain/enums";
import { fromUtcInputValue } from "@/lib/domain/time";
import { SEVERITY_LABELS, TYPE_LABELS } from "@/lib/ui/labels";

export interface MemberOption {
  userId: string;
  name: string;
  role: string;
}
export interface AssetOption {
  id: string;
  name: string;
  provider: string;
}

export function CreateIncidentButton({ members, assets, currentUserId }: { members: MemberOption[]; assets: AssetOption[]; currentUserId: string }) {
  const router = useRouter();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const empty = { title: "", description: "", type: "PROVIDER_OUTAGE", severity: "MEDIUM", startedAt: "", ownerId: currentUserId, assetIds: [] as string[] };
  const [form, setForm] = useState(empty);
  const dirty = form.title !== "" || form.description !== "";

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (form.title.trim().length < 3) local.title = "Title must be at least 3 characters.";
    if (!form.description.trim()) local.description = "Description is required.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    setFormError(null);
    const res = await api<{ id: string; caseNumber: string }>("/api/incidents", {
      body: {
        title: form.title,
        description: form.description,
        type: form.type,
        severity: form.severity,
        startedAt: form.startedAt ? fromUtcInputValue(form.startedAt) : null,
        ownerId: form.ownerId || null,
        assetIds: form.assetIds,
      },
    });
    setBusy(false);
    if (!res.ok) {
      setErrors(fieldErrors(res.error));
      setFormError(res.error.message);
      return;
    }
    notify(`Created ${res.data.caseNumber}. Changes saved.`);
    setOpen(false);
    setForm(empty);
    router.push(`/investigations/${res.data.id}`);
  }

  return (
    <>
      <Button variant="primary" icon={<Plus />} onClick={() => setOpen(true)}>
        Create incident
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        dirty={dirty && !busy}
        title="Create incident"
        description="Opens a new case in this workspace. Status starts as Open."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" form="create-incident" loading={busy} loadingLabel="Creating…">
              Create incident
            </Button>
          </>
        }
      >
        <form id="create-incident" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          {formError && (
            <div className="sm:col-span-2">
              <Banner tone="danger">{formError}</Banner>
            </div>
          )}
          <TextField
            className="sm:col-span-2"
            label="Title"
            required
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            error={errors.title}
            maxLength={200}
          />
          <TextareaField
            className="sm:col-span-2"
            label="Description"
            required
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            error={errors.description}
            help="What happened, what is known, and what is still unverified."
            maxLength={5000}
          />
          <SelectField
            label="Type"
            required
            value={form.type}
            onChange={(e) => set("type", e.target.value)}
            options={INCIDENT_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
            error={errors.type}
          />
          <SelectField
            label="Severity"
            required
            value={form.severity}
            onChange={(e) => set("severity", e.target.value)}
            options={SEVERITIES.slice()
              .reverse()
              .map((s) => ({ value: s, label: SEVERITY_LABELS[s].label }))}
            error={errors.severity}
            help="Severity describes business impact; it is not evidence of an attack."
          />
          <UtcDateTimeField label="Start time" value={form.startedAt} onChange={(e) => set("startedAt", e.target.value)} error={errors.startedAt} />
          <SelectField
            label="Owner"
            value={form.ownerId}
            onChange={(e) => set("ownerId", e.target.value)}
            options={members.filter((m) => m.role !== "VIEWER").map((m) => ({ value: m.userId, label: m.name }))}
            placeholder="Unassigned"
            error={errors.ownerId}
          />
          <div className="sm:col-span-2">
            <CheckboxList
              legend="Affected or relevant services"
              items={assets.map((a) => ({ value: a.id, label: `${a.name} · ${a.provider.replace("_", " ")}` }))}
              selected={form.assetIds}
              onChange={(v) => set("assetIds", v)}
              emptyText="No assets mapped yet. Add assets in the Asset graph."
              help="Scope only. Selecting a service does not mark it affected — that requires evidence."
              error={errors.assetIds}
            />
          </div>
        </form>
      </Dialog>
    </>
  );
}
