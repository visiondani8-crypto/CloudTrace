import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReportActions } from "@/components/reports/ReportActions";
import { ReportDocument } from "@/components/reports/ReportDocument";
import { Panel } from "@/components/ui/primitives";
import { requirePageContext } from "@/lib/auth/context";
import { formatUtc } from "@/lib/domain/time";
import { orNotFound } from "@/lib/page";
import { reportSummaryText } from "@/lib/reports/build";
import { getReport } from "@/lib/services/reports";

export const metadata: Metadata = { title: "Report" };

export default async function ReportViewer({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageContext();
  const report = await orNotFound(getReport(ctx, (await params).id));
  return (
    <div className="ct-page">
      <nav aria-label="Breadcrumb" className="ct-breadcrumb">
        <Link prefetch={false} href="/reports" className="inline-flex items-center gap-1 text-fg-2 no-underline hover:underline">
          <ArrowLeft size={13} aria-hidden="true" /> Back to reports
        </Link>
        <span aria-hidden="true">/</span>
        <Link prefetch={false} href={`/investigations/${report.incidentId}?tab=report&report=${report.id}`} className="text-fg-2">
          {report.caseNumber}
        </Link>
      </nav>
      <div className="mx-auto max-w-[980px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="ct-support">
            Immutable snapshot v{report.version} · generated {formatUtc(report.generatedAt)}. PDF uses your browser&apos;s print dialog (choose “Save as PDF”).
          </p>
          <ReportActions reportId={report.id} summary={reportSummaryText(report.content)} />
        </div>
        <Panel>
          <ReportDocument content={report.content} sha256={report.sha256} />
        </Panel>
        {report.versions.length > 1 && (
          <Panel className="mt-4" title="Version history">
            <ul className="flex flex-wrap gap-3 text-[12.5px]">
              {report.versions.map((v) => (
                <li key={v.id}>
                  {v.id === report.id ? (
                    <strong>
                      v{v.version} · {formatUtc(v.generatedAt)}
                    </strong>
                  ) : (
                    <Link prefetch={false} href={`/reports/${v.id}`}>
                      v{v.version} · {formatUtc(v.generatedAt)}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}
