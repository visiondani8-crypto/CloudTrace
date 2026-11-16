import type { ReportContent } from "@/lib/reports/build";
import { formatUtc, formatUtcDate } from "@/lib/domain/time";
import { HYPOTHESIS_CONFIDENCE_LABELS, HYPOTHESIS_STATUS_LABELS, PROVENANCE_LABELS, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, labelOf } from "@/lib/ui/labels";

function Refs({ refs }: { refs: string[] }) {
  if (!refs.length) return <span className="text-fg-2">none</span>;
  return <span className="ct-mono text-[12px]">{refs.join(", ")}</span>;
}

/** Immutable snapshot renderer. Content is rendered as text only (no HTML injection). */
export function ReportDocument({ content, sha256 }: { content: ReportContent; sha256?: string }) {
  const c = content;
  return (
    <article className="ct-report" aria-label={c.title}>
      <header>
        <div className="ct-eyebrow">Post-incident investigation report · version {c.version}</div>
        <h1 className="ct-title mt-1">{c.identification.title}</h1>
        <p className="ct-support mt-1">
          {c.organization} · generated {formatUtc(c.generatedAt, { seconds: true })} by {c.generatedBy}
        </p>
        {c.dataNotice.lines.length > 0 && (
          <div className="ct-banner mt-4" data-tone={c.dataNotice.containsSimulated ? "warning" : undefined}>
            <strong>Data limitations.</strong>
            <ul className="mt-1 list-disc pl-4">
              {c.dataNotice.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        )}
      </header>

      <h2>1. Incident identification</h2>
      <dl className="ct-kv">
        <dt>Case number</dt>
        <dd className="ct-mono">{c.identification.caseNumber}</dd>
        <dt>Period (UTC)</dt>
        <dd className="ct-mono">{c.identification.period}</dd>
        <dt>Severity</dt>
        <dd>{c.identification.severity}</dd>
        <dt>Status</dt>
        <dd>{c.identification.status}</dd>
        <dt>Type</dt>
        <dd>{c.identification.type}</dd>
        <dt>Case owner</dt>
        <dd>{c.identification.owner ?? "Unassigned"}</dd>
        <dt>Data mode</dt>
        <dd>{c.identification.dataLabel ?? "—"}</dd>
        <dt>Report author</dt>
        <dd>{c.generatedBy}</dd>
        <dt>Generated (UTC)</dt>
        <dd className="ct-mono">{formatUtc(c.generatedAt, { seconds: true })}</dd>
      </dl>

      <h2>2. Scope and affected systems</h2>
      <p>{c.scope.description}</p>
      {c.scope.assetsInScope.length > 0 && (
        <p className="mt-2">
          In scope: {c.scope.assetsInScope.map((a) => `${a.name} (${a.provider.replace("_", " ")}, ${a.criticality.toLowerCase()})`).join("; ")}.
        </p>
      )}

      <h2>3. Executive summary and classification</h2>
      <p>
        <strong>Classification:</strong> {c.executiveSummary.classification}. {c.executiveSummary.classificationNote}
      </p>
      <h3>Analyst conclusion ({c.executiveSummary.analysisMode})</h3>
      <p>{c.executiveSummary.analystConclusion}</p>
      {c.executiveSummary.analysisGeneratedAt && <p className="ct-support">Analysis generated {formatUtc(c.executiveSummary.analysisGeneratedAt)}.</p>}
      {c.executiveSummary.providerStatements.length > 0 && (
        <>
          <h3>Provider statements (public reports — not independently verified)</h3>
          <ul>
            {c.executiveSummary.providerStatements.map((p) => (
              <li key={p.ref}>
                <span className="ct-mono">{p.ref}</span> — {p.title} ({p.sourceName}
                {p.sourceUri ? (
                  <>
                    , <a href={p.sourceUri} target="_blank" rel="noopener noreferrer">source</a>
                  </>
                ) : null}
                )
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>4. What is known / what remains unverified</h2>
      <h3>Known (evidence-linked)</h3>
      {c.known.length === 0 ? (
        <p className="ct-support">No evidence-linked facts recorded.</p>
      ) : (
        <ul>
          {c.known.map((k, i) => (
            <li key={i}>
              {k.statement} <Refs refs={k.evidenceRefs} />
            </li>
          ))}
        </ul>
      )}
      <h3>Unverified / unknown</h3>
      {c.unverified.length === 0 ? <p className="ct-support">None recorded.</p> : <ul>{c.unverified.map((u, i) => <li key={i}>{u}</li>)}</ul>}

      <h2>5. Chronological evidence timeline</h2>
      <div className="ct-table-wrap rounded-[6px] border border-line">
        <table className="ct-table">
          <thead>
            <tr>
              <th scope="col">Time (UTC)</th>
              <th scope="col">Event</th>
              <th scope="col">Evidence</th>
              <th scope="col">Source / provenance</th>
            </tr>
          </thead>
          <tbody>
            {c.timeline.map((t) => (
              <tr key={t.eventId}>
                <td className="ct-mono whitespace-nowrap">{formatUtc(t.occurredAt)}</td>
                <td>
                  {t.title}
                  <div className="ct-mono text-[10.5px] text-fg-2">event {t.eventId}</div>
                </td>
                <td className="ct-mono whitespace-nowrap">{t.evidenceRef ?? "—"}</td>
                <td>
                  {t.provenance}
                  {t.sourceName ? ` · ${t.sourceName}` : ""}
                  <div className="text-[11px] text-fg-2">{t.verification}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>6. Dependency and blast-radius assessment</h2>
      <p className="ct-support">
        Assessed {c.impact.assessedAt ? `as of ${formatUtc(c.impact.assessedAt)} (latest failure observation)` : "over all observations"}. At-risk means a dependency path
        exists; it is not confirmation of failure.
      </p>
      <h3>Confirmed affected (direct evidence)</h3>
      {c.impact.confirmed.length === 0 ? <p className="ct-support">None.</p> : (
        <ul>
          {c.impact.confirmed.map((a) => (
            <li key={a.asset}>
              <strong>{a.asset}</strong> — {a.basis}; <Refs refs={a.evidenceRefs} />. {a.reason}
            </li>
          ))}
        </ul>
      )}
      {c.impact.providerReported.length > 0 && (
        <>
          <h3>Provider-reported impact</h3>
          <ul>
            {c.impact.providerReported.map((a) => (
              <li key={a.asset}>
                <strong>{a.asset}</strong> — <Refs refs={a.evidenceRefs} />. {a.reason}
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Potentially affected (at risk — dependency path only)</h3>
      {c.impact.atRisk.length === 0 ? <p className="ct-support">None.</p> : (
        <ul>
          {c.impact.atRisk.map((a) => (
            <li key={a.asset}>
              <strong>{a.asset}</strong> — path: {a.path.join(" → ")}
            </li>
          ))}
        </ul>
      )}
      {c.impact.healthy.length > 0 && (
        <>
          <h3>Confirmed healthy</h3>
          <ul>
            {c.impact.healthy.map((a) => (
              <li key={a.asset}>
                <strong>{a.asset}</strong> — <Refs refs={a.evidenceRefs} />. {a.reason}
              </li>
            ))}
          </ul>
        </>
      )}
      {c.impact.unknown.length > 0 && <p>Unknown (no sufficient observations): {c.impact.unknown.join(", ")}.</p>}
      {c.impact.cycles.length > 0 && <p>Dependency cycles noted: {c.impact.cycles.map((cy) => cy.join(" ↔ ")).join("; ")}.</p>}

      <h2>7. Hypotheses</h2>
      {c.hypotheses.length === 0 ? <p className="ct-support">No hypotheses recorded.</p> : (
        <ul>
          {c.hypotheses.map((h) => (
            <li key={h.title} className="mb-2">
              <strong>{h.title}</strong> — {labelOf(HYPOTHESIS_STATUS_LABELS, h.status).label}, {labelOf(HYPOTHESIS_CONFIDENCE_LABELS, h.confidence).label.toLowerCase()}.
              {h.description && <> {h.description}</>}
              <br />
              Supporting: <Refs refs={h.supportingRefs} />. Contradicting: <Refs refs={h.contradictingRefs} />.
              {h.note && <> Caveat: {h.note}</>} <span className="text-fg-2">({h.owner}, updated {formatUtc(h.updatedAt)})</span>
            </li>
          ))}
        </ul>
      )}

      <h2>8. Response actions</h2>
      <p>{c.responseActions.statement}</p>
      {c.responseActions.tasks.length > 0 && (
        <ul>
          {c.responseActions.tasks.map((t) => (
            <li key={t.title}>
              {t.title} — {labelOf(TASK_STATUS_LABELS, t.status).label}, {labelOf(TASK_PRIORITY_LABELS, t.priority).label.toLowerCase()} priority
              {t.assignee ? `, ${t.assignee}` : ""}
              {t.completedAt ? `, completed ${formatUtc(t.completedAt)}` : t.dueAt ? `, due ${formatUtc(t.dueAt)}` : ""}
            </li>
          ))}
        </ul>
      )}

      <h2>9. Lessons learned and resilience recommendations</h2>
      <ul>
        {c.recommendations.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      {c.analystNotes.length > 0 && (
        <>
          <h3>Analyst notes</h3>
          <ul>
            {c.analystNotes.map((n, i) => (
              <li key={i}>
                {n.text} <span className="text-fg-2">({n.author}, {formatUtc(n.createdAt)})</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>10. Data gaps, limitations and simulation disclaimer</h2>
      <ul>
        {[...c.dataNotice.lines, ...c.limitations].map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>

      <h2>11. References and evidence registry</h2>
      {c.references.sources.length > 0 && (
        <>
          <h3>External sources</h3>
          <ul>
            {c.references.sources.map((s) => (
              <li key={s.url}>
                {s.title} — <a href={s.url} target="_blank" rel="noopener noreferrer" className="break-all">{s.url}</a> ({s.status.replace("_", " ").toLowerCase()}, retrieved{" "}
                {formatUtcDate(s.retrievedAt)})
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Evidence registry</h3>
      <div className="ct-table-wrap rounded-[6px] border border-line">
        <table className="ct-table">
          <thead>
            <tr>
              <th scope="col">Ref</th>
              <th scope="col">Title / source</th>
              <th scope="col">Provenance</th>
              <th scope="col">Observed / ingested (UTC)</th>
              <th scope="col">SHA-256</th>
            </tr>
          </thead>
          <tbody>
            {c.references.evidence.map((e) => (
              <tr key={e.id}>
                <td className="ct-mono whitespace-nowrap">{e.ref}</td>
                <td>
                  {e.title}
                  <div className="text-[11px] text-fg-2">
                    {e.sourceName}
                    {e.sourceEventId ? ` · ${e.sourceEventId}` : ""}
                    {e.sourceUri ? ` · ${e.sourceUri}` : ""}
                  </div>
                </td>
                <td>{labelOf(PROVENANCE_LABELS, e.provenance).label}</td>
                <td className="ct-mono whitespace-nowrap text-[11px]">
                  {formatUtc(e.observedAt)}
                  <br />
                  {formatUtc(e.ingestedAt)}
                </td>
                <td className="ct-mono break-all text-[10.5px]">{e.sha256}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sha256 && (
        <p className="ct-support mt-4">
          Snapshot SHA-256: <span className="ct-mono break-all">{sha256}</span>. This version is immutable; later case changes produce a new version.
        </p>
      )}
    </article>
  );
}
