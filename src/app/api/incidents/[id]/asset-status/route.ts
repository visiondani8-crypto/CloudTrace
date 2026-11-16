import { readJson, withAuth } from "@/lib/api";
import { setIncidentAssetStatus } from "@/lib/services/assets";

export const POST = withAuth<{ id: string }>(
  async (req, { auth, params }) => {
    const row = await setIncidentAssetStatus(auth, params.id, await readJson(req));
    return { id: row.id, observedStatus: row.observedStatus };
  },
  { minRole: "ANALYST" },
);
