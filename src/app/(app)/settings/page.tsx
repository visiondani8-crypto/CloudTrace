import type { Metadata } from "next";
import { MembersTable, OrgNameForm, ProfileForm, SettingsTabs, type SettingsTab } from "@/components/admin/SettingsForms";
import { Banner, Mono, PageHeader, Panel, Tag } from "@/components/ui/primitives";
import { can, requirePageContext } from "@/lib/auth/context";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth/options";
import { formatUtc } from "@/lib/domain/time";
import { firstParam, type SearchParams } from "@/lib/page";
import { listMembers } from "@/lib/services/incidents";
import { getWorkspace } from "@/lib/services/workspace";
import { ROLE_LABELS } from "@/lib/ui/labels";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const raw = firstParam((await searchParams).tab);
  const tab: SettingsTab = raw === "members" || raw === "profile" || raw === "preferences" ? raw : "general";
  const isOwner = can(ctx, "OWNER");
  const [workspace, members] = await Promise.all([getWorkspace(ctx), listMembers(ctx)]);
  const me = members.find((m) => m.userId === ctx.userId);

  return (
    <div className="ct-page">
      <PageHeader crumbs={[{ label: "Administration" }, { label: "Settings" }]} eyebrow="Administration / workspace" title="Settings" subtitle="Organisation, members and your profile." />
      <SettingsTabs tab={tab} />
      <div className="pt-5" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "general" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Workspace">
              <OrgNameForm name={workspace.name} canEdit={isOwner} />
              <dl className="ct-kv mt-5">
                <dt>Workspace slug</dt>
                <dd className="ct-mono">{workspace.slug}</dd>
                <dt>Workspace ID</dt>
                <dd className="ct-mono">{workspace.id}</dd>
                <dt>Created (UTC)</dt>
                <dd className="ct-mono">{formatUtc(workspace.createdAt)}</dd>
              </dl>
            </Panel>
            <Panel title="Data mode">
              <dl className="ct-kv">
                <dt>Incidents</dt>
                <dd>
                  {workspace.incidentCount} ({workspace.demoIncidentCount} demonstration cases)
                </dd>
                <dt>Evidence records</dt>
                <dd>{workspace.evidenceCount}</dd>
                <dt>Database</dt>
                <dd>{workspace.database}</dd>
              </dl>
              <div className="mt-4">
                <Banner tone="warning">
                  Local SQLite and environment-based secrets suit a development or portfolio MVP. They are not enterprise-certified production infrastructure.
                </Banner>
              </div>
              <p className="ct-support mt-3">Destructive resets are command-line only (<Mono>npm run db:reset</Mono>, development only) and never available from this page.</p>
            </Panel>
          </div>
        )}
        {tab === "members" && (
          <Panel title="Members & roles" description="Permissions are enforced on the server for every request; hidden buttons are not the control.">
            <MembersTable members={members} isOwner={isOwner} currentUserId={ctx.userId} demoUserCreation={workspace.demoUserCreation} />
          </Panel>
        )}
        {tab === "profile" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="My profile">
              <ProfileForm name={ctx.userName} />
            </Panel>
            <Panel title="Account and session">
              <dl className="ct-kv">
                <dt>Email</dt>
                <dd className="ct-mono">{ctx.userEmail}</dd>
                <dt>Role in this workspace</dt>
                <dd>
                  <Tag>{ROLE_LABELS[ctx.role].label}</Tag> <span className="text-fg-2">{ROLE_LABELS[ctx.role].description}</span>
                </dd>
                <dt>Workspaces</dt>
                <dd>{ctx.memberships.map((m) => m.organizationName).join(", ")}</dd>
                <dt>Last sign-in (UTC)</dt>
                <dd className="ct-mono">{me?.lastLoginAt ? formatUtc(me.lastLoginAt) : "—"}</dd>
                <dt>Session lifetime</dt>
                <dd>{SESSION_MAX_AGE_SECONDS / 3600} hours, server-verified signed session</dd>
              </dl>
            </Panel>
          </div>
        )}
        {tab === "preferences" && (
          <Panel title="Preferences">
            <dl className="ct-kv max-w-[640px]">
              <dt>Time zone</dt>
              <dd>UTC (fixed). Forensic timestamps are always stored and displayed in UTC.</dd>
              <dt>Theme</dt>
              <dd>Obsidian (dark). No alternative theme is shipped in the MVP.</dd>
              <dt>Density</dt>
              <dd>Compact professional (default).</dd>
            </dl>
          </Panel>
        )}
      </div>
    </div>
  );
}
