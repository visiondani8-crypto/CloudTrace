import { readJson, withAuth } from "@/lib/api";
import { createTask, listTasks, updateTask } from "@/lib/services/investigation";

export const GET = withAuth<{ id: string }>(async (_req, { auth, params }) => ({ items: await listTasks(auth, params.id) }));

export const POST = withAuth<{ id: string }>(
  async (req, { auth, params }) => {
    const t = await createTask(auth, params.id, await readJson(req));
    return Response.json({ id: t.id }, { status: 201 });
  },
  { minRole: "ANALYST" },
);

export const PATCH = withAuth<{ id: string }>(
  async (req, { auth, params }) => {
    const t = await updateTask(auth, params.id, await readJson(req));
    return { id: t.id, status: t.status };
  },
  { minRole: "ANALYST" },
);
