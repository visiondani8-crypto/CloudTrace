import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { EvidenceInspectorHost } from "@/components/evidence/EvidenceInspector";
import { ReportActions } from "@/components/reports/ReportActions";
import { ReportDocument } from "@/components/reports/ReportDocument";
import { Banner, ClassificationBadge, DataModeBadge, EmptyState, LifecycleBadge, Mono, PageHeader, Panel, ReadOnlyNotice, SeverityBadge, Tag } from "@/components/ui/primitives";
import { can, type AuthContext } from "@/lib/auth/context";
import { formatUtc, formatUtcRange } from "@/lib/domain/time";
import { reportSummaryText } from "@/lib/reports/build";
import { latestAnalysis } from "@/lib/services/analysis";
import { computeIncidentImpact, listAssets, listDependencies } from "@/lib/services/assets";
import { listImportJobs, listIncidentEvidence } from "@/lib/services/evidence";
import { getIncident, listMembers } from "@/lib/services/incidents";
import { getAiConfigPublic } from "@/lib/services/public-config";
import { getTimeline, listHypotheses, listNotes, listTasks } from "@/lib/services/investigation";
import { getReport, listReports } from "@/lib/services/reports";
import { TYPE_EYEBROW, TYPE_LABELS, textOf } from "@/lib/ui/labels";
import { AnalyzeButton, CaseMenu, GenerateReportButton, RememberCase, StatusControl, WorkspaceTabs, type WorkspaceTab } from "./CaseControls";
import { DependencyTab } from "./DependencyTab";
import { EvidenceTab } from "./EvidenceTab";
import { HypothesesTab } from "./HypothesesTab";
import { OverviewTab } from "./OverviewTab";
import { TasksTab } from "./TasksTab";
import { TimelineTab } from "./TimelineTab";

function dataModeSentence(label: string | null): string {
  if (!label) return "Organisation records";
  if (/PUBLIC/.test(label) && /SIMULATED/.test(label)) return "Public reports + simulated customer telemetry";
  if (/SECURITY EXERCISE/.test(label)) return "Simulated security exercise";
  if (/SIMULATED/.test(label)) return "Simulated telemetry";
  return label;
}

const TABS: WorkspaceTab[] = ["overview", "timeline", "evidence", "dependency", "hypotheses", "tasks", "report"];

export async function IncidentWorkspace({
  ctx,
  incidentId,
  params,
  basePath,
}: {
  ctx: AuthContext;
  incidentId: string;
  params: Record<string, string | string[] | undefined>;
  basePath: "/investigations" | "/incidents";
}) {
  const tabParam = typeof params.tab === "string" ? params.tab : "overview";
  const tab: WorkspaceTab = (TABS as string[]).includes(tabParam) ? (tabParam as WorkspaceTab) : "overview";
  const canEdit = can(ctx, "ANALYST");
  const incident = await getIncident(ctx, incidentId);
  const [members, hypothesesAll, tasksAll, reportsAll, timelineAll] = await Promise.all([
    listMembers(ctx),
    listHypotheses(ctx, incidentId),
    listTasks(ctx, incidentId),
    listReports(ctx, { incidentId }),
    getTimeline(ctx, incidentId),
  ]);
  const ai = getAiConfigPublic();
  const isProviderCase = incident.type === "PROVIDER_OUTAGE";
  const hasSimulated = /SIMULATED|SYNTHETIC/.test(incident.dataLabel ?? "");
  const caseSummary = {
    id: incident.id,
    caseNumber: incident.caseNumber,
    title: incident.title,
    description: incident.description,
    type: incident.type,
    severity: incident.severity,
    status: incident.status,
    classification: incident.classification,
    ownerId: incident.ownerId,
    startedAt: incident.startedAt?.toISOString() ?? null,
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
  };
  const memberOptions = members.map((m) => ({ userId: m.userId, name: m.name, role: m.role }));

  return (
    <div className="ct-page">
      <RememberCase id={incident.id} />
      <EvidenceInspectorHost canEdit={canEdit} />
      <PageHeader
        crumbs={[
          { label: basePath === "/incidents" ? "Incidents" : "Investigation lab", href: basePath === "/incidents" ? "/incidents" : "/investigations" },
          { label: incident.caseNumber },
        ]}
        eyebrow={textOf(TYPE_EYEBROW, incident.type)}
        title={incident.title}
        subtitle={`${formatUtcRange(incident.startedAt, incident.resolvedAt)} · ${dataModeSentence(incident.dataLabel)}`}
        chips={
          <>
            <SeverityBadge value={incident.severity} />
            <LifecycleBadge value={incident.status} />
            <DataModeBadge label={incident.dataLabel} />
            <ClassificationBadge value={incident.classification} />
            <Tag>
              <Mono>{incident.caseNumber}</Mono>
            </Tag>
          </>
        }
        actions={
          <>
            {canEdit && <AnalyzeButton incidentId={incident.id} aiConfigured={ai.configured} />}
            {canEdit && <GenerateReportButton incidentId={incident.id} basePath={basePath} hasEvidence={incident.evidenceCount > 0} />}
            <CaseMenu incident={caseSummary} members={memberOptions} canEdit={canEdit} />
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        {isProviderCase && incident.isDemo && (
          <Banner icon={<ShieldAlert size={14} />}>
            Microsoft&apos;s incident is treated as a reported technical disruption; simulated company logs are labelled separately. Internal provider root
            cause is not independently verified.
          </Banner>
        )}
        {incident.classification === "SECURITY_SUSPECTED" && (
          <Banner tone="warning" icon={<ShieldAlert size={14} />}>
            Security suspected — not confirmed. Compromise requires analyst review of the evidence; automated analysis never confirms it.
          </Banner>
        )}
        {hasSimulated && !isProviderCase && <Banner tone="warning">Simulated company events. Not observed Microsoft tenant activity.</Banner>}
        {!canEdit && <ReadOnlyNotice />}
      </div>

      <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 rounded-[6px] border border-line bg-surface px-4 py-3 text-[12.5px] sm:grid-cols-3 xl:grid-cols-6">
        <div>
          <dt className="text-fg-2">Incident type</dt>
          <dd>{textOf(TYPE_LABELS, incident.type)}</dd>
        </div>
        <div>
          <dt className="text-fg-2">Owner</dt>
          <dd>{incident.ownerName ?? "Unassigned"}</dd>
        </div>
        <div>
          <dt className="text-fg-2">Last updated</dt>
          <dd className="ct-mono">{formatUtc(incident.updatedAt)}</dd>
        </div>
        <div>
          <dt className="text-fg-2">Evidence</dt>
          <dd>{incident.evidenceCount} records</dd>
        </div>
        <div>
          <dt className="text-fg-2">Source mode</dt>
          <dd>{incident.dataLabel ?? "Organisation records"}</dd>
        </div>
        <div>
          <dt className="text-fg-2">Status</dt>
          <dd className="mt-0.5">{canEdit ? <StatusControl incident={caseSummary} /> : <LifecycleBadge value={incident.status} />}</dd>
        </div>
      </dl>

      <WorkspaceTabs
        tab={tab}
        counts={{
          timeline: timelineAll.length,
          evidence: incident.evidenceCount,
          hypotheses: hypothesesAll.length,
          tasks: tasksAll.length,
          report: reportsAll.length,
        }}
      />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-5" tabIndex={-1}>
        {await renderTab()}
      </div>
    </div>
  );

  async function renderTab() {
    switch (tab) {
      case "overview": {
        const [impact, assets, notes, analysis] = await Promise.all([
          computeIncidentImpact(ctx, incidentId, "peak"),
          listAssets(ctx),
          listNotes(ctx, incidentId),
          latestAnalysis(ctx, incidentId),
        ]);
        return (
          <OverviewTab
            incidentId={incident.id}
            classification={incident.classification}
            evidenceCount={incident.evidenceCount}
            timeline={timelineAll}
            impact={impact}
            assetNames={Object.fromEntries(assets.map((a) => [a.id, a.name]))}
            hypotheses={hypothesesAll}
            tasks={tasksAll}
            notes={notes}
            analysis={analysis}
            sources={incident.sources}
            canEdit={canEdit}
            aiConfigured={ai.configured}
            basePath={basePath}
          />
        );
      }
      case "timeline": {
        const [impact, assets, evidence] = await Promise.all([computeIncidentImpact(ctx, incidentId, "latest"), listAssets(ctx), listIncidentEvidence(ctx, incidentId)]);
        const refOf = new Map(evidence.map((e) => [e.id, e.ref]));
        const names = new Map(assets.map((a) => [a.id, a.name]));
        const conflicts = Object.values(impact.result.impacts)
          .filter((i) => i.conflict)
          .map((i) => ({ assetName: names.get(i.assetId) ?? "asset", evidenceIds: i.evidence.map((r) => ({ id: r.evidenceId, ref: refOf.get(r.evidenceId) ?? "evidence" })) }));
        const relevant = new Set(timelineAll.map((t) => t.assetId).filter(Boolean));
        return (
          <TimelineTab
            incidentId={incident.id}
            caseNumber={incident.caseNumber}
            items={timelineAll}
            assets={assets.filter((a) => relevant.has(a.id) || incident.scopeAssets.some((s) => s.assetId === a.id)).map((a) => ({ id: a.id, name: a.name }))}
            conflicts={conflicts}
            canEdit={canEdit}
          />
        );
      }
      case "evidence": {
        const [rows, assets, imports] = await Promise.all([listIncidentEvidence(ctx, incidentId), listAssets(ctx), listImportJobs(ctx, incidentId)]);
        return (
          <EvidenceTab
            incident={{ id: incident.id, caseNumber: incident.caseNumber, title: incident.title }}
            rows={rows}
            assets={assets.map((a) => ({ id: a.id, name: a.name }))}
            imports={imports}
            canEdit={canEdit}
          />
        );
      }
      case "dependency": {
        const view = params.view === "latest" ? "latest" : "peak";
        const [impact, assets, deps, evidence] = await Promise.all([
          computeIncidentImpact(ctx, incidentId, view),
          listAssets(ctx),
          listDependencies(ctx),
          listIncidentEvidence(ctx, incidentId),
        ]);
        return (
          <DependencyTab
            incident={{ id: incident.id, caseNumber: incident.caseNumber }}
            assets={assets}
            dependencies={deps}
            impact={{ result: impact.result, asOf: impact.asOf, view }}
            evidence={evidence.map((e) => ({ id: e.id, ref: e.ref, title: e.title, provenance: e.provenance, observedAt: e.observedAt, assetId: e.assetId }))}
            canEdit={canEdit}
          />
        );
      }
      case "hypotheses": {
        const [evidence, analysis] = await Promise.all([listIncidentEvidence(ctx, incidentId), latestAnalysis(ctx, incidentId)]);
        return (
          <HypothesesTab
            incidentId={incident.id}
            hypotheses={hypothesesAll}
            evidence={evidence.map((e) => ({ id: e.id, ref: e.ref, title: e.title, provenance: e.provenance }))}
            suggestions={analysis?.hypotheses ?? []}
            suggestionMode={analysis?.mode ?? null}
            canEdit={canEdit}
          />
        );
      }
      case "tasks": {
        const evidence = await listIncidentEvidence(ctx, incidentId);
        return (
          <TasksTab
            incidentId={incident.id}
            tasks={tasksAll}
            members={memberOptions}
            evidence={evidence.map((e) => ({ id: e.id, ref: e.ref, title: e.title }))}
            canEdit={canEdit}
          />
        );
      }
      case "report": {
        const selectedId = typeof params.report === "string" ? params.report : reportsAll[0]?.id;
        const report = selectedId && reportsAll.some((r) => r.id === selectedId) ? await getReport(ctx, selectedId) : null;
        return (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <Panel
              title={report ? `Report v${report.version}` : "Report"}
              description={report ? `Immutable snapshot generated ${formatUtc(report.generatedAt)}` : undefined}
              actions={report ? <ReportActions reportId={report.id} summary={reportSummaryText(report.content)} compact /> : undefined}
            >
              {report ? (
                <ReportDocument content={report.content} sha256={report.sha256} />
              ) : (
                <EmptyState title="No report snapshots have been generated.">
                  {incident.evidenceCount === 0
                    ? "Add at least one evidence item before generating a report."
                    : canEdit
                      ? "Generate a versioned snapshot of the current investigation."
                      : "Analysts and owners can generate reports."}
                </EmptyState>
              )}
            </Panel>
            <div className="flex flex-col gap-4">
              <Panel title="Version history">
                {reportsAll.length === 0 ? (
                  <p className="ct-support">No versions yet.</p>
                ) : (
                  <ol className="flex flex-col gap-2">
                    {reportsAll.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                        <Link prefetch={false} href={`${basePath}/${incident.id}?tab=report&report=${r.id}`} scroll={false} aria-current={report?.id === r.id ? "true" : undefined} className="aria-[current=true]:font-semibold">
                          v{r.version} · {formatUtc(r.generatedAt)}
                        </Link>
                        <span className="text-[11.5px] text-fg-2">{r.generatedBy}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {canEdit && (
                  <div className="mt-4">
                    <GenerateReportButton
                      incidentId={incident.id}
                      basePath={basePath}
                      hasEvidence={incident.evidenceCount > 0}
                      label={reportsAll.length ? "Generate new version" : "Generate report"}
                      variant={reportsAll.length ? "secondary" : "primary"}
                    />
                    <p className="ct-support mt-2">A new version never alters earlier versions.</p>
                  </div>
                )}
              </Panel>
              {report && (
                <Panel title="Snapshot metadata">
                  <dl className="ct-kv">
                    <dt>Case</dt>
                    <dd className="ct-mono">{report.caseNumber}</dd>
                    <dt>Version</dt>
                    <dd>v{report.version}</dd>
                    <dt>Generated by</dt>
                    <dd>{report.content.generatedBy}</dd>
                    <dt>Generated (UTC)</dt>
                    <dd className="ct-mono">{formatUtc(report.generatedAt, { seconds: true })}</dd>
                    <dt>Snapshot SHA-256</dt>
                    <dd className="ct-mono break-all text-[11px]">{report.sha256}</dd>
                  </dl>
                  <Link prefetch={false} href={`/reports/${report.id}`} className="mt-3 inline-block text-[12.5px]">
                    View report
                  </Link>
                </Panel>
              )}
            </div>
          </div>
        );
      }
    }
  }
}
