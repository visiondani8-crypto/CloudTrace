// Mirrors backend/clipforge/edit/reframe.py, edit/timemap.py and render/compositor.py
// (effect zoom/pan, colour matrix, vignette). Shared fixtures in tests keep them identical.
import type { CropKeyframe, Easing, Effect, Timeline, VideoClip } from "@/lib/types";

export function baseCrop(srcW: number, srcH: number, aspect: number): [number, number] {
  if (srcW / srcH > aspect) return [srcH * aspect, srcH];
  return [srcW, srcW / aspect];
}

export function fitZoom(srcW: number, srcH: number, aspect: number): number {
  const [bw, bh] = baseCrop(srcW, srcH, aspect);
  return Math.min(bw / srcW, bh / srcH);
}

/** (x0, y0, w, h) in source pixels. */
export function cropRect(cx: number, cy: number, zoom: number, srcW: number, srcH: number, aspect: number): [number, number, number, number] {
  const [bw, bh] = baseCrop(srcW, srcH, aspect);
  const w = bw / zoom;
  const h = bh / zoom;
  const x0 = w <= srcW ? Math.min(Math.max(cx * srcW - w / 2, 0), srcW - w) : (srcW - w) / 2;
  const y0 = h <= srcH ? Math.min(Math.max(cy * srcH - h / 2, 0), srcH - h) : (srcH - h) / 2;
  return [x0, y0, w, h];
}

export function ease(kind: Easing, u: number): number {
  u = Math.max(0, Math.min(1, u));
  switch (kind) {
    case "linear": return u;
    case "ease_in": return u * u;
    case "ease_out": return 1 - (1 - u) * (1 - u);
    case "hold": return 0;
    default: return u * u * (3 - 2 * u);
  }
}

export function interpKeyframes(kfs: CropKeyframe[], t: number): [number, number, number] {
  if (!kfs.length) return [0.5, 0.5, 1];
  if (t <= kfs[0].t) return [kfs[0].cx, kfs[0].cy, kfs[0].zoom];
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (a.t <= t && t < b.t) {
      const u = ease(b.ease, (t - a.t) / Math.max(1e-6, b.t - a.t));
      return [a.cx + (b.cx - a.cx) * u, a.cy + (b.cy - a.cy) * u, a.zoom + (b.zoom - a.zoom) * u];
    }
  }
  const k = kfs[kfs.length - 1];
  return [k.cx, k.cy, k.zoom];
}

const smooth = (u: number) => {
  u = Math.max(0, Math.min(1, u));
  return u * u * (3 - 2 * u);
};

export function effRange(e: Effect, clipDur: number): [number, number] {
  const end = e.end ?? clipDur;
  return [e.start, Math.max(e.start + 1e-3, end)];
}

export function effectZoomPan(effects: Effect[], r: number, clipDur: number): [number, number, number] {
  let z = 1;
  let dx = 0;
  let dy = 0;
  for (const e of effects) {
    if (!e.enabled || (e.type !== "zoom" && e.type !== "pan")) continue;
    const [a, b] = effRange(e, clipDur);
    if (!((a <= r && r < b) || (r >= b && e.type === "zoom" && e.end == null))) continue;
    const u = b > a ? smooth((r - a) / (b - a)) : 1;
    if (e.type === "zoom") {
      const f = Number(e.params.from ?? 1);
      const to = Number(e.params.to ?? f);
      z *= f + (to - f) * u;
    } else {
      dx += Number(e.params.dx ?? 0) * u;
      dy += Number(e.params.dy ?? 0) * u;
    }
  }
  return [z, dx, dy];
}

// ----------------------------------------------------------------------------- time mapping

export interface Seg { clip: VideoClip; index: number; t0: number; t1: number; s0: number; s1: number; speed: number }

export function clipDuration(c: VideoClip) {
  return (c.src_out - c.src_in) / c.speed;
}

export function segments(tl: Timeline): Seg[] {
  const out: Seg[] = [];
  let t = 0;
  tl.clips.forEach((c, index) => {
    const d = clipDuration(c);
    out.push({ clip: c, index, t0: t, t1: t + d, s0: c.src_in, s1: c.src_out, speed: c.speed });
    t += d;
  });
  return out;
}

export function timelineDuration(tl: Timeline) {
  return tl.clips.reduce((a, c) => a + clipDuration(c), 0);
}

export function segAt(segs: Seg[], t: number): Seg | null {
  for (const s of segs) if (s.t0 <= t && t < s.t1) return s;
  return segs.length && Math.abs(t - segs[segs.length - 1].t1) < 1e-6 ? segs[segs.length - 1] : null;
}

export const toSource = (s: Seg, t: number) => s.s0 + (t - s.t0) * s.speed;
export const toTimeline = (s: Seg, src: number) => s.t0 + (src - s.s0) / s.speed;

export function sourceToTimeline(segs: Seg[], srcS: number, srcE: number): [number, number] | null {
  const mid = (srcS + srcE) / 2;
  for (const s of segs) {
    if (s.s0 <= mid && mid < s.s1) return [toTimeline(s, Math.max(srcS, s.s0)), toTimeline(s, Math.min(srcE, s.s1))];
  }
  return null;
}

// ----------------------------------------------------------------------------- colour (mirror of compositor.color_matrix)

function satMatrixRGB(s: number): number[][] {
  return [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
  ];
}

/** 3×4 RGB matrix (exposure → temperature → saturation → contrast) or null for identity. */
export function colorMatrixRGB(exposure = 0, contrast = 1, saturation = 1, temperature = 0): number[][] | null {
  if (Math.abs(exposure) < 1e-4 && Math.abs(contrast - 1) < 1e-4 && Math.abs(saturation - 1) < 1e-4 && Math.abs(temperature) < 1e-4) return null;
  const b = 2 ** exposure;
  const temp = [1 + 0.12 * temperature, 1 + 0.02 * temperature, 1 - 0.12 * temperature];
  const sat = satMatrixRGB(saturation);
  const off = 255 * 0.5 * (1 - contrast);
  return sat.map((row) => [...row.map((v, j) => contrast * v * temp[j] * b), off]);
}

export function applyColorMatrix(data: Uint8ClampedArray, m: number[][]) {
  const [r0, r1, r2] = m;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    data[i] = r0[0] * r + r0[1] * g + r0[2] * b + r0[3];
    data[i + 1] = r1[0] * r + r1[1] * g + r1[2] * b + r1[3];
    data[i + 2] = r2[0] * r + r2[1] * g + r2[2] * b + r2[3];
  }
}

export function vignetteMask(w: number, h: number, amount: number): Float32Array {
  const m = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.sqrt(((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2) / Math.SQRT2;
      const u = Math.max(0, Math.min(1, (r - 0.35) / 0.6));
      m[y * w + x] = 1 - amount * 0.85 * (u * u * (3 - 2 * u));
    }
  }
  return m;
}
