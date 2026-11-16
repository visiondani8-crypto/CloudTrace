import { readJson, withAuth } from "@/lib/api";
import { formatEvidenceRef } from "@/lib/domain/enums";
import { createManualEvidence, listIncidentEvidence } from "@/lib/services/evidence";

export const GET = withAuth<{ id: string }>(async (_req, { auth, params }) => ({
  items: await listIncidentEvidence(auth, params.id),
}));

export const POST = withAuth<{ id: string }>(
  async (req, { auth, params }) => {
    const evidence = await createManualEvidence(auth, params.id, await readJson(req));
    return Response.json(
      { id: evidence.id, ref: formatEvidenceRef(evidence.refNumber), sha256: evidence.sha256 },
      { status: 201 },
    );
  },
  { minRole: "ANALYST" },
);
