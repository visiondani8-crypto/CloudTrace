import { withAuth } from "@/lib/api";
import { deleteDependency } from "@/lib/services/assets";

export const DELETE = withAuth<{ id: string }>(async (_req, { auth, params }) => deleteDependency(auth, params.id), {
  minRole: "ANALYST",
});
