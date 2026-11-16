"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Dialog";
import { TextareaField } from "@/components/ui/fields";
import { CopyButton } from "@/components/ui/interactive";
import { useToast } from "@/components/ui/Toast";
import { Banner, ConfidenceBadge, ErrorState, Mono, ProvenanceBadge, SectionLabel, Skeleton, Tag } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { formatUtc } from "@/lib/domain/time";
import { CATEGORY_LABELS, OBSERVED_STATUS_LABELS, PROVENANCE_LABELS, labelOf, textOf } from "@/lib/ui/labels";

interface EvidenceDetail {
  id: string;
  ref: string;
  incidentId: string;
  caseNumber: string;
  assetId: string | null;
  assetName: string | null;
  title: string;
  category: string;
  provenance: string;
  sourceName: string;
  sourceUri: string | null;
  sourceEventId: string | null;
  sha256: string;
  observedAt: string;
  ingestedAt: string;
  isSynthetic: boolean;
  confidenceLevel: string;
  assetStatus: string | null;
  contentText: string;
  createdByName: string | null;
  importJob: { filename: string; fileSha256: string; createdAt: string } | null;
  rawMetadata: Record<string, unknown> | null;
  timelineEvents: { id: string; title: string; occurredAt: string }[];
  annotations: { id: string; text: string; authorName: string; createdAt: string }[];
}

/** Returns an href that opens the inspector for an evidence item while keeping the current view. */
export function useEvidenceHref() {
  const pathname = usePathname();
  const params = useSearchParams();
  return useCallback(
    (id: string) => {
      const next = new URLSearchParams(params.toString());
      next.set("evidence", id);
      return `${pathname}?${next}`;
    },
    [pathname, params],
  );
}

export function EvidenceChip({ id, label, title }: { id: string; label: string; title?: string }) {
  const href = useEvidenceHref();
  return (
    <Link prefetch={false} href={href(id)} scroll={false} className="ct-chip-btn no-underline" title={title ?? `Inspect evidence ${label}`} aria-label={`Inspect evidence ${label}${title ? `: ${title}` : ""}`}>
      {label}
    </Link>
  );
}

/** Drawer controlled by the `evidence` URL parameter. Mount once per page. */
export function EvidenceInspectorHost({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const notify = useToast();
  const evidenceId = params.get("evidence");
  const [data, setData] = useState<EvidenceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrap, setWrap] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | undefined>();

  const load = useCallback(async (id: string) => {
    setError(null);
    const res = await api<EvidenceDetail>(`/api/evidence/${encodeURIComponent(id)}`);
    if (res.ok) setData(res.data);
    else setError(res.status === 404 ? "This evidence record is not available in your workspace." : res.error.message);
  }, []);

  useEffect(() => {
    setData(null);
    setNote("");
    if (evidenceId) void load(evidenceId);
  }, [evidenceId, load]);

  const close = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("evidence");
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };

  async function addNote() {
    if (!data) return;
    if (!note.trim()) {
      setNoteError("Annotation is required.");
      return;
    }
    setSaving(true);
    setNoteError(undefined);
    const res = await api(`/api/evidence/${data.id}/annotations`, { body: { text: note } });
    setSaving(false);
    if (!res.ok) {
      setNoteError(res.error.message);
      return;
    }
    setNote("");
    notify("Annotation saved. The original evidence record is unchanged.");
    void load(data.id);
  }

  const prov = data ? PROVENANCE_LABELS[data.provenance as keyof typeof PROVENANCE_LABELS] : null;

  return (
    <Drawer
      open={!!evidenceId}
      onClose={close}
      title={data ? `Inspect evidence ${data.ref}` : "Inspect evidence"}
      subtitle={data ? data.title : undefined}
    >
      {error && <ErrorState message={error} action={evidenceId ? <Button size="sm" onClick={() => load(evidenceId)}>Retry</Button> : undefined} />}
      {!data && !error && (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      )}
      {data && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-1.5">
            <ProvenanceBadge value={data.provenance} />
            <ConfidenceBadge value={data.confidenceLevel} />
            <Tag>{textOf(CATEGORY_LABELS, data.category)}</Tag>
            {data.assetStatus && <Tag tone={labelOf(OBSERVED_STATUS_LABELS, data.assetStatus).tone}>Asserts asset {data.assetStatus.toLowerCase()}</Tag>}
          </div>
          {data.isSynthetic && <Banner tone="warning">Simulated company events. Not observed Microsoft tenant activity.</Banner>}
          {data.provenance === "PUBLIC_REPORTED" && (
            <Banner>Provider-reported details are not independently verified from internal provider telemetry.</Banner>
          )}
          {data.provenance === "ANALYST_NOTE" && (
            <Banner>Analyst-authored record{data.createdByName ? ` by ${data.createdByName}` : ""}; not direct provider or system evidence.</Banner>
          )}

          <dl className="ct-kv">
            <dt>Evidence ID</dt>
            <dd>
              <Mono>{data.ref}</Mono> <Mono className="text-fg-2">({data.id})</Mono>
            </dd>
            <dt>Observed at</dt>
            <dd>
              <Mono>{formatUtc(data.observedAt, { seconds: true })}</Mono>
            </dd>
            <dt>Ingested at</dt>
            <dd>
              <Mono>{formatUtc(data.ingestedAt, { seconds: true })}</Mono>
            </dd>
            <dt>Source</dt>
            <dd>{data.sourceName}</dd>
            <dt>Source event ID</dt>
            <dd>{data.sourceEventId ? <Mono>{data.sourceEventId}</Mono> : "—"}</dd>
            <dt>Provenance</dt>
            <dd>{prov ? `${prov.label} — ${prov.description}` : data.provenance}</dd>
            <dt>Linked asset</dt>
            <dd>{data.assetName ? <Link prefetch={false} href={`/assets?asset=${data.assetId}`}>{data.assetName}</Link> : "Not linked"}</dd>
            <dt>Linked case</dt>
            <dd>
              <Link prefetch={false} href={`/investigations/${data.incidentId}?tab=evidence`}>
                <Mono>{data.caseNumber}</Mono>
              </Link>
            </dd>
            <dt>Ingestion</dt>
            <dd>
              {data.importJob ? (
                <>
                  Imported from <Mono>{data.importJob.filename}</Mono>
                  {typeof data.rawMetadata?.rowNumber === "number" && <> (row {String(data.rawMetadata.rowNumber)})</>}
                </>
              ) : data.rawMetadata?.entry === "seed" ? (
                "Demonstration seed"
              ) : data.rawMetadata?.entry === "microsoft-graph" ? (
                "Microsoft Graph tenant service health (read-only)"
              ) : (
                `Manual entry${data.createdByName ? ` by ${data.createdByName}` : ""}`
              )}
            </dd>
          </dl>

          <div>
            <SectionLabel>SHA-256 (canonical record)</SectionLabel>
            <div className="ct-code" data-wrap="true">
              {data.sha256}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <CopyButton value={data.sha256} label="Copy hash" successMessage="SHA-256 copied." />
              {data.sourceUri && (
                <a className="ct-btn" data-size="sm" href={data.sourceUri} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden="true" /> External source
                </a>
              )}
            </div>
            <p className="ct-support mt-2">
              Hash of the stored canonical record; proves it is unchanged since ingestion. Not a chain of custody for the upstream system.
              {data.importJob && (
                <>
                  {" "}
                  Source file SHA-256: <Mono className="break-all">{data.importJob.fileSha256}</Mono>
                </>
              )}
            </p>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <SectionLabel>Normalised content</SectionLabel>
              <Button size="sm" variant="ghost" aria-pressed={wrap} onClick={() => setWrap((w) => !w)}>
                {wrap ? "Disable wrapping" : "Wrap lines"}
              </Button>
            </div>
            <pre className="ct-code m-0" data-wrap={wrap}>
              {data.contentText}
            </pre>
            <p className="ct-support mt-1">Rendered as plain text. Evidence content is never executed, fetched or rendered as HTML.</p>
          </div>

          {data.timelineEvents.length > 0 && (
            <div>
              <SectionLabel>Timeline events</SectionLabel>
              <ul className="text-[12.5px]">
                {data.timelineEvents.map((t) => (
                  <li key={t.id}>
                    <Mono className="text-fg-2">{formatUtc(t.occurredAt)}</Mono> — {t.title}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <SectionLabel>Analyst annotations ({data.annotations.length})</SectionLabel>
            {data.annotations.length === 0 && <p className="ct-support">No annotations yet.</p>}
            <ul className="flex flex-col gap-2">
              {data.annotations.map((a) => (
                <li key={a.id} className="rounded-[5px] border border-line bg-raised p-2.5 text-[12.5px]">
                  <div className="whitespace-pre-wrap">{a.text}</div>
                  <div className="mt-1 text-[11.5px] text-fg-2">
                    {a.authorName} · <Mono>{formatUtc(a.createdAt)}</Mono>
                  </div>
                </li>
              ))}
            </ul>
            {canEdit ? (
              <div className="mt-3">
                <TextareaField label="Add annotation" value={note} onChange={(e) => setNote(e.target.value)} error={noteError} help="Annotations are separate, audited records; the evidence itself is immutable." maxLength={4000} />
                <Button className="mt-2" size="sm" variant="primary" loading={saving} onClick={addNote}>
                  Save annotation
                </Button>
              </div>
            ) : (
              <p className="ct-support mt-2">Your role allows viewing, not editing.</p>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
