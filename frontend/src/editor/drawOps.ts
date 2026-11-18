// Canvas renderer for the backend's renderer-neutral draw ops (mirror of render/ass.py semantics).
import type { DrawOp } from "@/lib/types";

const fontsLoaded = new Set<string>();
let fontLoad: Promise<void> | null = null;

export function loadFonts(): Promise<void> {
  if (fontLoad) return fontLoad;
  fontLoad = fetch("/api/fonts")
    .then((r) => r.json())
    .then(async (list: { key: string; file: string; italic: boolean }[]) => {
      await Promise.all(
        list.map(async (f) => {
          try {
            const face = new FontFace(`cf-${f.key}`, `url(/api/fonts/file/${f.file})`, { style: f.italic ? "italic" : "normal" });
            await face.load();
            (document as any).fonts.add(face);
            fontsLoaded.add(f.key);
          } catch {
            /* missing font: canvas falls back, export still uses bundled file */
          }
        }),
      );
    })
    .catch(() => {});
  return fontLoad;
}

function keyed(keys: [number, number][] | undefined, t: number, dflt: number): number {
  if (!keys || !keys.length) return dflt;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [ta, va] = keys[i];
    const [tb, vb] = keys[i + 1];
    if (t < tb) return t <= ta ? va : va + ((vb - va) * (t - ta)) / Math.max(1e-6, tb - ta);
  }
  return keys[keys.length - 1][1];
}

function rgba(hex: string, a: number) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function arrowPath(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sh = h * 0.36;
  const head = Math.min(w * 0.42, h);
  const y0 = (h - sh) / 2;
  const y1 = (h + sh) / 2;
  ctx.beginPath();
  ctx.moveTo(0, y0);
  ctx.lineTo(w - head, y0);
  ctx.lineTo(w - head, 0);
  ctx.lineTo(w, h / 2);
  ctx.lineTo(w - head, h);
  ctx.lineTo(w - head, y1);
  ctx.lineTo(0, y1);
  ctx.closePath();
}

/** Draw all ops active at timeline time t. ctx must be scaled to composition pixels. */
export function drawOps(ctx: CanvasRenderingContext2D, ops: DrawOp[], t: number, images: Map<string, HTMLImageElement>) {
  for (const op of ops) {
    if (t < op.t0 || t >= op.t1) continue;
    const local = t - op.t0;
    const am = keyed(op.anim?.alpha, local, 1);
    if (am <= 0.001) continue;
    const sc = keyed(op.anim?.scale, local, 1) * (op.scale ?? 1);
    let x = op.x;
    let y = op.y;
    if (op.anim?.move) {
      const [dx, dy, d] = op.anim.move;
      const u = Math.min(1, local / Math.max(1e-3, d));
      x += dx * (1 - u);
      y += dy * (1 - u);
    }
    ctx.save();
    if (op.k === "text" && op.text) {
      const em = op.em ?? 40;
      const size = op.size ?? em;
      const asc = op.asc ?? em * 0.8;
      ctx.font = `${op.italic ? "italic " : ""}${em}px "cf-${op.font}", Inter, sans-serif`;
      (ctx as any).letterSpacing = `${op.spacing ?? 0}px`;
      ctx.textAlign = op.an === 4 ? "left" : op.an === 6 ? "right" : "center";
      ctx.textBaseline = "alphabetic";
      ctx.translate(x, y);
      if (sc !== 1) ctx.scale(sc, sc);
      const by = -size / 2 + asc;
      if (op.blur) ctx.filter = `blur(${op.blur * 0.6}px)`;
      const sw = op.sw ?? 0;
      if (op.shadow && op.shadow > 0) {
        ctx.save();
        ctx.translate(op.shadow, op.shadow);
        ctx.fillStyle = rgba(op.shc ?? "#000000", (op.sha ?? 0.55) * am);
        ctx.strokeStyle = ctx.fillStyle;
        if (sw > 0) {
          ctx.lineWidth = sw * 2;
          ctx.lineJoin = "round";
          ctx.strokeText(op.text, 0, by);
        }
        ctx.fillText(op.text, 0, by);
        ctx.restore();
      }
      if (sw > 0 && (op.sa ?? 1) > 0) {
        ctx.lineWidth = sw * 2;
        ctx.lineJoin = "round";
        ctx.strokeStyle = rgba(op.stroke ?? "#000000", (op.sa ?? 1) * am);
        ctx.strokeText(op.text, 0, by);
      }
      if (op.fa > 0) {
        ctx.fillStyle = rgba(op.fill, op.fa * am);
        ctx.fillText(op.text, 0, by);
      }
    } else if (op.k === "rect" || op.k === "ellipse" || op.k === "arrow") {
      const w = op.w ?? 0;
      const h = op.h ?? 0;
      if (op.grow) {
        const u = Math.min(1, local / Math.max(1e-3, op.t1 - op.t0));
        ctx.translate(x, y);
        ctx.scale(u, 1);
        ctx.translate(-x, -y);
      } else if (sc !== 1) {
        ctx.translate(x + w / 2, y + h / 2);
        ctx.scale(sc, sc);
        ctx.translate(-(x + w / 2), -(y + h / 2));
      }
      if (op.k === "arrow" && op.rot) {
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate((op.rot * Math.PI) / 180);
        ctx.translate(-(x + w / 2), -(y + h / 2));
      }
      const sw = op.sw ?? 0;
      if (op.k === "rect") roundRect(ctx, x - sw / 2, y - sw / 2, w + sw, h + sw, (op.r ?? 0) + sw / 2);
      else if (op.k === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2 + sw / 2, h / 2 + sw / 2, 0, 0, Math.PI * 2);
      } else {
        ctx.translate(x, y);
        arrowPath(ctx, w, h);
      }
      if (op.fa > 0) {
        ctx.fillStyle = rgba(op.fill, op.fa * am);
        ctx.fill();
      }
      if (sw > 0 && (op.sa ?? 0) > 0) {
        ctx.lineWidth = sw;
        ctx.strokeStyle = rgba(op.stroke ?? op.fill, (op.sa ?? 1) * am);
        ctx.stroke();
      }
    } else if (op.k === "img" && op.asset_id) {
      const img = images.get(op.asset_id);
      if (img && img.complete && img.naturalWidth) {
        const w = op.w ?? 0;
        const h = op.h ?? 0;
        const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
        const iw = img.naturalWidth * s;
        const ih = img.naturalHeight * s;
        ctx.globalAlpha = op.fa * am;
        ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
      }
    }
    ctx.restore();
  }
}
