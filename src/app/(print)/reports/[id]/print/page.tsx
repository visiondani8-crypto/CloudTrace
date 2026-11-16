import type { Metadata } from "next";
import { ReportDocument } from "@/components/reports/ReportDocument";
import { requirePageContext } from "@/lib/auth/context";
import { orNotFound } from "@/lib/page";
import { getReport, recordReportExport } from "@/lib/services/reports";
import { PrintToolbar } from "./PrintToolbar";

export const metadata: Metadata = { title: "Print report" };

export default async function PrintReportPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext();
  const report = await orNotFound(getReport(ctx, (await params).id));
  await recordReportExport(ctx, report, "print");
  return (
    <main className="ct-print-page">
      <PrintToolbar backHref={`/reports/${report.id}`} />
      <ReportDocument content={report.content} sha256={report.sha256} />
    </main>
  );
}
