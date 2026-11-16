import type { Metadata } from "next";
import { AssetsWorkspace } from "@/components/graph/AssetsWorkspace";
import { PageHeader, ReadOnlyNotice } from "@/components/ui/primitives";
import { can, requirePageContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { firstParam, type SearchParams } from "@/lib/page";
import { computeIncidentImpact, listAssets, listDependencies } from "@/lib/services/assets";
import { listIncidentEvidence } from "@/lib/services/evidence";

export const metadata: Metadata = { title: "Asset graph" };

export default async function AssetsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const params = await searchParams;
  const canEdit = can(ctx, "ANALYST");
  const [assets, dependencies, incidents] = await Promise.all([
    listAssets(ctx),
    listDependencies(ctx),
    prisma.incident.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, caseNumber: true, title: true },
      orderBy: { caseNumber: "asc" },
      take: 200,
    }),
  ]);
  const overlayId = firstParam(params.incident);
  const overlayIncident = overlayId ? incidents.find((i) => i.id === overlayId) : undefined;
  const [impact, evidence] = overlayIncident
    ? await Promise.all([computeIncidentImpact(ctx, overlayIncident.id, "peak"), listIncidentEvidence(ctx, overlayIncident.id)])
    : [null, []];

  return (
    <div className="ct-page">
      <PageHeader
        crumbs={[{ label: "Investigation" }, { label: "Asset graph" }]}
        eyebrow="Investigation / service catalogue"
        title="Asset graph"
        subtitle="Map services, providers, ownership and dependency paths."
      />
      {!canEdit && (
        <div className="mb-4">
          <ReadOnlyNotice />
        </div>
      )}
      <AssetsWorkspace
        assets={assets}
        dependencies={dependencies}
        incidents={incidents}
        overlay={overlayIncident && impact ? { incidentId: overlayIncident.id, caseNumber: overlayIncident.caseNumber, result: impact.result, asOf: impact.asOf } : null}
        overlayEvidence={evidence.map((e) => ({ id: e.id, ref: e.ref, title: e.title, provenance: e.provenance, observedAt: e.observedAt, assetId: e.assetId }))}
        canEdit={canEdit}
      />
    </div>
  );
}
