import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronUp, Clapperboard, Pause, Play, Scissors, Send, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { errorMessage, get, patch, post } from "@/lib/api";
import type { Edit, Highlight, Job, Project } from "@/lib/types";
import { dur, STYLE_LABELS, tc } from "@/lib/format";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, NativeSelect, PageHeader, ScoreBadge, Segmented, Spinner, useToast } from "@/components/ui";
import { cn } from "@/lib/cn";

const CAPTIONS = [
  ["bold_social", "Bold Social"], ["clean_white", "Clean White"], ["word_by_word", "Word-by-Word"], ["karaoke", "Karaoke Highlight"],
  ["cinematic_minimal", "Cinematic Minimal"], ["documentary", "Documentary"], ["creator", "Creator Style"], ["neon", "Neon Highlight"],
  ["gaming", "Gaming"], ["custom_brand", "Custom Brand"],
];

function Breakdown({ h }: { h: Highlight }) {
  return (
    <div className="space-y-1.5">
      {Object.entries(h.breakdown).map(([k, f]) => (
        <div key={k}>
          <div className="flex items-center justify-between text-2xs">
            <span className="text-sub">{f.label}</span>
            <span className="tabular text-fg">{f.points.toFixed(1)} / {f.max.toFixed(0)}</span>
          </div>
          <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-accent/80" style={{ width: `${(f.points / Math.max(1, f.max)) * 100}%` }} />
          </div>
          {f.evidence.length > 0 && <div className="mt-0.5 text-2xs text-muted">{f.evidence.join(" · ")}</div>}
        </div>
      ))}
      {(h.evidence.adjustments ?? []).map((a) => (
        <div key={a.label} className={cn("text-2xs", a.points < 0 ? "text-err" : "text-ok")}>{a.points > 0 ? "+" : ""}{a.points} · {a.label}</div>
      ))}
      <p className="pt-1 text-2xs text-muted">Scores are configurable editorial heuristics derived from this video's transcript, audio and visuals — not a prediction of views.</p>
    </div>
  );
}

function RateButtons({ rating, onRate }: { rating: number; onRate: (v: -1 | 0 | 1) => void }) {
  const btn = (v: -1 | 1, Icon: typeof ThumbsUp, label: string) => (
    <button
      onClick={() => onRate(rating === v ? 0 : v)}
      aria-pressed={rating === v}
      aria-label={label}
      title={`${label} — your ratings can tune scoring (Settings → Personal tuning)`}
      className={cn("rounded p-1 transition-colors", rating === v ? (v > 0 ? "bg-ok/15 text-ok" : "bg-err/15 text-err") : "text-muted hover:bg-raised hover:text-fg")}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
  return (
    <div className="flex items-center gap-0.5" data-testid="rate-buttons">
      {btn(1, ThumbsUp, "Good clip")}
      {btn(-1, ThumbsDown, "Bad clip")}
    </div>
  );
}

function HighlightCard({ h, selected, onSelect, onPlay, playing, onOpen, onExport, onRate, busy }: {
  h: Highlight; selected: boolean; onSelect: (v: boolean) => void; onPlay: () => void; playing: boolean; onOpen: () => void; onExport: () => void;
  onRate: (v: -1 | 0 | 1) => void; busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className={cn("overflow-hidden transition-colors", selected && "border-accent/60")} data-testid="highlight-card">
      <div className="flex gap-3 p-3">
        <div className="relative h-[108px] w-[192px] shrink-0 overflow-hidden rounded-lg bg-black">
          {h.thumb_url && <img src={h.thumb_url} alt="" className="h-full w-full object-cover" />}
          <button onClick={onPlay} className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition hover:bg-black/40 hover:opacity-100 focus-visible:opacity-100" aria-label={playing ? "Pause preview" : "Play preview"}>
            {playing ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8" />}
          </button>
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-2xs tabular">{dur(h.duration)}</span>
          <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-2xs">#{h.rank}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <label className="flex min-w-0 cursor-pointer items-start gap-2">
              <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} className="mt-1 accent-[#5B8CFF]" aria-label={`Select ${h.title}`} />
              <h3 className="line-clamp-2 text-[14px] font-semibold leading-snug">{h.title}</h3>
            </label>
            <ScoreBadge score={h.score} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-sub">
            <span className="tabular">{tc(h.start)} → {tc(h.end)}</span>
            <span>·</span>
            <span className="truncate">{h.topic}</span>
            {h.evidence.llm && <Badge tone="accent">AI-refined</Badge>}
            {(h.edits ?? []).length > 0 && <Badge tone="ok">{h.edits!.length} edit</Badge>}
          </div>
          <p className="mt-1.5 line-clamp-2 text-xs text-fg/85">{h.reason}</p>
          <p className="mt-1 line-clamp-1 text-2xs italic text-muted">Hook: “{h.hook}”</p>
        </div>
      </div>
      {h.issues.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {h.issues.map((i) => <span key={i} className="inline-flex items-center gap-1 rounded bg-warn/10 px-1.5 py-0.5 text-2xs text-warn"><AlertTriangle className="h-3 w-3" />{i}</span>)}
        </div>
      )}
      <div className="flex items-center justify-between border-t border-line px-3 py-2">
        <button onClick={() => setOpen(!open)} className="flex min-w-0 items-center gap-1 truncate text-left text-2xs text-sub hover:text-fg">
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} Why this score · audience: {h.audience}
        </button>
        <div className="flex items-center gap-1.5">
          <RateButtons rating={h.rating ?? 0} onRate={onRate} />
          <Button size="sm" variant="ghost" icon={<Send className="h-3.5 w-3.5" />} onClick={onExport} disabled={busy}>Export</Button>
          <Button size="sm" variant="primary" icon={<Scissors className="h-3.5 w-3.5" />} onClick={onOpen} loading={busy} data-testid="open-editor">Open Editor</Button>
        </div>
      </div>
      {open && <div className="border-t border-line bg-bg/40 px-4 py-3"><Breakdown h={h} /><p className="mt-3 text-2xs text-sub"><span className="text-muted">Transcript:</span> {h.transcript}</p></div>}
    </Card>
  );
}

export default function HighlightsPage() {
  const { pid } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: project } = useQuery({ queryKey: ["project", pid], queryFn: () => get<Project>(`/projects/${pid}`) });
  const { data: hls, isLoading } = useQuery({ queryKey: ["highlights", pid], queryFn: () => get<Highlight[]>(`/projects/${pid}/highlights`) });
  const { data: analysis } = useQuery({ queryKey: ["analysis", pid], queryFn: () => get<any>(`/projects/${pid}/analysis`), retry: false });
  const [sort, setSort] = useState<"score" | "time" | "duration">("score");
  const [minScore, setMinScore] = useState(0);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState<string | null>(null);
  const [prep, setPrep] = useState(false);
  const [prepOpts, setPrepOpts] = useState({ style: "dynamic", aspect: "9:16", caption_style: "bold_social" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const src = project?.sources?.[0];
  const srcDur = src?.probe?.duration ?? 1;

  useEffect(() => {
    if (hls) setSel(new Set(hls.filter((h) => h.selected).map((h) => h.id)));
  }, [hls]);

  const list = useMemo(() => {
    let l = (hls ?? []).filter((h) => h.score >= minScore && (!q || (h.title + h.topic + h.transcript).toLowerCase().includes(q.toLowerCase())));
    l = [...l].sort((a, b) => (sort === "score" ? b.score - a.score : sort === "time" ? a.start - b.start : b.duration - a.duration));
    return l;
  }, [hls, sort, minScore, q]);

  const toggle = (id: string, v: boolean) => {
    const n = new Set(sel);
    v ? n.add(id) : n.delete(id);
    setSel(n);
    patch(`/highlights/${id}`, { selected: v }).catch(() => {});
  };

  const rate = (id: string, v: -1 | 0 | 1) => {
    qc.setQueryData<Highlight[]>(["highlights", pid], (old) => old?.map((h) => (h.id === id ? { ...h, rating: v } : h)));
    patch(`/highlights/${id}`, { rating: v }).catch((e) => {
      toast({ tone: "err", text: `Could not save rating: ${errorMessage(e)}` });
      qc.invalidateQueries({ queryKey: ["highlights", pid] });
    });
  };

  const play = (h: Highlight) => {
    const v = videoRef.current;
    if (!v) return;
    if (playing === h.id) {
      v.pause();
      setPlaying(null);
      return;
    }
    v.currentTime = h.start;
    v.play();
    setPlaying(h.id);
    const stop = () => {
      if (v.currentTime >= h.end) {
        v.pause();
        setPlaying(null);
        v.removeEventListener("timeupdate", stop);
      }
    };
    v.addEventListener("timeupdate", stop);
  };

  async function openEditor(h: Highlight, then: "editor" | "export") {
    setBusyId(h.id);
    try {
      let eid = h.edits?.[0]?.id;
      if (!eid) {
        const e = await post<Edit>("/edits", { highlight_id: h.id, style: prepOpts.style, aspect: prepOpts.aspect, caption_style: prepOpts.caption_style });
        eid = e.id;
      }
      qc.invalidateQueries({ queryKey: ["highlights", pid] });
      nav(then === "editor" ? `/editor/${eid}` : `/export?edits=${eid}`);
    } catch (e) {
      toast({ tone: "err", text: errorMessage(e) });
    } finally {
      setBusyId(null);
    }
  }

  const prepare = useMutation({
    mutationFn: () => post<Job>(`/projects/${pid}/prepare-edits`, { highlight_ids: [...sel], ...prepOpts }),
    onSuccess: () => {
      setPrep(false);
      toast({ tone: "accent", text: `Preparing ${sel.size} edit(s)… they'll appear in the Export Centre.` });
    },
    onError: (e) => toast({ tone: "err", text: errorMessage(e) }),
  });

  if (isLoading) return <div className="p-8"><Spinner /></div>;
  const sel_ = analysis?.selection;
  return (
    <div className="mx-auto max-w-[1280px] px-8 py-7">
      <PageHeader
        title="AI Highlights"
        sub={project ? `${project.name} · ${hls?.length ?? 0} recommended clip(s) from ${sel_?.candidates ?? "?"} candidates${analysis?.weights_source === "learned" ? " · scored with your learned weights" : ""}` : ""}
        actions={
          <>
            <Button variant="outline" onClick={() => nav(`/projects/${pid}`)}>Analysis settings</Button>
            <Button variant="primary" icon={<Clapperboard className="h-4 w-4" />} disabled={!sel.size} onClick={() => setPrep(true)} data-testid="prepare-edits">
              Prepare Edits ({sel.size})
            </Button>
          </>
        }
      />
      {sel_?.note && <div className="mb-4"><Alert tone="accent">{sel_.note}</Alert></div>}
      {(hls ?? []).length === 0 ? (
        <EmptyState icon={<Sparkles className="h-6 w-6" />} title="No highlights yet" sub={project?.summary?.no_speech ? "No usable speech was found, so no clips were invented. Try importing subtitles or a different content mode." : "Run an analysis to find the strongest moments."} action={<Button onClick={() => nav(`/projects/${pid}`)}>Go to analysis</Button>} />
      ) : (
        <>
          <Card className="mb-4 p-4">
            <div className="mb-2 flex items-center justify-between text-2xs text-sub">
              <span>Timeline overview</span>
              <span className="tabular">{tc(srcDur)}</span>
            </div>
            <div className="relative h-10 rounded-md bg-bg" data-testid="timeline-overview">
              {(analysis?.summary?.topics ?? []).map((t: any, i: number) => (
                <div key={t.id} className={cn("absolute inset-y-0 border-r border-line/60", i % 2 ? "bg-white/[0.015]" : "")} style={{ left: `${(t.start / srcDur) * 100}%`, width: `${((t.end - t.start) / srcDur) * 100}%` }} title={t.label} />
              ))}
              {(hls ?? []).map((h) => (
                <button
                  key={h.id}
                  onClick={() => document.getElementById(`hl-${h.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  className={cn("absolute top-1.5 h-7 rounded border text-2xs font-medium", sel.has(h.id) ? "border-accent bg-accent/40" : "border-accent/50 bg-accent/15 hover:bg-accent/30")}
                  style={{ left: `${(h.start / srcDur) * 100}%`, width: `${Math.max(0.6, ((h.end - h.start) / srcDur) * 100)}%` }}
                  title={`#${h.rank} ${h.title} (${h.score.toFixed(0)})`}
                >
                  {h.rank}
                </button>
              ))}
            </div>
          </Card>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Segmented value={sort} onChange={setSort} options={[{ value: "score", label: "Best score" }, { value: "time", label: "Timeline order" }, { value: "duration", label: "Longest" }]} />
            <div className="flex items-center gap-2 text-xs text-sub">
              Min score
              <Input type="number" className="w-16" value={minScore} min={0} max={100} onChange={(e) => setMinScore(Number(e.target.value))} />
            </div>
            <Input className="w-64" placeholder="Search titles & transcript…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => list.forEach((h) => !sel.has(h.id) && toggle(h.id, true))}>Select all</Button>
            <Button size="sm" variant="ghost" onClick={() => [...sel].forEach((id) => toggle(id, false))}>Clear</Button>
          </div>
          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
            {list.map((h) => (
              <div id={`hl-${h.id}`} key={h.id}>
                <HighlightCard h={h} selected={sel.has(h.id)} onSelect={(v) => toggle(h.id, v)} onPlay={() => play(h)} playing={playing === h.id}
                  onOpen={() => openEditor(h, "editor")} onExport={() => openEditor(h, "export")} onRate={(v) => rate(h.id, v)} busy={busyId === h.id} />
              </div>
            ))}
          </div>
        </>
      )}
      {src?.has_proxy && (
        <div className={cn("fixed bottom-4 right-4 z-30 w-[360px] overflow-hidden rounded-xl border border-line bg-black shadow-panel transition", playing ? "opacity-100" : "pointer-events-none opacity-0")}>
          <video ref={videoRef} src={`/api/sources/${src.id}/proxy`} className="w-full" preload="metadata" controls />
        </div>
      )}
      <Dialog open={prep} onOpenChange={setPrep} title={`Prepare ${sel.size} edit(s)`} description="Creates editable timelines with captions, reframing and the chosen editing recipe. You can review each before exporting."
        footer={<><Button variant="ghost" onClick={() => setPrep(false)}>Cancel</Button><Button variant="primary" loading={prepare.isPending} onClick={() => prepare.mutate()}>Prepare edits</Button></>}>
        <div className="grid grid-cols-1 gap-3">
          <Field label="Editing style"><Segmented value={prepOpts.style} onChange={(v) => setPrepOpts({ ...prepOpts, style: v })} options={Object.entries(STYLE_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Aspect ratio"><Segmented value={prepOpts.aspect} onChange={(v) => setPrepOpts({ ...prepOpts, aspect: v })} options={["9:16", "1:1", "4:5", "16:9", "source"].map((a) => ({ value: a, label: a === "source" ? "Original" : a }))} /></Field>
          <Field label="Caption style"><NativeSelect value={prepOpts.caption_style} onChange={(v) => setPrepOpts({ ...prepOpts, caption_style: v })} options={CAPTIONS.map(([value, label]) => ({ value, label }))} /></Field>
        </div>
      </Dialog>
    </div>
  );
}
