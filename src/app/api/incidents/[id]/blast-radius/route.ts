import { withAuth } from "@/lib/api";
import { computeIncidentImpact } from "@/lib/services/assets";

export const GET = withAuth<{ id: string }>(async (req, { auth, params }) => {
  const view = req.nextUrl.searchParams.get("view") === "latest" ? "latest" : "peak";
  return computeIncidentImpact(auth, params.id, view);
});
