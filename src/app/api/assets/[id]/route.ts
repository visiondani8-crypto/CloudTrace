import { readJson, withAuth } from "@/lib/api";
import { updateAsset } from "@/lib/services/assets";

export const PATCH = withAuth<{ id: string }>(
  async (req, { auth, params }) => {
    const asset = await updateAsset(auth, params.id, await readJson(req));
    return { id: asset.id };
  },
  { minRole: "ANALYST" },
);
