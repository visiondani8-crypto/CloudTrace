import { create } from "zustand";
import type { AudioClip, Effect, GraphicLayer, Marker, TextLayer, Timeline, VideoClip } from "@/lib/types";
import { uid } from "@/lib/format";
import { clipDuration, segAt, segments, timelineDuration } from "./geometry";

export type Selection =
  | { kind: "clip"; id: string }
  | { kind: "overlay"; id: string }
  | { kind: "text"; id: string }
  | { kind: "graphic"; id: string }
  | { kind: "audio"; id: string }
  | { kind: "word"; id: number }
  | { kind: "marker"; id: string }
  | null;

const HISTORY = 100;

function relayout(tl: Timeline): Timeline {
  let t = 0;
  for (const c of tl.clips) {
    c.start = t;
    t += clipDuration(c);
  }
  const d = t;
  // Keep overlays/text/graphics within the timeline.
  tl.texts = tl.texts.filter((x) => x.start < d).map((x) => ({ ...x, end: Math.min(x.end, d) }));
  tl.graphics = tl.graphics.filter((x) => x.start < d).map((x) => ({ ...x, end: Math.min(x.end, d) }));
  return tl;
}

export interface EditorState {
  timeline: Timeline | null;
  past: Timeline[];
  future: Timeline[];
  dirty: boolean;
  savedAt: number | null;
  selection: Selection;
  playhead: number;
  playing: boolean;
  pxPerSec: number;
  snapping: boolean;
  load: (tl: Timeline) => void;
  commit: (fn: (tl: Timeline) => void, opts?: { history?: boolean }) => void;
  beginGesture: () => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
  select: (s: Selection) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setZoom: (pxPerSec: number) => void;
  setSnapping: (v: boolean) => void;
  // editing operations
  splitAtPlayhead: () => boolean;
  deleteSelection: (ripple: boolean) => void;
  addText: (kind: TextLayer["kind"], text?: string) => void;
  addGraphic: (kind: GraphicLayer["kind"], assetId?: string, aspect?: number) => void;
  addEffect: (type: Effect["type"], params?: Effect["params"]) => void;
  addMarker: () => void;
  addAudio: (assetId: string, label: string, duration: number) => void;
  addOverlay: (assetId: string, duration: number) => void;
}

let gestureBase: Timeline | null = null;

export const useEditor = create<EditorState>((set, get) => ({
  timeline: null,
  past: [],
  future: [],
  dirty: false,
  savedAt: null,
  selection: null,
  playhead: 0,
  playing: false,
  pxPerSec: 60,
  snapping: true,

  load: (tl) => set({ timeline: relayout(structuredClone(tl)), past: [], future: [], dirty: false, selection: null, playhead: 0, playing: false }),

  commit: (fn, opts) => {
    const cur = get().timeline;
    if (!cur) return;
    const next = structuredClone(cur);
    fn(next);
    relayout(next);
    const history = opts?.history !== false;
    if (history) {
      const base = gestureBase ?? cur;
      gestureBase = null;
      set({ timeline: next, past: [...get().past.slice(-HISTORY + 1), base], future: [], dirty: true });
    } else {
      set({ timeline: next, dirty: true });
    }
  },

  // For drags: capture the pre-drag state once; intermediate commits skip history; final commit records it.
  beginGesture: () => {
    gestureBase = get().timeline ? structuredClone(get().timeline!) : null;
  },

  undo: () => {
    const { past, timeline, future } = get();
    if (!past.length || !timeline) return;
    set({ timeline: past[past.length - 1], past: past.slice(0, -1), future: [timeline, ...future], dirty: true });
  },
  redo: () => {
    const { past, timeline, future } = get();
    if (!future.length || !timeline) return;
    set({ timeline: future[0], future: future.slice(1), past: [...past, timeline], dirty: true });
  },
  markSaved: () => set({ dirty: false, savedAt: Date.now() }),
  select: (s) => set({ selection: s }),
  setPlayhead: (t) => {
    const tl = get().timeline;
    const d = tl ? timelineDuration(tl) : 0;
    set({ playhead: Math.max(0, Math.min(t, Math.max(0, d - 1e-3))) });
  },
  setPlaying: (p) => set({ playing: p }),
  setZoom: (px) => set({ pxPerSec: Math.max(8, Math.min(600, px)) }),
  setSnapping: (v) => set({ snapping: v }),

  splitAtPlayhead: () => {
    const { timeline, playhead, selection } = get();
    if (!timeline) return false;
    const segs = segments(timeline);
    const sg = segAt(segs, playhead);
    if (sg && (!selection || selection.kind === "clip")) {
      const r = playhead - sg.t0;
      if (r < 0.1 || sg.t1 - playhead < 0.1) return false;
      const srcT = sg.s0 + r * sg.speed;
      get().commit((tl) => {
        const c = tl.clips[sg.index];
        const b: VideoClip = structuredClone(c);
        b.id = uid("c_");
        b.src_in = srcT;
        c.src_out = srcT;
        b.transition_in = { type: "cut", duration: 0 };
        c.effects = c.effects.filter((e) => e.start < r).map((e) => ({ ...e, end: e.end == null ? null : Math.min(e.end, r) }));
        b.effects = b.effects
          .filter((e) => (e.end == null ? true : e.end > r))
          .map((e) => ({ ...e, id: uid("fx_"), start: Math.max(0, e.start - r), end: e.end == null ? null : e.end - r }));
        tl.clips.splice(sg.index + 1, 0, b);
      });
      return true;
    }
    if (selection && (selection.kind === "text" || selection.kind === "graphic")) {
      get().commit((tl) => {
        const arr: any[] = selection.kind === "text" ? tl.texts : tl.graphics;
        const i = arr.findIndex((x) => x.id === selection.id);
        if (i < 0 || playhead <= arr[i].start + 0.05 || playhead >= arr[i].end - 0.05) return;
        const b = { ...structuredClone(arr[i]), id: uid(selection.kind === "text" ? "tx_" : "gf_"), start: playhead };
        arr[i].end = playhead;
        arr.splice(i + 1, 0, b);
      });
      return true;
    }
    return false;
  },

  deleteSelection: (ripple) => {
    const { selection, timeline } = get();
    if (!selection || !timeline) return;
    get().commit((tl) => {
      if (selection.kind === "clip") {
        if (tl.clips.length <= 1) return;
        tl.clips = tl.clips.filter((c) => c.id !== selection.id);
      } else if (selection.kind === "text" || selection.kind === "graphic" || selection.kind === "audio" || selection.kind === "overlay") {
        const key = selection.kind === "text" ? "texts" : selection.kind === "graphic" ? "graphics" : selection.kind === "audio" ? "audio_clips" : "overlays";
        const arr: any[] = (tl as any)[key];
        const item = arr.find((x) => x.id === selection.id);
        if (!item) return;
        const start = item.start;
        const len = (item.end ?? item.start + (item.src_out != null ? item.src_out - item.src_in : 0)) - start;
        (tl as any)[key] = arr.filter((x) => x.id !== selection.id);
        if (ripple && len > 0) {
          for (const x of (tl as any)[key]) {
            if (x.start >= start) {
              x.start -= len;
              if (x.end != null) x.end -= len;
            }
          }
        }
      } else if (selection.kind === "word") {
        const w = tl.captions.words.find((x) => x.id === selection.id);
        if (w) w.hidden = true;
      } else if (selection.kind === "marker") {
        tl.markers = tl.markers.filter((m) => m.id !== selection.id);
      }
    });
    set({ selection: null });
  },

  addText: (kind, text) => {
    const { playhead, timeline } = get();
    if (!timeline) return;
    const d = timelineDuration(timeline);
    const id = uid("tx_");
    const presets: Record<string, Partial<TextLayer>> = {
      title: { y: 0.16, style: { ...baseTextStyle(), size: 0.05, weight: 800 } },
      hook: { y: 0.2, style: { ...baseTextStyle(), size: 0.042, weight: 900, font: "Montserrat", color: "#0B0E14", background: "rounded", background_color: "#FFFFFF", background_opacity: 0.96 } },
      callout: { y: 0.4, style: { ...baseTextStyle(), size: 0.036, weight: 800, color: "#FFFFFF", background: "rounded", background_color: "#5B8CFF", background_opacity: 1 } },
      lower_third: { x: 0.08, y: 0.84, width: 0.7, style: { ...baseTextStyle(), size: 0.036, weight: 800, align: "left", background: "box", background_color: "#0B0E14", background_opacity: 0.85 }, subtitle: "Subtitle" },
      label: { y: 0.5, style: { ...baseTextStyle(), size: 0.03, weight: 600, outline: 0.003 } },
    };
    const layer: TextLayer = {
      id, kind, text: text ?? (kind === "lower_third" ? "Name Surname" : kind === "hook" ? "Hook text" : kind === "callout" ? "Key point" : "Title"),
      start: playhead, end: Math.min(d, playhead + 3), x: 0.5, y: 0.2, width: 0.84, style: baseTextStyle(),
      anim_in: { type: "pop", duration: 0.3 }, anim_out: { type: "fade", duration: 0.2 }, opacity: 1, subtitle: "",
      ...(presets[kind] as any),
    };
    // Avoid stacking on top of existing text that is visible at the same time (e.g. a hook heading).
    const busy = timeline.texts.filter((x) => x.start < layer.end && x.end > layer.start);
    const tooClose = (y: number) => busy.some((x) => Math.abs(x.y - y) < Math.max(0.09, x.style.size * 2.6));
    if (tooClose(layer.y)) {
      const alt = [0.32, 0.45, 0.56, 0.8, 0.88].find((y) => !tooClose(y));
      if (alt !== undefined) layer.y = alt;
    }
    get().commit((tl) => {
      tl.texts.push(layer);
    });
    set({ selection: { kind: "text", id } });
  },

  addGraphic: (kind, assetId, aspect = 1) => {
    const { playhead, timeline } = get();
    if (!timeline) return;
    const d = timelineDuration(timeline);
    const id = uid("gf_");
    const W = timeline.canvas.width;
    const H = timeline.canvas.height;
    const g: GraphicLayer = {
      id, kind, start: kind === "progress_bar" || kind === "logo" ? 0 : playhead, end: kind === "progress_bar" || kind === "logo" ? d : Math.min(d, playhead + 3),
      x: 0.5, y: 0.45, w: 0.4, h: 0.15, rotation: 0, color: "#E8AD52", stroke: 0.006, fill_opacity: 0, opacity: 1, radius: 0.02,
      asset_id: assetId ?? null, anim_in: { type: "fade", duration: 0.2 }, anim_out: { type: "fade", duration: 0.2 },
    };
    if (kind === "arrow") Object.assign(g, { w: 0.2, h: 0.06, color: "#E46B73", rotation: 30, fill_opacity: 1, stroke: 0 });
    if (kind === "circle") Object.assign(g, { w: 0.25, h: (0.25 * W) / H });
    if (kind === "rect") Object.assign(g, { fill_opacity: 0.6, color: "#0B0E14", stroke: 0 });
    if (kind === "progress_bar") Object.assign(g, { x: 0.5, y: 0.0035, w: 1, h: 0.007, color: "#5B8CFF", fill_opacity: 1, radius: 0, anim_in: { type: "none", duration: 0 }, anim_out: { type: "none", duration: 0 } });
    if (kind === "logo" || kind === "image") {
      const gw = kind === "logo" ? 0.16 : 0.5;
      Object.assign(g, { w: gw, h: (gw * W) / H / Math.max(0.2, aspect), x: kind === "logo" ? 0.85 : 0.5, y: kind === "logo" ? 0.08 : 0.4, color: "#FFFFFF" });
    }
    get().commit((tl) => {
      tl.graphics.push(g);
    });
    set({ selection: { kind: "graphic", id } });
  },

  addEffect: (type, params) => {
    const { timeline, selection, playhead } = get();
    if (!timeline) return;
    const segs = segments(timeline);
    const target = selection?.kind === "clip" ? segs.find((s) => s.clip.id === selection.id) : segAt(segs, playhead);
    if (!target) return;
    const defaults: Record<string, Effect["params"]> = {
      zoom: { from: 1, to: 1.15 }, pan: { dx: 0.05, dy: 0 }, blur: { radius: 0.01 }, vignette: { amount: 0.4 },
      exposure: { value: 0.2 }, contrast: { value: 1.15 }, saturation: { value: 1.2 }, sharpen: { amount: 0.5 },
      fade_in: { color: "#000000" }, fade_out: { color: "#000000" }, freeze: {}, mask: { shape: "rounded", size: 0.85, feather: 0.03, color: "#000000" },
      grade: { exposure: 0, contrast: 1.08, saturation: 0.9, temperature: 0.15 },
    };
    const dur = target.t1 - target.t0;
    const rel = Math.max(0, playhead - target.t0);
    let start = 0;
    let end: number | null = null;
    if (type === "fade_in") end = Math.min(0.6, dur);
    if (type === "fade_out") start = Math.max(0, dur - 0.6);
    if (type === "freeze") { start = rel; end = Math.min(dur, rel + 1); }
    if (type === "zoom" && !params) { start = rel; end = Math.min(dur, rel + 0.8); }
    const e: Effect = { id: uid("fx_"), type, start, end, params: params ?? defaults[type] ?? {}, enabled: true };
    get().commit((tl) => {
      tl.clips[target.index].effects.push(e);
    });
    set({ selection: { kind: "clip", id: target.clip.id } });
  },

  addMarker: () => {
    const { playhead } = get();
    const m: Marker = { id: uid("mk_"), t: playhead, label: "", color: "#E8AD52" };
    get().commit((tl) => {
      tl.markers.push(m);
      tl.markers.sort((a, b) => a.t - b.t);
    });
  },

  addAudio: (assetId, label, duration) => {
    const { playhead, timeline } = get();
    if (!timeline) return;
    const d = timelineDuration(timeline);
    const isSfx = label === "sfx";
    const a: AudioClip = {
      id: uid("au_"), asset_id: assetId, start: isSfx ? playhead : 0, src_in: 0, src_out: Math.min(duration, isSfx ? duration : d),
      gain_db: isSfx ? -6 : -16, fade_in: isSfx ? 0 : 1, fade_out: isSfx ? 0 : 1.5, duck: !isSfx, loop: !isSfx && duration < d, envelope: [], label: isSfx ? "sfx" : "music",
    };
    get().commit((tl) => {
      tl.audio_clips.push(a);
    });
    set({ selection: { kind: "audio", id: a.id } });
  },

  addOverlay: (assetId, duration) => {
    const { playhead, timeline } = get();
    if (!timeline) return;
    const d = timelineDuration(timeline);
    const len = Math.min(duration, 3, d - playhead);
    if (len <= 0.2) return;
    const o: VideoClip = {
      id: uid("ov_"), src_in: 0, src_out: len, speed: 1, start: playhead, effects: [], transition_in: { type: "cut", duration: 0 },
      volume_db: 0, envelope: [], muted: true, label: "B-roll", source_id: assetId, transform: [0, 0, 1, 1], opacity: 1,
    };
    get().commit((tl) => {
      tl.overlays.push(o);
    });
    set({ selection: { kind: "overlay", id: o.id } });
  },
}));

export function baseTextStyle(): TextLayer["style"] {
  return {
    font: "Inter", weight: 800, size: 0.05, color: "#FFFFFF", outline_color: "#000000", outline: 0.0, shadow: 0.003, shadow_color: "#000000",
    background: "none", background_color: "#000000", background_opacity: 0, letter_spacing: 0, line_height: 1.15, align: "center", uppercase: false, italic: false,
  };
}
