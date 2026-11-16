import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "lucide-react";
import { ActivityChart } from "@/components/charts/ActivityChart";
import { CreateIncidentButton } from "@/components/incidents/CreateIncident";
import { IncidentTable } from "@/components/incidents/IncidentTable";
import { Banner, EmptyState, MetricCard, Mono, PageHeader, Panel, Tag } from "@/components/ui/primitives";
import { can, requirePageContext } from "@/lib/auth/context";
import { formatUtc, formatUtcDate } from "@/lib/domain/time";
import { firstParam, type SearchParams } from "@/lib/page";
import { listAssets } from "@/lib/services/assets";
import { listMembers } from "@/lib/services/incidents";
import { getIntegrationStatus } from "@/lib/services/integrations";
import { getOverview, listAudit } from "@/lib/services/workspace";
import { CONNECTION_STATUS_LABELS } from "@/lib/ui/labels";

export const metadata: Metadata = { title: "Command overview" };

const RANGES = [7, 14, 30];

function QualityRow({ label, value, total, explanation }: { label: string; value: number; total: number; explanation: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
        <span className="text-fg">{label}</span>
        <span className="ct-mono text-fg-2">
          {value}/{total} · {pct}%
        </span>
      </div>
      <div className="ct-meter mt-1.5" role="img" aria-label={`${label}: ${value} of ${total} (${pct}%)`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="ct-support mt-1">{explanation}</p>
    </div>
  );
}

export default async function OverviewPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const params = await searchParams;
  const range = RANGES.includes(Number(firstParam(params.range))) ? Number(firstParam(params.range)) : 14;
  const isAnalyst = can(ctx, "ANALYST");
  const [overview, integrations, audit, members, assets] = await Promise.all([
    getOverview(ctx, range),
    getIntegrationStatus(ctx),
    isAnalyst ? listAudit(ctx, { pageSize: 10 }) : Promise.resolve(null),
    isAnalyst ? listMembers(ctx) : Promise.resolve([]),
    isAnalyst ? listAssets(ctx) : Promise.resolve([]),
  ]);
  const { counts, quality, activity } = overview;

  return (
    <div className="ct-page">
      <PageHeader
        eyebrow="Operations / workspace"
        title="Command overview"
        subtitle="Security and service incidents across your workspace."
        chips={
          <>
            <Tag tone={integrations.microsoft.status === "CONNECTED" ? "success" : "warning"}>
              {integrations.microsoft.status === "CONNECTED" ? "Tenant service health + local data" : "Demo · local data"}
            </Tag>
            <Tag>{ctx.organizationName}</Tag>
          </>
        }
        actions={
          isAnalyst ? (
            <CreateIncidentButton
              members={members.map((m) => ({ userId: m.userId, name: m.name, role: m.role }))}
              assets={assets.map((a) => ({ id: a.id, name: a.name, provider: a.provider }))}
              currentUserId={ctx.userId}
            />
          ) : undefined
        }
      />

      {overview.hasDemoData && (
        <div className="mb-5">
          <Banner icon={<Info size={14} />}>
            This workspace contains public historical reports and simulated organisation telemetry. No live Microsoft tenant is
            connected — this is not a live Microsoft investigation.
          </Banner>
        </div>
      )}

      <div className="ct-metrics">
        <MetricCard label="Open incidents" value={counts.open} caption={`Not resolved · ${counts.total} cases in total`} href="/incidents?status=OPEN&status=INVESTIGATING&status=MONITORING" />
        <MetricCard label="Investigating" value={counts.investigating} caption="Cases in Investigating status" href="/incidents?status=INVESTIGATING" />
        <MetricCard
          label="Confirmed affected assets"
          value={counts.confirmedAffected}
          caption="Direct evidence of failure in open cases (latest observations)"
          href="/assets"
        />
        <MetricCard label="At-risk dependencies" value={counts.atRisk} caption="Dependency path only — not confirmed down" href="/assets" />
      </div>

      <div className="ct-analysis-grid mb-4">
        <Panel
          id="activity"
          title="Incident activity"
          description={
            activity.hasData
              ? `Recorded timeline events per UTC day · ${range} days ending ${formatUtcDate(activity.end)} (latest recorded event)`
              : "No observations available for this time range."
          }
          actions={
            <div className="ct-segmented" role="group" aria-label="Time range">
              {RANGES.map((r) => (
                <Link prefetch={false} key={r} href={`/overview?range=${r}`} aria-current={r === range ? "true" : undefined} aria-label={`Show ${r} days`} className="px-2.5 py-1.5 text-[12px] font-semibold text-fg-2 no-underline aria-[current=true]:bg-selected aria-[current=true]:text-fg" scroll={false}>
                  {r}d
                </Link>
              ))}
            </div>
          }
        >
          {activity.hasData ? (
            <ActivityChart data={activity.days} label={`Events per UTC day, ${range} days`} />
          ) : (
            <EmptyState title="No observations available for this time range.">Import or add evidence to see recorded activity.</EmptyState>
          )}
        </Panel>

        <Panel id="quality" title="Evidence quality" description="Deterministic coverage checks across all evidence in this workspace.">
          {quality ? (
            <div className="flex flex-col gap-4">
              <QualityRow label="Traceable to a source" value={quality.traceable} total={quality.total} explanation="Has a source URL or upstream source event ID." />
              <QualityRow label="Linked to an asset" value={quality.assetLinked} total={quality.total} explanation="Can inform dependency impact." />
              <QualityRow label="Not simulated" value={quality.nonSimulated} total={quality.total} explanation="Public reports, customer observations or analyst notes." />
              <QualityRow
                label="Customer observed"
                value={quality.customerObserved}
                total={quality.total}
                explanation="From the organisation's own authorised systems."
              />
              <QualityRow
                label="Cases with evidence"
                value={quality.incidentsWithEvidence}
                total={quality.incidentCount}
                explanation="Cases without evidence cannot produce reports."
              />
            </div>
          ) : (
            <EmptyState title="Not computable">No evidence is recorded yet, so evidence quality is withheld rather than estimated.</EmptyState>
          )}
        </Panel>
      </div>

      <Panel
        id="priority"
        className="mb-4"
        title="Priority incidents"
        description="Open cases first, then by severity and last update."
        actions={
          <Link prefetch={false} href="/incidents" className="text-[12.5px]">
            View all incidents
          </Link>
        }
        flush
      >
        {overview.priority.length ? (
          <IncidentTable rows={overview.priority} caption="Priority incidents" />
        ) : (
          <EmptyState title="No incidents recorded.">Create a case to start an investigation.</EmptyState>
        )}
      </Panel>

      <div className="ct-two-columns">
        <Panel id="audit" title="Recent audit activity" actions={isAnalyst ? <Link prefetch={false} href="/activity" className="text-[12.5px]">Open audit log</Link> : undefined}>
          {!audit ? (
            <p className="ct-support">The audit log is available to analysts and owners. Your role allows viewing, not editing.</p>
          ) : audit.items.length === 0 ? (
            <p className="ct-support">No audit entries yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {audit.items.slice(0, 5).map((a) => (
                <li key={a.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="text-[13px] text-fg">{a.summary}</div>
                  <div className="mt-0.5 text-[12px] text-fg-2">
                    <Mono>{formatUtc(a.createdAt)}</Mono> · {a.actorLabel} · <Mono>{a.action}</Mono>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel id="connections" title="Current connections" actions={<Link prefetch={false} href="/integrations" className="text-[12.5px]">Manage integrations</Link>}>
          <ul className="flex flex-col gap-3 text-[13px]">
            <li className="flex items-center justify-between gap-3">
              <span>Local investigation engine</span>
              <Tag tone="success">Active · local</Tag>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span>Microsoft 365 service health</span>
              <Tag tone={CONNECTION_STATUS_LABELS[integrations.microsoft.status].tone}>{CONNECTION_STATUS_LABELS[integrations.microsoft.status].label}</Tag>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span>Claude analysis</span>
              <Tag tone={integrations.ai.status === "CONNECTED" ? "success" : "neutral"}>
                {integrations.ai.status === "CONNECTED" ? "Connected" : "Not configured"}
              </Tag>
            </li>
          </ul>
          {integrations.microsoft.status === "NOT_CONFIGURED" && (
            <p className="ct-support mt-3">Not configured — local analysis remains available.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
