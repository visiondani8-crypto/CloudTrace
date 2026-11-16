import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ActivityChart, type ActivityPoint } from "@/components/charts/ActivityChart";
import { EvidenceChip } from "@/components/evidence/EvidenceInspector";
import {
  ClassificationBadge,
  EmptyState,
  HypothesisConfidenceBadge,
  HypothesisStatusBadge,
  ImpactBadge,
  MetricCard,
  Mono,
  Panel,
  ProvenanceBadge,
  SectionLabel,
  Tag,
  TaskStatusBadge,
} from "@/components/ui/primitives";
import type { IncidentImpact } from "@/lib/investigation/load";
import { formatUtc, formatUtcDate } from "@/lib/domain/time";
import type { AnalysisView } from "@/lib/services/analysis";
import type { HypothesisView, TaskView, TimelineItem } from "@/lib/services/investigation";
import { ANALYSIS_MODE_LABELS, CLASSIFICATION_LABELS, labelOf } from "@/lib/ui/labels";
import { AnalyzeButton } from "./CaseControls";
import { NotesPanel } from "./NotesPanel";

function bucketActivity(items: TimelineItem[]): { data: ActivityPoint[]; label: string } {
  if (items.length === 0) return { data: [], label: "" };
  const times = items.map((t) => new Date(t.occurredAt).getTime());
  const start = Math.min(...times);
  const end = Math.max(...times);
  const hourly = end - start <= 48 * 3600_000;
  const step = hourly ? 3600_000 : 86_400_000;
  const floor = (t: number) => Math.floor(t / step) * step;
  const keyOf = (t: number) => {
    const iso = new Date(t).toISOString();
    return hourly ? `${iso.slice(0, 10)} ${iso.slice(11, 13)}:00` : iso.slice(0, 10);
  };
  const buckets = new Map<number, ActivityPoint>();
  for (let t = floor(start); t <= floor(end); t += step) {
    buckets.set(t, { day: keyOf(t), PUBLIC_REPORTED: 0, CUSTOMER_OBSERVED: 0, SYNTHETIC: 0, ANALYST_NOTE: 0 });
  }
  for (const item of items) {
    const b = buckets.get(floor(new Date(item.occurredAt).getTime()));
    const k = item.sourceClass as keyof ActivityPoint;
    if (b && k !== "day" && k in b) (b[k] as number)++;
  }
  return {
    data: [...buckets.values()],
    label: `Recorded case events per ${hourly ? "hour" : "day"} (UTC), ${formatUtc(new Date(start))} – ${formatUtc(new Date(end))}`,
  };
}

export function OverviewTab({
  incidentId,
  classification,
  evidenceCount,
  timeline,
  impact,
  assetNames,
  hypotheses,
  tasks,
  notes,
  analysis,
  sources,
  canEdit,
  aiConfigured,
  basePath,
}: {
  incidentId: string;
  classification: string;
  evidenceCount: number;
  timeline: TimelineItem[];
  impact: IncidentImpact;
  assetNames: Record<string, string>;
  hypotheses: HypothesisView[];
  tasks: TaskView[];
  notes: { id: string; text: string; authorName: string; createdAt: string }[];
  analysis: AnalysisView | null;
  sources: { id: string; title: string; url: string; publisher: string | null; retrievedAt: Date; status: string; note: string | null }[];
  canEdit: boolean;
  aiConfigured: boolean;
  basePath: string;
}) {
  const impacts = Object.values(impact.result.impacts);
  const confirmed = impacts.filter((i) => i.state === "CONFIRMED_AFFECTED" && !i.providerReported);
  const providerReported = impacts.filter((i) => i.providerReported);
  const atRisk = impacts.filter((i) => i.state === "POTENTIALLY_AFFECTED");
  const correlated = timeline.filter((t) => t.related.length > 0).length;
  const activity = bucketActivity(timeline);
  const leading = hypotheses.find((h) => h.status !== "REJECTED");
  const hypothesisEvidence = new Set(hypotheses.flatMap((h) => [...h.supporting, ...h.contradicting].map((e) => e.id)));
  const openTasks = tasks.filter((t) => t.status === "OPEN" || t.status === "IN_PROGRESS");
  const latestEvents = timeline.slice(-6);
  const href = `${basePath}/${incidentId}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="ct-metrics mb-0">
        <MetricCard label="Linked evidence" value={evidenceCount} caption="Evidence records in this case" href={`${href}?tab=evidence`} />
        <MetricCard label="Correlated events" value={correlated} caption="Same asset ±15 min or same source event — related, not causal" href={`${href}?tab=timeline`} />
        <MetricCard
          label="Confirmed affected"
          value={confirmed.length}
          caption={providerReported.length ? `Direct evidence · +${providerReported.length} provider-reported` : "Direct evidence of failure"}
          href={`${href}?tab=dependency`}
        />
        <MetricCard label="Potentially at risk" value={atRisk.length} caption="At risk — dependency path" href={`${href}?tab=dependency`} />
      </div>

      <div className="ct-analysis-grid">
        <Panel id="signal" title="Signal activity" description={timeline.length ? "Derived from recorded case events only — no continuous telemetry is implied." : undefined}>
          {timeline.length ? (
            <ActivityChart data={activity.data} label={activity.label} height={220} />
          ) : (
            <EmptyState title="No observations available for this time range.">Add or import evidence to build the timeline.</EmptyState>
          )}
        </Panel>

        <Panel
          id="assessment"
          title="Investigation assessment"
          actions={analysis ? <Tag>{labelOf(ANALYSIS_MODE_LABELS, analysis.mode).label}</Tag> : undefined}
        >
          <div className="flex flex-col gap-4">
            <div>
              <SectionLabel>Classification</SectionLabel>
              <ClassificationBadge value={classification} />
              {analysis?.classificationSuggestion && analysis.classificationSuggestion !== classification && (
                <p className="ct-support mt-1.5">
                  Analysis suggests: {labelOf(CLASSIFICATION_LABELS, analysis.classificationSuggestion).label} (not applied — analyst decides).
                </p>
              )}
            </div>
            <div>
              <SectionLabel>Leading hypothesis</SectionLabel>
              {leading ? (
                <div>
                  <p className="text-[13px] font-medium leading-5">{leading.title}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <HypothesisStatusBadge value={leading.status} />
                    <HypothesisConfidenceBadge value={leading.confidence} />
                    {leading.status !== "SUPPORTED" && <Tag tone="warning">Hypothesis — not verified</Tag>}
                  </div>
                  {leading.note && <p className="ct-support mt-1.5">{leading.note}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <span className="text-[11.5px] text-fg-2">Supporting:</span>
                    {leading.supporting.length ? leading.supporting.map((e) => <EvidenceChip key={e.id} id={e.id} label={e.ref} title={e.title} />) : <span className="text-[11.5px] text-fg-2">none</span>}
                    {leading.contradicting.length > 0 && (
                      <>
                        <span className="ml-2 text-[11.5px] text-fg-2">Contradicting:</span>
                        {leading.contradicting.map((e) => (
                          <EvidenceChip key={e.id} id={e.id} label={e.ref} title={e.title} />
                        ))}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <p className="ct-support">No hypotheses recorded. Add one with supporting evidence.</p>
              )}
            </div>
            <div>
              <SectionLabel>Evidence coverage</SectionLabel>
              <p className="text-[12.5px]">
                {hypothesisEvidence.size} of {evidenceCount} evidence items are cited by a hypothesis.
              </p>
            </div>
            <div>
              <SectionLabel>Analysis</SectionLabel>
              {analysis ? (
                <>
                  <p className="text-[12.5px] text-fg-2">
                    {analysis.mode === "CLAUDE" ? `Claude analysis${analysis.modelId ? ` (${analysis.modelId})` : ""}` : "Rule-based analysis"} ·{" "}
                    <Mono>{formatUtc(analysis.generatedAt)}</Mono>
                    {analysis.errorStatus && <> · Claude unavailable ({analysis.errorStatus}), fallback used</>}
                  </p>
                  <p className="mt-2 text-[13px] leading-5">{analysis.summary}</p>
                </>
              ) : (
                <p className="ct-support">No analysis has been run for this incident.</p>
              )}
              {canEdit && (
                <div className="mt-3">
                  <AnalyzeButton incidentId={incidentId} aiConfigured={aiConfigured} />
                </div>
              )}
            </div>
          </div>
        </Panel>
      </div>

      {analysis && (
        <Panel id="analysis-detail" title="Analysis detail" description="Facts cite evidence; unknowns stay explicit. Nothing here is a verified root cause.">
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <SectionLabel>Evidence-linked facts</SectionLabel>
              {analysis.facts.length === 0 && <p className="ct-support">No facts produced.</p>}
              <ul className="flex flex-col gap-2">
                {analysis.facts.map((f, i) => (
                  <li key={i} className="text-[12.5px] leading-[19px]">
                    {f.statement}{" "}
                    <span className="inline-flex flex-wrap gap-1 align-middle">
                      {f.evidenceIds.map((id) => (
                        <EvidenceChip key={id} id={id} label={timeline.find((t) => t.evidenceId === id)?.evidenceRef ?? "evidence"} />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <SectionLabel>Unknowns</SectionLabel>
                <ul className="list-disc pl-4 text-[12.5px] leading-[19px]">
                  {analysis.unknowns.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              </div>
              <div>
                <SectionLabel>Recommended follow-ups (advisory — nothing executes)</SectionLabel>
                <ul className="list-disc pl-4 text-[12.5px] leading-[19px]">
                  {analysis.recommendedActions.map((a, i) => (
                    <li key={i}>{a.description}</li>
                  ))}
                </ul>
              </div>
              <div>
                <SectionLabel>Limitations</SectionLabel>
                <ul className="list-disc pl-4 text-[12px] leading-[18px] text-fg-2">
                  {analysis.limitations.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </Panel>
      )}

      <div className="ct-analysis-grid">
        <Panel id="latest-timeline" title="Latest timeline entries" actions={<Link prefetch={false} href={`${href}?tab=timeline`} className="text-[12.5px]">Open timeline</Link>}>
          {latestEvents.length === 0 ? (
            <p className="ct-support">No events recorded.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {latestEvents.map((t) => (
                <li key={t.id} className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 py-2.5 first:pt-0 max-sm:grid-cols-1">
                  <Mono className="text-[12px] text-fg-2">{formatUtc(t.occurredAt)}</Mono>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium">{t.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <ProvenanceBadge value={t.sourceClass} />
                      {t.evidenceId ? <EvidenceChip id={t.evidenceId} label={t.evidenceRef!} /> : <Tag>Analyst-entered / unverified</Tag>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel id="impact-mini" title="Dependency impact" description={impact.asOf ? `Incident impact as of ${formatUtc(impact.asOf)}` : undefined} actions={<Link prefetch={false} href={`${href}?tab=dependency`} className="text-[12.5px]">Inspect full map</Link>}>
          {impacts.filter((i) => i.state !== "UNKNOWN").length === 0 ? (
            <p className="ct-support">No assets are affected or at risk based on recorded evidence.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {impacts
                .filter((i) => i.state !== "UNKNOWN")
                .sort((a, b) => a.state.localeCompare(b.state))
                .map((i) => (
                  <li key={i.assetId} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="min-w-0 truncate">{assetNames[i.assetId]}</span>
                    <ImpactBadge state={i.state} providerReported={i.providerReported} />
                  </li>
                ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="ct-two-columns">
        <NotesPanel incidentId={incidentId} notes={notes} canEdit={canEdit} />
        <div className="flex flex-col gap-4">
          <Panel id="open-tasks" title="Open issues / tasks" actions={<Link prefetch={false} href={`${href}?tab=tasks`} className="text-[12.5px]">All tasks</Link>}>
            {openTasks.length === 0 ? (
              <p className="ct-support">No open response tasks.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {openTasks.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-2 text-[13px]">
                    <span>{t.title}</span>
                    <TaskStatusBadge value={t.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {sources.length > 0 && (
            <Panel id="sources" title="Sources" description="External references are linked, not copied. Opened only by explicit click.">
              <ul className="flex flex-col gap-3">
                {sources.map((s) => (
                  <li key={s.id} className="text-[12.5px] leading-[18px]">
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1">
                      {s.title} <ExternalLink size={12} className="mt-1 flex-none" aria-hidden="true" />
                    </a>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-fg-2">
                      <Tag tone={s.status === "PRELIMINARY" ? "warning" : "neutral"}>{s.status.replace("_", " ")}</Tag>
                      <span>
                        {s.publisher} · retrieved {formatUtcDate(s.retrievedAt)}
                      </span>
                    </div>
                    {s.note && <p className="ct-support mt-1">{s.note}</p>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
