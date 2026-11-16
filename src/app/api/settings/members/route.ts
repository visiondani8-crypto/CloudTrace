import { readJson, withAuth } from "@/lib/api";
import { listMembers } from "@/lib/services/incidents";
import { createDemoUser, updateMemberRole } from "@/lib/services/workspace";

export const GET = withAuth(async (_req, { auth }) => ({ items: await listMembers(auth) }));

export const POST = withAuth(
  async (req, { auth }) => Response.json(await createDemoUser(auth, await readJson(req)), { status: 201 }),
  { minRole: "OWNER" },
);

export const PATCH = withAuth(
  async (req, { auth }) => {
    const m = await updateMemberRole(auth, await readJson(req));
    return { id: m.id, role: m.role };
  },
  { minRole: "OWNER" },
);
