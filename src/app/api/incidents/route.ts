import { readJson, searchParamsObject, withAuth } from "@/lib/api";
import { createIncident, listIncidents } from "@/lib/services/incidents";

export const GET = withAuth(async (req, { auth }) => listIncidents(auth, searchParamsObject(req)));

export const POST = withAuth(
  async (req, { auth }) => {
    const incident = await createIncident(auth, await readJson(req));
    return Response.json({ id: incident.id, caseNumber: incident.caseNumber }, { status: 201 });
  },
  { minRole: "ANALYST" },
);
