import type { Metadata } from "next";
import { IncidentWorkspace } from "@/components/investigation/Workspace";
import { requirePageContext } from "@/lib/auth/context";
import { orNotFound, type SearchParams } from "@/lib/page";

export const metadata: Metadata = { title: "Incident" };

/** Same shared case workspace as /investigations/[id]; breadcrumbs reflect the Incidents entry point. */
export default async function IncidentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  return orNotFound(IncidentWorkspace({ ctx, incidentId: id, params: await searchParams, basePath: "/incidents" }));
}
