"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DependencyExplorer, type AssetLite, type DependencyLite, type EvidenceLite } from "@/components/graph/DependencyExplorer";
import { Segmented } from "@/components/ui/fields";
import { Banner } from "@/components/ui/primitives";
import type { BlastRadiusResult } from "@/lib/blast-radius";
import { formatUtc } from "@/lib/domain/time";

export function DependencyTab({
  incident,
  assets,
  dependencies,
  impact,
  evidence,
  canEdit,
}: {
  incident: { id: string; caseNumber: string };
  assets: AssetLite[];
  dependencies: DependencyLite[];
  impact: { result: BlastRadiusResult; asOf: string | null; view: "peak" | "latest" };
  evidence: EvidenceLite[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const counts = impact.result.counts;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Assessment point"
            value={impact.view}
            onChange={(v) => {
              const next = new URLSearchParams(params.toString());
              next.set("tab", "dependency");
              if (v === "latest") next.set("view", "latest");
              else next.delete("view");
              router.replace(`${pathname}?${next}`, { scroll: false });
            }}
            options={[
              { value: "peak", label: "Incident impact" },
              { value: "latest", label: "Latest observations" },
            ]}
          />
          <span className="text-[12px] text-fg-2">
            {impact.view === "peak"
              ? impact.asOf
                ? `Assessed as of the latest failure observation, ${formatUtc(impact.asOf)}`
                : "No failure observations recorded"
              : impact.result.referenceTime
                ? `All observations up to ${formatUtc(impact.result.referenceTime)}`
                : "No observations recorded"}
          </span>
        </div>
        <span className="text-[12px] text-fg-2">
          {counts.CONFIRMED_AFFECTED - counts.providerReported} confirmed · {counts.providerReported} provider-reported · {counts.POTENTIALLY_AFFECTED} at risk ·{" "}
          {counts.CONFIRMED_HEALTHY} healthy · {counts.UNKNOWN} unknown
        </span>
      </div>
      <Banner>
        A dependency on a degraded service makes an asset <strong>at risk</strong>, not confirmed down. Provider notices mark the provider&apos;s service only;
        customer impact needs the organisation&apos;s own (or simulated) observations.
      </Banner>
      <DependencyExplorer
        assets={assets}
        dependencies={dependencies}
        impact={impact}
        incident={incident}
        evidence={evidence}
        canEdit={canEdit}
        mode="incident"
        initialSelected={params.get("asset")}
      />
    </div>
  );
}
