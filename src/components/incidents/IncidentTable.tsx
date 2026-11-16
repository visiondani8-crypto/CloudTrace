import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DataModeBadge, LifecycleBadge, Mono, SeverityBadge } from "@/components/ui/primitives";
import { formatUtc } from "@/lib/domain/time";
import { TYPE_LABELS, textOf } from "@/lib/ui/labels";

export interface IncidentRow {
  id: string;
  caseNumber: string;
  title: string;
  type: string;
  severity: string;
  status: string;
  updatedAt: string;
  ownerName: string | null;
  evidenceCount: number;
  dataLabel: string | null;
}

/** Desktop table plus accessible mobile cards; every row opens the actual case. */
export function IncidentTable({ rows, caption }: { rows: IncidentRow[]; caption: string }) {
  return (
    <>
      <div className="ct-table-wrap hidden md:block">
        <table className="ct-table">
          <caption className="ct-sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Case ID</th>
              <th scope="col">Title</th>
              <th scope="col">Type</th>
              <th scope="col">Severity</th>
              <th scope="col">Status</th>
              <th scope="col">Owner</th>
              <th scope="col">Updated (UTC)</th>
              <th scope="col" data-numeric="true">
                Evidence
              </th>
              <th scope="col">
                <span className="ct-sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Mono className="whitespace-nowrap text-[12.5px]">{r.caseNumber}</Mono>
                </td>
                <td className="min-w-[240px] max-w-[420px]">
                  <Link prefetch={false} href={`/investigations/${r.id}`} className="line-clamp-2 font-medium text-fg no-underline hover:underline">
                    {r.title}
                  </Link>
                  {r.dataLabel && (
                    <div className="mt-1">
                      <DataModeBadge label={r.dataLabel} />
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap text-fg-2">{textOf(TYPE_LABELS, r.type)}</td>
                <td>
                  <SeverityBadge value={r.severity} />
                </td>
                <td>
                  <LifecycleBadge value={r.status} />
                </td>
                <td className="whitespace-nowrap text-fg-2">{r.ownerName ?? "Unassigned"}</td>
                <td>
                  <Mono className="whitespace-nowrap text-[12px] text-fg-2">{formatUtc(r.updatedAt)}</Mono>
                </td>
                <td data-numeric="true">{r.evidenceCount}</td>
                <td>
                  <Link prefetch={false} href={`/investigations/${r.id}`} className="ct-btn" data-size="sm" data-variant="ghost" aria-label={`Open investigation ${r.caseNumber}`}>
                    Open <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line md:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <Mono className="text-[12px] text-fg-2">{r.caseNumber}</Mono>
              <Mono className="text-[11.5px] text-fg-2">{formatUtc(r.updatedAt)}</Mono>
            </div>
            <Link prefetch={false} href={`/investigations/${r.id}`} className="mt-1 block text-[13.5px] font-medium leading-5 text-fg no-underline">
              {r.title}
            </Link>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <SeverityBadge value={r.severity} />
              <LifecycleBadge value={r.status} />
              <DataModeBadge label={r.dataLabel} />
            </div>
            <div className="mt-2 flex items-center justify-between text-[12px] text-fg-2">
              <span>
                {textOf(TYPE_LABELS, r.type)} · {r.evidenceCount} evidence · {r.ownerName ?? "Unassigned"}
              </span>
              <Link prefetch={false} href={`/investigations/${r.id}`} className="ct-btn" data-size="sm">
                Open investigation
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
