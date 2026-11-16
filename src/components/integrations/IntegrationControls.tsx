"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { Mono, Tag } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { formatUtc } from "@/lib/domain/time";

export function SyncButton({ disabledReason }: { disabledReason: string | null }) {
  const router = useRouter();
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Button
        variant="primary"
        icon={<RefreshCw />}
        loading={busy}
        loadingLabel="Syncing…"
        disabled={!!disabledReason}
        onClick={async () => {
          setBusy(true);
          const res = await api<{ issueCount: number; created: number; updated: number }>("/api/integrations/microsoft/sync", { body: {} });
          setBusy(false);
          if (!res.ok) notify(res.error.message, "danger");
          else notify(`Sync complete: ${res.data.issueCount} issues retrieved (${res.data.created} new, ${res.data.updated} updated).`);
          router.refresh();
        }}
      >
        Sync now
      </Button>
      {disabledReason && <p className="ct-support mt-1.5">{disabledReason}</p>}
    </div>
  );
}

export function IssueAttach({
  issues,
  incidents,
  canEdit,
}: {
  issues: { id: string; externalId: string; service: string; title: string; status: string; isResolved: boolean; lastModifiedDateTime: string | null }[];
  incidents: { id: string; caseNumber: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const notify = useToast();
  const [target, setTarget] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (issues.length === 0) return <p className="ct-support">No service-health issues have been retrieved.</p>;
  return (
    <div className="ct-table-wrap">
      <table className="ct-table">
        <caption className="ct-sr-only">Tenant service-health issues</caption>
        <thead>
          <tr>
            <th scope="col">Issue</th>
            <th scope="col">Service</th>
            <th scope="col">Status</th>
            <th scope="col">Last modified (UTC)</th>
            {canEdit && <th scope="col">Attach to incident</th>}
          </tr>
        </thead>
        <tbody>
          {issues.map((i) => (
            <tr key={i.id}>
              <td>
                <Mono>{i.externalId}</Mono>
                <div className="text-[12.5px]">{i.title}</div>
              </td>
              <td>{i.service}</td>
              <td>
                <Tag tone={i.isResolved ? "success" : "warning"}>{i.status}</Tag>
              </td>
              <td>
                <Mono className="text-[12px]">{formatUtc(i.lastModifiedDateTime)}</Mono>
              </td>
              {canEdit && (
                <td>
                  <div className="flex gap-2">
                    <select className="ct-field min-h-[30px] w-auto py-1 text-[12px]" aria-label={`Incident for ${i.externalId}`} value={target[i.id] ?? ""} onChange={(e) => setTarget({ ...target, [i.id]: e.target.value })}>
                      <option value="">Select case</option>
                      {incidents.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.caseNumber}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={!target[i.id]}
                      loading={busy === i.id}
                      onClick={async () => {
                        setBusy(i.id);
                        const res = await api("/api/integrations/microsoft/issues", { body: { issueId: i.id, incidentId: target[i.id] } });
                        setBusy(null);
                        if (!res.ok) return notify(res.error.message, "danger");
                        notify("Tenant notice attached as evidence. It does not mark any asset as down.");
                        router.refresh();
                      }}
                    >
                      Attach
                    </Button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
