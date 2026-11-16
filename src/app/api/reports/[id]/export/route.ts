import { withAuth } from "@/lib/api";
import { AppError } from "@/lib/domain/errors";
import { reportTimelineCsvRows } from "@/lib/reports/build";
import { csvResponseHeaders, safeFilename, toCsv } from "@/lib/reports/csv";
import { getReport, recordReportExport } from "@/lib/services/reports";

/** Exports an immutable snapshot: format=json (full content + provenance) or format=csv (timeline). */
export const GET = withAuth<{ id: string }>(async (req, { auth, params }) => {
  const format = req.nextUrl.searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "csv") throw new AppError("VALIDATION_ERROR", "format must be json or csv.");
  const report = await getReport(auth, params.id);
  await recordReportExport(auth, report, format);
  const base = `${report.caseNumber}-report-v${report.version}`;
  if (format === "csv") {
    const { headers, rows } = reportTimelineCsvRows(report.content);
    return new Response(toCsv(headers, rows), { headers: csvResponseHeaders(`${base}-timeline.csv`) });
  }
  const body = JSON.stringify(
    { exportedAt: new Date().toISOString(), snapshotSha256: report.sha256, report: report.content },
    null,
    2,
  );
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename(`${base}.json`)}"`,
      "Cache-Control": "no-store",
    },
  });
});
