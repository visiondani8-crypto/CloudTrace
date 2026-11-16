import { withAuth } from "@/lib/api";
import { generateReport, listReports } from "@/lib/services/reports";
import { incidentOrThrow } from "@/lib/services/guards";
import { prisma } from "@/lib/db";

export const GET = withAuth<{ id: string }>(async (_req, { auth, params }) => {
  await incidentOrThrow(prisma, auth, params.id);
  return { items: await listReports(auth, { incidentId: params.id }) };
});

export const POST = withAuth<{ id: string }>(
  async (_req, { auth, params }) => Response.json(await generateReport(auth, params.id), { status: 201 }),
  { minRole: "ANALYST" },
);
