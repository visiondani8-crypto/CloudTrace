import { readJson, withAuth } from "@/lib/api";
import { createHypothesis, listHypotheses, updateHypothesis } from "@/lib/services/investigation";

export const GET = withAuth<{ id: string }>(async (_req, { auth, params }) => ({ items: await listHypotheses(auth, params.id) }));

export const POST = withAuth<{ id: string }>(
  async (req, { auth, params }) => {
    const h = await createHypothesis(auth, params.id, await readJson(req));
    return Response.json({ id: h.id }, { status: 201 });
  },
  { minRole: "ANALYST" },
);

export const PATCH = withAuth<{ id: string }>(
  async (req, { auth, params }) => {
    const h = await updateHypothesis(auth, params.id, await readJson(req));
    return { id: h.id, status: h.status };
  },
  { minRole: "ANALYST" },
);
