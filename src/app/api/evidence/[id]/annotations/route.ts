import { readJson, withAuth } from "@/lib/api";
import { addAnnotation } from "@/lib/services/evidence";

export const POST = withAuth<{ id: string }>(
  async (req, { auth, params }) => {
    const a = await addAnnotation(auth, params.id, await readJson(req));
    return Response.json({ id: a.id }, { status: 201 });
  },
  { minRole: "ANALYST" },
);
