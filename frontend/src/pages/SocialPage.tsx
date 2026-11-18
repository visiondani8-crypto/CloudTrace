import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Package, RefreshCw, Save, X } from "lucide-react";
import { errorMessage, get, patch, post } from "@/lib/api";
import type { Render, SocialPackage } from "@/lib/types";
import { ago, PLATFORM_LABELS } from "@/lib/format";
import { Alert, Badge, Button, Card, CardHeader, CopyButton, EmptyState, Field, Input, NativeSelect, PageHeader, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";

function Row({ label, value, onChange, multiline, chosen, onChoose }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; chosen?: boolean; onChoose?: () => void }) {
  return (
    <div className={cn("rounded-lg border p-2.5", chosen ? "border-accent/60 bg-accent/5" : "border-line")}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-2xs font-medium uppercase tracking-wider text-muted">{label}</span>
        <div className="flex items-center gap-1">
          {onChoose && <Button size="xs" variant={chosen ? "primary" : "ghost"} onClick={onChoose}>{chosen ? "Selected" : "Use"}</Button>}
          <CopyButton text={value} />
        </div>
      </div>
      {multiline ? <Textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} /> : <Input value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

export default function SocialPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: renders } = useQuery({ queryKey: ["renders"], queryFn: () => get<Render[]>("/renders", { status: "completed" }) });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => get<any>("/settings") });
  const editId = params.get("edit") ?? renders?.[0]?.edit_id ?? null;
  const { data: pkgs } = useQuery({ queryKey: ["social", editId], queryFn: () => get<SocialPackage[]>("/social", { edit_id: editId! }), enabled: !!editId });
  const [pkgId, setPkgId] = useState<string | null>(null);
  const pkg = useMemo(() => (pkgs ?? []).find((p) => p.id === pkgId) ?? pkgs?.[0], [pkgs, pkgId]);
  const [draft, setDraft] = useState<SocialPackage | null>(null);
  const [platform, setPlatform] = useState("tiktok");
  const [tagInput, setTagInput] = useState("");
  const render = (renders ?? []).find((r) => r.edit_id === editId);

  useEffect(() => {
    setDraft(pkg ? structuredClone(pkg) : null);
    if (pkg) setPlatform(pkg.platform);
  }, [pkg]);

  const regen = useMutation({
    mutationFn: () => post<SocialPackage>("/social", { edit_id: editId, platform, render_id: render?.id ?? null }),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ["social", editId] }); setPkgId(p.id); toast({ tone: "ok", text: `Generated ${PLATFORM_LABELS[p.platform]} copy (${p.provider})` }); },
    onError: (e) => toast({ tone: "err", text: errorMessage(e) }),
  });
  const save = useMutation({
    mutationFn: () => patch<SocialPackage>(`/social/${draft!.id}`, { chosen: draft!.chosen, content: draft!.content }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["social", editId] }); toast({ tone: "ok", text: "Saved" }); },
  });

  const editsWithRenders = useMemo(() => {
    const m = new Map<string, Render>();
    for (const r of renders ?? []) if (!m.has(r.edit_id)) m.set(r.edit_id, r);
    return [...m.values()];
  }, [renders]);

  const c = draft?.content;
  const setC = (fn: (d: SocialPackage) => void) => setDraft((d) => { if (!d) return d; const n = structuredClone(d); fn(n); return n; });
  return (
    <div className="mx-auto max-w-[1360px] px-8 py-7">
      <PageHeader title="Social Media Package" sub="Copy is grounded in each clip's own words. No automatic posting — copy, edit and download." />
      {editsWithRenders.length === 0 ? (
        <EmptyState title="No rendered clips yet" sub="Render a clip in the Export Centre; a posting package is generated automatically." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
          <Card className="h-fit">
            <CardHeader title="Clips" />
            <div className="space-y-1 px-2 pb-3">
              {editsWithRenders.map((r) => (
                <button key={r.edit_id} onClick={() => setParams({ edit: r.edit_id })} className={cn("w-full rounded-md px-2.5 py-2 text-left text-xs", r.edit_id === editId ? "bg-raised text-fg" : "text-sub hover:bg-raised/60")}>
                  <div className="truncate">{r.name}</div>
                  <div className="text-2xs text-muted">{r.width}×{r.height} · {ago(r.finished_at)}</div>
                </button>
              ))}
            </div>
          </Card>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_1fr]">
            <div className="space-y-3">
              {render?.exists && (
                <div className="overflow-hidden rounded-xl border border-line bg-black" style={{ aspectRatio: `${render.width}/${render.height}` }}>
                  <video src={render.file_url!} controls className="h-full w-full object-contain" />
                </div>
              )}
              <Card className="p-3">
                <div className="flex gap-2">
                  <NativeSelect value={platform} onChange={setPlatform} options={Object.entries(PLATFORM_LABELS).map(([value, label]) => ({ value, label }))} />
                  <Button icon={<RefreshCw className="h-3.5 w-3.5" />} loading={regen.isPending} onClick={() => regen.mutate()}>Generate</Button>
                </div>
                <p className="mt-2 text-2xs text-muted">Provider: {settings?.ai?.provider ?? "local"} (change in Settings → AI providers)</p>
                {(pkgs ?? []).length > 1 && (
                  <Field label="Saved versions" className="mt-2">
                    <NativeSelect value={pkg?.id ?? ""} onChange={setPkgId} options={(pkgs ?? []).map((p) => ({ value: p.id, label: `${PLATFORM_LABELS[p.platform]} · ${p.provider} · ${ago(p.updated_at)}` }))} />
                  </Field>
                )}
              </Card>
              {draft && (
                <Card className="p-3">
                  <div className="grid grid-cols-3 gap-1.5">
                    <a href={`/api/social/${draft.id}/export.txt`}><Button size="sm" className="w-full" icon={<Download className="h-3 w-3" />}>TXT</Button></a>
                    <a href={`/api/social/${draft.id}/export.json`}><Button size="sm" className="w-full" icon={<Download className="h-3 w-3" />}>JSON</Button></a>
                    <a href={`/api/social/${draft.id}/export.csv`}><Button size="sm" className="w-full" icon={<Download className="h-3 w-3" />}>CSV</Button></a>
                  </div>
                  {render && <a href={`/api/projects/${render.project_id}/package.zip?render_ids=${render.id}`}><Button variant="primary" className="mt-2 w-full" icon={<Package className="h-4 w-4" />}>Download video + metadata</Button></a>}
                </Card>
              )}
            </div>
            {draft && c ? (
              <Card>
                <CardHeader title={`${PLATFORM_LABELS[draft.platform]} package`} sub={`Generated by ${draft.provider}${draft.usage?.cost_usd ? ` · est. $${draft.usage.cost_usd}` : ""}`}
                  action={<Button size="sm" variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} onClick={() => save.mutate()}>Save choices</Button>} />
                <div className="space-y-3 px-4 pb-4">
                  {(c.warnings ?? []).map((w) => <Alert key={w} tone="warn">{w}</Alert>)}
                  {(c.grounding?.issues ?? []).length > 0 && <Alert tone="warn" title="Grounding check removed unsupported content">{c.grounding.issues.join(" · ")}</Alert>}
                  <h4 className="text-xs font-semibold text-sub">Titles</h4>
                  {c.titles.map((t, i) => (
                    <Row key={i} label={t.style} value={t.text} chosen={draft.chosen.title === t.text}
                      onChoose={() => setC((d) => { d.chosen.title = d.content.titles[i].text; })}
                      onChange={(v) => setC((d) => { const was = d.chosen.title === d.content.titles[i].text; d.content.titles[i].text = v; if (was) d.chosen.title = v; })} />
                  ))}
                  <h4 className="pt-1 text-xs font-semibold text-sub">Descriptions</h4>
                  {(["short", "medium", "long"] as const).map((k) => (
                    <Row key={k} label={k} multiline value={c.descriptions[k]} chosen={draft.chosen.description === c.descriptions[k]}
                      onChoose={() => setC((d) => { d.chosen.description = d.content.descriptions[k]; })}
                      onChange={(v) => setC((d) => { const was = d.chosen.description === d.content.descriptions[k]; d.content.descriptions[k] = v; if (was) d.chosen.description = v; })} />
                  ))}
                  <div className="rounded-lg border border-line p-2.5">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-2xs font-medium uppercase tracking-wider text-muted">Hashtags</span>
                      <CopyButton text={(draft.chosen.hashtags ?? c.hashtags).join(" ")} />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(draft.chosen.hashtags ?? c.hashtags).map((h) => (
                        <span key={h} className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-xs text-accent">
                          {h}
                          <button onClick={() => setC((d) => { d.chosen.hashtags = (d.chosen.hashtags ?? d.content.hashtags).filter((x) => x !== h); })} aria-label={`Remove ${h}`}><X className="h-3 w-3" /></button>
                        </span>
                      ))}
                      <form onSubmit={(e) => { e.preventDefault(); const t = tagInput.trim().replace(/^#?/, "#").replace(/[^#\w]/g, ""); if (t.length > 1) setC((d) => { d.chosen.hashtags = [...(d.chosen.hashtags ?? d.content.hashtags), t]; }); setTagInput(""); }}>
                        <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="Add hashtag" className="h-6 w-32 text-xs" />
                      </form>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Row label="Hook text" value={c.hook_text} onChange={(v) => setC((d) => { d.content.hook_text = v; })} />
                    <Row label="Thumbnail title" value={c.thumbnail_title} onChange={(v) => setC((d) => { d.content.thumbnail_title = v; })} />
                  </div>
                  <Row label="Keywords" value={c.keywords.join(", ")} onChange={(v) => setC((d) => { d.content.keywords = v.split(",").map((x) => x.trim()).filter(Boolean); })} />
                  <div className="rounded-lg border border-line p-2.5">
                    <div className="mb-1 flex items-center justify-between"><span className="text-2xs font-medium uppercase tracking-wider text-muted">Posting suggestions</span><CopyButton text={c.suggestions.join("\n")} /></div>
                    <ul className="space-y-1 text-xs text-fg/85">{c.suggestions.map((s) => <li key={s}>• {s}</li>)}</ul>
                    <p className="mt-2 text-2xs text-muted">Suggestions are presentation tips, not performance predictions.</p>
                  </div>
                  {c.grounding?.source_sentences && (
                    <details className="text-2xs text-muted">
                      <summary className="cursor-pointer">Source sentences used</summary>
                      <ul className="mt-1 space-y-0.5">{c.grounding.source_sentences.map((s: string) => <li key={s}>“{s}”</li>)}</ul>
                    </details>
                  )}
                  <Badge>{draft.provider === "local" ? "Extractive (local)" : `LLM (${draft.provider}) + grounding check`}</Badge>
                </div>
              </Card>
            ) : (
              <EmptyState title="No package for this clip yet" sub="Choose a platform and press Generate." />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
