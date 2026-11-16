import { readJson, withAuth } from "@/lib/api";
import { createNote, listNotes } from "@/lib/services/investigation";

export const GET = withAuth<{ id: string }>(async (_req, { auth, params }) => ({ items: await listNotes(auth, params.id) }));

export const POST = withAuth<{ id: string }>(
  async (req, { auth, params }) => {
    const n = await createNote(auth, params.id, await readJson(req));
    return Response.json({ id: n.id }, { status: 201 });
  },
  { minRole: "ANALYST" },
);
