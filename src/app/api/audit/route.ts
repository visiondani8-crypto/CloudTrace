import { searchParamsObject, withAuth } from "@/lib/api";
import { formatUtc } from "@/lib/domain/time";
import { csvResponseHeaders, toCsv } from "@/lib/reports/csv";
import { listAudit } from "@/lib/services/workspace";

export const GET = withAuth(
  async (req, { auth }) => {
    const params = searchParamsObject(req);
    if (params.format !== "csv") return listAudit(auth, params);
    const { items } = await listAudit(auth, { ...params, page: 1, pageSize: 100 });
    const csv = toCsv(
      ["created_at_utc", "actor", "action", "entity_type", "entity_id", "summary"],
      items.map((a) => [formatUtc(a.createdAt, { seconds: true }), a.actorLabel, a.action, a.entityType, a.entityId ?? "", a.summary]),
    );
    return new Response(csv, { headers: csvResponseHeaders(`${auth.organizationSlug}-audit.csv`) });
  },
  { minRole: "ANALYST" },
);
