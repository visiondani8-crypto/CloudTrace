import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, ExternalLink, FolderOpen, Package, Scissors, Send, Share2, Trash2, XCircle } from "lucide-react";
import { del, errorMessage, get, post } from "@/lib/api";
import type { ExportSettings, Job, Render } from "@/lib/types";
import { ago, bytes, dur, PLATFORM_LABELS, STYLE_LABELS } from "@/lib/format";
import { Alert, Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, NativeSelect, PageHeader, Segmented, Switch, useToast } from "@/components/ui";
import { JobRow } from "@/components/layout/JobsPanel";
import { cn } from "@/lib/cn";

interface EditRow { id: string; name: string; style: string; version: number; project_id: string; aspect: string; is_current: boolean; updated_at: string }

function ValidationView({ r }: { r: Render }) {
  const v = r.validation;
  if (!v) return null;
  return (
    <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
      {v.checks.map((c) => (
        <div key={c.name} className="flex items-start gap-1.5 text-2xs">
          {c.ok ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-ok" /> : c.severity === "warning" ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warn" /> : <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-err" />}
          <span><span className="text-sub">{c.name.replace(/_/g, " ")}:</span> <span className="text-fg/80">{c.detail}</span></span>
        </div>
      ))}
    </div>
  );
}

export default function ExportCentre() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => get<any>("/settings") });
  const { data: presets } = useQuery({ queryKey: ["export-presets"], queryFn: () => get<any>("/export/presets") });
  const { data: lib } = useQuery({ queryKey: ["library", "edits"], queryFn: () => get<{ edits: EditRow[] }>("/library", { kind: "edits" }), refetchInterval: 8000 });
  const { data: renders } = useQuery({ queryKey: ["renders"], queryFn: () => get<Render[]>("/renders"), refetchInterval: 5000 });
  const { data: jobs } = useQuery({ queryKey: ["jobs", "render"], queryFn: () => get<Job[]>("/jobs", { status: "queued,running,paused,failed", limit: 50 }), refetchInterval: 3000 });
  const [sel, setSel] = useState<Set<string>>(new Set((params.get("edits") ?? "").split(",").filter(Boolean)));
  const [s, setS] = useState<ExportSettings | null>(null);
  const [details, setDetails] = useState<Render | null>(null);
  const edits = useMemo(() => (lib?.edits ?? []).filter((e) => e.is_current), [lib]);

  useEffect(() => {
    if (settings && !s) {
      const d = settings.export_defaults;
      setS({ preset: d.preset, resolution: d.resolution, codec: d.codec, quality_mode: "crf", crf: d.crf, encoder_speed: d.encoder_speed, hardware: d.hardware,
        audio_bitrate_kbps: d.audio_bitrate_kbps, burn_captions: d.burn_captions, export_srt: d.export_srt, allow_upscale: false, platform: settings.defaults.platform, output_folder: "", name: "" });
    }
  }, [settings, s]);

  const first = [...sel][0];
  const { data: est, error: estErr } = useQuery({
    queryKey: ["estimate", first, s],
    queryFn: () => post<any>("/export/estimate", { edit_id: first, settings: { ...s, output_folder: s?.output_folder || null } }),
    enabled: !!first && !!s,
  });

  const start = useMutation({
    mutationFn: () => post<{ render_id: string; job_id: string }[]>("/renders", { edit_ids: [...sel], settings: { ...s, output_folder: s?.output_folder || null, name: sel.size === 1 ? s?.name : "" }, generate_social: true }),
    onSuccess: (r) => { toast({ tone: "accent", text: `Queued ${r.length} render(s)` }); qc.invalidateQueries({ queryKey: ["jobs"] }); qc.invalidateQueries({ queryKey: ["renders"] }); },
    onError: (e) => toast({ tone: "err", text: errorMessage(e) }),
  });
  const reveal = useMutation({
    mutationFn: (id: string) => post<{ opened: boolean; folder: string }>(`/renders/${id}/reveal`),
    onSuccess: (r) => toast({ tone: r.opened ? "ok" : "accent", text: r.opened ? `Opened ${r.folder}` : `Output folder: ${r.folder}` }),
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/renders/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["renders"] }) });

  if (!s) return null;
  const up = (p: Partial<ExportSettings>) => setS({ ...s, ...p });
  const renderJobs = (jobs ?? []).filter((j) => j.kind === "render");
  const done = (renders ?? []).filter((r) => ["completed", "failed_validation"].includes(r.status));
  const byProject = done.reduce<Record<string, Render[]>>((a, r) => ((a[r.project_id] ||= []).push(r), a), {});
  const isCustom = s.preset === "custom";
  return (
    <div className="mx-auto max-w-[1360px] px-8 py-7">
      <PageHeader title="Export Centre" sub="Renders always read the original footage — proxies are never used for output." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Edits ready to export" sub={`${sel.size} selected`} action={edits.length > 0 && <Button size="xs" variant="ghost" onClick={() => setSel(sel.size === edits.length ? new Set() : new Set(edits.map((e) => e.id)))}>{sel.size === edits.length ? "Clear" : "Select all"}</Button>} />
            <div className="max-h-[320px] space-y-1 overflow-y-auto px-4 pb-4">
              {edits.length === 0 && <EmptyState title="No edits yet" sub="Open a highlight in the editor or use Prepare Edits on the highlights page." />}
              {edits.map((e) => (
                <label key={e.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2", sel.has(e.id) ? "border-accent/60 bg-accent/5" : "border-line hover:border-sub")}>
                  <input type="checkbox" checked={sel.has(e.id)} onChange={(ev) => { const n = new Set(sel); ev.target.checked ? n.add(e.id) : n.delete(e.id); setSel(n); }} className="accent-[#5B8CFF]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{e.name}</div>
                    <div className="text-2xs text-muted">v{e.version} · {STYLE_LABELS[e.style] ?? e.style} · {e.aspect} · edited {ago(e.updated_at)}</div>
                  </div>
                  <Link to={`/editor/${e.id}`} className="text-sub hover:text-accent" aria-label="Open in editor"><Scissors className="h-4 w-4" /></Link>
                </label>
              ))}
            </div>
          </Card>
          {renderJobs.length > 0 && (
            <Card>
              <CardHeader title="Render queue" sub={`Concurrent renders are limited by available memory and CPU.`} />
              <div className="space-y-2 px-4 pb-4">{renderJobs.map((j) => <JobRow key={j.id} job={j} />)}</div>
            </Card>
          )}
          <Card>
            <CardHeader title="Completed renders" />
            <div className="space-y-4 px-4 pb-4">
              {done.length === 0 && <p className="text-xs text-muted">Nothing rendered yet.</p>}
              {Object.entries(byProject).map(([pid, list]) => (
                <div key={pid}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs text-sub">{list.length} clip(s)</span>
                    <div className="flex gap-1.5">
                      <a href={`/api/projects/${pid}/metadata.csv`}><Button size="xs" icon={<Download className="h-3 w-3" />}>Metadata CSV</Button></a>
                      <a href={`/api/projects/${pid}/metadata.json`}><Button size="xs" icon={<Download className="h-3 w-3" />}>JSON</Button></a>
                      <a href={`/api/projects/${pid}/package.zip`} data-testid="download-package"><Button size="xs" variant="primary" icon={<Package className="h-3 w-3" />}>Download package</Button></a>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
                    {list.map((r) => (
                      <div key={r.id} className="rounded-lg border border-line bg-bg/40 p-2" data-testid="render-card">
                        <div className="overflow-hidden rounded-md bg-black" style={{ aspectRatio: `${r.width}/${r.height}`, maxHeight: 260 }}>
                          {r.exists ? <video src={r.file_url!} controls preload="metadata" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-2xs text-err">File missing</div>}
                        </div>
                        <div className="mt-1.5 truncate text-xs font-medium">{r.name}</div>
                        <div className="flex items-center justify-between text-2xs text-muted">
                          <span>{r.width}×{r.height} · {dur(r.duration)} · {bytes(r.file_size)}</span>
                          {r.status === "completed" ? <Badge tone="ok">validated</Badge> : <Badge tone="err">check failed</Badge>}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {r.exists && <a href={`${r.file_url}?download=true`}><Button size="xs" icon={<Download className="h-3 w-3" />}>Download</Button></a>}
                          <Button size="xs" variant="ghost" icon={<FolderOpen className="h-3 w-3" />} onClick={() => reveal.mutate(r.id)}>Folder</Button>
                          <Link to={`/social?edit=${r.edit_id}`}><Button size="xs" variant="ghost" icon={<Share2 className="h-3 w-3" />}>Social</Button></Link>
                          <Button size="xs" variant="ghost" onClick={() => setDetails(r)}>Report</Button>
                          <Button size="xs" variant="ghost" aria-label="Remove from list" onClick={() => remove.mutate(r.id)}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <Card className="h-fit xl:sticky xl:top-4">
          <CardHeader title="Export settings" />
          <div className="space-y-3 px-4 pb-4">
            {sel.size <= 1 && <Field label="Export name"><Input value={s.name ?? ""} onChange={(e) => up({ name: e.target.value })} placeholder="Uses the clip title" /></Field>}
            <Field label="Quality preset">
              <NativeSelect value={s.preset} onChange={(v) => up({ preset: v as any, resolution: null, codec: (presets?.presets?.[v]?.codec ?? s.codec) as any })}
                options={Object.entries(presets?.presets ?? {}).map(([k, p]: any) => ({ value: k, label: p.label }))} />
            </Field>
            <p className="-mt-2 text-2xs text-muted">{presets?.presets?.[s.preset]?.description}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Platform"><NativeSelect value={s.platform ?? "tiktok"} onChange={(v) => up({ platform: v as any })} options={Object.entries(PLATFORM_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
              <Field label="Resolution"><NativeSelect value={s.resolution ?? ""} onChange={(v) => up({ resolution: (v || null) as any })} options={[{ value: "", label: "Preset default" }, { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }, { value: "1440p", label: "1440p" }, { value: "2160p", label: "2160p / 4K" }, { value: "source", label: "Match source detail" }]} /></Field>
              <Field label="Frame rate"><NativeSelect value={s.fps ?? ""} onChange={(v) => up({ fps: v ? Number(v) : null })} options={[{ value: "", label: "Source" }, ...[24, 25, 30, 50, 60].map((f) => ({ value: f, label: `${f} fps` }))]} /></Field>
              <Field label="Codec"><NativeSelect value={s.codec} disabled={!isCustom} onChange={(v) => up({ codec: v as any })} options={[{ value: "h264", label: "H.264 (MP4)" }, { value: "hevc", label: "H.265/HEVC (MP4)", disabled: !presets?.hardware?.encoders?.libx265 && !presets?.hardware?.encoders?.hevc_videotoolbox }, { value: "prores", label: "ProRes 422 HQ (MOV)", disabled: !presets?.hardware?.encoders?.prores_ks }]} /></Field>
            </div>
            {isCustom && (
              <>
                <Field label="Rate control"><Segmented size="sm" value={s.quality_mode} onChange={(v) => up({ quality_mode: v })} options={[{ value: "crf", label: "Constant quality" }, { value: "bitrate", label: "Bitrate" }]} /></Field>
                {s.quality_mode === "crf" ? (
                  <Field label={`Quality (CRF ${s.crf}) — lower is better`}><input type="range" min={12} max={30} value={s.crf} onChange={(e) => up({ crf: Number(e.target.value) })} className="w-full" /></Field>
                ) : (
                  <Field label="Video bitrate (kbps)"><Input type="number" value={s.bitrate_kbps ?? 12000} onChange={(e) => up({ bitrate_kbps: Number(e.target.value) })} /></Field>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Encoder speed"><NativeSelect value={s.encoder_speed} onChange={(v) => up({ encoder_speed: v as any })} options={[{ value: "fast", label: "Fast" }, { value: "medium", label: "Medium" }, { value: "slow", label: "Slow (best)" }]} /></Field>
                  <Field label="Audio (kbps)"><NativeSelect value={s.audio_bitrate_kbps} onChange={(v) => up({ audio_bitrate_kbps: Number(v) })} options={[128, 160, 192, 256, 320].map((b) => ({ value: b, label: `${b} AAC` }))} /></Field>
                </div>
              </>
            )}
            <Field label="Encoder" hint={presets?.hardware?.notes?.[0]}>
              <Segmented size="sm" value={s.hardware} onChange={(v) => up({ hardware: v })} options={[{ value: "cpu", label: "CPU (x264/x265)" }, { value: "videotoolbox", label: "VideoToolbox" }, { value: "auto", label: "Auto" }]} />
            </Field>
            {s.hardware !== "cpu" && !presets?.hardware?.videotoolbox && <Alert tone="warn">VideoToolbox is not available on this machine; the CPU encoder will be used.</Alert>}
            <Field label="Output folder" hint={`Default: ${settings.storage.exports_dir}/<project>`}><Input value={s.output_folder ?? ""} onChange={(e) => up({ output_folder: e.target.value })} placeholder="Default exports folder" /></Field>
            <Switch checked={s.burn_captions} onChange={(v) => up({ burn_captions: v })} label="Burn captions into video" />
            <Switch checked={s.export_srt} onChange={(v) => up({ export_srt: v })} label="Also save SRT + VTT files" />
            <Switch checked={s.allow_upscale} onChange={(v) => up({ allow_upscale: v })} label="Allow upscaling beyond 2× source detail" />
            {est && (
              <div className="rounded-lg border border-line bg-bg/50 p-3 text-xs" data-testid="estimate">
                <div className="flex justify-between"><span className="text-sub">Output</span><span className="tabular">{est.width}×{est.height} · {est.fps} fps</span></div>
                <div className="flex justify-between"><span className="text-sub">Duration</span><span className="tabular">{dur(est.duration)}</span></div>
                <div className="flex justify-between"><span className="text-sub">Estimated size</span><span className="tabular">~{bytes(est.estimated_bytes)}</span></div>
                <p className={cn("mt-2 text-2xs", est.scale.is_upscaled ? "text-warn" : "text-sub")}>{est.scale.message}</p>
                {est.blocked && <p className="mt-1 text-2xs text-err">This resolution would upscale more than 2×. Lower it or enable “Allow upscaling”.</p>}
              </div>
            )}
            {estErr && <Alert tone="err">{errorMessage(estErr)}</Alert>}
            <Button variant="primary" size="lg" className="w-full" icon={<Send className="h-4 w-4" />} disabled={!sel.size || est?.blocked} loading={start.isPending} onClick={() => start.mutate()} data-testid="start-render">
              Start render{sel.size > 1 ? ` (${sel.size})` : ""}
            </Button>
            <p className="text-center text-2xs text-muted">Each finished file is checked: streams, resolution, duration, decoding, A/V sync, loudness and overlay presence.</p>
          </div>
        </Card>
      </div>
      <Dialog open={!!details} onOpenChange={() => setDetails(null)} title="Render report" description={details?.output_path ?? ""} wide>
        {details && (
          <div className="space-y-3">
            <ValidationView r={details} />
            {details.settings?.report?.scale && <p className="text-xs text-sub">{details.settings.report.scale.message}</p>}
            {details.settings?.report?.audio && <p className="text-xs text-sub">Audio: target {details.settings.report.audio.loudness_target} LUFS{details.settings.report.audio.measured_input_lufs != null && `, source mix measured ${details.settings.report.audio.measured_input_lufs} LUFS`}</p>}
            {details.settings?.report?.video && <p className="text-xs text-sub">Rendered {details.settings.report.video.frames} frames at {details.settings.report.video.render_speed_x}× realtime{details.settings.report.video.hdr_tonemapped && " · HDR tone-mapped to SDR"}</p>}
            {details.exists && <a href={details.file_url!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent">Open file <ExternalLink className="h-3 w-3" /></a>}
          </div>
        )}
      </Dialog>
    </div>
  );
}
