import { readJson, withAuth } from "@/lib/api";
import { getIncident, updateIncident } from "@/lib/services/incidents";

export const GET = withAuth<{ id: string }>(async (_req, { auth, params }) => getIncident(auth, params.id));

export const PATCH = withAuth<{ id: string }>(
  async (req, { auth, params }) => {
    const updated = await updateIncident(auth, params.id, await readJson(req));
    return { id: updated.id, status: updated.status, severity: updated.severity, classification: updated.classification };
  },
  { minRole: "ANALYST" },
);
