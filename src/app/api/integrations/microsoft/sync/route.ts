import { withAuth } from "@/lib/api";
import { syncMicrosoft } from "@/lib/services/integrations";

export const POST = withAuth(async (_req, { auth }) => syncMicrosoft(auth), { minRole: "OWNER" });
