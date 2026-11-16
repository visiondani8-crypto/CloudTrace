import { readJson, withAuth } from "@/lib/api";
import { createDependency, listDependencies } from "@/lib/services/assets";

export const GET = withAuth(async (_req, { auth }) => ({ items: await listDependencies(auth) }));

export const POST = withAuth(
  async (req, { auth }) => {
    const { dependency, createsCycle } = await createDependency(auth, await readJson(req));
    return Response.json({ id: dependency.id, createsCycle }, { status: 201 });
  },
  { minRole: "ANALYST" },
);
