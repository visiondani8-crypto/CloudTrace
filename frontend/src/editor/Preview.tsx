import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DrawOp, Probe, Timeline } from "@/lib/types";
import { applyColorMatrix, colorMatrixRGB, cropRect, effRange, effectZoomPan, interpKeyframes, type Seg, segAt, segments, toSource, toTimeline, timelineDuration, vignetteMask } from "./geometry";
import { drawOps, loadFonts } from "./drawOps";
import {
  activeTransition, audioClipSpan, audioClipVolume, audioMediaTime, dialogueVolume, HANDLE_TRANSITIONS, isSpeech,
  otherSource, smooth, speechIntervals, transitionAudioWeights, upcomingTransition,
} from "./mediaSync";
import { useEditor } from "./store";

interface Props {
  timeline: Timeline;
  ops: DrawOp[];
  sourceId: string;
  probe: Probe;
  showSafe: boolean;
  exactFrameUrl: string | null;
}

function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

type Ctx = CanvasRenderingContext2D;

/** Per-frame drawing environment: canvas size plus cached scratch surfaces and masks. */
interface Env {
  W: number;
  H: number;
  dpr: number;
  tl: Timeline;
  probe: Probe;
  layer: (name: string) => Ctx;
  vignette: (amount: number) => Float32Array;
}

function multiplyMask(ctx: Ctx, env: Env, m: Float32Array) {
  const img = ctx.getImageData(0, 0, env.W, env.H);
  const d = img.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    d[i] *= m[p];
    d[i + 1] *= m[p];
    d[i + 2] *= m[p];
  }
  ctx.putImageData(img, 0, 0);
}

function blurInPlace(ctx: Ctx, env: Env, sigma: number) {
  if (sigma <= 0.3) return;
  const fx = env.layer("fx");
  fx.clearRect(0, 0, env.W, env.H);
  fx.drawImage(ctx.canvas, 0, 0);
  ctx.save();
  ctx.filter = `blur(${sigma.toFixed(1)}px)`;
  ctx.drawImage(fx.canvas, 0, 0);
  ctx.restore();
}

/** Shape mask (compositor Masks.shape): colour outside a rounded rectangle / circle, feathered. */
function drawShapeMask(ctx: Ctx, env: Env, shape: string, size: number, feather: number, color: string) {
  const { W, H } = env;
  const m = env.layer("mask");
  m.save();
  m.clearRect(0, 0, W, H);
  m.fillStyle = color;
  m.fillRect(0, 0, W, H);
  m.globalCompositeOperation = "destination-out";
  const k = Math.max(1, Math.floor(Math.min(W, H) * feather));
  if (feather > 0) m.filter = `blur(${(k / 2).toFixed(1)}px)`;
  m.fillStyle = "#000";
  m.beginPath();
  if (shape === "circle") {
    m.arc(W / 2, H / 2, (Math.min(W, H) * size) / 2, 0, Math.PI * 2);
  } else {
    const mw = W * size;
    const mh = H * size;
    const x0 = (W - mw) / 2;
    const y0 = (H - mh) / 2;
    if (typeof m.roundRect === "function") m.roundRect(x0, y0, mw, mh, Math.min(mw, mh) * 0.08);
    else m.rect(x0, y0, mw, mh);
  }
  m.fill();
  m.restore();
  ctx.drawImage(m.canvas, 0, 0);
}

/** One clip's picture at timeline time t (panels, background, clip effects) — mirrors Compositor.compose_clip. */
function drawClip(ctx: Ctx, env: Env, v: HTMLVideoElement, sg: Seg, t: number) {
  const { W, H, dpr, tl, probe } = env;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (v.readyState < 2 || !v.videoWidth) return;
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  const fx = vw / probe.display_width;
  const fy = vh / probe.display_height;
  const r = t - sg.t0;
  const dur = sg.t1 - sg.t0;
  const [ez, edx, edy] = effectZoomPan(sg.clip.effects, r, dur);
  const plans = tl.reframe.panels.map((p) => {
    const px = Math.round(p.rect[0] * W);
    const py = Math.round(p.rect[1] * H);
    const pw = Math.round((p.rect[0] + p.rect[2]) * W) - px;
    const ph = Math.round((p.rect[1] + p.rect[3]) * H) - py;
    const [cx, cy, z0] = interpKeyframes(p.keyframes, t);
    const [x0, y0, cw, ch] = cropRect(Math.min(1, Math.max(0, cx + edx)), Math.min(1, Math.max(0, cy + edy)), z0 * ez, probe.display_width, probe.display_height, pw / ph);
    return { px, py, pw, ph, x0, y0, cw, ch };
  });
  const needsBg = plans.some((p) => p.x0 < -0.5 || p.y0 < -0.5 || p.x0 + p.cw > probe.display_width + 0.5 || p.y0 + p.ch > probe.display_height + 0.5);
  if (needsBg) {
    if (tl.reframe.background === "blur") {
      const s = Math.max(W / vw, H / vh);
      ctx.save();
      ctx.filter = `blur(${Math.round(8 * dpr)}px) brightness(0.55)`;
      ctx.drawImage(v, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s);
      ctx.restore();
    } else {
      ctx.fillStyle = tl.reframe.background === "color" ? tl.reframe.background_color : "#000";
      ctx.fillRect(0, 0, W, H);
    }
  }
  for (const p of plans) {
    // Intersect the crop with the source, map the visible part to the panel.
    const sx0 = Math.max(0, p.x0);
    const sy0 = Math.max(0, p.y0);
    const sx1 = Math.min(probe.display_width, p.x0 + p.cw);
    const sy1 = Math.min(probe.display_height, p.y0 + p.ch);
    if (sx1 <= sx0 || sy1 <= sy0) continue;
    const kx = p.pw / p.cw;
    const ky = p.ph / p.ch;
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.px, p.py, p.pw, p.ph);
    ctx.clip();
    ctx.drawImage(v, sx0 * fx, sy0 * fy, (sx1 - sx0) * fx, (sy1 - sy0) * fy, p.px + (sx0 - p.x0) * kx, p.py + (sy0 - p.y0) * ky, (sx1 - sx0) * kx, (sy1 - sy0) * ky);
    ctx.restore();
  }
  // Clip effects, in order (mirrors compositor._clip_effects)
  for (const e of sg.clip.effects) {
    if (!e.enabled) continue;
    const [a, b] = effRange(e, dur);
    if (!(a <= r && r < b)) continue;
    const u = (r - a) / (b - a);
    const P = e.params;
    if (e.type === "blur") {
      blurInPlace(ctx, env, Number(P.radius ?? 0.01) * H);
    } else if (e.type === "exposure" || e.type === "contrast" || e.type === "saturation" || e.type === "grade") {
      const m = colorMatrixRGB(
        e.type === "exposure" || e.type === "grade" ? Number(P.exposure ?? P.value ?? 0) : 0,
        e.type === "contrast" || e.type === "grade" ? Number(P.contrast ?? P.value ?? 1) : 1,
        e.type === "saturation" || e.type === "grade" ? Number(P.saturation ?? P.value ?? 1) : 1,
        e.type === "grade" ? Number(P.temperature ?? 0) : 0,
      );
      if (m) {
        const img = ctx.getImageData(0, 0, W, H);
        applyColorMatrix(img.data, m);
        ctx.putImageData(img, 0, 0);
      }
    } else if (e.type === "vignette") {
      multiplyMask(ctx, env, env.vignette(Number(P.amount ?? 0.4)));
    } else if (e.type === "fade_in" || e.type === "fade_out") {
      const alpha = e.type === "fade_in" ? 1 - u : u;
      ctx.fillStyle = String(P.color ?? "#000000");
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    } else if (e.type === "mask") {
      drawShapeMask(ctx, env, String(P.shape ?? "rounded"), Number(P.size ?? 0.85), Number(P.feather ?? 0.03), String(P.color ?? "#000000"));
    }
    // sharpen: export-only (visible in Exact Frame); a canvas unsharp mask would cost too much per frame.
  }
}

/** Keep a media element on `target` (seconds): play/drift-correct while playing, seek while paused. */
function follow(el: HTMLMediaElement, target: number, rate: number, playing: boolean, tol: number, seekPaused = true) {
  if (playing) {
    if (Math.abs(el.playbackRate - rate) > 1e-3) el.playbackRate = rate;
    if (el.paused) {
      if (Math.abs(el.currentTime - target) > 0.04) el.currentTime = target;
      el.play().catch(() => {});
    } else if (!el.seeking && Math.abs(el.currentTime - target) > tol) {
      el.currentTime = target;
    }
  } else {
    if (!el.paused) el.pause();
    if (seekPaused && !el.seeking && Math.abs(el.currentTime - target) > 0.03) el.currentTime = target;
  }
}

function preseek(el: HTMLMediaElement, target: number) {
  if (!el.paused) el.pause();
  if (!el.seeking && Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
}

function releaseMedia(el: HTMLMediaElement) {
  el.pause();
  el.removeAttribute("src");
  el.load();
}

export function Preview({ timeline, ops, sourceId, probe, showSafe, exactFrameUrl }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Two decoders of the same proxy: the "main" one plays the clip under the playhead, the other
  // supplies the far side of crossfade/slide/zoom transitions and swaps in at the cut.
  const vids = useRef<(HTMLVideoElement | null)[]>([null, null]);
  const mainIdx = useRef(0);
  const cuts = useRef<{ t: number; handle: boolean; swap: boolean; drift: number }[]>([]);
  const layers = useRef(new Map<string, Ctx>());
  const vigCache = useRef(new Map<string, Float32Array>());
  const images = useRef(new Map<string, HTMLImageElement>());
  const brolls = useRef(new Map<string, HTMLVideoElement>());
  const audios = useRef(new Map<string, HTMLAudioElement>());
  const [box, setBox] = useState({ w: 360, h: 640 });
  const [fontsReady, setFontsReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const segs = useMemo(() => segments(timeline), [timeline]);
  const duration = useMemo(() => timelineDuration(timeline), [timeline]);
  const speech = useMemo(() => speechIntervals(timeline, segs), [timeline, segs]);
  const tlRef = useRef(timeline);
  const opsRef = useRef(ops);
  const speechRef = useRef(speech);
  tlRef.current = timeline;
  opsRef.current = ops;
  speechRef.current = speech;
  const CW = timeline.canvas.width;
  const CH = timeline.canvas.height;
  const drawRef = useRef<(t: number) => void>(() => {});
  const redraw = useCallback(() => drawRef.current(useEditor.getState().playhead), []);

  useEffect(() => {
    loadFonts().then(() => setFontsReady(true));
  }, []);

  // Fit canvas to the available area.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const s = Math.min((r.width - 24) / CW, (r.height - 24) / CH);
      setBox({ w: Math.max(80, Math.floor(CW * s)), h: Math.max(80, Math.floor(CH * s)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [CW, CH]);

  // Load images used by graphics.
  useEffect(() => {
    for (const g of timeline.graphics) {
      if (g.asset_id && !images.current.has(g.asset_id)) {
        const img = new Image();
        img.src = `/api/assets/${g.asset_id}/file`;
        img.onload = redraw;
        images.current.set(g.asset_id, img);
      }
    }
  }, [timeline.graphics, redraw]);

  // B-roll decoders (one muted <video> per overlay) and music/SFX players (one <audio> per clip).
  useEffect(() => {
    const want = new Map(timeline.overlays.filter((o) => o.source_id).map((o) => [o.id, `/api/assets/${o.source_id}/file`]));
    for (const [id, el] of brolls.current) {
      if (want.get(id) !== el.dataset.src) {
        releaseMedia(el);
        brolls.current.delete(id);
      }
    }
    for (const [id, src] of want) {
      if (brolls.current.has(id)) continue;
      const el = document.createElement("video");
      el.muted = true;
      el.playsInline = true;
      el.preload = "auto";
      el.dataset.src = src;
      el.addEventListener("loadeddata", redraw);
      el.addEventListener("seeked", redraw);
      el.addEventListener("error", redraw);
      el.src = src;
      brolls.current.set(id, el);
    }
  }, [timeline.overlays, redraw]);

  useEffect(() => {
    const want = new Map(timeline.audio_clips.map((a) => [a.id, `/api/assets/${a.asset_id}/file`]));
    for (const [id, el] of audios.current) {
      if (want.get(id) !== el.dataset.src) {
        releaseMedia(el);
        audios.current.delete(id);
      }
    }
    for (const [id, src] of want) {
      if (audios.current.has(id)) continue;
      const el = new Audio();
      el.preload = "auto";
      el.dataset.src = src;
      el.src = src;
      audios.current.set(id, el);
    }
  }, [timeline.audio_clips]);

  useEffect(() => () => {
    for (const el of [...brolls.current.values(), ...audios.current.values()]) releaseMedia(el);
    brolls.current.clear();
    audios.current.clear();
  }, []);

  // Read-only inspection hook used by the end-to-end preview-fidelity test.
  useEffect(() => {
    const w = window as unknown as { __clipforgePreview?: unknown };
    w.__clipforgePreview = {
      editor: useEditor,
      media: () => ({
        main: mainIdx.current,
        cuts: cuts.current,
        videos: vids.current.map((v) => v && { paused: v.paused, t: v.currentTime, muted: v.muted, volume: v.volume, seeking: v.seeking, ready: v.readyState }),
        broll: [...brolls.current].map(([id, v]) => ({ id, paused: v.paused, t: v.currentTime, seeking: v.seeking, ready: v.readyState, error: !!v.error })),
        audio: [...audios.current].map(([id, a]) => ({ id, paused: a.paused, t: a.currentTime, volume: a.volume, seeking: a.seeking, ready: a.readyState, error: !!a.error })),
      }),
    };
    return () => {
      delete w.__clipforgePreview;
    };
  }, []);

  const draw = useCallback((t: number) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const tl = tlRef.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(box.w * dpr);
    const H = Math.round(box.h * dpr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const env: Env = {
      W, H, dpr, tl, probe,
      layer: (name) => {
        let c = layers.current.get(name);
        if (!c) {
          const el = document.createElement("canvas");
          c = el.getContext("2d", { willReadFrequently: true })!;
          layers.current.set(name, c);
        }
        if (c.canvas.width !== W || c.canvas.height !== H) {
          c.canvas.width = W;
          c.canvas.height = H;
        }
        return c;
      },
      vignette: (amount) => {
        const key = `${W}x${H}x${amount.toFixed(3)}`;
        let m = vigCache.current.get(key);
        if (!m) {
          if (vigCache.current.size > 6) vigCache.current.clear();
          m = vignetteMask(W, H, amount);
          vigCache.current.set(key, m);
        }
        return m;
      },
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const sgs = segments(tl);
    const sg = segAt(sgs, t);
    const main = vids.current[mainIdx.current];
    const sec = vids.current[1 - mainIdx.current];
    if (main && sg) {
      // Transitions (mirrors Compositor._transition; windows are centred on the cut)
      const tr = activeTransition(sgs, t);
      if (tr && HANDLE_TRANSITIONS.has(tr.type) && sec && sec.readyState >= 2) {
        const before = t < tr.T;
        const la = env.layer("A");
        const lb = env.layer("B");
        drawClip(la, env, before ? main : sec, tr.a, t);
        drawClip(lb, env, before ? sec : main, tr.b, t);
        const u = Math.max(0, Math.min(1, tr.u));
        const e = smooth(u);
        if (tr.type === "crossfade") {
          ctx.drawImage(la.canvas, 0, 0);
          ctx.globalAlpha = u;
          ctx.drawImage(lb.canvas, 0, 0);
        } else if (tr.type === "slide") {
          const off = Math.round(e * W);
          ctx.drawImage(la.canvas, -off, 0);
          ctx.drawImage(lb.canvas, W - off, 0);
        } else {
          const s = 1 + 0.25 * e;
          ctx.drawImage(la.canvas, ((1 - s) * W) / 2, ((1 - s) * H) / 2, W * s, H * s);
          ctx.globalAlpha = u;
          ctx.drawImage(lb.canvas, 0, 0);
        }
        ctx.globalAlpha = 1;
      } else {
        drawClip(ctx, env, main, sg, t);
        if (tr && tr.type !== "cut") {
          const u = Math.max(0, Math.min(1, tr.u));
          const before = t < tr.T;
          if (tr.type === "fade_black" || tr.type === "fade_white") {
            ctx.fillStyle = tr.type === "fade_black" ? "#000" : "#fff";
            ctx.globalAlpha = Math.max(0, Math.min(1, before ? u * 2 : 2 - u * 2));
            ctx.fillRect(0, 0, W, H);
            ctx.globalAlpha = 1;
          } else if (tr.type === "blur") {
            blurInPlace(ctx, env, (before ? u * 2 : (1 - u) * 2) * H * 0.02);
          }
          // crossfade/slide/zoom fall back to a cut only until the second decoder is ready.
        }
      }
      // B-roll overlays (after transitions, before the global grade — compositor._finish order)
      const ovTrack = tl.tracks.find((x) => x.kind === "overlay");
      if (!ovTrack?.hidden) {
        for (const ov of tl.overlays) {
          if (!(t >= ov.start && t < ov.start + (ov.src_out - ov.src_in) / ov.speed)) continue;
          const [ox, oy, ow, oh] = ov.transform ?? [0, 0, 1, 1];
          const px = Math.floor(ox * W);
          const py = Math.floor(oy * H);
          const pw = Math.min(Math.max(2, Math.floor(ow * W)), W - px);
          const ph = Math.min(Math.max(2, Math.floor(oh * H)), H - py);
          const el = brolls.current.get(ov.id);
          if (el && el.readyState >= 2 && el.videoWidth) {
            // cover-fit, centre crop (same as the exporter)
            const s = Math.max(pw / el.videoWidth, ph / el.videoHeight);
            const sw = pw / s;
            const sh = ph / s;
            ctx.globalAlpha = Math.max(0, Math.min(1, ov.opacity));
            ctx.drawImage(el, (el.videoWidth - sw) / 2, (el.videoHeight - sh) / 2, sw, sh, px, py, pw, ph);
            ctx.globalAlpha = 1;
          } else {
            ctx.fillStyle = "rgba(91,140,255,0.25)";
            ctx.fillRect(px, py, pw, ph);
            ctx.fillStyle = "#fff";
            ctx.font = `${12 * dpr}px Inter`;
            ctx.fillText(el?.error ? "B-roll format not playable in the browser — use Exact Frame" : "Loading B-roll…", px + 8 * dpr, py + 18 * dpr);
          }
        }
      }
      // Global grade + vignette (pixel-exact mirror of the exporter's matrix)
      const gm = colorMatrixRGB(tl.color.exposure, tl.color.contrast, tl.color.saturation, tl.color.temperature);
      if (gm) {
        const img = ctx.getImageData(0, 0, W, H);
        applyColorMatrix(img.data, gm);
        ctx.putImageData(img, 0, 0);
      }
      if (tl.color.vignette > 0) multiplyMask(ctx, env, env.vignette(tl.color.vignette));
    } else if (!sg) {
      ctx.fillStyle = "#11151D";
      ctx.fillRect(0, 0, W, H);
    }
    // Captions, titles and graphics from the shared draw-ops.
    ctx.setTransform(W / CW, 0, 0, H / CH, 0, 0);
    drawOps(ctx, opsRef.current, t, images.current);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (showSafe) {
      const sa = tl.canvas.safe_area;
      ctx.strokeStyle = "rgba(232,173,82,0.8)";
      ctx.setLineDash([6 * dpr, 6 * dpr]);
      ctx.lineWidth = dpr;
      ctx.strokeRect((sa.left ?? 0.05) * W, (sa.top ?? 0.05) * H, W * (1 - (sa.left ?? 0.05) - (sa.right ?? 0.05)), H * (1 - (sa.top ?? 0.05) - (sa.bottom ?? 0.05)));
      ctx.setLineDash([]);
    }
  }, [box, probe, CW, CH, showSafe]);
  drawRef.current = draw;

  /** Drive the secondary decoder, B-roll and music/SFX elements to timeline time t. */
  const syncMedia = useCallback((t: number, playing: boolean, sgs: Seg[]) => {
    const tl = tlRef.current;
    const main = vids.current[mainIdx.current];
    const sec = vids.current[1 - mainIdx.current];
    const sg = segAt(sgs, t);
    const tr = activeTransition(sgs, t);
    const handle = tr && HANDLE_TRANSITIONS.has(tr.type) ? tr : null;
    const w = handle ? transitionAudioWeights(handle) : null;
    if (main) {
      main.muted = false;
      let vol = sg ? dialogueVolume(tl, sg, t) : 0;
      if (handle && w) vol *= t < handle.T ? w.a : w.b;
      main.volume = Math.max(0, Math.min(1, vol));
    }
    if (sec) {
      if (handle && w) {
        const o = otherSource(handle, t);
        follow(sec, o.src, o.seg.speed, playing, 0.15);
        sec.volume = Math.max(0, Math.min(1, dialogueVolume(tl, o.seg, t) * (t < handle.T ? w.b : w.a)));
        sec.muted = false;
      } else {
        sec.muted = true;
        const up = playing ? upcomingTransition(sgs, t, 1.5) : null;
        if (up) preseek(sec, Math.max(0, up.b.s0 - (up.d / 2) * up.b.speed));
        else if (!sec.paused) sec.pause();
      }
    }
    for (const ov of tl.overlays) {
      const el = brolls.current.get(ov.id);
      if (!el || el.error) continue;
      const len = (ov.src_out - ov.src_in) / ov.speed;
      if (t >= ov.start && t < ov.start + len) follow(el, ov.src_in + (t - ov.start) * ov.speed, ov.speed, playing, 0.15);
      else if (playing && ov.start > t && ov.start - t < 1.5) preseek(el, ov.src_in);
      else if (!el.paused) el.pause();
    }
    const talking = isSpeech(speechRef.current, t);
    for (const ac of tl.audio_clips) {
      const el = audios.current.get(ac.id);
      if (!el || el.error) continue;
      const ad = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : undefined;
      const [s0, s1] = audioClipSpan(tl, ac, ad);
      if (t >= s0 && t < s1) {
        el.volume = audioClipVolume(tl, ac, t, talking, ad);
        follow(el, audioMediaTime(ac, t, ad), 1, playing, 0.2, false);
      } else if (playing && s0 > t && s0 - t < 1.5) {
        preseek(el, ac.src_in);
      } else if (!el.paused) {
        el.pause();
      }
    }
  }, []);

  // Playback / scrubbing loop.
  useEffect(() => {
    let raf = 0;
    let lastSeek = -1;
    const tick = () => {
      const st = useEditor.getState();
      const v = vids.current[mainIdx.current];
      const sgs = segments(tlRef.current);
      let t = st.playhead;
      if (v && st.playing) {
        const sg = segAt(sgs, t);
        if (!sg) {
          st.setPlaying(false);
        } else {
          if (v.paused) {
            v.currentTime = toSource(sg, t);
            v.playbackRate = sg.speed;
            v.play().catch(() => st.setPlaying(false));
          }
          const nt = toTimeline(sg, v.currentTime);
          if (v.currentTime >= sg.s1 - 0.015 || nt >= sg.t1) {
            const next = sgs[sg.index + 1];
            if (next) {
              const sec = vids.current[1 - mainIdx.current];
              const tr = next.clip.transition_in;
              const handle = !!sec && HANDLE_TRANSITIONS.has(tr.type) && tr.duration > 0;
              const drift = sec ? sec.currentTime - next.s0 : NaN;
              const swap = handle && !sec!.paused && Math.abs(drift) < 0.6;
              cuts.current = [...cuts.current.slice(-9), { t: next.t0, handle, swap, drift }];
              if (swap) {
                // The secondary decoder is already playing the incoming clip's handle: swap roles,
                // so the outgoing clip's tail keeps playing on the other element.
                mainIdx.current = 1 - mainIdx.current;
              } else {
                v.currentTime = next.s0;
              }
              vids.current[mainIdx.current]!.playbackRate = next.speed;
              t = next.t0;
            } else {
              v.pause();
              st.setPlaying(false);
              t = Math.max(0, sg.t1 - 1e-3);
            }
          } else if (nt >= sg.t0 - 0.05) {
            // A decoder that lags a few ms behind its clip start must not drag the playhead back
            // into the previous clip (that would re-trigger the cut and swap the decoders again).
            t = Math.max(sg.t0, nt);
          }
          if (Math.abs(t - st.playhead) > 1e-4) st.setPlayhead(t);
        }
      } else if (v) {
        if (!v.paused) v.pause();
        const sg = segAt(sgs, t);
        if (sg) {
          const src = toSource(sg, t);
          if (Math.abs(v.currentTime - src) > 0.03 && lastSeek !== src && !v.seeking) {
            lastSeek = src;
            v.currentTime = src;
          }
        }
      }
      syncMedia(t, useEditor.getState().playing, sgs);
      draw(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [draw, syncMedia]);

  // Drag selected text/graphic on the canvas.
  const drag = useRef<{ id: string; kind: "text" | "graphic" | "captions"; ox: number; oy: number; sx: number; sy: number } | null>(null);
  const hitTest = (nx: number, ny: number) => {
    const st = useEditor.getState();
    const t = st.playhead;
    const tl = tlRef.current;
    for (const g of [...tl.graphics].reverse()) {
      if (t >= g.start && t < g.end && Math.abs(nx - g.x) <= g.w / 2 && Math.abs(ny - g.y) <= Math.max(g.h / 2, 0.01)) return { kind: "graphic" as const, id: g.id, x: g.x, y: g.y };
    }
    for (const x of [...tl.texts].reverse()) {
      const hh = x.style.size * 1.4;
      const left = x.style.align === "left" ? x.x : x.style.align === "right" ? x.x - x.width : x.x - x.width / 2;
      if (t >= x.start && t < x.end && nx >= left && nx <= left + x.width && Math.abs(ny - x.y) <= hh) return { kind: "text" as const, id: x.id, x: x.x, y: x.y };
    }
    // Caption block: union of the caption word ops visible now (layer 2 = caption text).
    if (tl.captions.enabled) {
      const live = opsRef.current.filter((o) => o.l === 2 && o.k === "text" && t >= o.t0 && t < o.t1);
      if (live.length) {
        const pad = 0.02;
        const x0 = Math.min(...live.map((o) => (o.x - ((o.text?.length ?? 1) * (o.em ?? 40) * 0.3)) / CW)) - pad;
        const x1 = Math.max(...live.map((o) => (o.x + ((o.text?.length ?? 1) * (o.em ?? 40) * 0.3)) / CW)) + pad;
        const y0 = Math.min(...live.map((o) => (o.y - (o.size ?? 40) / 2) / CH)) - pad;
        const y1 = Math.max(...live.map((o) => (o.y + (o.size ?? 40) / 2) / CH)) + pad;
        if (nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1) {
          const cs = tl.captions.style;
          return { kind: "captions" as const, id: "captions", x: cs.position_x, y: cs.position_y };
        }
      }
    }
    return null;
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    const hit = hitTest(nx, ny);
    if (!hit) return;
    useEditor.getState().select(hit.kind === "captions" ? { kind: "captions" } : { kind: hit.kind, id: hit.id });
    useEditor.getState().beginGesture();
    drag.current = { id: hit.id, kind: hit.kind, ox: hit.x, oy: hit.y, sx: nx, sy: ny };
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    const x = Math.min(1, Math.max(0, d.ox + nx - d.sx));
    const y = Math.min(1, Math.max(0, d.oy + ny - d.sy));
    useEditor.getState().commit((tl) => {
      if (d.kind === "captions") {
        tl.captions.style.position_x = Math.round(x * 1000) / 1000;
        tl.captions.style.position_y = Math.round(Math.min(0.95, Math.max(0.05, y)) * 1000) / 1000;
        return;
      }
      const arr: any[] = d.kind === "text" ? tl.texts : tl.graphics;
      const it = arr.find((a) => a.id === d.id);
      if (it) {
        it.x = Math.round(x * 1000) / 1000;
        it.y = Math.round(y * 1000) / 1000;
      }
    }, { history: false });
  };
  const onPointerUp = () => {
    if (drag.current) {
      useEditor.getState().commit(() => {}, { history: true });
      drag.current = null;
    }
  };

  return (
    <div ref={wrapRef} className="relative flex h-full w-full items-center justify-center checker">
      {[0, 1].map((i) => (
        <video
          key={i}
          ref={(el) => {
            vids.current[i] = el;
          }}
          src={`/api/sources/${sourceId}/proxy`}
          preload="auto"
          playsInline
          muted={i === 1}
          className="hidden"
          data-testid={i === 0 ? "preview-video" : "preview-video-b"}
          onLoadedData={() => {
            if (i === 0) setVideoReady(true);
            redraw();
          }}
          onSeeked={redraw}
        />
      ))}
      <canvas
        ref={canvasRef}
        style={{ width: box.w, height: box.h }}
        className="rounded-sm shadow-[0_0_0_1px_#303848,0_20px_60px_rgba(0,0,0,0.5)]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        data-testid="preview-canvas"
        aria-label="Video preview"
      />
      {exactFrameUrl && (
        <img src={exactFrameUrl} alt="Exact export frame" style={{ width: box.w, height: box.h }} className="pointer-events-none absolute rounded-sm ring-2 ring-accent" />
      )}
      {(!fontsReady || !videoReady) && <div className="absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-2xs text-sub">{!videoReady ? "Loading preview proxy…" : "Loading fonts…"}</div>}
      {duration <= 0 && <div className="absolute text-sm text-sub">Timeline is empty</div>}
    </div>
  );
}

export { hexRgb };
