import type { Metadata } from "next";
import { Bot, Cloud, Cpu, Shield } from "lucide-react";
import { IssueAttach, SyncButton } from "@/components/integrations/IntegrationControls";
import { Banner, Mono, PageHeader, Panel, Tag } from "@/components/ui/primitives";
import { can, requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { formatUtc } from "@/lib/domain/time";
import { getIntegrationStatus, listProviderIssues } from "@/lib/services/integrations";
import { CONNECTION_STATUS_LABELS } from "@/lib/ui/labels";

export const metadata: Metadata = { title: "Integrations" };

function CardTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-fg-2" aria-hidden="true">
        {icon}
      </span>
      {children}
    </span>
  );
}

export default async function IntegrationsPage() {
  const ctx = await requirePageContext();
  const status = await getIntegrationStatus(ctx);
  const ms = status.microsoft;
  const isOwner = can(ctx, "OWNER");
  const [issues, incidents] = await Promise.all([
    listProviderIssues(ctx),
    prisma.incident.findMany({ where: { organizationId: ctx.organizationId }, select: { id: true, caseNumber: true }, orderBy: { caseNumber: "asc" } }),
  ]);
  const msLabel = CONNECTION_STATUS_LABELS[ms.status];
  const syncDisabled = !isOwner
    ? "Only workspace owners can run a sync."
    : !ms.assignedToThisWorkspace
      ? "Not configured — local analysis remains available."
      : null;

  return (
    <div className="ct-page">
      <PageHeader
        crumbs={[{ label: "Administration" }, { label: "Integrations" }]}
        eyebrow="Administration / sources"
        title="Integrations"
        subtitle="Manage which authorised sources CloudTrace can analyse."
      />
      <div className="mb-4">
        <Banner>
          Every investigation workflow works locally without integrations: seeded cases, CSV/JSON imports, dependency analysis, rule-based analysis and reports. Integrations are
          optional, read-only and never shown as connected without a recorded successful sync.
        </Banner>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel title={<CardTitle icon={<Cpu size={16} />}>Local investigation engine</CardTitle>} actions={<Tag tone="success">Active · local</Tag>}>
          <ul className="list-disc pl-4 text-[13px] leading-5">
            <li>Seeded demonstration incidents and organisation data</li>
            <li>CSV/JSON evidence imports with validation and SHA-256 hashing</li>
            <li>Dependency blast-radius engine and correlation rules</li>
            <li>Rule-based analysis and versioned reports</li>
          </ul>
          <p className="ct-support mt-3">Runs entirely on this server. Not a network connection.</p>
        </Panel>

        <Panel title={<CardTitle icon={<Cloud size={16} />}>Microsoft 365 service health</CardTitle>} actions={<Tag tone={msLabel.tone}>{msLabel.label}</Tag>}>
          {ms.status === "NOT_CONFIGURED" ? (
            <p className="text-[13px]">Not configured — local analysis remains available. No tenant data is shown.</p>
          ) : (
            <dl className="ct-kv mb-3">
              <dt>Permission</dt>
              <dd>
                <Mono>{ms.permission}</Mono> (application, admin consent)
              </dd>
              <dt>Last successful sync</dt>
              <dd className="ct-mono">{ms.lastSyncAt ? formatUtc(ms.lastSyncAt) : "Never"}</dd>
              <dt>Last attempt</dt>
              <dd className="ct-mono">{ms.lastAttemptAt ? formatUtc(ms.lastAttemptAt) : "—"}</dd>
              <dt>Retrieved issues</dt>
              <dd>{ms.issueCount}</dd>
              {ms.lastErrorCode && (
                <>
                  <dt>Last error</dt>
                  <dd className="ct-mono text-red">{ms.lastErrorCode}</dd>
                </>
              )}
            </dl>
          )}
          {ms.problems.length > 0 && (
            <Banner tone="warning">
              <ul className="list-disc pl-4">
                {ms.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Banner>
          )}
          <div className="mt-3">
            <SyncButton disabledReason={syncDisabled} />
          </div>
          <details className="mt-4 text-[13px]" open={ms.status === "NOT_CONFIGURED"}>
            <summary className="cursor-pointer font-semibold">View setup</summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 leading-5">
              <li>Register an application in Microsoft Entra ID for your tenant.</li>
              <li>
                Add the Microsoft Graph <strong>application</strong> permission <Mono>ServiceHealth.Read.All</Mono> and grant admin consent. No other permission is needed.
              </li>
              <li>Create a client secret and store it only in the server environment — never in the browser.</li>
              <li>
                Set <Mono>MS_TENANT_ID</Mono>, <Mono>MS_CLIENT_ID</Mono>, <Mono>MS_CLIENT_SECRET</Mono> and <Mono>MS_CONNECTOR_ORGANIZATION_SLUG</Mono> (this workspace:{" "}
                <Mono>{ctx.organizationSlug}</Mono>) in <Mono>.env</Mono>, then restart the server.
              </li>
              <li>A workspace owner runs <strong>Sync now</strong>. Only service-health issues and overviews are read.</li>
            </ol>
            <p className="ct-support mt-2">
              Least privilege: the connector reads tenant service-health records only. A tenant notice proves the tenant was notified — not that dependent assets failed.
            </p>
          </details>
        </Panel>

        <Panel
          title={<CardTitle icon={<Bot size={16} />}>Claude analysis</CardTitle>}
          actions={<Tag tone={status.ai.status === "CONNECTED" ? "success" : "neutral"}>{status.ai.status === "CONNECTED" ? "Connected" : "Not configured"}</Tag>}
        >
          {status.ai.status === "CONNECTED" ? (
            <p className="text-[13px]">
              Server-side analysis with model <Mono>{status.ai.model}</Mono>. Evidence abstracts for the selected incident only; claims must cite evidence IDs. Failures fall back to
              rule-based analysis.
            </p>
          ) : (
            <p className="text-[13px]">
              Rule-based analysis available without an API key. To enable Claude, set <Mono>ANTHROPIC_API_KEY</Mono> (and optionally <Mono>CLAUDE_MODEL</Mono>) in the server
              environment. Keys are never entered in or sent to the browser.
            </p>
          )}
          {status.ai.problem && status.ai.status !== "CONNECTED" && <p className="ct-support mt-2">{status.ai.problem}</p>}
        </Panel>

        <Panel title={<CardTitle icon={<Shield size={16} />}>Planned integrations</CardTitle>} actions={<Tag>Planned · not connected</Tag>}>
          <ul className="flex flex-col gap-2.5 text-[13px]">
            {["Microsoft Sentinel incidents", "Microsoft Entra sign-in logs", "Azure Monitor", "AWS CloudWatch / CloudTrail"].map((name) => (
              <li key={name} className="flex items-center justify-between gap-2">
                <span>{name}</span>
                <Tag>Planned · not connected</Tag>
              </li>
            ))}
          </ul>
          <p className="ct-support mt-3">Roadmap only. No data is collected from these sources.</p>
        </Panel>
      </div>

      {ms.assignedToThisWorkspace && (
        <Panel className="mt-4" flush title="Tenant service-health issues" description="Retrieved read-only from Microsoft Graph. Attach an issue to a case as customer-observed evidence.">
          <IssueAttach issues={issues} incidents={incidents} canEdit={can(ctx, "ANALYST")} />
        </Panel>
      )}
    </div>
  );
}
