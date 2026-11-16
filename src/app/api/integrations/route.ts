import { withAuth } from "@/lib/api";
import { getIntegrationStatus } from "@/lib/services/integrations";

export const GET = withAuth(async (_req, { auth }) => getIntegrationStatus(auth));
