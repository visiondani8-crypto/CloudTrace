import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, FileVideo, Link2Off, Pencil, Play, Sparkles, Wand2 } from "lucide-react";
import { errorMessage, get, patch, post } from "@/lib/api";
import type { AnalysisSettings, Job, MediaSource, Project } from "@/lib/types";
import { bytes, dur, MODE_LABELS, PLATFORM_LABELS, STYLE_LABELS, tc } from "@/lib/format";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, NativeSelect, PageHeader, Segmented, Spinner, Switch, Textarea, useToast } from "@/components/ui";
import { JobRow } from "@/components/layout/JobsPanel";
import { cn } from "@/lib/cn";

const DURATIONS = [
  { value: "auto", label: "Auto (18–75s)" },
  { value: "10-20", label: "10–20 s" },
  { value: "20-35", label: "20–35 s" },
  { value: "30-60", label: "30–60 s" },
  { value: "35-60", label: "35–60 s" },
  { value: "60-90", label: "60–90 s" },
  { value: "90-180", label: "90–180 s" },
  { value: "custom", label: "Custom…" },
];
const CAPTION_STYLES = [
  ["bold_social", "Bold Social"], ["clean_white", "Clean White"], ["word_by_word", "Word-by-Word"], ["karaoke", "Karaoke Highlight"],
  ["cinematic_minimal", "Cinematic Minimal"], ["documentary", "Documentary"], ["creator", "Creator Style"], ["neon", "Neon Highlight"],
  ["gaming", "Gaming"], ["custom_brand", "Custom Brand"],
];

function MetaRow({ k, v, warn }: { k: string; v: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line/60 py-1.5 text-xs last:border-0">
      <span className="text-sub">{k}</span>
      <span className={cn("text-right tabular", warn ? "text-warn" : "text-fg")}>{v}</span>
    </div>
  );
}

export function SourceMeta({ src }: { src: MediaSource }) {
  const p = src.probe;
  if (!p) return <p className="text-xs text-muted">Not inspected yet.</p>;
  return (
    <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
      <div>
        <MetaRow k="Duration" v={tc(p.duration)} />
        <MetaRow k="Resolution" v={`${p.display_width}×${p.display_height}${p.rotation ? ` (rotated ${p.rotation}°)` : ""}`} />
        <MetaRow k="Display aspect" v={p.display_aspect_ratio} />
        <MetaRow k="Frame rate" v={`${p.fps} fps${p.variable_frame_rate ? " (variable)" : ""}`} warn={p.variable_frame_rate} />
        <MetaRow k="Video codec" v={`${p.video_codec}${p.video_profile ? ` · ${p.video_profile}` : ""} · ${p.pix_fmt} · ${p.bit_depth}-bit`} />
        <MetaRow k="HDR" v={p.hdr ? p.hdr_format : "SDR"} warn={p.hdr} />
      </div>
      <div>
        <MetaRow k="Bitrate" v={p.bit_rate ? `${(p.bit_rate / 1e6).toFixed(1)} Mbps` : "—"} />
        <MetaRow k="Audio" v={p.has_audio ? `${p.audio_codec} · ${p.audio_channels} ch · ${(p.audio_sample_rate / 1000).toFixed(1)} kHz` : "No audio track"} warn={!p.has_audio} />
        <MetaRow k="File size" v={bytes(p.size_bytes)} />
        <MetaRow k="Container" v={p.container} />
        <MetaRow k="Storage" v={src.referenced ? "Linked (not copied)" : src.kind === "url" ? "Downloaded" : "Copied into library"} />
        <MetaRow k="Colour" v={[p.color_space, p.color_transfer].filter(Boolean).join(" / ") || "untagged"} />
      </div>
    </div>
  );
}

export default function ProjectPage() {
  const { pid } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [params] = useSearchParams();
  const { data: project, isLoading } = useQuery({ queryKey: ["project", pid], queryFn: () => get<Project>(`/projects/${pid}`), refetchInterval: 5000 });
  const { data: appSettings } = useQuery({ queryKey: ["settings"], queryFn: () => get<any>("/settings") });
  const { data: providers } = useQuery({ queryKey: ["providers"], queryFn: () => get<any>("/providers") });
  const [st, setSt] = useState<AnalysisSettings | null>(null);
  const [batch, setBatch] = useState(!!params.get("batch"));
  const [batchOpts, setBatchOpts] = useState({ prepare_count: 6, style: "dynamic", aspect: "9:16", caption_style: "bold_social", auto_render: false });
  const [relink, setRelink] = useState("");
  const [rename, setRename] = useState<string | null>(null);
  const src = project?.sources?.[0];

  useEffect(() => {
    if (!project || !appSettings || st) return;
    const d = appSettings.defaults;
    const s = project.settings ?? {};
    setSt({
      analysis_mode: (s.analysis_mode as any) ?? d.analysis_mode ?? "balanced",
      content_mode: (s.content_mode as any) ?? d.content_mode ?? "podcast",
      platforms: (s.platforms as any) ?? [d.platform ?? "tiktok"],
      duration_preset: (s.duration_preset as any) ?? "auto",
      min_duration: (s.min_duration as any) ?? 20,
      max_duration: (s.max_duration as any) ?? 60,
      count: (s.count as any) ?? null,
      min_score: (s.min_score as any) ?? null,
      language: (s.language as any) ?? null,
      custom_instructions: (s.custom_instructions as any) ?? "",
      transcription_engine: (s.transcription_engine as any) ?? "auto",
      ai_provider: (s.ai_provider as any) ?? appSettings.ai.provider ?? "local",
      diarize: true,
    });
  }, [project, appSettings, st]);

  const activeJob = useMemo(() => (project?.jobs ?? []).find((j) => ["queued", "running", "paused"].includes(j.status) && ["analyze", "batch", "url_import"].includes(j.kind)), [project]);
  const lastJob = (project?.jobs ?? []).find((j) => ["analyze", "batch"].includes(j.kind));
  const { data: liveJob } = useQuery({ queryKey: ["job", activeJob?.id], queryFn: () => get<Job>(`/jobs/${activeJob!.id}`), enabled: !!activeJob, refetchInterval: 2000 });

  const start = useMutation({
    mutationFn: async () => {
      if (!src || !st) throw new Error("No source");
      const settings = { ...st, min_duration: st.duration_preset === "custom" ? st.min_duration : null, max_duration: st.duration_preset === "custom" ? st.max_duration : null };
      if (batch) {
        return post<Job>(`/projects/${pid}/batch`, {
          source_id: src.id,
          settings: {
            analysis: settings, auto_prepare: true, prepare_count: batchOpts.prepare_count, aspect: batchOpts.aspect, edit_style: batchOpts.style,
            caption_style: batchOpts.caption_style, auto_render: batchOpts.auto_render,
            export: batchOpts.auto_render ? { ...(appSettings?.export_defaults ?? {}), platform: settings.platforms[0] } : null,
          },
        });
      }
      return post<Job>(`/projects/${pid}/analyze`, { source_id: src.id, settings });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", pid] });
      toast({ tone: "accent", text: batch ? "Batch started: analysis → edits" : "Analysis started" });
    },
    onError: (e) => toast({ tone: "err", text: errorMessage(e) }),
  });
  const doRelink = useMutation({
    mutationFn: () => post(`/sources/${src!.id}/relink`, { path: relink }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project", pid] }); toast({ tone: "ok", text: "Source relinked" }); },
    onError: (e) => toast({ tone: "err", text: errorMessage(e) }),
  });
  const doRename = useMutation({
    mutationFn: (name: string) => patch(`/projects/${pid}`, { name }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project", pid] }); qc.invalidateQueries({ queryKey: ["projects"] }); setRename(null); },
  });

  if (isLoading || !project) return <div className="p-8"><Spinner /></div>;
  const up = (k: keyof AnalysisSettings, v: any) => setSt((s) => (s ? { ...s, [k]: v } : s));
  const summary = project.summary ?? {};
  const job = liveJob ?? activeJob;
  const anthropicOk = providers?.anthropic?.available && providers?.anthropic?.cloud_consent;
  return (
    <div className="mx-auto max-w-[1280px] px-8 py-7">
      <PageHeader
        title={
          rename !== null ? (
            <form onSubmit={(e) => { e.preventDefault(); doRename.mutate(rename); }} className="flex gap-2">
              <Input autoFocus value={rename} onChange={(e) => setRename(e.target.value)} className="h-9 w-80 text-base" />
              <Button type="submit" variant="primary">Save</Button>
            </form>
          ) : (
            <span className="flex items-center gap-2">{project.name}<button onClick={() => setRename(project.name)} className="text-muted hover:text-fg" aria-label="Rename project"><Pencil className="h-4 w-4" /></button></span>
          )
        }
        sub="Import & analysis"
        actions={
          summary.analysis_id && (
            <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} onClick={() => nav(`/projects/${pid}/highlights`)}>
              Review highlights <ArrowRight className="h-4 w-4" />
            </Button>
          )
        }
      />
      {!src && (
        <Alert tone="accent" title="No video yet">
          {(project.jobs ?? []).some((j) => j.kind === "url_import" && j.status !== "completed") ? "Downloading…" : <Link to="/new" className="underline">Import a video</Link>}
        </Alert>
      )}
      {src && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <div className="space-y-4 xl:col-span-3">
            <Card>
              <CardHeader title={<span className="flex items-center gap-2"><FileVideo className="h-4 w-4 text-accent" />{src.original_name}</span>} sub={src.path} action={src.missing ? <Badge tone="err">Missing</Badge> : <Badge tone="ok">Available</Badge>} />
              <div className="px-4 pb-4">
                {src.has_proxy && (
                  <video src={`/api/sources/${src.id}/proxy`} controls preload="metadata" className="mb-3 aspect-video w-full rounded-lg bg-black" />
                )}
                <SourceMeta src={src} />
                {(src.probe?.warnings ?? []).map((w) => <p key={w} className="mt-2 flex gap-1.5 text-2xs text-warn"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{w}</p>)}
                {src.referenced && !src.missing && <p className="mt-2 text-2xs text-muted">This file is linked, not copied. If you move or rename it, use Relink.</p>}
                {src.missing && (
                  <div className="mt-3 rounded-lg border border-err/30 bg-err/5 p-3">
                    <p className="flex items-center gap-1.5 text-xs text-err"><Link2Off className="h-4 w-4" />The original file can't be found. Point ClipForge to its new location:</p>
                    <div className="mt-2 flex gap-2">
                      <Input value={relink} onChange={(e) => setRelink(e.target.value)} placeholder="/new/path/to/video.mp4" />
                      <Button onClick={() => doRelink.mutate()} loading={doRelink.isPending} disabled={!relink}>Relink</Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
            {job && <JobRow job={job} />}
            {!job && lastJob?.status === "failed" && <JobRow job={lastJob} />}
            {summary.analysis_id && (
              <Card>
                <CardHeader title="What this video is about" sub={`${summary.sentences} sentences · ${summary.topics?.length ?? 0} topics · ${summary.speakers ?? 1} speaker(s)${summary.speaker_confidence ? ` (confidence ${(summary.speaker_confidence * 100).toFixed(0)}%, experimental)` : ""} · ${summary.engine} (${summary.language})`} />
                <div className="space-y-3 px-4 pb-4">
                  <div className="flex flex-wrap gap-1.5">{(summary.keywords ?? []).map((k: string) => <Badge key={k}>{k}</Badge>)}</div>
                  <div className="space-y-1">
                    {(summary.topics ?? []).map((t: any) => (
                      <div key={t.id} className="flex items-center gap-3 text-xs">
                        <span className="w-24 shrink-0 tabular text-muted">{tc(t.start)}–{tc(t.end)}</span>
                        <span className="text-fg">{t.label}</span>
                        <span className="truncate text-muted">{t.keywords?.slice(2).join(", ")}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-4 text-2xs text-sub">
                    <span>Speech {Math.round((summary.speech_ratio ?? 0) * 100)}%</span>
                    <span>Faces on screen {Math.round((summary.face_presence ?? 0) * 100)}%</span>
                    <span>{summary.scene_count} shots</span>
                    <span>{summary.questions} questions</span>
                  </div>
                </div>
              </Card>
            )}
          </div>
          <div className="xl:col-span-2">
            {st && (
              <Card className="sticky top-4">
                <CardHeader title="Analysis settings" sub="Changing captions or colours later never re-runs analysis — results are cached." />
                <div className="space-y-3.5 px-4 pb-4">
                  <Field label="Analysis mode">
                    <Segmented
                      value={st.analysis_mode}
                      onChange={(v) => up("analysis_mode", v)}
                      options={[{ value: "fast", label: "Fast", title: "Lower cost, quicker candidate generation" }, { value: "balanced", label: "Balanced" }, { value: "deep", label: "Deep Analysis", title: "Finer visual sampling, more candidates, AI refinement — takes longer" }]}
                    />
                  </Field>
                  {st.analysis_mode === "deep" && <p className="-mt-2 text-2xs text-warn">Deep Analysis takes noticeably longer (finer visual sampling, wider beam search{st.ai_provider !== "local" ? ", AI refinement" : ""}).</p>}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Content type">
                      <NativeSelect value={st.content_mode} onChange={(v) => up("content_mode", v)} options={Object.entries(MODE_LABELS).map(([value, label]) => ({ value, label }))} />
                    </Field>
                    <Field label="Target platform">
                      <NativeSelect value={st.platforms[0]} onChange={(v) => up("platforms", [v])} options={Object.entries(PLATFORM_LABELS).map(([value, label]) => ({ value, label }))} />
                    </Field>
                    <Field label="Clip duration">
                      <NativeSelect value={st.duration_preset} onChange={(v) => up("duration_preset", v)} options={DURATIONS} />
                    </Field>
                    <Field label="Number of highlights" hint="Blank = automatic">
                      <Input type="number" min={1} max={50} value={st.count ?? ""} onChange={(e) => up("count", e.target.value ? Number(e.target.value) : null)} placeholder="Auto" />
                    </Field>
                  </div>
                  {st.duration_preset === "custom" && (
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Min seconds"><Input type="number" value={st.min_duration ?? 20} onChange={(e) => up("min_duration", Number(e.target.value))} /></Field>
                      <Field label="Max seconds"><Input type="number" value={st.max_duration ?? 60} onChange={(e) => up("max_duration", Number(e.target.value))} /></Field>
                    </div>
                  )}
                  <Field label="Minimum highlight score" hint="Only clips at or above this score are returned. Blank = adaptive.">
                    <Input type="number" min={0} max={100} value={st.min_score ?? ""} onChange={(e) => up("min_score", e.target.value ? Number(e.target.value) : null)} placeholder="Adaptive" />
                  </Field>
                  <Field label="Custom instructions" hint="These change selection and scoring, e.g. “Find the funniest moments between 20 and 45 seconds and avoid long pauses”.">
                    <Textarea rows={3} value={st.custom_instructions} onChange={(e) => up("custom_instructions", e.target.value)} placeholder="Optional" data-testid="instructions" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Language">
                      <Input value={st.language ?? ""} onChange={(e) => up("language", e.target.value || null)} placeholder="Auto-detect" />
                    </Field>
                    <Field label="AI assistance">
                      <NativeSelect
                        value={st.ai_provider}
                        onChange={(v) => up("ai_provider", v)}
                        options={[
                          { value: "local", label: "Local (no LLM)" },
                          { value: "ollama", label: `Ollama${providers?.ollama?.available ? "" : " (unavailable)"}`, disabled: !providers?.ollama?.available },
                          { value: "anthropic", label: `Anthropic${anthropicOk ? " (cloud)" : " (not set up)"}`, disabled: !anthropicOk },
                        ]}
                      />
                    </Field>
                  </div>
                  {st.ai_provider === "anthropic" && <Alert tone="warn">Cloud processing: transcript text of candidate clips is sent to Anthropic. Video and audio never leave this machine.</Alert>}
                  <div className="rounded-lg border border-line p-3">
                    <Switch checked={batch} onChange={setBatch} label={<span className="flex items-center gap-1.5"><Wand2 className="h-3.5 w-3.5 text-accent" />Batch: prepare edits automatically</span>} />
                    {batch && (
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <Field label="Edits to prepare"><Input type="number" min={1} max={50} value={batchOpts.prepare_count} onChange={(e) => setBatchOpts({ ...batchOpts, prepare_count: Number(e.target.value) })} /></Field>
                        <Field label="Aspect ratio"><NativeSelect value={batchOpts.aspect} onChange={(v) => setBatchOpts({ ...batchOpts, aspect: v })} options={["9:16", "1:1", "4:5", "16:9"].map((a) => ({ value: a, label: a }))} /></Field>
                        <Field label="Editing style"><NativeSelect value={batchOpts.style} onChange={(v) => setBatchOpts({ ...batchOpts, style: v })} options={Object.entries(STYLE_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
                        <Field label="Captions"><NativeSelect value={batchOpts.caption_style} onChange={(v) => setBatchOpts({ ...batchOpts, caption_style: v })} options={CAPTION_STYLES.map(([value, label]) => ({ value, label }))} /></Field>
                        <div className="col-span-2"><Switch checked={batchOpts.auto_render} onChange={(v) => setBatchOpts({ ...batchOpts, auto_render: v })} label="Also render with export defaults (skip review)" /></div>
                      </div>
                    )}
                  </div>
                  <Button variant="primary" size="lg" className="w-full" icon={<Play className="h-4 w-4" />} loading={start.isPending} disabled={!!activeJob || src.missing} onClick={() => start.mutate()} data-testid="start-analysis">
                    {activeJob ? "Analysis running…" : summary.analysis_id ? "Re-analyse" : batch ? "Start batch" : "Start analysis"}
                  </Button>
                  {src.probe && <p className="text-center text-2xs text-muted">{dur(src.probe.duration)} of footage · transcripts and analysis are cached per file</p>}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
