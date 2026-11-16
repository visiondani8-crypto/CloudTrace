import { readJson, withAuth } from "@/lib/api";
import { createAsset, listAssets } from "@/lib/services/assets";

export const GET = withAuth(async (_req, { auth }) => ({ items: await listAssets(auth) }));

export const POST = withAuth(
  async (req, { auth }) => {
    const asset = await createAsset(auth, await readJson(req));
    return Response.json({ id: asset.id }, { status: 201 });
  },
  { minRole: "ANALYST" },
);
