import type { Metadata } from "next";
import { CreateIncidentButton } from "@/components/incidents/CreateIncident";
import { IncidentFilters, Pager } from "@/components/incidents/IncidentFilters";
import { IncidentTable } from "@/components/incidents/IncidentTable";
import { EmptyState, ErrorState, PageHeader, Panel, ReadOnlyNotice } from "@/components/ui/primitives";
import { can, requirePageContext } from "@/lib/auth/context";
import type { SearchParams } from "@/lib/page";
import { listAssets } from "@/lib/services/assets";
import { listIncidents, listMembers } from "@/lib/services/incidents";

export const metadata: Metadata = { title: "Incidents" };

export default async function IncidentsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const params = await searchParams;
  const isAnalyst = can(ctx, "ANALYST");
  const filtered = ["q", "severity", "status", "type"].some((k) => params[k] !== undefined);

  let result: Awaited<ReturnType<typeof listIncidents>> | null = null;
  try {
    result = await listIncidents(ctx, {
      q: params.q as string | undefined,
      severity: params.severity as never,
      status: params.status as never,
      type: params.type as never,
      sort: params.sort as never,
      page: params.page as never,
      pageSize: (params.pageSize as never) ?? undefined,
    });
  } catch {
    result = null;
  }
  const [members, assets] = isAnalyst ? await Promise.all([listMembers(ctx), listAssets(ctx)]) : [[], []];

  return (
    <div className="ct-page">
      <PageHeader
        crumbs={[{ label: "Operations" }, { label: "Incidents" }]}
        eyebrow="Operations / case management"
        title="Incidents"
        subtitle="Investigate service disruption, suspicious activity and configuration failures."
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
      {!isAnalyst && (
        <div className="mb-4">
          <ReadOnlyNotice />
        </div>
      )}
      <Panel flush>
        <IncidentFilters total={result?.total ?? 0} />
        {!result ? (
          <div className="p-4">
            <ErrorState message="Some filters are invalid or the incident list could not be loaded. Reset the filters and try again." />
          </div>
        ) : result.items.length === 0 ? (
          filtered ? (
            <EmptyState title="No results match these filters.">Adjust or reset the filters to see more cases.</EmptyState>
          ) : (
            <EmptyState title="No incidents recorded.">Create a case to start an investigation.</EmptyState>
          )
        ) : (
          <>
            <IncidentTable rows={result.items} caption="Incidents" />
            <Pager page={result.page} pageCount={result.pageCount} pageSize={result.pageSize} sizes={[10, 20, 50, 100]} />
          </>
        )}
      </Panel>
    </div>
  );
}
