"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/Dialog";
import { Mono, Tag } from "@/components/ui/primitives";
import { formatUtc } from "@/lib/domain/time";

interface AuditRow {
  id: string;
  createdAt: string;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
}

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  const [open, setOpen] = useState<AuditRow | null>(null);
  return (
    <>
      <div className="ct-table-wrap">
        <table className="ct-table">
          <caption className="ct-sr-only">Audit entries, most recent first</caption>
          <thead>
            <tr>
              <th scope="col">Time (UTC)</th>
              <th scope="col">Actor</th>
              <th scope="col">Action</th>
              <th scope="col">Entity</th>
              <th scope="col">Summary</th>
              <th scope="col">
                <span className="ct-sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Mono className="whitespace-nowrap text-[12px]">{formatUtc(r.createdAt, { seconds: true })}</Mono>
                </td>
                <td className="whitespace-nowrap">{r.actorLabel}</td>
                <td>
                  <Mono className="text-[12px]">{r.action}</Mono>
                </td>
                <td className="text-fg-2">{r.entityType}</td>
                <td className="min-w-[260px]">{r.summary}</td>
                <td>
                  <button type="button" className="ct-btn" data-size="sm" data-variant="ghost" onClick={() => setOpen(r)} aria-label={`View details for ${r.action} at ${formatUtc(r.createdAt)}`}>
                    Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Drawer open={!!open} onClose={() => setOpen(null)} title="Audit entry" subtitle={open ? formatUtc(open.createdAt, { seconds: true }) : undefined}>
        {open && (
          <div className="flex flex-col gap-4">
            <Tag>Append-only record</Tag>
            <dl className="ct-kv">
              <dt>Entry ID</dt>
              <dd className="ct-mono">{open.id}</dd>
              <dt>Actor</dt>
              <dd>{open.actorLabel}</dd>
              <dt>Action</dt>
              <dd className="ct-mono">{open.action}</dd>
              <dt>Entity</dt>
              <dd>
                {open.entityType} {open.entityId && <Mono className="text-fg-2">{open.entityId}</Mono>}
              </dd>
              <dt>Summary</dt>
              <dd>{open.summary}</dd>
            </dl>
            <div>
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.7px] text-fg-2">Safe metadata (secrets redacted)</div>
              <pre className="ct-code m-0" data-wrap="true">
                {JSON.stringify(open.metadata, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
