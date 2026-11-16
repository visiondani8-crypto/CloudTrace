import { readJson, withAuth } from "@/lib/api";
import { attachIssueToIncident, listProviderIssues } from "@/lib/services/integrations";

export const GET = withAuth(async (_req, { auth }) => ({ items: await listProviderIssues(auth) }));

export const POST = withAuth(
  async (req, { auth }) => {
    const evidence = await attachIssueToIncident(auth, await readJson(req));
    return Response.json({ id: evidence.id }, { status: 201 });
  },
  { minRole: "ANALYST" },
);
