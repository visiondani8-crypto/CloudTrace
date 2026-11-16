import type { Metadata } from "next";
import { IncidentWorkspace } from "@/components/investigation/Workspace";
import { requirePageContext } from "@/lib/auth/context";
import { orNotFound, type SearchParams } from "@/lib/page";
import { getIncident } from "@/lib/services/incidents";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const ctx = await requirePageContext();
  try {
    const incident = await getIncident(ctx, (await params).id);
    return { title: `${incident.caseNumber} · Investigation` };
  } catch {
    return { title: "Investigation" };
  }
}

export default async function InvestigationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  return orNotFound(IncidentWorkspace({ ctx, incidentId: id, params: await searchParams, basePath: "/investigations" }));
}
