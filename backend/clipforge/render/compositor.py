"""Frame compositor: timeline → raw frames → encoder.

Per output frame:
  1. fetch the source frame(s) for the active clip(s) from streaming decoders
     reading the ORIGINAL media (never the preview proxy);
  2. build the background (blurred cover / solid) where the crop leaves gaps;
  3. warp each reframing panel with a single sub-pixel affine resample
     (crop + scale in one interpolation, so no generational loss or jitter);
  4. apply clip effects, transitions, B-roll overlays, global grade,
     vignette, sharpening and logo/image overlays;
  5. pipe BGR frames to FFmpeg, where libass burns in captions/titles/graphics
     at output resolution and the encoder runs once.

The colour math (exposure → temperature → saturation → contrast) and the
vignette formula are mirrored in the browser preview.
"""

from __future__ import annotations

import logging
import math
import queue
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from ..config import get_config
from ..edit.reframe import crop_rect, interp_keyframes
from ..edit.timemap import Seg, segments
from ..schemas import Effect, Timeline
from ..util.proc import CancelToken, ProcessError

log = logging.getLogger(__name__)

HANDLE_TRANSITIONS = ("crossfade", "slide", "zoom")


# ----------------------------------------------------------------------------- decoding

def _decode_filters(info: dict[str, Any], speed: float, fps: float, scale_wh: tuple[int, int] | None) -> str:
    vf = []
    if info.get("hdr"):
        vf += ["zscale=t=linear:npl=100", "format=gbrpf32le", "zscale=p=bt709", "tonemap=hable:desat=0",
               "zscale=t=bt709:m=bt709:r=tv", "format=yuv420p"]
    vf.append(f"setpts=(PTS-STARTPTS)/{speed:.6f}")
    vf.append(f"fps={fps:.6f}")
    matrix = info.get("color_space") or ("bt709" if info.get("display_height", 0) >= 720 else "bt601")
    matrix = {"bt709": "bt709", "smpte170m": "bt601", "bt470bg": "bt601", "bt2020nc": "bt2020", "bt2020c": "bt2020"}.get(matrix, "bt709")
    rng = "pc" if info.get("color_range") == "pc" else "tv"
    w, h = scale_wh or (info["display_width"], info["display_height"])
    vf.append(f"scale={w}:{h}:flags=lanczos+accurate_rnd+full_chroma_int:in_color_matrix={matrix}:in_range={rng}")
    vf.append("format=bgr24")
    return ",".join(vf)


class FrameReader:
    """Sequential frame source for one clip (with transition handles)."""

    def __init__(self, path: Path, info: dict[str, Any], src_start: float, speed: float, fps: float,
                 seconds: float, scale_wh: tuple[int, int], token: CancelToken | None):
        cfg = get_config()
        self.w, self.h = scale_wh
        self.frame_bytes = self.w * self.h * 3
        args = [cfg.ffmpeg_bin, "-nostdin", "-hide_banner", "-loglevel", "error",
                "-ss", f"{max(0.0, src_start):.4f}", "-t", f"{seconds * speed + 1.0:.4f}",
                "-i", str(path), "-map", "0:v:0", "-an", "-sn",
                "-vf", _decode_filters(info, speed, fps, scale_wh), "-f", "rawvideo", "pipe:1"]
        self.proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
                                     bufsize=self.frame_bytes * 2)
        self.token = token
        if token:
            token.register(self.proc)
        self.q: queue.Queue = queue.Queue(maxsize=8)
        self.pos = -1
        self.cur: np.ndarray | None = None
        self.eof = False
        self.t = threading.Thread(target=self._pump, daemon=True)
        self.t.start()

    def _pump(self) -> None:
        assert self.proc.stdout is not None
        while True:
            buf = self.proc.stdout.read(self.frame_bytes)
            if len(buf) < self.frame_bytes:
                self.q.put(None)
                return
            self.q.put(np.frombuffer(buf, dtype=np.uint8).reshape(self.h, self.w, 3))

    def get(self, k: int) -> np.ndarray:
        while self.pos < k and not self.eof:
            item = self.q.get()
            if item is None:
                self.eof = True
                break
            self.cur = item
            self.pos += 1
        if self.cur is None:
            err = (self.proc.stderr.read() if self.proc.stderr else b"").decode("utf-8", "replace")[-300:]
            raise ProcessError(f"Could not decode source frames: {err or 'no frames returned'}")
        return self.cur

    def close(self) -> None:
        if self.token:
            self.token.unregister(self.proc)
        if self.proc.poll() is None:
            self.proc.kill()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass


# ----------------------------------------------------------------------------- colour

def _sat_matrix_rgb(s: float) -> np.ndarray:
    return np.array([
        [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
        [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
        [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
    ], dtype=np.float32)


def color_matrix(exposure: float = 0.0, contrast: float = 1.0, saturation: float = 1.0, temperature: float = 0.0) -> np.ndarray | None:
    """3×4 BGR affine matrix: exposure → temperature → saturation → contrast."""
    if abs(exposure) < 1e-4 and abs(contrast - 1) < 1e-4 and abs(saturation - 1) < 1e-4 and abs(temperature) < 1e-4:
        return None
    b = 2.0 ** exposure
    temp = np.diag([1 + 0.12 * temperature, 1 + 0.02 * temperature, 1 - 0.12 * temperature]).astype(np.float32)  # RGB
    m_rgb = contrast * (_sat_matrix_rgb(saturation) @ temp) * b
    m_bgr = m_rgb[::-1, ::-1]
    off = 255.0 * 0.5 * (1 - contrast)
    out = np.zeros((3, 4), dtype=np.float32)
    out[:, :3] = m_bgr
    out[:, 3] = off
    return out


def apply_color(img: np.ndarray, m: np.ndarray | None) -> np.ndarray:
    if m is None:
        return img
    return cv2.transform(img, m)


@dataclass
class _MaskCache:
    masks: dict[tuple, np.ndarray] = field(default_factory=dict)

    def vignette(self, w: int, h: int, amount: float) -> np.ndarray:
        key = ("v", w, h, round(amount, 3))
        if key not in self.masks:
            ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
            r = np.sqrt(((xs - w / 2) / (w / 2)) ** 2 + ((ys - h / 2) / (h / 2)) ** 2) / math.sqrt(2)
            u = np.clip((r - 0.35) / 0.6, 0, 1)
            m = 1.0 - amount * 0.85 * (u * u * (3 - 2 * u))
            self.masks[key] = cv2.merge([m, m, m]).astype(np.float32)
        return self.masks[key]

    def shape(self, w: int, h: int, shape: str, size: float, feather: float) -> np.ndarray:
        key = ("s", w, h, shape, round(size, 3), round(feather, 3))
        if key not in self.masks:
            m = np.zeros((h, w), np.float32)
            if shape == "circle":
                r = int(min(w, h) * size / 2)
                cv2.circle(m, (w // 2, h // 2), r, 1.0, -1, lineType=cv2.LINE_AA)
            else:
                mw, mh = int(w * size), int(h * size)
                x0, y0 = (w - mw) // 2, (h - mh) // 2
                rad = int(min(mw, mh) * 0.08)
                cv2.rectangle(m, (x0 + rad, y0), (x0 + mw - rad, y0 + mh), 1.0, -1)
                cv2.rectangle(m, (x0, y0 + rad), (x0 + mw, y0 + mh - rad), 1.0, -1)
                for cx, cy in ((x0 + rad, y0 + rad), (x0 + mw - rad, y0 + rad), (x0 + rad, y0 + mh - rad), (x0 + mw - rad, y0 + mh - rad)):
                    cv2.circle(m, (cx, cy), rad, 1.0, -1, lineType=cv2.LINE_AA)
            if feather > 0:
                k = max(1, int(min(w, h) * feather))
                m = cv2.GaussianBlur(m, (0, 0), k / 2)
            self.masks[key] = cv2.merge([m, m, m])
        return self.masks[key]


def _hex_bgr(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return int(h[4:6], 16), int(h[2:4], 16), int(h[0:2], 16)


def _smooth(u: float) -> float:
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


def _eff_range(e: Effect, clip_dur: float) -> tuple[float, float]:
    end = e.end if e.end is not None else clip_dur
    return e.start, max(e.start + 1e-3, end)


def effect_zoom_pan(effects: list[Effect], r: float, clip_dur: float) -> tuple[float, float, float]:
    """Multiplicative zoom and additive pan (normalised source units) from clip effects at clip time r."""
    z, dx, dy = 1.0, 0.0, 0.0
    for e in effects:
        if not e.enabled or e.type not in ("zoom", "pan"):
            continue
        a, b = _eff_range(e, clip_dur)
        if not (a <= r < b or (r >= b and e.type == "zoom" and e.end is None)):
            continue
        u = _smooth((r - a) / (b - a)) if b > a else 1.0
        if e.type == "zoom":
            f = float(e.params.get("from", 1.0))
            t = float(e.params.get("to", f))
            z *= f + (t - f) * u
        else:
            dx += float(e.params.get("dx", 0.0)) * u
            dy += float(e.params.get("dy", 0.0)) * u
    return z, dx, dy


# ----------------------------------------------------------------------------- compositor

class Compositor:
    def __init__(self, tl: Timeline, src: Path, info: dict[str, Any], out_w: int, out_h: int, fps: float,
                 asset_paths: dict[str, Path], token: CancelToken | None = None, start_at: float | None = None):
        self.start_at = start_at  # single-frame previews: decoders start near this timeline time
        self.tl = tl
        self.src = src
        self.info = info
        self.W, self.H = out_w, out_h
        self.S = out_w / tl.canvas.width
        self.fps = fps
        self.token = token
        self.assets = asset_paths
        self.segs = segments(tl)
        self.readers: dict[int, FrameReader] = {}
        self.reader_origin: dict[int, float] = {}
        self.overlay_readers: dict[str, FrameReader] = {}
        self.masks = _MaskCache()
        self.sw, self.sh = info["display_width"], info["display_height"]
        self.global_m = color_matrix(tl.color.exposure, tl.color.contrast, tl.color.saturation, tl.color.temperature)
        self.freeze: dict[str, np.ndarray] = {}
        self.img_cache: dict[tuple, np.ndarray] = {}
        self.prescale = self._prescale()
        self.stats = {"bg_frames": 0, "transition_frames": 0, "prescale": self.prescale}

    # -------------------------------------------------- setup
    def _prescale(self) -> tuple[int, int]:
        """Decode at the smallest size that still gives ≥1 source px per output px."""
        from ..edit.reframe import base_crop

        need = 0.0
        for p in self.tl.reframe.panels:
            pw, ph = p.rect[2] * self.W, p.rect[3] * self.H
            _bw, bh = base_crop(self.sw, self.sh, pw / ph)
            zmax = max((k.zoom for k in p.keyframes), default=1.0)
            emax = 1.0
            for c in self.tl.clips:
                for e in c.effects:
                    if e.type == "zoom":
                        emax = max(emax, float(e.params.get("from", 1)), float(e.params.get("to", 1)))
            need = max(need, ph * zmax * emax / bh)
        f = min(1.0, need * 1.05)
        if f > 0.9:
            return self.sw - self.sw % 2, self.sh - self.sh % 2
        w = max(16, int(round(self.sw * f / 2) * 2))
        h = max(16, int(round(self.sh * f / 2) * 2))
        return w, h

    def _handles(self, k: int) -> tuple[float, float]:
        tin = self.segs[k].clip.transition_in if k > 0 else None
        nxt = self.segs[k + 1].clip.transition_in if k + 1 < len(self.segs) else None
        pre = tin.duration / 2 if tin and tin.type in HANDLE_TRANSITIONS else 0.0
        post = nxt.duration / 2 if nxt and nxt.type in HANDLE_TRANSITIONS else 0.0
        return pre, post

    def _reader(self, k: int) -> FrameReader:
        if k not in self.readers:
            sg = self.segs[k]
            pre, post = self._handles(k)
            src_start = max(0.0, sg.s0 - pre * sg.speed)
            real_pre = (sg.s0 - src_start) / sg.speed
            secs = (sg.t1 - sg.t0) + real_pre + post
            if self.start_at is not None and sg.t0 - real_pre <= self.start_at < sg.t1 + post:
                src_start = max(0.0, sg.to_source(self.start_at))
                real_pre = sg.t0 - self.start_at  # origin becomes start_at
                secs = 1.0
            self.readers[k] = FrameReader(self.src, self.info, src_start, sg.speed, self.fps, secs, self.prescale, self.token)
            self.reader_origin[k] = sg.t0 - real_pre
        return self.readers[k]

    def _release_before(self, k: int) -> None:
        for j in list(self.readers):
            if j < k - 1:
                self.readers.pop(j).close()

    def close(self) -> None:
        for r in list(self.readers.values()) + list(self.overlay_readers.values()):
            r.close()
        self.readers.clear()
        self.overlay_readers.clear()

    def _frame(self, k: int, t: float) -> np.ndarray:
        rd = self._reader(k)
        idx = int(round((t - self.reader_origin[k]) * self.fps))
        fr = rd.get(max(0, idx))
        # Freeze-frame effects hold the frame from the effect start (audio continues).
        sg = self.segs[k]
        r = t - sg.t0
        for e in sg.clip.effects:
            if e.enabled and e.type == "freeze":
                a, b = _eff_range(e, sg.t1 - sg.t0)
                if a <= r < b:
                    if e.id not in self.freeze:
                        self.freeze[e.id] = fr.copy()
                    return self.freeze[e.id]
        return fr

    # -------------------------------------------------- per-clip composition
    def _background(self, frame: np.ndarray) -> np.ndarray:
        rf = self.tl.reframe
        if rf.background == "blur":
            fh, fw = frame.shape[:2]
            s = max(self.W / fw, self.H / fh)
            cw, ch = self.W / s, self.H / s
            x0, y0 = int((fw - cw) / 2), int((fh - ch) / 2)
            sub = frame[max(0, y0) : int(y0 + ch), max(0, x0) : int(x0 + cw)]
            small = cv2.resize(sub, (max(8, self.W // 14), max(8, self.H // 14)), interpolation=cv2.INTER_AREA)
            small = cv2.GaussianBlur(small, (0, 0), 3.0)
            bg = cv2.resize(small, (self.W, self.H), interpolation=cv2.INTER_LINEAR)
            return cv2.convertScaleAbs(bg, alpha=0.55, beta=0)
        col = _hex_bgr(rf.background_color if rf.background == "color" else "#000000")
        bg = np.empty((self.H, self.W, 3), np.uint8)
        bg[:] = col
        return bg

    def compose_clip(self, k: int, t: float) -> np.ndarray:
        sg = self.segs[k]
        frame = self._frame(k, t)
        fh, fw = frame.shape[:2]
        r = t - sg.t0
        clip_dur = sg.t1 - sg.t0
        ez, edx, edy = effect_zoom_pan(sg.clip.effects, r, clip_dur)
        plans = []
        needs_bg = False
        for p in self.tl.reframe.panels:
            px, py = int(round(p.rect[0] * self.W)), int(round(p.rect[1] * self.H))
            pw = int(round((p.rect[0] + p.rect[2]) * self.W)) - px
            ph = int(round((p.rect[1] + p.rect[3]) * self.H)) - py
            cx, cy, z = interp_keyframes(p.keyframes, t)
            z *= ez
            x0, y0, cw, ch = crop_rect(min(1.0, max(0.0, cx + edx)), min(1.0, max(0.0, cy + edy)), z, self.sw, self.sh, pw / ph)
            if x0 < -0.5 or y0 < -0.5 or x0 + cw > self.sw + 0.5 or y0 + ch > self.sh + 0.5:
                needs_bg = True
            plans.append((px, py, pw, ph, x0, y0, cw, ch))
        canvas = self._background(frame) if needs_bg else np.zeros((self.H, self.W, 3), np.uint8)
        if needs_bg:
            self.stats["bg_frames"] += 1
        fx = fw / self.sw
        fy = fh / self.sh
        for px, py, pw, ph, x0, y0, cw, ch in plans:
            sx = pw / (cw * fx)
            sy = ph / (ch * fy)
            M = np.array([[sx, 0, -x0 * fx * sx], [0, sy, -y0 * fy * sy]], dtype=np.float32)
            roi = canvas[py : py + ph, px : px + pw]
            tmp = roi.copy()
            interp = cv2.INTER_CUBIC if sx > 1.02 else cv2.INTER_LINEAR
            cv2.warpAffine(frame, M, (pw, ph), dst=tmp, flags=interp, borderMode=cv2.BORDER_TRANSPARENT)
            canvas[py : py + ph, px : px + pw] = tmp
        return self._clip_effects(canvas, sg, r, clip_dur)

    def _clip_effects(self, img: np.ndarray, sg: Seg, r: float, clip_dur: float) -> np.ndarray:
        for e in sg.clip.effects:
            if not e.enabled:
                continue
            a, b = _eff_range(e, clip_dur)
            if not (a <= r < b):
                continue
            u = (r - a) / (b - a)
            p = e.params
            if e.type == "blur":
                sigma = float(p.get("radius", 0.01)) * self.H
                if sigma > 0.3:
                    img = cv2.GaussianBlur(img, (0, 0), sigma)
            elif e.type in ("exposure", "contrast", "saturation", "grade"):
                m = color_matrix(float(p.get("exposure", p.get("value", 0.0)) if e.type in ("exposure", "grade") else 0.0),
                                 float(p.get("contrast", p.get("value", 1.0)) if e.type in ("contrast", "grade") else 1.0),
                                 float(p.get("saturation", p.get("value", 1.0)) if e.type in ("saturation", "grade") else 1.0),
                                 float(p.get("temperature", 0.0)) if e.type == "grade" else 0.0)
                img = apply_color(img, m)
            elif e.type == "vignette":
                img = cv2.multiply(img.astype(np.float32), self.masks.vignette(self.W, self.H, float(p.get("amount", 0.4)))).astype(np.uint8)
            elif e.type == "sharpen":
                amt = float(p.get("amount", 0.5)) * 0.8
                bl = cv2.GaussianBlur(img, (0, 0), max(0.8, self.H / 1920 * 1.2))
                img = cv2.addWeighted(img, 1 + amt, bl, -amt, 0)
            elif e.type in ("fade_in", "fade_out"):
                alpha = 1 - u if e.type == "fade_in" else u
                col = np.empty_like(img)
                col[:] = _hex_bgr(str(p.get("color", "#000000")))
                img = cv2.addWeighted(img, 1 - alpha, col, alpha, 0)
            elif e.type == "mask":
                m = self.masks.shape(self.W, self.H, str(p.get("shape", "rounded")), float(p.get("size", 0.85)), float(p.get("feather", 0.03)))
                col = np.empty_like(img)
                col[:] = _hex_bgr(str(p.get("color", "#000000")))
                img = (img.astype(np.float32) * m + col.astype(np.float32) * (1 - m)).astype(np.uint8)
        return img

    # -------------------------------------------------- transitions
    def _seg_at(self, t: float) -> int:
        for k, sg in enumerate(self.segs):
            if sg.t0 <= t < sg.t1:
                return k
        return len(self.segs) - 1

    def compose(self, t: float) -> np.ndarray:
        k = self._seg_at(t)
        self._release_before(k)
        sg = self.segs[k]
        img = None
        # Incoming transition into clip k (window centred on the cut)
        tin = sg.clip.transition_in if k > 0 else None
        nxt = self.segs[k + 1].clip.transition_in if k + 1 < len(self.segs) else None
        if tin and tin.type != "cut" and tin.duration > 0 and t < sg.t0 + tin.duration / 2:
            img = self._transition(k, t, tin.type, tin.duration)
        elif nxt and nxt.type != "cut" and nxt.duration > 0 and t >= sg.t1 - nxt.duration / 2:
            img = self._transition(k + 1, t, nxt.type, nxt.duration)
        if img is None:
            img = self.compose_clip(k, t)
        return self._finish(img, t)

    def _transition(self, kb: int, t: float, typ: str, d: float) -> np.ndarray:
        self.stats["transition_frames"] += 1
        T = self.segs[kb].t0
        u = (t - (T - d / 2)) / d
        u = max(0.0, min(1.0, u))
        ka = kb - 1
        if typ in ("fade_black", "fade_white"):
            col = np.empty((self.H, self.W, 3), np.uint8)
            col[:] = (0, 0, 0) if typ == "fade_black" else (255, 255, 255)
            if t < T:
                a = self.compose_clip(ka, t)
                return cv2.addWeighted(a, 1 - u * 2, col, u * 2, 0)
            b = self.compose_clip(kb, t)
            return cv2.addWeighted(b, (u - 0.5) * 2, col, 1 - (u - 0.5) * 2, 0)
        if typ == "blur":
            if t < T:
                img = self.compose_clip(ka, t)
                s = u * 2
            else:
                img = self.compose_clip(kb, t)
                s = (1 - u) * 2
            sigma = s * self.H * 0.02
            return cv2.GaussianBlur(img, (0, 0), sigma) if sigma > 0.3 else img
        a = self.compose_clip(ka, t)
        b = self.compose_clip(kb, t)
        e = _smooth(u)
        if typ == "crossfade":
            return cv2.addWeighted(a, 1 - u, b, u, 0)
        if typ == "slide":
            off = int(round(e * self.W))
            out = np.empty_like(a)
            out[:, : self.W - off] = a[:, off:]
            out[:, self.W - off :] = b[:, : off]
            return out
        if typ == "zoom":
            s = 1 + 0.25 * e
            M = np.array([[s, 0, (1 - s) * self.W / 2], [0, s, (1 - s) * self.H / 2]], dtype=np.float32)
            az = cv2.warpAffine(a, M, (self.W, self.H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
            return cv2.addWeighted(az, 1 - u, b, u, 0)
        return b if u >= 0.5 else a

    # -------------------------------------------------- finishing
    def _finish(self, img: np.ndarray, t: float) -> np.ndarray:
        img = self._overlays(img, t)
        img = apply_color(img, self.global_m)
        c = self.tl.color
        if c.vignette > 0:
            img = cv2.multiply(img.astype(np.float32), self.masks.vignette(self.W, self.H, c.vignette)).astype(np.uint8)
        if c.sharpen > 0:
            amt = c.sharpen * 0.8
            bl = cv2.GaussianBlur(img, (0, 0), max(0.8, self.H / 1920 * 1.2))
            img = cv2.addWeighted(img, 1 + amt, bl, -amt, 0)
        return self._images(img, t)

    def _overlays(self, img: np.ndarray, t: float) -> np.ndarray:
        trk = next((x for x in self.tl.tracks if x.kind == "overlay"), None)
        if trk and trk.hidden:
            return img
        for ov in self.tl.overlays:
            if not (ov.start <= t < ov.start + ov.duration):
                continue
            path = self.assets.get(ov.source_id or "")
            if path is None:
                continue
            x, y, w, h = ov.transform or (0.0, 0.0, 1.0, 1.0)
            px, py, pw, ph = int(x * self.W), int(y * self.H), max(2, int(w * self.W)), max(2, int(h * self.H))
            pw, ph = min(pw, self.W - px), min(ph, self.H - py)
            if ov.id not in self.overlay_readers:
                from ..media.ffprobe import probe

                oi = probe(path, detect_vfr=False)
                s = max(pw / oi["display_width"], ph / oi["display_height"])
                sw_, sh_ = int(round(oi["display_width"] * s / 2) * 2), int(round(oi["display_height"] * s / 2) * 2)
                self.overlay_readers[ov.id] = FrameReader(path, oi, ov.src_in, ov.speed, self.fps, ov.duration, (max(2, sw_), max(2, sh_)), self.token)
            rd = self.overlay_readers[ov.id]
            fr = rd.get(int(round((t - ov.start) * self.fps)))
            fh, fw = fr.shape[:2]
            ox, oy = (fw - pw) // 2, (fh - ph) // 2
            sub = fr[max(0, oy) : max(0, oy) + ph, max(0, ox) : max(0, ox) + pw]
            sub = sub[: ph, : pw]
            if ov.opacity >= 0.999:
                img[py : py + sub.shape[0], px : px + sub.shape[1]] = sub
            else:
                roi = img[py : py + sub.shape[0], px : px + sub.shape[1]]
                img[py : py + sub.shape[0], px : px + sub.shape[1]] = cv2.addWeighted(roi, 1 - ov.opacity, sub, ov.opacity, 0)
        return img

    def _images(self, img: np.ndarray, t: float) -> np.ndarray:
        trk = next((x for x in self.tl.tracks if x.kind == "graphics"), None)
        if trk and trk.hidden:
            return img
        for g in self.tl.graphics:
            if g.kind not in ("image", "logo") or not (g.start <= t < g.end) or not g.asset_id:
                continue
            path = self.assets.get(g.asset_id)
            if path is None or not path.exists():
                continue
            gw, gh = max(2, int(g.w * self.W)), max(2, int(g.h * self.H))
            key = (str(path), gw, gh)
            if key not in self.img_cache:
                raw = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
                if raw is None:
                    continue
                if raw.ndim == 2:
                    raw = cv2.cvtColor(raw, cv2.COLOR_GRAY2BGRA)
                elif raw.shape[2] == 3:
                    raw = cv2.cvtColor(raw, cv2.COLOR_BGR2BGRA)
                s = min(gw / raw.shape[1], gh / raw.shape[0])
                rw, rh = max(1, int(raw.shape[1] * s)), max(1, int(raw.shape[0] * s))
                self.img_cache[key] = cv2.resize(raw, (rw, rh), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
            rgba = self.img_cache[key]
            rh, rw = rgba.shape[:2]
            x0 = int(g.x * self.W - rw / 2)
            y0 = int(g.y * self.H - rh / 2)
            a = g.opacity * _anim_alpha(g, t)
            if a <= 0:
                continue
            xs0, ys0 = max(0, x0), max(0, y0)
            xs1, ys1 = min(self.W, x0 + rw), min(self.H, y0 + rh)
            if xs1 <= xs0 or ys1 <= ys0:
                continue
            src = rgba[ys0 - y0 : ys1 - y0, xs0 - x0 : xs1 - x0]
            alpha = src[..., 3:4].astype(np.float32) / 255.0 * a
            roi = img[ys0:ys1, xs0:xs1].astype(np.float32)
            img[ys0:ys1, xs0:xs1] = (roi * (1 - alpha) + src[..., :3].astype(np.float32) * alpha).astype(np.uint8)
        return img


def _anim_alpha(g, t: float) -> float:
    a = 1.0
    if g.anim_in.type != "none" and g.anim_in.duration > 0:
        a = min(a, (t - g.start) / g.anim_in.duration)
    if g.anim_out.type != "none" and g.anim_out.duration > 0:
        a = min(a, (g.end - t) / g.anim_out.duration)
    return max(0.0, min(1.0, a))


# ----------------------------------------------------------------------------- encode loop

def render_video(comp: Compositor, workdir: Path, ass_name: str | None, audio_wav: Path, out_path: Path,
                 vcodec_args: list[str], acodec_args: list[str], check_times: list[float],
                 token: CancelToken | None = None, progress=None) -> dict[str, Any]:
    cfg = get_config()
    tl = comp.tl
    duration = tl.duration
    n = max(1, int(round(duration * comp.fps)))
    vf = []
    if ass_name:
        vf.append(f"subtitles=filename={ass_name}:fontsdir=fonts")
    pix = "yuv422p10le" if "prores_ks" in vcodec_args else "yuv420p"
    vf.append(f"scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format={pix}")
    tmp_out = out_path.with_name(out_path.stem + ".part" + out_path.suffix)
    args = [cfg.ffmpeg_bin, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{comp.W}x{comp.H}", "-r", f"{comp.fps:.6f}", "-i", "pipe:0",
            "-i", str(audio_wav), "-map", "0:v:0", "-map", "1:a:0", "-vf", ",".join(vf), *vcodec_args, *acodec_args,
            "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
            "-t", f"{duration:.4f}"]
    if out_path.suffix == ".mp4":
        args += ["-movflags", "+faststart"]
    args.append(str(tmp_out))
    enc = subprocess.Popen(args, stdin=subprocess.PIPE, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, cwd=str(workdir))
    if token:
        token.register(enc)
    err_lines: list[bytes] = []
    et = threading.Thread(target=lambda: err_lines.extend(enc.stderr.readlines() if enc.stderr else []), daemon=True)
    et.start()
    wq: queue.Queue = queue.Queue(maxsize=6)
    werr: list[BaseException] = []

    def _writer() -> None:
        try:
            while True:
                item = wq.get()
                if item is None:
                    break
                enc.stdin.write(item)  # type: ignore[union-attr]
        except BaseException as e:  # noqa: BLE001
            werr.append(e)

    wt = threading.Thread(target=_writer, daemon=True)
    wt.start()
    checks = sorted(set(int(round(ct * comp.fps)) for ct in check_times if 0 <= ct < duration))
    saved = []
    t_start = time.time()
    try:
        for i in range(n):
            if token:
                token.check()
            if werr:
                break
            t = i / comp.fps
            frame = comp.compose(t)
            if i in checks:
                pth = workdir / f"check_{i}.png"
                cv2.imwrite(str(pth), frame)
                saved.append({"frame": i, "t": t, "path": str(pth)})
            wq.put(np.ascontiguousarray(frame).tobytes())
            if progress and i % 5 == 0:
                progress(i / n)
        wq.put(None)
        wt.join()
        if enc.stdin:
            enc.stdin.close()
        rc = enc.wait()
        et.join(timeout=5)
    finally:
        comp.close()
        if token:
            token.unregister(enc)
        if enc.poll() is None:
            enc.kill()
    if token and token.cancelled:
        token.check()
    if rc != 0 or werr:
        tail = b"".join(err_lines).decode("utf-8", "replace")[-600:]
        raise ProcessError(f"Encoder failed (exit {rc})", rc, tail)
    tmp_out.replace(out_path)
    elapsed = time.time() - t_start
    return {"frames": n, "fps": comp.fps, "width": comp.W, "height": comp.H, "elapsed_s": round(elapsed, 2),
            "render_speed_x": round(duration / elapsed, 2) if elapsed > 0 else None, "checks": saved,
            "hdr_tonemapped": bool(comp.info.get("hdr")), **comp.stats}
