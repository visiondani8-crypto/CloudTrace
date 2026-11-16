"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { EvidenceChip } from "@/components/evidence/EvidenceInspector";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { CheckboxList, SelectField, Segmented, TextField, TextareaField, UtcDateTimeField } from "@/components/ui/fields";
import { useToast } from "@/components/ui/Toast";
import { Banner, EmptyState, Mono, Panel, Tag, TaskPriorityBadge, TaskStatusBadge } from "@/components/ui/primitives";
import { api, fieldErrors } from "@/lib/client/api";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/domain/enums";
import { formatUtc, fromUtcInputValue, toUtcInputValue } from "@/lib/domain/time";
import type { TaskView } from "@/lib/services/investigation";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/ui/labels";

function overdue(t: TaskView, now: number | null) {
  return now !== null && !!t.dueAt && (t.status === "OPEN" || t.status === "IN_PROGRESS") && new Date(t.dueAt).getTime() < now;
}

export function TasksTab({
  incidentId,
  tasks,
  members,
  evidence,
  canEdit,
}: {
  incidentId: string;
  tasks: TaskView[];
  members: { userId: string; name: string; role: string }[];
  evidence: { id: string; ref: string; title: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const notify = useToast();
  const [view, setView] = useState<"table" | "board">("table");
  const [editing, setEditing] = useState<TaskView | "new" | null>(null);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);

  async function setStatus(t: TaskView, status: string) {
    const res = await api(`/api/incidents/${incidentId}/tasks`, { method: "PATCH", body: { id: t.id, status } });
    if (!res.ok) return notify(res.error.message, "danger");
    notify(`Task marked ${TASK_STATUS_LABELS[status as keyof typeof TASK_STATUS_LABELS].label.toLowerCase()}. Bookkeeping only — nothing was executed.`);
    router.refresh();
  }

  const statusSelect = (t: TaskView) =>
    canEdit ? (
      <select className="ct-field min-h-[30px] w-auto py-1 text-[12px]" value={t.status} aria-label={`Status for ${t.title}`} onChange={(e) => void setStatus(t, e.target.value)}>
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_LABELS[s].label}
          </option>
        ))}
      </select>
    ) : (
      <TaskStatusBadge value={t.status} />
    );

  const due = (t: TaskView) =>
    t.dueAt ? (
      <span className="inline-flex flex-col gap-1">
        <Mono className="whitespace-nowrap text-[12px]">{formatUtc(t.dueAt)}</Mono>
        {overdue(t, now) && <Tag tone="danger">Overdue</Tag>}
      </span>
    ) : (
      <span className="text-fg-2">No due date</span>
    );

  return (
    <div className="flex flex-col gap-4">
      <Banner>Response tasks are manual follow-ups. Nothing here disables accounts, contains hosts or changes cloud systems.</Banner>
      <Panel
        flush
        title="Response tasks"
        actions={
          <>
            <Segmented label="Task view" value={view} onChange={setView} options={[{ value: "table", label: "Table" }, { value: "board", label: "Board" }]} />
            {canEdit && (
              <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setEditing("new")}>
                Create task
              </Button>
            )}
          </>
        }
      >
        {tasks.length === 0 ? (
          <EmptyState title="No response tasks recorded.">{canEdit ? "Add the first manual follow-up." : undefined}</EmptyState>
        ) : view === "table" ? (
          <div className="ct-table-wrap">
            <table className="ct-table">
              <caption className="ct-sr-only">Response tasks</caption>
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Due (UTC)</th>
                  <th scope="col">Status</th>
                  <th scope="col">Linked evidence</th>
                  <th scope="col">
                    <span className="ct-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td className="min-w-[220px]">
                      <div className="font-medium">{t.title}</div>
                      {t.description && <div className="mt-0.5 line-clamp-2 text-[12px] text-fg-2">{t.description}</div>}
                      {t.completedAt && <div className="mt-0.5 text-[11.5px] text-fg-2">Completed {formatUtc(t.completedAt)}</div>}
                    </td>
                    <td>
                      <TaskPriorityBadge value={t.priority} />
                    </td>
                    <td className="whitespace-nowrap text-fg-2">{t.assigneeName ?? "Unassigned"}</td>
                    <td>{due(t)}</td>
                    <td>{statusSelect(t)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {t.evidence.length ? t.evidence.map((e) => <EvidenceChip key={e.id} id={e.id} label={e.ref} />) : <span className="text-fg-2">—</span>}
                      </div>
                    </td>
                    <td>
                      {canEdit && (
                        <Button size="sm" variant="ghost" icon={<Pencil />} aria-label={`Edit task ${t.title}`} onClick={() => setEditing(t)}>
                          Edit
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
            {TASK_STATUSES.map((s) => (
              <section key={s} aria-label={TASK_STATUS_LABELS[s].label} className="rounded-[6px] border border-line bg-raised p-3">
                <h3 className="mb-2 flex items-center justify-between text-[12px] font-semibold uppercase tracking-[0.6px] text-fg-2">
                  {TASK_STATUS_LABELS[s].label} <span className="ct-mono">{tasks.filter((t) => t.status === s).length}</span>
                </h3>
                <ul className="flex flex-col gap-2">
                  {tasks
                    .filter((t) => t.status === s)
                    .map((t) => (
                      <li key={t.id} className="rounded-[5px] border border-line bg-surface p-2.5 text-[12.5px]">
                        <div className="font-medium">{t.title}</div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <TaskPriorityBadge value={t.priority} />
                          {overdue(t, now) && <Tag tone="danger">Overdue</Tag>}
                        </div>
                        <div className="mt-1.5 text-[11.5px] text-fg-2">{t.assigneeName ?? "Unassigned"}{t.dueAt ? ` · due ${formatUtc(t.dueAt)}` : ""}</div>
                        <div className="mt-2">{statusSelect(t)}</div>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Panel>
      {canEdit && <TaskDialog incidentId={incidentId} target={editing} onClose={() => setEditing(null)} members={members} evidence={evidence} />}
    </div>
  );
}

function TaskDialog({ incidentId, target, onClose, members, evidence }: { incidentId: string; target: TaskView | "new" | null; onClose: () => void; members: { userId: string; name: string; role: string }[]; evidence: { id: string; ref: string; title: string }[] }) {
  const router = useRouter();
  const notify = useToast();
  const existing = target && target !== "new" ? target : null;
  const blank = { title: "", description: "", priority: "MEDIUM", status: "OPEN", assigneeId: "", dueAt: "", evidenceIds: [] as string[] };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setErrors({});
    setForm(
      existing
        ? {
            title: existing.title,
            description: existing.description ?? "",
            priority: existing.priority,
            status: existing.status,
            assigneeId: existing.assigneeId ?? "",
            dueAt: toUtcInputValue(existing.dueAt),
            evidenceIds: existing.evidence.map((e) => e.id),
          }
        : blank,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (form.title.trim().length < 3) return setErrors({ title: "Task must be at least 3 characters." });
    setBusy(true);
    const body = {
      title: form.title,
      description: form.description || null,
      priority: form.priority,
      status: form.status,
      assigneeId: form.assigneeId || null,
      dueAt: form.dueAt ? fromUtcInputValue(form.dueAt) : null,
      evidenceIds: form.evidenceIds,
    };
    const res = existing
      ? await api(`/api/incidents/${incidentId}/tasks`, { method: "PATCH", body: { id: existing.id, ...body } })
      : await api(`/api/incidents/${incidentId}/tasks`, { body });
    setBusy(false);
    if (!res.ok) return setErrors({ ...fieldErrors(res.error), _: res.error.message });
    notify(existing ? "Changes saved." : "Task created and recorded in the audit log.");
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      dirty={!busy && form.title !== (existing?.title ?? "")}
      title={existing ? "Edit task" : "Create task"}
      description="Tasks track manual follow-ups. CloudTrace does not execute them."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="task-form" loading={busy}>
            {existing ? "Save changes" : "Create task"}
          </Button>
        </>
      }
    >
      <form id="task-form" className="grid gap-4 sm:grid-cols-2" onSubmit={save} noValidate>
        {errors._ && (
          <div className="sm:col-span-2">
            <Banner tone="danger">{errors._}</Banner>
          </div>
        )}
        <TextField className="sm:col-span-2" label="Task" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={errors.title} maxLength={200} />
        <TextareaField className="sm:col-span-2" label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <SelectField label="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} options={TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_PRIORITY_LABELS[p].label }))} />
        <SelectField label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s].label }))} />
        <SelectField label="Assignee" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })} options={members.map((m) => ({ value: m.userId, label: m.name }))} placeholder="Unassigned" error={errors.assigneeId} />
        <UtcDateTimeField label="Due" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} error={errors.dueAt} />
        <div className="sm:col-span-2">
          <CheckboxList legend="Linked evidence" items={evidence.map((e) => ({ value: e.id, label: `${e.ref} · ${e.title}` }))} selected={form.evidenceIds} onChange={(v) => setForm({ ...form, evidenceIds: v })} emptyText="No evidence in this incident yet." error={errors.evidenceIds} />
        </div>
      </form>
    </Dialog>
  );
}
