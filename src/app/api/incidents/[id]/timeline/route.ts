import { readJson, withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { formatUtc } from "@/lib/domain/time";
import { csvResponseHeaders, toCsv } from "@/lib/reports/csv";
import { addTimelineEntry, getTimeline } from "@/lib/services/investigation";
import { writeAudit } from "@/lib/audit";
import { PROVENANCE_LABELS, labelOf } from "@/lib/ui/labels";

export const GET = withAuth<{ id: string }>(async (req, { auth, params }) => {
  const items = await getTimeline(auth, params.id);
  if (req.nextUrl.searchParams.get("format") !== "csv") return { items };
  const incident = await prisma.incident.findFirstOrThrow({ where: { id: params.id, organizationId: auth.organizationId } });
  await writeAudit(prisma, auth, {
    action: "report.timeline_exported",
    entityType: "Incident",
    entityId: incident.id,
    summary: `${incident.caseNumber}: exported live timeline CSV (${items.length} events)`,
  });
  const csv = toCsv(
    ["case_number", "event_id", "occurred_at_utc", "title", "description", "provenance", "evidence_ref", "source_name", "sha256", "asset", "verification"],
    items.map((t) => [
      incident.caseNumber,
      t.id,
      formatUtc(t.occurredAt, { seconds: true }),
      t.title,
      t.description ?? "",
      labelOf(PROVENANCE_LABELS, t.sourceClass).label,
      t.evidenceRef ?? "",
      t.sourceName ?? "",
      t.sha256 ?? "",
      t.assetName ?? "",
      t.verified ? "Evidence-linked" : "Analyst-entered / unverified",
    ]),
  );
  return new Response(csv, { headers: csvResponseHeaders(`${incident.caseNumber}-timeline.csv`) });
});

export const POST = withAuth<{ id: string }>(
  async (req, { auth, params }) => {
    const event = await addTimelineEntry(auth, params.id, await readJson(req));
    return Response.json({ id: event.id }, { status: 201 });
  },
  { minRole: "ANALYST" },
);
