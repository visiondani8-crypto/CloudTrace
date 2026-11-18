import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bookmark, Check, ChevronLeft, ChevronRight, Grid3x3, ImageDown, Pause, Play, Redo2, Save, Scissors, Send, SkipBack, Trash2, Undo2 } from "lucide-react";
import { errorMessage, get, post, put } from "@/lib/api";
import type { DrawOp, Edit, Reframe } from "@/lib/types";
import { STYLE_LABELS, tc } from "@/lib/format";
import { Badge, Button, IconButton, Spinner, useToast } from "@/components/ui";
import { Preview } from "./Preview";
import { TimelineView } from "./TimelineView";
import { Inspector } from "./Inspector";
import { LeftPanel } from "./LeftPanel";
import { timelineDuration } from "./geometry";
import { useEditor } from "./store";

export default function EditorPage() {
  const { eid } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: edit, isLoading, error } = useQuery({ queryKey: ["edit", eid], queryFn: () => get<Edit>(`/edits/${eid}`), staleTime: Infinity });
  const tl = useEditor((s) => s.timeline);
  const dirty = useEditor((s) => s.dirty);
  const savedAt = useEditor((s) => s.savedAt);
  const playing = useEditor((s) => s.playing);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const [ops, setOps] = useState<DrawOp[]>([]);
  const [saving, setSaving] = useState(false);
  const [showSafe, setShowSafe] = useState(false);
  const [exact, setExact] = useState<string | null>(null);
  const [exactBusy, setExactBusy] = useState(false);
  const saveTimer = useRef<number>();
  const opsTimer = useRef<number>();

  useEffect(() => {
    if (edit) useEditor.getState().load(edit.timeline);
  }, [edit]);

  // Live draw-ops (same layout engine as the exporter), debounced.
  useEffect(() => {
    if (!tl || !eid) return;
    window.clearTimeout(opsTimer.current);
    opsTimer.current = window.setTimeout(() => {
      post<{ ops: DrawOp[] }>(`/edits/${eid}/ops`, tl).then((r) => setOps(r.ops)).catch(() => {});
    }, 120);
  }, [tl, eid]);

  const save = useCallback(async () => {
    const st = useEditor.getState();
    if (!st.timeline || !eid) return;
    setSaving(true);
    try {
      await put(`/edits/${eid}/timeline`, st.timeline);
      st.markSaved();
      qc.setQueryData(["edit", eid], (old: Edit | undefined) => (old ? { ...old, timeline: st.timeline! } : old));
    } catch (e) {
      toast({ tone: "err", text: `Autosave failed: ${errorMessage(e)}` });
    } finally {
      setSaving(false);
    }
  }, [eid, qc, toast]);

  // Autosave 1.5 s after the last change.
  useEffect(() => {
    if (!dirty) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(save, 1500);
    return () => window.clearTimeout(saveTimer.current);
  }, [tl, dirty, save]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable) return;
      const st = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const fps = st.timeline?.canvas.fps ?? 30;
      if (e.code === "Space") { e.preventDefault(); st.setPlaying(!st.playing); }
      else if (mod && e.key.toLowerCase() === "z" && e.shiftKey) { e.preventDefault(); st.redo(); }
      else if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); st.undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); st.redo(); }
      else if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); st.setPlaying(false); st.setPlayhead(st.playhead - (e.shiftKey ? 1 : 1 / fps)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); st.setPlaying(false); st.setPlayhead(st.playhead + (e.shiftKey ? 1 : 1 / fps)); }
      else if (e.key.toLowerCase() === "s" && !mod) { e.preventDefault(); st.splitAtPlayhead(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); st.deleteSelection(e.shiftKey); }
      else if (e.key.toLowerCase() === "m" && !mod) { e.preventDefault(); st.addMarker(); }
      else if (e.key === "=" || e.key === "+") st.setZoom(st.pxPerSec * 1.25);
      else if (e.key === "-") st.setZoom(st.pxPerSec / 1.25);
      else if (e.key === "Home") st.setPlayhead(0);
      else if (e.key === "End" && st.timeline) st.setPlayhead(timelineDuration(st.timeline));
      else if (e.key === "Escape") st.select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const onReframe = async (mode: string) => {
    const st = useEditor.getState();
    if (mode === "manual") {
      st.commit((t) => { t.reframe.mode = "manual"; });
      return;
    }
    try {
      const rf = await post<Reframe>(`/edits/${eid}/reframe`, { mode, timeline: st.timeline });
      st.commit((t) => { t.reframe = rf; });
      toast({ tone: "accent", text: rf.note || `Reframed: ${rf.mode}` });
    } catch (e) {
      toast({ tone: "err", text: errorMessage(e) });
    }
  };

  const exactFrame = async () => {
    if (exact) {
      setExact(null);
      return;
    }
    setExactBusy(true);
    try {
      if (useEditor.getState().dirty) await save();
      const t = useEditor.getState().playhead;
      const r = await fetch(`/api/edits/${eid}/frame?t=${t.toFixed(3)}&width=720`);
      if (!r.ok) throw new Error((await r.json()).detail);
      setExact(URL.createObjectURL(await r.blob()));
    } catch (e) {
      toast({ tone: "err", text: errorMessage(e) });
    } finally {
      setExactBusy(false);
    }
  };

  const openEdit = (id: string) => {
    if (useEditor.getState().dirty) save();
    nav(`/editor/${id}`);
  };

  if (isLoading) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (error || !edit) return <div className="p-8 text-err">Could not open this edit: {errorMessage(error)}</div>;
  if (!tl || !edit.source) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  const st = useEditor.getState();
  const dur = timelineDuration(tl);

  return (
    <div className="flex h-full flex-col">
      {/* top bar */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-sidebar px-3">
        <IconButton label="Back to highlights" onClick={() => nav(`/projects/${edit.project_id}/highlights`)}><ArrowLeft className="h-4 w-4" /></IconButton>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{edit.name}</div>
          <div className="text-2xs text-muted">v{edit.version} · {STYLE_LABELS[edit.style] ?? edit.style} · {tl.canvas.aspect} · {tc(dur, true)}</div>
        </div>
        <div className="flex-1" />
        <span className="text-2xs text-muted" data-testid="save-state">
          {saving ? "Saving…" : dirty ? "Unsaved changes" : savedAt ? <span className="flex items-center gap-1 text-ok"><Check className="h-3 w-3" />Saved</span> : "All changes saved"}
        </span>
        <Button size="sm" variant="ghost" icon={<Save className="h-3.5 w-3.5" />} onClick={save} disabled={!dirty} data-testid="save">Save</Button>
        <Button size="sm" variant="primary" icon={<Send className="h-3.5 w-3.5" />} onClick={async () => { if (dirty) await save(); nav(`/export?edits=${edit.id}`); }} data-testid="export">Export</Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="w-[300px] shrink-0 border-r border-line bg-sidebar"><LeftPanel edit={edit} onOpenEdit={openEdit} /></aside>
        <section className="flex min-w-0 flex-1 flex-col bg-bg">
          <div className="min-h-0 flex-1">
            <Preview timeline={tl} ops={ops} sourceId={edit.source.id} probe={edit.source.probe} showSafe={showSafe} exactFrameUrl={exact} />
          </div>
          {/* transport */}
          <div className="flex h-11 shrink-0 items-center justify-center gap-1 border-t border-line bg-sidebar px-3">
            <IconButton label="Go to start (Home)" onClick={() => st.setPlayhead(0)}><SkipBack className="h-4 w-4" /></IconButton>
            <IconButton label="Previous frame (←)" onClick={() => st.setPlayhead(st.playhead - 1 / tl.canvas.fps)}><ChevronLeft className="h-4 w-4" /></IconButton>
            <button onClick={() => st.setPlaying(!playing)} className="mx-1 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover" aria-label={playing ? "Pause (Space)" : "Play (Space)"} data-testid="play">
              {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
            </button>
            <IconButton label="Next frame (→)" onClick={() => st.setPlayhead(st.playhead + 1 / tl.canvas.fps)}><ChevronRight className="h-4 w-4" /></IconButton>
            <PlayheadClock duration={dur} />
            <div className="mx-2 h-5 w-px bg-line" />
            <IconButton label="Split at playhead (S)" onClick={() => st.splitAtPlayhead()}><Scissors className="h-4 w-4" /></IconButton>
            <IconButton label="Delete selection (Del) — Shift+Del ripple deletes" onClick={() => st.deleteSelection(false)}><Trash2 className="h-4 w-4" /></IconButton>
            <IconButton label="Add marker (M)" onClick={() => st.addMarker()}><Bookmark className="h-4 w-4" /></IconButton>
            <IconButton label="Undo (⌘Z)" onClick={() => st.undo()} disabled={!past}><Undo2 className="h-4 w-4" /></IconButton>
            <IconButton label="Redo (⌘⇧Z)" onClick={() => st.redo()} disabled={!future}><Redo2 className="h-4 w-4" /></IconButton>
            <div className="mx-2 h-5 w-px bg-line" />
            <IconButton label="Safe-area guides" active={showSafe} onClick={() => setShowSafe(!showSafe)}><Grid3x3 className="h-4 w-4" /></IconButton>
            <Button size="sm" variant={exact ? "primary" : "ghost"} icon={exactBusy ? <Spinner className="h-3.5 w-3.5" /> : <ImageDown className="h-3.5 w-3.5" />} onClick={exactFrame} data-testid="exact-frame">
              {exact ? "Exit exact frame" : "Exact frame"}
            </Button>
            {exact && <Badge tone="accent">Rendered by the export engine</Badge>}
          </div>
        </section>
        <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-line bg-sidebar" data-testid="inspector"><Inspector onReframe={onReframe} /></aside>
      </div>
      <div className="h-[280px] shrink-0 border-t border-line"><TimelineView sourceId={edit.source.id} /></div>
    </div>
  );
}

function PlayheadClock({ duration }: { duration: number }) {
  const t = useEditor((s) => s.playhead);
  return <span className="ml-2 w-[150px] text-center font-mono text-xs tabular text-sub" data-testid="clock">{tc(t, true)} / {tc(duration, true)}</span>;
}
