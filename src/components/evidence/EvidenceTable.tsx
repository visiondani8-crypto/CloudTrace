"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ConfidenceBadge, Mono, ProvenanceBadge } from "@/components/ui/primitives";
import { formatUtc } from "@/lib/domain/time";
import type { EvidenceRow } from "@/lib/services/evidence";
import { useEvidenceHref } from "./EvidenceInspector";

/** Evidence list with keyboard-accessible row links; selecting a row opens the inspector. */
export function EvidenceTable({ rows, showCase }: { rows: EvidenceRow[]; showCase?: boolean }) {
  const router = useRouter();
  const href = useEvidenceHref();
  const selected = useSearchParams().get("evidence");
  return (
    <>
      <div className="ct-table-wrap hidden md:block">
        <table className="ct-table">
          <caption className="ct-sr-only">Evidence records</caption>
          <thead>
            <tr>
              <th scope="col">Evidence ID</th>
              <th scope="col">Title</th>
              {showCase && <th scope="col">Case</th>}
              <th scope="col">Observed (UTC)</th>
              <th scope="col">Ingested (UTC)</th>
              <th scope="col">Source</th>
              <th scope="col">Provenance</th>
              <th scope="col">Asset</th>
              <th scope="col">SHA-256</th>
              <th scope="col" data-numeric="true">
                Notes
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} data-clickable="true" data-selected={selected === e.id} onClick={() => router.replace(href(e.id), { scroll: false })}>
                <td>
                  <Link prefetch={false} href={href(e.id)} scroll={false} replace className="ct-mono whitespace-nowrap text-[12.5px]" onClick={(ev) => ev.stopPropagation()} aria-label={`Inspect evidence ${e.ref}`}>
                    {e.ref}
                  </Link>
                </td>
                <td className="min-w-[220px] max-w-[360px]">
                  <span className="line-clamp-2">{e.title}</span>
                </td>
                {showCase && (
                  <td>
                    <Mono className="whitespace-nowrap text-[12px]">{e.caseNumber}</Mono>
                  </td>
                )}
                <td>
                  <Mono className="whitespace-nowrap text-[12px]">{formatUtc(e.observedAt)}</Mono>
                </td>
                <td>
                  <Mono className="whitespace-nowrap text-[12px] text-fg-2">{formatUtc(e.ingestedAt)}</Mono>
                </td>
                <td className="max-w-[200px] text-fg-2">
                  <span className="line-clamp-2 text-[12.5px]">{e.sourceName}</span>
                </td>
                <td>
                  <div className="flex flex-col items-start gap-1">
                    <ProvenanceBadge value={e.provenance} />
                    <ConfidenceBadge value={e.confidenceLevel} />
                  </div>
                </td>
                <td className="text-fg-2">{e.assetName ?? "—"}</td>
                <td>
                  <Mono className="text-[12px] text-fg-2" title={e.sha256}>
                    {e.sha256.slice(0, 10)}…
                  </Mono>
                </td>
                <td data-numeric="true">{e.annotationCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line md:hidden">
        {rows.map((e) => (
          <li key={e.id} className="px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <Link prefetch={false} href={href(e.id)} scroll={false} replace className="ct-mono text-[12.5px]">
                {e.ref}
              </Link>
              <Mono className="text-[11.5px] text-fg-2">{formatUtc(e.observedAt)}</Mono>
            </div>
            <p className="mt-1 text-[13px] leading-5">{e.title}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <ProvenanceBadge value={e.provenance} />
              {showCase && <Mono className="text-[11.5px] text-fg-2">{e.caseNumber}</Mono>}
            </div>
            <p className="mt-1.5 text-[11.5px] text-fg-2">
              {e.sourceName} · <Mono title={e.sha256}>{e.sha256.slice(0, 10)}…</Mono>
            </p>
            <Link prefetch={false} href={href(e.id)} scroll={false} replace className="ct-btn mt-2" data-size="sm">
              Inspect evidence
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
