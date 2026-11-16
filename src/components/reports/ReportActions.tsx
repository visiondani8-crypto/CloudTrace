"use client";

import { Download, Printer } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/interactive";

export function ReportActions({ reportId, summary, compact }: { reportId: string; summary: string; compact?: boolean }) {
  const size = compact ? "sm" : "md";
  return (
    <div className="flex flex-wrap gap-2">
      <ButtonLink size={size} href={`/reports/${reportId}/print`} icon={<Printer />} external>
        Print / save as PDF
      </ButtonLink>
      <ButtonLink size={size} href={`/api/reports/${reportId}/export?format=json`} icon={<Download />} download>
        Export JSON
      </ButtonLink>
      <ButtonLink size={size} href={`/api/reports/${reportId}/export?format=csv`} icon={<Download />} download>
        Export timeline CSV
      </ButtonLink>
      <CopyButton value={summary} label="Copy summary" size={size} successMessage="Executive summary copied." />
    </div>
  );
}
