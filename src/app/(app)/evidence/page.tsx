import type { Metadata } from "next";
import { EvidenceInspectorHost } from "@/components/evidence/EvidenceInspector";
import { AddEvidenceButton, ImportWizardButton } from "@/components/evidence/EvidenceForms";
import { EvidenceTable } from "@/components/evidence/EvidenceTable";
import { VaultFilters } from "@/components/evidence/VaultFilters";
import { Pager } from "@/components/incidents/IncidentFilters";
import { EmptyState, ErrorState, Mono, PageHeader, Panel, ReadOnlyNotice, Tag } from "@/components/ui/primitives";
import { can, requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { formatUtc } from "@/lib/domain/time";
import { firstParam, type SearchParams } from "@/lib/page";
import { listAssets } from "@/lib/services/assets";
import { listEvidence, listImportJobs } from "@/lib/services/evidence";

export const metadata: Metadata = { title: "Evidence vault" };

export default async function EvidenceVaultPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const params = await searchParams;
  const canEdit = can(ctx, "ANALYST");
  const [incidents, assets, totalAll, imports] = await Promise.all([
    prisma.incident.findMany({ where: { organizationId: ctx.organizationId }, select: { id: true, caseNumber: true, title: true }, orderBy: { caseNumber: "asc" }, take: 200 }),
    listAssets(ctx),
    prisma.evidence.count({ where: { organizationId: ctx.organizationId } }),
    listImportJobs(ctx),
  ]);
  let result: Awaited<ReturnType<typeof listEvidence>> | null = null;
  try {
    result = await listEvidence(ctx, {
      q: firstParam(params.q),
      incidentId: firstParam(params.incidentId),
      provenance: firstParam(params.provenance) as never,
      assetId: firstParam(params.assetId),
      from: firstParam(params.from),
      to: firstParam(params.to),
      page: firstParam(params.page) as never,
      pageSize: firstParam(params.pageSize) as never,
    });
  } catch {
    result = null;
  }

  return (
    <div className="ct-page">
      <EvidenceInspectorHost canEdit={canEdit} />
      <PageHeader
        crumbs={[{ label: "Investigation" }, { label: "Evidence vault" }]}
        eyebrow="Investigation / evidence"
        title="Evidence vault"
        subtitle="Preserved observations and references with traceable provenance."
        chips={<Tag>{totalAll} evidence records in this workspace</Tag>}
        actions={
          canEdit ? (
            <>
              <ImportWizardButton incidents={incidents} />
              <AddEvidenceButton incidents={incidents} assets={assets.map((a) => ({ id: a.id, name: a.name }))} />
            </>
          ) : undefined
        }
      />
      {!canEdit && (
        <div className="mb-4">
          <ReadOnlyNotice />
        </div>
      )}
      <Panel flush className="mb-4">
        <VaultFilters incidents={incidents} assets={assets.map((a) => ({ id: a.id, name: a.name }))} total={result?.total ?? 0} />
        {!result ? (
          <div className="p-4">
            <ErrorState message="The filters are invalid or evidence could not be loaded. Reset the filters and try again." />
          </div>
        ) : totalAll === 0 ? (
          <EmptyState title="No evidence recorded yet.">{canEdit ? "Import a CSV/JSON file or add a record." : undefined}</EmptyState>
        ) : result.items.length === 0 ? (
          <EmptyState title="No results match these filters." />
        ) : (
          <>
            <EvidenceTable rows={result.items} showCase />
            <Pager page={result.page} pageCount={result.pageCount} pageSize={result.pageSize} />
          </>
        )}
      </Panel>
      <Panel title="Recent imports" description="Every import attempt, including rejected files, with accepted/rejected/duplicate counts.">
        {imports.length === 0 ? (
          <p className="ct-support">No imports yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-[12.5px]">
            {imports.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-2">
                <Mono className="text-fg-2">{formatUtc(j.createdAt)}</Mono>
                <Mono>{j.caseNumber}</Mono>
                <Mono>{j.filename}</Mono>
                <Tag tone={j.outcome === "COMPLETED" ? "success" : "warning"}>{j.outcome === "COMPLETED" ? "Completed" : "Rejected"}</Tag>
                <span className="text-fg-2">
                  {j.acceptedCount} accepted · {j.rejectedCount} rejected · {j.duplicateCount} duplicates
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
