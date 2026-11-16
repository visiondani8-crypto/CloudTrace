import { searchParamsObject, withAuth } from "@/lib/api";
import { listEvidence } from "@/lib/services/evidence";

export const GET = withAuth(async (req, { auth }) => listEvidence(auth, searchParamsObject(req)));
