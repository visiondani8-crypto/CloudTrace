import { readJson, withAuth } from "@/lib/api";
import { updateOrganization } from "@/lib/services/workspace";

export const PATCH = withAuth(
  async (req, { auth }) => {
    const org = await updateOrganization(auth, await readJson(req));
    return { id: org.id, name: org.name };
  },
  { minRole: "OWNER" },
);
