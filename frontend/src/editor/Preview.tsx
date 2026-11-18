import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DrawOp, Probe, Timeline } from "@/lib/types";
import { applyColorMatrix, colorMatrixRGB, cropRect, effRange, effectZoomPan, interpKeyframes, segAt, segments, toSource, toTimeline, timelineDuration, vignetteMask } from "./geometry";
import { drawOps, loadFonts } from "./drawOps";
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

export function Preview({ timeline, ops, sourceId, probe, showSafe, exactFrameUrl }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const vigRef = useRef<{ key: string; m: Float32Array } | null>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const [box, setBox] = useState({ w: 360, h: 640 });
  const [fontsReady, setFontsReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const segs = useMemo(() => segments(timeline), [timeline]);
  const duration = useMemo(() => timelineDuration(timeline), [timeline]);
  const tlRef = useRef(timeline);
  const opsRef = useRef(ops);
  tlRef.current = timeline;
  opsRef.current = ops;
  const CW = timeline.canvas.width;
  const CH = timeline.canvas.height;

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
        images.current.set(g.asset_id, img);
      }
    }
  }, [timeline.graphics]);

  const draw = useCallback((t: number) => {
    const cv = canvasRef.current;
    const v = videoRef.current;
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const sg = segAt(segments(tl), t);
    if (v && v.readyState >= 2 && sg) {
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      const fx = vw / probe.display_width;
      const fy = vh / probe.display_height;
      const r = t - sg.t0;
      const [ez, edx, edy] = effectZoomPan(sg.clip.effects, r, sg.t1 - sg.t0);
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
      // Clip effects (mirrors compositor._clip_effects)
      const dur = sg.t1 - sg.t0;
      let needPixels: number[][] | null = null;
      let vig = tl.color.vignette;
      for (const e of sg.clip.effects) {
        if (!e.enabled) continue;
        const [a, b] = effRange(e, dur);
        if (!(a <= r && r < b)) continue;
        const u = (r - a) / (b - a);
        const P = e.params;
        if (e.type === "blur") {
          const sig = Number(P.radius ?? 0.01) * H;
          if (!offRef.current) offRef.current = document.createElement("canvas");
          const off = offRef.current;
          off.width = W;
          off.height = H;
          off.getContext("2d")!.drawImage(cv, 0, 0);
          ctx.save();
          ctx.filter = `blur(${sig.toFixed(1)}px)`;
          ctx.drawImage(off, 0, 0);
          ctx.restore();
        } else if (["exposure", "contrast", "saturation", "grade"].includes(e.type)) {
          const m = colorMatrixRGB(
            e.type === "exposure" || e.type === "grade" ? Number(P.exposure ?? P.value ?? 0) : 0,
            e.type === "contrast" || e.type === "grade" ? Number(P.contrast ?? P.value ?? 1) : 1,
            e.type === "saturation" || e.type === "grade" ? Number(P.saturation ?? P.value ?? 1) : 1,
            e.type === "grade" ? Number(P.temperature ?? 0) : 0,
          );
          if (m) needPixels = m;
        } else if (e.type === "vignette") {
          vig = Math.max(vig, Number(P.amount ?? 0.4));
        } else if (e.type === "fade_in" || e.type === "fade_out") {
          const alpha = e.type === "fade_in" ? 1 - u : u;
          ctx.fillStyle = String(P.color ?? "#000000");
          ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
          ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = 1;
        }
      }
      // Transition approximations that need only one frame
      const k = sg.index;
      const nxt = segs[k + 1]?.clip.transition_in;
      const tin = k > 0 ? sg.clip.transition_in : null;
      for (const [tr, T, side] of [[tin, sg.t0, "in"], [nxt, sg.t1, "out"]] as const) {
        if (!tr || tr.type === "cut" || tr.duration <= 0) continue;
        const half = tr.duration / 2;
        const dist = side === "in" ? t - T : T - t;
        if (dist >= half) continue;
        const u = 1 - dist / half;
        if (tr.type === "fade_black" || tr.type === "fade_white") {
          ctx.fillStyle = tr.type === "fade_black" ? "#000" : "#fff";
          ctx.globalAlpha = u;
          ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = 1;
        }
      }
      // Global grade + clip colour (pixel-exact mirror of the exporter's matrix)
      const gm = colorMatrixRGB(tl.color.exposure, tl.color.contrast, tl.color.saturation, tl.color.temperature);
      if (needPixels || gm || vig > 0) {
        const img = ctx.getImageData(0, 0, W, H);
        if (needPixels) applyColorMatrix(img.data, needPixels);
        if (gm) applyColorMatrix(img.data, gm);
        if (vig > 0) {
          const key = `${W}x${H}x${vig}`;
          if (vigRef.current?.key !== key) vigRef.current = { key, m: vignetteMask(W, H, vig) };
          const m = vigRef.current.m;
          const d = img.data;
          for (let i = 0, p = 0; i < d.length; i += 4, p++) {
            d[i] *= m[p];
            d[i + 1] *= m[p];
            d[i + 2] *= m[p];
          }
        }
        ctx.putImageData(img, 0, 0);
      }
      // B-roll overlays: placeholder in live preview (exact frame shows the real footage)
      for (const ov of tl.overlays) {
        if (t >= ov.start && t < ov.start + (ov.src_out - ov.src_in) / ov.speed) {
          const [ox, oy, ow, oh] = ov.transform ?? [0, 0, 1, 1];
          ctx.fillStyle = "rgba(91,140,255,0.25)";
          ctx.fillRect(ox * W, oy * H, ow * W, oh * H);
          ctx.fillStyle = "#fff";
          ctx.font = `${12 * dpr}px Inter`;
          ctx.fillText("B-roll (use Exact Frame to preview)", ox * W + 8 * dpr, oy * H + 18 * dpr);
        }
      }
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
  }, [box, probe, CW, CH, showSafe, segs]);

  // Playback / scrubbing loop.
  useEffect(() => {
    let raf = 0;
    let lastSeek = -1;
    const tick = () => {
      const st = useEditor.getState();
      const v = videoRef.current;
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
              v.currentTime = next.s0;
              v.playbackRate = next.speed;
              t = next.t0;
            } else {
              v.pause();
              st.setPlaying(false);
              t = Math.max(0, sg.t1 - 1e-3);
            }
          } else if (nt >= sg.t0 - 0.05) {
            t = nt;
          }
          const vol = sg.clip.muted || tlRef.current.audio.dialogue_mute ? 0 : Math.min(1, 10 ** (sg.clip.volume_db / 20));
          v.volume = vol;
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
      draw(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  // Drag selected text/graphic on the canvas.
  const drag = useRef<{ id: string; kind: "text" | "graphic"; ox: number; oy: number; sx: number; sy: number } | null>(null);
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
    return null;
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    const hit = hitTest(nx, ny);
    if (!hit) return;
    useEditor.getState().select({ kind: hit.kind, id: hit.id });
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
      <video
        ref={videoRef}
        src={`/api/sources/${sourceId}/proxy`}
        preload="auto"
        playsInline
        className="hidden"
        onLoadedData={() => setVideoReady(true)}
        onSeeked={() => draw(useEditor.getState().playhead)}
      />
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
