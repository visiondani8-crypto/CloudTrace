import type { Metadata } from "next";
import Link from "next/link";
import { Download, Lock } from "lucide-react";
import { AuditTable } from "@/components/admin/AuditTable";
import { Pager } from "@/components/incidents/IncidentFilters";
import { Banner, EmptyState, ErrorState, PageHeader, Panel } from "@/components/ui/primitives";
import { can, requirePageContext } from "@/lib/auth/context";
import { firstParam, type SearchParams } from "@/lib/page";
import { listMembers } from "@/lib/services/incidents";
import { AUDIT_ACTION_CLASSES, listAudit } from "@/lib/services/workspace";

export const metadata: Metadata = { title: "Activity & audit" };

export default async function ActivityPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const params = await searchParams;
  const header = (
    <PageHeader
      crumbs={[{ label: "Administration" }, { label: "Activity & audit" }]}
      eyebrow="Administration / audit"
      title="Activity & audit"
      subtitle="Review changes, imports, analysis and report generation."
    />
  );
  if (!can(ctx, "ANALYST")) {
    return (
      <div className="ct-page">
        {header}
        <Panel>
          <EmptyState icon={<Lock size={22} strokeWidth={1.5} />} title="You do not have permission to view the audit log.">
            The audit log is available to analysts and owners. Your role allows viewing, not editing. Ask a workspace owner if you need access.
          </EmptyState>
          <div className="text-center">
            <Link prefetch={false} href="/overview" className="ct-btn">
              Return to overview
            </Link>
          </div>
        </Panel>
      </div>
    );
  }
  const filters = {
    q: firstParam(params.q),
    actorId: firstParam(params.actorId),
    action: firstParam(params.action),
    entity: firstParam(params.entity),
    from: firstParam(params.from),
    to: firstParam(params.to),
    page: firstParam(params.page) as never,
    pageSize: firstParam(params.pageSize) as never,
  };
  const members = await listMembers(ctx);
  let result: Awaited<ReturnType<typeof listAudit>> | null = null;
  try {
    result = await listAudit(ctx, filters);
  } catch {
    result = null;
  }
  const filtered = Object.entries(filters).some(([k, v]) => v && k !== "page" && k !== "pageSize");
  const exportQuery = new URLSearchParams(Object.entries(filters).filter(([k, v]) => v && k !== "page" && k !== "pageSize") as [string, string][]);
  exportQuery.set("format", "csv");

  return (
    <div className="ct-page">
      {header}
      <div className="mb-4">
        <Banner icon={<Lock size={14} />}>
          Append-only record. Entries cannot be edited or deleted from the product; metadata is redacted so secrets and tokens are never shown.
        </Banner>
      </div>
      <Panel flush>
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div className="min-w-[200px] flex-1">
            <label htmlFor="a-q" className="ct-field-label">
              Search summary
            </label>
            <input id="a-q" name="q" type="search" className="ct-field" defaultValue={filters.q ?? ""} />
          </div>
          <div>
            <label htmlFor="a-actor" className="ct-field-label">
              Actor
            </label>
            <select id="a-actor" name="actorId" className="ct-field min-w-[160px]" defaultValue={filters.actorId ?? ""}>
              <option value="">All actors</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="a-action" className="ct-field-label">
              Action class
            </label>
            <select id="a-action" name="action" className="ct-field min-w-[170px]" defaultValue={filters.action ?? ""}>
              <option value="">All actions</option>
              {AUDIT_ACTION_CLASSES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="a-entity" className="ct-field-label">
              Entity / case ID
            </label>
            <input id="a-entity" name="entity" className="ct-field" data-mono="true" defaultValue={filters.entity ?? ""} placeholder="CT-2026-001" />
          </div>
          <div>
            <label htmlFor="a-from" className="ct-field-label">
              From (UTC)
            </label>
            <input id="a-from" name="from" type="date" className="ct-field" defaultValue={filters.from ?? ""} />
          </div>
          <div>
            <label htmlFor="a-to" className="ct-field-label">
              To (UTC)
            </label>
            <input id="a-to" name="to" type="date" className="ct-field" defaultValue={filters.to ?? ""} />
          </div>
          <button type="submit" className="ct-btn">
            Apply
          </button>
          {filtered && (
            <Link prefetch={false} href="/activity" className="ct-btn" data-variant="ghost">
              Reset
            </Link>
          )}
          <a href={`/api/audit?${exportQuery}`} className="ct-btn ml-auto" download>
            <Download size={15} aria-hidden="true" /> Export CSV
          </a>
        </form>
        {!result ? (
          <div className="p-4">
            <ErrorState message="Some filters are invalid. Reset the filters and try again." />
          </div>
        ) : result.items.length === 0 ? (
          filtered ? <EmptyState title="No results match these filters." /> : <EmptyState title="No audit entries yet." />
        ) : (
          <>
            <AuditTable rows={result.items} />
            <Pager page={result.page} pageCount={result.pageCount} pageSize={result.pageSize} sizes={[25, 50, 100]} />
          </>
        )}
      </Panel>
    </div>
  );
}
