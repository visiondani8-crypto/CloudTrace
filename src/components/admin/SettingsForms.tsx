"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { SelectField, TextField } from "@/components/ui/fields";
import { Tabs } from "@/components/ui/interactive";
import { useToast } from "@/components/ui/Toast";
import { Banner, Mono, Tag } from "@/components/ui/primitives";
import { api, fieldErrors } from "@/lib/client/api";
import { ROLES } from "@/lib/domain/enums";
import { formatUtc } from "@/lib/domain/time";
import { ROLE_LABELS } from "@/lib/ui/labels";

export type SettingsTab = "general" | "members" | "profile" | "preferences";

export function SettingsTabs({ tab }: { tab: SettingsTab }) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  return (
    <Tabs
      label="Settings sections"
      value={tab}
      onChange={(t) => startTransition(() => router.push(`${pathname}${t === "general" ? "" : `?tab=${t}`}`, { scroll: false }))}
      tabs={[
        { value: "general", label: "General" },
        { value: "members", label: "Members & roles" },
        { value: "profile", label: "My profile" },
        { value: "preferences", label: "Preferences" },
      ]}
    />
  );
}

export function OrgNameForm({ name, canEdit }: { name: string; canEdit: boolean }) {
  const router = useRouter();
  const notify = useToast();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex max-w-[520px] flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const res = await api("/api/settings/organization", { method: "PATCH", body: { name: value } });
        setBusy(false);
        if (!res.ok) return setError(fieldErrors(res.error).name ?? res.error.message);
        setError(undefined);
        notify("Changes saved.");
        router.refresh();
      }}
    >
      <TextField label="Workspace name" value={value} onChange={(e) => setValue(e.target.value)} disabled={!canEdit} readOnly={!canEdit} error={error} help={canEdit ? undefined : "Only owners can rename the workspace."} />
      {canEdit && (
        <div>
          <Button type="submit" variant="primary" loading={busy} disabled={value === name}>
            Save changes
          </Button>
        </div>
      )}
    </form>
  );
}

interface Member {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  lastLoginAt: string | null;
  joinedAt: string;
}

export function MembersTable({ members, isOwner, currentUserId, demoUserCreation }: { members: Member[]; isOwner: boolean; currentUserId: string; demoUserCreation: boolean }) {
  const router = useRouter();
  const notify = useToast();
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="ct-table-wrap rounded-[6px] border border-line">
        <table className="ct-table">
          <caption className="ct-sr-only">Workspace members</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Last sign-in (UTC)</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.membershipId}>
                <td>
                  {m.name} {m.userId === currentUserId && <Tag className="ml-1">You</Tag>}
                </td>
                <td>
                  <Mono className="text-[12.5px]">{m.email}</Mono>
                </td>
                <td>
                  {isOwner ? (
                    <select
                      className="ct-field min-h-[30px] w-auto py-1 text-[12.5px]"
                      aria-label={`Role for ${m.name}`}
                      value={m.role}
                      onChange={async (e) => {
                        const res = await api("/api/settings/members", { method: "PATCH", body: { membershipId: m.membershipId, role: e.target.value } });
                        if (!res.ok) notify(res.error.message, "danger");
                        else notify(`Role updated for ${m.name}. Recorded in the audit log.`);
                        router.refresh();
                      }}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r].label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Tag tone={ROLE_LABELS[m.role as keyof typeof ROLE_LABELS]?.tone}>{ROLE_LABELS[m.role as keyof typeof ROLE_LABELS]?.label ?? m.role}</Tag>
                  )}
                </td>
                <td>
                  <Mono className="text-[12px] text-fg-2">{m.lastLoginAt ? formatUtc(m.lastLoginAt) : "Never"}</Mono>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="grid gap-3 text-[12.5px] sm:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r} className="rounded-[6px] border border-line bg-raised p-3">
            <dt className="font-semibold">{ROLE_LABELS[r].label}</dt>
            <dd className="mt-1 text-fg-2">{ROLE_LABELS[r].description}</dd>
          </div>
        ))}
      </dl>
      {isOwner &&
        (demoUserCreation ? (
          <div>
            <Button icon={<UserPlus />} onClick={() => setAdding(true)}>
              Create local demo user
            </Button>
            <p className="ct-support mt-1.5">Development-only path. Production deployments need proper onboarding and account recovery.</p>
            <DemoUserDialog open={adding} onClose={() => setAdding(false)} />
          </div>
        ) : (
          <p className="ct-support">Local demo user creation is disabled in this environment.</p>
        ))}
    </div>
  );
}

function DemoUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const notify = useToast();
  const [form, setForm] = useState({ name: "", email: "", role: "VIEWER", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dirty={!busy && !!(form.name || form.email)}
      title="Create local demo user"
      description="Creates a password-based local account in this workspace. The password is hashed and never shown again."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="demo-user" loading={busy}>
            Create user
          </Button>
        </>
      }
    >
      <form
        id="demo-user"
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const res = await api("/api/settings/members", { body: form });
          setBusy(false);
          if (!res.ok) return setErrors({ ...fieldErrors(res.error), _: res.error.message });
          notify(`Created ${form.email}.`);
          setForm({ name: "", email: "", role: "VIEWER", password: "" });
          onClose();
          router.refresh();
        }}
      >
        {errors._ && (
          <div className="sm:col-span-2">
            <Banner tone="danger">{errors._}</Banner>
          </div>
        )}
        <TextField label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
        <TextField label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
        <SelectField label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r].label }))} />
        <TextField label="Initial password" type="password" autoComplete="new-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={errors.password} help="At least 12 characters." />
      </form>
    </Dialog>
  );
}

export function ProfileForm({ name }: { name: string }) {
  const router = useRouter();
  const notify = useToast();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex max-w-[520px] flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const res = await api("/api/settings/profile", { method: "PATCH", body: { name: value } });
        setBusy(false);
        if (!res.ok) return setError(fieldErrors(res.error).name ?? res.error.message);
        setError(undefined);
        notify("Changes saved.");
        router.refresh();
      }}
    >
      <TextField label="Display name" value={value} onChange={(e) => setValue(e.target.value)} error={error} />
      <div>
        <Button type="submit" variant="primary" loading={busy} disabled={value === name}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
