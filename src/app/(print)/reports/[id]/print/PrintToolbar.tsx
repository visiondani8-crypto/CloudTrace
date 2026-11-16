"use client";

import Link from "next/link";

export function PrintToolbar({ backHref }: { backHref: string }) {
  return (
    <div className="ct-no-print mx-auto mb-6 flex max-w-[940px] flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-surface p-3">
      <p className="ct-support">Print view. Use “Print / save as PDF”, then choose “Save as PDF” as the destination. No server-side PDF is generated.</p>
      <div className="flex gap-2">
        <Link prefetch={false} href={backHref} className="ct-btn">
          Back to report
        </Link>
        <button type="button" className="ct-btn" data-variant="primary" onClick={() => window.print()}>
          Print / save as PDF
        </button>
      </div>
    </div>
  );
}
