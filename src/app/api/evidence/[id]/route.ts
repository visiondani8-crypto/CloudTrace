import { withAuth } from "@/lib/api";
import { getEvidenceDetail } from "@/lib/services/evidence";

export const GET = withAuth<{ id: string }>(async (_req, { auth, params }) => getEvidenceDetail(auth, params.id));
