import { withAuth } from "@/lib/api";
import { getReport } from "@/lib/services/reports";

export const GET = withAuth<{ id: string }>(async (_req, { auth, params }) => getReport(auth, params.id));
