import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api";
import { analyzeSchema } from "@/lib/validation/schemas";
import { analyzeIncident, latestAnalysis } from "@/lib/services/analysis";

export const GET = withAuth<{ id: string }>(async (_req, { auth, params }) => ({ analysis: await latestAnalysis(auth, params.id) }));

async function optionalJson(req: NextRequest): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export const POST = withAuth<{ id: string }>(
  async (req, { auth, params }) => {
    const input = analyzeSchema.parse(await optionalJson(req));
    return { analysis: await analyzeIncident(auth, params.id, input) };
  },
  { minRole: "ANALYST" },
);
