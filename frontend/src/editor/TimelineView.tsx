import { memo, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, Lock, Magnet, Unlock, Volume2, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import { get } from "@/lib/api";
import type { Timeline, Track } from "@/lib/types";
import { tc } from "@/lib/format";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui";
import { clipDuration, segments, sourceToTimeline, timelineDuration } from "./geometry";
import { useEditor, type Selection } from "./store";
import { Envelope } from "./Envelope";

const HEAD = 132;
const LANE_H: Record<string, number> = { video: 56, overlay: 30, captions: 26, text: 30, graphics: 30, audio: 44 };

interface Sprite { interval: number; count: number; cols: number; rows: number; tile_w: number; tile_h: number }

type DragMode = "move" | "trim-l" | "trim-r";

function useDrag() {
  const st = useRef<{ x: number; apply: (dt: number) => void } | null>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!st.current) return;
      const pps = useEditor.getState().pxPerSec;
      st.current.apply((e.clientX - st.current.x) / pps);
    };
    const up = () => {
      if (st.current) {
        useEditor.getState().commit(() => {}, { history: true });
        st.current = null;
        document.body.style.cursor = "";
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);
  return (e: React.PointerEvent, apply: (dt: number) => void, cursor = "grabbing") => {
    e.stopPropagation();
    e.preventDefault();
    useEditor.getState().beginGesture();
    st.current = { x: e.clientX, apply };
    document.body.style.cursor = cursor;
  };
}

function snapPoints(tl: Timeline, playhead: number, excludeId?: string): number[] {
  const pts = [0, playhead, timelineDuration(tl)];
  for (const s of segments(tl)) pts.push(s.t0, s.t1);
  for (const m of tl.markers) pts.push(m.t);
  for (const x of tl.texts) if (x.id !== excludeId) pts.push(x.start, x.end);
  for (const g of tl.graphics) if (g.id !== excludeId) pts.push(g.start, g.end);
  return pts;
}

function snap(t: number, pts: number[], pps: number, enabled: boolean): number {
  if (!enabled) return t;
  let best = t;
  let bd = 8 / pps;
  for (const p of pts) {
    const d = Math.abs(p - t);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

const Waveform = memo(function Waveform({ peaks, perSec, s0, s1, width, height, muted }: { peaks: number[]; perSec: number; s0: number; s1: number; width: number; height: number; muted: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.floor(width * dpr));
    cv.height = Math.floor(height * dpr);
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = muted ? "rgba(105,117,134,0.5)" : "rgba(57,185,138,0.75)";
    const n = cv.width;
    for (let x = 0; x < n; x++) {
      const a = s0 + ((s1 - s0) * x) / n;
      const b = s0 + ((s1 - s0) * (x + 1)) / n;
      let mx = 0;
      for (let i = Math.floor(a * perSec); i <= Math.floor(b * perSec) && i < peaks.length; i++) mx = Math.max(mx, peaks[i] ?? 0);
      const hh = (mx / 255) * cv.height * 0.9;
      ctx.fillRect(x, (cv.height - hh) / 2, 1, Math.max(1, hh));
    }
  }, [peaks, perSec, s0, s1, width, height, muted]);
  return <canvas ref={ref} style={{ width, height }} className="pointer-events-none absolute inset-0" />;
});

function Playhead({ height }: { height: number }) {
  const playhead = useEditor((s) => s.playhead);
  const pps = useEditor((s) => s.pxPerSec);
  return (
    <div className="pointer-events-none absolute top-0 z-20" style={{ left: playhead * pps, height }}>
      <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-accent" />
      <div className="absolute left-0 top-0 h-full w-px bg-accent" />
    </div>
  );
}

export function TimelineView({ sourceId }: { sourceId: string }) {
  const tl = useEditor((s) => s.timeline)!;
  const pps = useEditor((s) => s.pxPerSec);
  const selection = useEditor((s) => s.selection);
  const snapping = useEditor((s) => s.snapping);
  const { select, setPlayhead, commit, setZoom, setSnapping } = useEditor.getState();
  const startDrag = useDrag();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { data: wave } = useQuery({ queryKey: ["waveform", sourceId], queryFn: () => get<{ per_second: number; peaks: number[] }>(`/sources/${sourceId}/waveform`), staleTime: Infinity, retry: false });
  const { data: sprite } = useQuery({ queryKey: ["sprite", sourceId], queryFn: () => get<Sprite>(`/sources/${sourceId}/sprite.json`), staleTime: Infinity, retry: false });
  const segs = useMemo(() => segments(tl), [tl]);
  const duration = timelineDuration(tl);
  const width = Math.max(600, duration * pps + 200);
  const tracks = tl.tracks;
  const totalH = 22 + tracks.reduce((a, t) => a + (LANE_H[t.kind] ?? 30), 0);
  const isSel = (k: NonNullable<Selection>["kind"], id: string | number) => selection?.kind === k && (selection as any).id === id;
  const trackOf = (kind: Track["kind"], id?: string) => tracks.find((t) => t.kind === kind && (!id || t.id === id));
  const locked = (kind: Track["kind"], id?: string) => !!trackOf(kind, id)?.locked;

  // ctrl/cmd + wheel zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom(useEditor.getState().pxPerSec * (e.deltaY > 0 ? 0.9 : 1.1));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  const scrub = (e: React.PointerEvent) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    const toT = (cx: number) => (cx - rect.left + el.scrollLeft - HEAD) / useEditor.getState().pxPerSec;
    setPlayhead(toT(e.clientX));
    const mv = (ev: PointerEvent) => setPlayhead(toT(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };

  const trimClip = (e: React.PointerEvent, idx: number, mode: DragMode) => {
    if (locked("video")) return;
    const c0 = { ...tl.clips[idx] };
    const srcDur = Infinity;
    select({ kind: "clip", id: c0.id });
    startDrag(e, (dt) => {
      commit((t) => {
        const c = t.clips[idx];
        if (!c) return;
        if (mode === "trim-l") c.src_in = Math.min(c0.src_out - 0.2, Math.max(0, c0.src_in + dt * c0.speed));
        if (mode === "trim-r") c.src_out = Math.max(c0.src_in + 0.2, Math.min(srcDur, c0.src_out + dt * c0.speed));
      }, { history: false });
    }, "ew-resize");
  };

  const moveItem = (e: React.PointerEvent, key: "texts" | "graphics" | "audio_clips" | "overlays", id: string, mode: DragMode) => {
    const kindMap = { texts: "text", graphics: "graphics", audio_clips: "audio", overlays: "overlay" } as const;
    if (locked(kindMap[key] as Track["kind"])) return;
    const arr: any[] = (tl as any)[key];
    const it0 = structuredClone(arr.find((x) => x.id === id));
    const selKind = key === "texts" ? "text" : key === "graphics" ? "graphic" : key === "audio_clips" ? "audio" : "overlay";
    select({ kind: selKind as any, id });
    const pts = snapPoints(tl, useEditor.getState().playhead, id);
    const len = it0.end != null ? it0.end - it0.start : (it0.src_out - it0.src_in) / (it0.speed ?? 1);
    startDrag(e, (dt) => {
      commit((t) => {
        const it = (t as any)[key].find((x: any) => x.id === id);
        if (!it) return;
        const D = timelineDuration(t);
        if (mode === "move") {
          let s = Math.max(0, Math.min(D - 0.1, it0.start + dt));
          const sn = snap(s, pts, pps, snapping);
          const sne = snap(s + len, pts, pps, snapping);
          s = sn !== s ? sn : sne !== s + len ? sne - len : s;
          it.start = Math.max(0, s);
          if (it.end != null) it.end = it.start + len;
        } else if (mode === "trim-l") {
          if (it.end != null) it.start = Math.min(it.end - 0.1, Math.max(0, snap(it0.start + dt, pts, pps, snapping)));
          else {
            const d = Math.min(len - 0.1, Math.max(-it0.src_in, dt));
            it.start = it0.start + d;
            it.src_in = it0.src_in + d;
          }
        } else {
          if (it.end != null) it.end = Math.max(it.start + 0.1, Math.min(D, snap(it0.end + dt, pts, pps, snapping)));
          else it.src_out = Math.max(it.src_in + 0.1, (it0.src_out ?? it0.src_in + len) + dt);
        }
      }, { history: false });
    }, mode === "move" ? "grabbing" : "ew-resize");
  };

  const toggleTrack = (id: string, key: "locked" | "hidden" | "muted" | "solo") =>
    commit((t) => {
      const tr = t.tracks.find((x) => x.id === id);
      if (tr) (tr as any)[key] = !(tr as any)[key];
    });

  const ticks = useMemo(() => {
    const step = pps > 200 ? 0.5 : pps > 80 ? 1 : pps > 30 ? 5 : pps > 12 ? 10 : 30;
    const out = [];
    for (let t = 0; t <= duration + step; t += step) out.push(t);
    return out;
  }, [pps, duration]);

  const words = useMemo(() => {
    const out: { id: number; t0: number; t1: number; text: string; hidden: boolean; emphasis: boolean }[] = [];
    for (const w of tl.captions.words) {
      const m = sourceToTimeline(segs, w.src_s, w.src_e);
      if (m) out.push({ id: w.id, t0: m[0], t1: m[1], text: w.text, hidden: w.hidden, emphasis: w.emphasis });
    }
    return out;
  }, [tl.captions.words, segs]);

  const spriteTile = (srcT: number, h: number) => {
    if (!sprite) return undefined;
    const i = Math.min(sprite.count - 1, Math.max(0, Math.floor(srcT / sprite.interval)));
    const s = h / sprite.tile_h;
    return {
      backgroundImage: `url(/api/sources/${sourceId}/sprite)`,
      backgroundSize: `${sprite.cols * sprite.tile_w * s}px ${sprite.rows * sprite.tile_h * s}px`,
      backgroundPosition: `-${(i % sprite.cols) * sprite.tile_w * s}px -${Math.floor(i / sprite.cols) * sprite.tile_h * s}px`,
      width: sprite.tile_w * s,
      height: h,
    } as React.CSSProperties;
  };

  const isKf = (panel: string, index: number) => selection?.kind === "keyframe" && selection.panel === panel && selection.index === index;

  const dragKeyframe = (e: React.PointerEvent, panel: string, index: number) => {
    e.stopPropagation();
    e.preventDefault();
    select({ kind: "keyframe", panel, index });
    setPlayhead(tl.reframe.panels.find((p) => p.id === panel)!.keyframes[index].t);
    if (locked("video")) return;
    const t0 = tl.reframe.panels.find((p) => p.id === panel)!.keyframes[index].t;
    const pts = snapPoints(tl, useEditor.getState().playhead);
    startDrag(e, (dt) => {
      commit((t) => {
        const kfs = t.reframe.panels.find((p) => p.id === panel)!.keyframes;
        const lo = index > 0 ? kfs[index - 1].t + 0.04 : 0;
        const hi = index + 1 < kfs.length ? kfs[index + 1].t - 0.04 : timelineDuration(t);
        kfs[index].t = Math.round(Math.max(lo, Math.min(hi, snap(t0 + dt, pts, pps, snapping))) * 1000) / 1000;
        t.reframe.mode = "manual";
      }, { history: false });
    }, "ew-resize");
  };

  const renderLane = (tr: Track) => {
    const h = LANE_H[tr.kind] ?? 30;
    const common = cn("relative border-b border-line/70", tr.hidden && "opacity-40");
    if (tr.kind === "video") {
      return (
        <div key={tr.id} className={common} style={{ height: h }}>
          {tl.reframe.mode !== "original" && tl.reframe.panels.map((p, pi) =>
            p.keyframes.map((k, ki) => (
              <button key={`${p.id}-${ki}`} aria-label={`Crop keyframe ${ki + 1}${tl.reframe.panels.length > 1 ? ` (${p.id})` : ""}`}
                className={cn("absolute z-10 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border border-bg", isKf(p.id, ki) ? "bg-warn" : "bg-accent hover:bg-accent-hover")}
                style={{ left: k.t * pps, top: 2 + pi * 6 }} onPointerDown={(e) => dragKeyframe(e, p.id, ki)} data-testid="keyframe" />
            )))}
          {segs.map((sg) => {
            const w = (sg.t1 - sg.t0) * pps;
            const tiles = Math.max(1, Math.ceil(w / ((sprite?.tile_w ?? 160) * ((h - 16) / (sprite?.tile_h ?? 90)))));
            const sel = isSel("clip", sg.clip.id);
            return (
              <div
                key={sg.clip.id}
                className={cn("group absolute top-1 overflow-hidden rounded-md border bg-[#1f3054]", sel ? "border-accent ring-1 ring-accent" : "border-[#33497a]")}
                style={{ left: sg.t0 * pps, width: Math.max(4, w - 1), height: h - 8 }}
                onPointerDown={(e) => { e.stopPropagation(); select({ kind: "clip", id: sg.clip.id }); }}
                data-testid="timeline-clip"
              >
                <div className="flex h-[calc(100%-14px)] overflow-hidden opacity-80">
                  {Array.from({ length: Math.min(tiles, 60) }).map((_, k) => (
                    <div key={k} style={spriteTile(sg.s0 + ((sg.s1 - sg.s0) * k) / tiles, h - 22)} className="shrink-0" />
                  ))}
                </div>
                <div className="flex h-[14px] items-center gap-1 truncate bg-black/40 px-1 text-[10px] text-fg/90">
                  {sg.clip.label || "Clip"} · {clipDuration(sg.clip).toFixed(1)}s{sg.speed !== 1 && ` · ${sg.speed}×`}
                  {sg.clip.effects.length > 0 && <span className="rounded bg-accent/30 px-1">fx {sg.clip.effects.length}</span>}
                </div>
                {sg.clip.transition_in.type !== "cut" && sg.index > 0 && (
                  <div className="absolute left-0 top-0 h-full w-2 bg-gradient-to-r from-warn/70 to-transparent" title={`${sg.clip.transition_in.type} ${sg.clip.transition_in.duration}s`} />
                )}
                <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/30" onPointerDown={(e) => trimClip(e, sg.index, "trim-l")} aria-label="Trim start" />
                <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/30" onPointerDown={(e) => trimClip(e, sg.index, "trim-r")} aria-label="Trim end" />
              </div>
            );
          })}
        </div>
      );
    }
    if (tr.kind === "audio" && tr.id === "a1") {
      return (
        <div key={tr.id} className={common} style={{ height: h }}>
          {segs.map((sg) => (
            <div key={sg.clip.id} className={cn("absolute top-1 overflow-hidden rounded-md border border-ok/30 bg-ok/5", isSel("clip", sg.clip.id) && "border-ok")} style={{ left: sg.t0 * pps, width: Math.max(4, (sg.t1 - sg.t0) * pps - 1), height: h - 8 }}
              onPointerDown={(e) => { e.stopPropagation(); select({ kind: "clip", id: sg.clip.id }); }}>
              {wave && <Waveform peaks={wave.peaks} perSec={wave.per_second} s0={sg.s0} s1={sg.s1} width={Math.max(4, (sg.t1 - sg.t0) * pps - 1)} height={h - 8} muted={sg.clip.muted || tr.muted} />}
              {sg.clip.volume_db !== 0 && <span className="absolute right-1 top-0.5 text-[10px] text-ok">{sg.clip.volume_db > 0 ? "+" : ""}{sg.clip.volume_db} dB</span>}
              <Envelope owner="clip" id={sg.clip.id} points={sg.clip.envelope} duration={sg.t1 - sg.t0} width={Math.max(4, (sg.t1 - sg.t0) * pps - 1)} height={h - 8} color="#9fe3c6" />
            </div>
          ))}
        </div>
      );
    }
    if (tr.kind === "audio") {
      const isMusic = tr.id === "a2";
      return (
        <div key={tr.id} className={common} style={{ height: h }}>
          {tl.audio_clips.filter((a) => (a.label === "sfx") !== isMusic).map((a) => {
            const len = (a.src_out ?? a.src_in + 5) - a.src_in;
            return (
              <div key={a.id} className={cn("absolute top-1 cursor-grab rounded-md border px-1 text-[10px]", isMusic ? "border-[#8a6bd6]/50 bg-[#8a6bd6]/15" : "border-warn/50 bg-warn/15", isSel("audio", a.id) && "ring-1 ring-accent")}
                style={{ left: a.start * pps, width: Math.max(6, len * pps), height: h - 8 }} onPointerDown={(e) => moveItem(e, "audio_clips", a.id, "move")}>
                <span className="pointer-events-none truncate">{a.label} · {a.gain_db} dB{a.duck ? " · ducked" : ""}</span>
                <Envelope owner="audio" id={a.id} points={a.envelope} duration={len} width={Math.max(6, len * pps)} height={h - 8} color={isMusic ? "#c6b4f2" : "#f3d39a"} />
                <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => moveItem(e, "audio_clips", a.id, "trim-l")} />
                <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => moveItem(e, "audio_clips", a.id, "trim-r")} />
              </div>
            );
          })}
        </div>
      );
    }
    if (tr.kind === "captions") {
      return (
        <div key={tr.id} className={common} style={{ height: h }}>
          {tl.captions.enabled && words.map((w) => (
            <button key={w.id} onPointerDown={(e) => { e.stopPropagation(); select({ kind: "word", id: w.id }); setPlayhead(w.t0); }}
              className={cn("absolute top-1 overflow-hidden whitespace-nowrap rounded-sm border px-0.5 text-left text-[9px] leading-[16px]",
                w.hidden ? "border-line/40 text-muted line-through" : w.emphasis ? "border-warn/60 bg-warn/15 text-warn" : "border-line bg-raised text-sub",
                isSel("word", w.id) && "border-accent text-fg")}
              style={{ left: w.t0 * pps, width: Math.max(3, (w.t1 - w.t0) * pps - 1), height: h - 8 }} title={w.text}>
              {(w.t1 - w.t0) * pps > 18 ? w.text : ""}
            </button>
          ))}
          {tl.captions.manual_cues.map((c) => (
            <div key={c.id} className="absolute top-1 truncate rounded-sm border border-accent/50 bg-accent/10 px-1 text-[9px]" style={{ left: c.start * pps, width: (c.end - c.start) * pps, height: h - 8 }}>{c.text}</div>
          ))}
        </div>
      );
    }
    if (tr.kind === "overlay") {
      return (
        <div key={tr.id} className={common} style={{ height: h }}>
          {tl.overlays.map((o) => (
            <div key={o.id} className={cn("absolute top-1 cursor-grab rounded-md border border-accent/50 bg-accent/15 px-1 text-[10px]", isSel("overlay", o.id) && "ring-1 ring-accent")}
              style={{ left: o.start * pps, width: Math.max(6, ((o.src_out - o.src_in) / o.speed) * pps), height: h - 8 }} onPointerDown={(e) => moveItem(e, "overlays", o.id, "move")}>
              B-roll
              <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => moveItem(e, "overlays", o.id, "trim-r")} />
            </div>
          ))}
        </div>
      );
    }
    const isText = tr.kind === "text";
    const items: any[] = isText ? tl.texts : tl.graphics;
    // Stack overlapping items into sub-rows so none hides another.
    const rowEnd: number[] = [];
    const rowOf = new Map<string, number>();
    for (const it of [...items].sort((a, b) => a.start - b.start)) {
      let r = rowEnd.findIndex((e) => e <= it.start + 1e-3);
      if (r < 0) { r = rowEnd.length; rowEnd.push(0); }
      rowEnd[r] = it.end;
      rowOf.set(it.id, r);
    }
    const rows = Math.max(1, rowEnd.length);
    const rowH = (h - 8) / rows;
    return (
      <div key={tr.id} className={common} style={{ height: h }}>
        {items.map((it) => (
          <div key={it.id} className={cn("absolute cursor-grab truncate rounded-md border px-1.5 text-[10px]",
            isText ? "border-[#d6a24f]/50 bg-[#d6a24f]/15 text-[#f1cf8f]" : "border-[#4fb3d6]/50 bg-[#4fb3d6]/15 text-[#9fdcf1]",
            isSel(isText ? "text" : "graphic", it.id) && "ring-1 ring-accent")}
            style={{ left: it.start * pps, width: Math.max(6, (it.end - it.start) * pps), top: 4 + (rowOf.get(it.id) ?? 0) * rowH, height: rowH - 1, lineHeight: `${rowH - 3}px` }}
            onPointerDown={(e) => moveItem(e, isText ? "texts" : "graphics", it.id, "move")} data-testid={isText ? "timeline-text" : "timeline-graphic"}>
            {isText ? it.text : it.kind.replace("_", " ")}
            <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => moveItem(e, isText ? "texts" : "graphics", it.id, "trim-l")} />
            <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => moveItem(e, isText ? "texts" : "graphics", it.id, "trim-r")} />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2">
        <IconButton label="Zoom out (-)" onClick={() => setZoom(pps / 1.4)}><ZoomOut className="h-3.5 w-3.5" /></IconButton>
        <input type="range" min={8} max={600} value={pps} onChange={(e) => setZoom(Number(e.target.value))} className="w-28" aria-label="Timeline zoom" />
        <IconButton label="Zoom in (=)" onClick={() => setZoom(pps * 1.4)}><ZoomIn className="h-3.5 w-3.5" /></IconButton>
        <IconButton label={snapping ? "Snapping on" : "Snapping off"} active={snapping} onClick={() => setSnapping(!snapping)}><Magnet className="h-3.5 w-3.5" /></IconButton>
        <span className="ml-2 text-2xs text-muted">{tl.clips.length} clip(s) · {tc(duration, true)} · Ctrl/⌘ + scroll to zoom</span>
      </div>
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto" data-testid="timeline">
        <div className="relative" style={{ width: width + HEAD, height: totalH }}>
          {/* track headers */}
          <div className="sticky left-0 z-30 float-left bg-sidebar" style={{ width: HEAD }}>
            <div className="h-[22px] border-b border-r border-line" />
            {tracks.map((tr) => (
              <div key={tr.id} className="flex items-center gap-0.5 border-b border-r border-line/70 px-1.5" style={{ height: LANE_H[tr.kind] ?? 30 }}>
                <button className={cn("flex-1 truncate text-left text-[11px] hover:text-fg", isSel("track", tr.id) ? "text-accent" : "text-sub")} onClick={() => select({ kind: "track", id: tr.id })}
                  title="Track properties">{tr.name}{tr.kind === "audio" && tr.gain_db ? ` ${tr.gain_db > 0 ? "+" : ""}${tr.gain_db}dB` : ""}</button>
                <button className="rounded p-0.5 text-muted hover:text-fg" onClick={() => toggleTrack(tr.id, "locked")} aria-label={tr.locked ? "Unlock track" : "Lock track"}>
                  {tr.locked ? <Lock className="h-3 w-3 text-warn" /> : <Unlock className="h-3 w-3" />}
                </button>
                {tr.kind === "audio" ? (
                  <>
                    <button className={cn("rounded px-0.5 text-[10px] font-bold", tr.solo ? "text-warn" : "text-muted hover:text-fg")} onClick={() => toggleTrack(tr.id, "solo")} aria-label="Solo track">S</button>
                    <button className="rounded p-0.5 text-muted hover:text-fg" onClick={() => toggleTrack(tr.id, "muted")} aria-label={tr.muted ? "Unmute track" : "Mute track"}>
                      {tr.muted ? <VolumeX className="h-3 w-3 text-err" /> : <Volume2 className="h-3 w-3" />}
                    </button>
                  </>
                ) : (
                  <button className="rounded p-0.5 text-muted hover:text-fg" onClick={() => toggleTrack(tr.id, "hidden")} aria-label={tr.hidden ? "Show track" : "Hide track"}>
                    {tr.hidden ? <EyeOff className="h-3 w-3 text-err" /> : <Eye className="h-3 w-3" />}
                  </button>
                )}
              </div>
            ))}
          </div>
          {/* lanes */}
          <div className="absolute top-0" style={{ left: HEAD, width }}>
            <div className="relative h-[22px] cursor-pointer border-b border-line bg-surface" onPointerDown={scrub} data-testid="ruler">
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full border-l border-line/80 pl-1 text-[10px] leading-[20px] text-muted" style={{ left: t * pps }}>{tc(t)}</div>
              ))}
              {tl.markers.map((m) => (
                <button key={m.id} className="absolute top-0 h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[9px] border-x-transparent" style={{ left: m.t * pps, borderTopColor: m.color }}
                  onPointerDown={(e) => { e.stopPropagation(); select({ kind: "marker", id: m.id }); setPlayhead(m.t); }} title={m.label || "Marker"} aria-label="Marker" />
              ))}
            </div>
            <div onPointerDown={(e) => { if (e.target === e.currentTarget) select(null); }}>
              {tracks.map(renderLane)}
            </div>
            <div className="pointer-events-none absolute top-0" style={{ left: duration * pps, height: totalH }}>
              <div className="h-full w-px bg-err/50" />
            </div>
            <Playhead height={totalH} />
          </div>
        </div>
      </div>
    </div>
  );
}
