import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Microscope } from "lucide-react";
import { IncidentTable } from "@/components/incidents/IncidentTable";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { listIncidents } from "@/lib/services/incidents";

export const metadata: Metadata = { title: "Investigation lab" };

export default async function InvestigationsIndex() {
  const ctx = await requirePageContext();
  const lastId = (await cookies()).get("ct_last_case")?.value;
  // Only resume a case that belongs to the active organisation.
  const last = lastId
    ? await prisma.incident.findFirst({ where: { id: lastId, organizationId: ctx.organizationId }, select: { id: true, caseNumber: true, title: true } })
    : null;
  const active = await listIncidents(ctx, { status: ["OPEN", "INVESTIGATING", "MONITORING"], pageSize: 20 });
  const recent = await listIncidents(ctx, { pageSize: 10 });

  return (
    <div className="ct-page">
      <PageHeader eyebrow="Investigation" title="Select an investigation" subtitle="Open a case to work through its timeline, evidence, dependency impact, hypotheses, tasks and report." />
      {last && (
        <Panel className="mb-4" title="Resume last case">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px]">
              <span className="ct-mono text-fg-2">{last.caseNumber}</span> · {last.title}
            </div>
            <Link prefetch={false} href={`/investigations/${last.id}`} className="ct-btn" data-variant="primary">
              Open investigation
            </Link>
          </div>
        </Panel>
      )}
      <Panel className="mb-4" title="Active investigations" description="Open, investigating and monitoring cases." flush>
        {active.items.length ? (
          <IncidentTable rows={active.items} caption="Active investigations" />
        ) : (
          <EmptyState icon={<Microscope size={22} strokeWidth={1.5} />} title="Select an incident to start investigating">
            No active cases. Recently updated cases are listed below.
          </EmptyState>
        )}
      </Panel>
      <Panel title="Recently updated" flush actions={<Link prefetch={false} href="/incidents" className="text-[12.5px]">View all incidents</Link>}>
        {recent.items.length ? (
          <IncidentTable rows={recent.items} caption="Recently updated incidents" />
        ) : (
          <EmptyState title="No incidents recorded.">Create a case to start an investigation.</EmptyState>
        )}
      </Panel>
    </div>
  );
}
