"""Smart reframing: crop geometry and automatic subject-tracking trajectories.

Geometry (mirrored exactly in ``frontend/src/editor/geometry.ts`` and checked by
shared fixtures in tests):
  For a panel of aspect A (px w/h) and a source W×H, ``zoom = 1`` is the largest
  crop of aspect A that fits inside the source. ``zoom < 1`` shows more than
  the source (the remainder is filled with a blurred/solid background).
  (cx, cy) is the crop centre in normalised source coordinates; it is clamped
  so the crop never leaves the source when the crop is smaller than the source.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from ..schemas import CropKeyframe, Panel, Reframe, Timeline
from .timemap import Seg, segments


# ----------------------------------------------------------------------------- geometry

def base_crop(src_w: float, src_h: float, aspect: float) -> tuple[float, float]:
    if src_w / src_h > aspect:
        return src_h * aspect, src_h
    return src_w, src_w / aspect


def fit_zoom(src_w: float, src_h: float, aspect: float) -> float:
    bw, bh = base_crop(src_w, src_h, aspect)
    return min(bw / src_w, bh / src_h)


def crop_rect(cx: float, cy: float, zoom: float, src_w: float, src_h: float, aspect: float) -> tuple[float, float, float, float]:
    """Return (x0, y0, w, h) in source pixels."""
    bw, bh = base_crop(src_w, src_h, aspect)
    w, h = bw / zoom, bh / zoom
    if w <= src_w:
        x0 = min(max(cx * src_w - w / 2, 0.0), src_w - w)
    else:
        x0 = (src_w - w) / 2
    if h <= src_h:
        y0 = min(max(cy * src_h - h / 2, 0.0), src_h - h)
    else:
        y0 = (src_h - h) / 2
    return x0, y0, w, h


def _ease(kind: str, u: float) -> float:
    u = max(0.0, min(1.0, u))
    if kind == "linear":
        return u
    if kind == "ease_in":
        return u * u
    if kind == "ease_out":
        return 1 - (1 - u) * (1 - u)
    if kind == "hold":
        return 0.0
    return u * u * (3 - 2 * u)  # ease_in_out (smoothstep)


def interp_keyframes(kfs: list[CropKeyframe], t: float) -> tuple[float, float, float]:
    if not kfs:
        return 0.5, 0.5, 1.0
    if t <= kfs[0].t:
        k = kfs[0]
        return k.cx, k.cy, k.zoom
    for a, b in zip(kfs, kfs[1:]):
        if a.t <= t < b.t:
            u = _ease(b.ease, (t - a.t) / max(1e-6, b.t - a.t))
            return a.cx + (b.cx - a.cx) * u, a.cy + (b.cy - a.cy) * u, a.zoom + (b.zoom - a.zoom) * u
    k = kfs[-1]
    return k.cx, k.cy, k.zoom


# ----------------------------------------------------------------------------- tracking

def _faces_at(visual: dict[str, Any], t_src: float) -> list[list[float]]:
    fps = visual.get("sample_fps", 4.0)
    s = visual.get("samples") or []
    i = int(round(t_src * fps))
    if 0 <= i < len(s):
        return s[i]["faces"]
    return []


def _saliency_at(visual: dict[str, Any], t_src: float) -> tuple[float, float]:
    fps = visual.get("sample_fps", 4.0)
    s = visual.get("samples") or []
    i = int(round(t_src * fps))
    if 0 <= i < len(s):
        return tuple(s[i]["sal"])  # type: ignore[return-value]
    return 0.5, 0.5


def _track_targets(samples_t: list[float], visual: dict[str, Any], prefer: str = "largest",
                   speaker_side: list[float | None] | None = None) -> tuple[list[tuple[float, float] | None], float]:
    """Pick a target (cx, cy) per sample. Nearest-neighbour association keeps the
    camera on the same person instead of hopping between similar faces."""
    targets: list[tuple[float, float] | None] = []
    prev: tuple[float, float] | None = None
    hits = 0
    for k, t in enumerate(samples_t):
        faces = _faces_at(visual, t)
        if faces:
            hits += 1
            cand = [(f[0] + f[2] / 2, f[1] + f[3] * 0.45, f[2] * f[3], f[5] if len(f) > 5 else 0.0) for f in faces]
            want = speaker_side[k] if speaker_side else None
            if want is not None:
                pick = min(cand, key=lambda c: abs(c[0] - want))
            elif prev is not None:
                # stay with the tracked face unless a much larger one appears
                near = min(cand, key=lambda c: (c[0] - prev[0]) ** 2 + (c[1] - prev[1]) ** 2)
                big = max(cand, key=lambda c: c[2])
                pick = big if big[2] > near[2] * 2.2 else near
            else:
                pick = max(cand, key=lambda c: c[2])
            prev = (pick[0], pick[1])
            targets.append(prev)
        else:
            targets.append(None)
    conf = hits / max(1, len(samples_t))
    return targets, conf


def _virtual_camera(times: list[float], targets: list[tuple[float, float] | None], cut_times: list[float],
                    dead_zone: float, max_speed: float, smooth: float) -> list[tuple[float, float, float]]:
    """Dead-zone + exponential-smoothing camera with speed limit; snaps on scene cuts."""
    out: list[tuple[float, float, float]] = []
    cam: list[float] | None = None
    last_target = (0.5, 0.45)
    prev_t = times[0] if times else 0.0
    for t, tgt in zip(times, targets):
        if tgt is None:
            tgt = last_target
        last_target = tgt
        if cam is None:
            cam = [tgt[0], tgt[1]]
        else:
            dt = max(1e-3, t - prev_t)
            cut = any(prev_t < c <= t for c in cut_times)
            if cut:
                cam = [tgt[0], tgt[1]]
            else:
                for d in (0, 1):
                    err = tgt[d] - cam[d]
                    if abs(err) > dead_zone:
                        step = (abs(err) - dead_zone) * (1 - math.exp(-dt / smooth))
                        step = min(step, max_speed * dt)
                        cam[d] += math.copysign(step, err)
        out.append((t, cam[0], cam[1]))
        prev_t = t
    return out


def _simplify(points: list[tuple[float, float, float]], eps: float) -> list[tuple[float, float, float]]:
    """Ramer–Douglas–Peucker on (t, x, y) with t only as the parameter."""
    if len(points) <= 2:
        return points
    a, b = points[0], points[-1]
    best_d, best_i = -1.0, 0
    for i in range(1, len(points) - 1):
        p = points[i]
        u = (p[0] - a[0]) / max(1e-9, b[0] - a[0])
        ix, iy = a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u
        d = math.hypot(p[1] - ix, p[2] - iy)
        if d > best_d:
            best_d, best_i = d, i
    if best_d > eps:
        left = _simplify(points[: best_i + 1], eps)
        right = _simplify(points[best_i:], eps)
        return left[:-1] + right
    return [a, b]


def _timeline_samples(segs: list[Seg], fps: float) -> list[tuple[float, float]]:
    """(timeline_t, source_t) sample pairs at the analysis rate."""
    pts = []
    step = 1.0 / fps
    for sg in segs:
        t = sg.t0
        while t < sg.t1 - 1e-6:
            pts.append((t, sg.to_source(t)))
            t += step
        pts.append((sg.t1 - 1e-3, sg.to_source(sg.t1 - 1e-3)))
    return pts


def auto_reframe(tl: Timeline, info: dict[str, Any], visual: dict[str, Any] | None, mode: str = "auto",
                 speaker_sides: dict[int, float] | None = None, speaker_at: Any = None,
                 preserve_full_frame: bool = False) -> Reframe:
    """Build a Reframe for the timeline's canvas aspect."""
    W, H = tl.canvas.width, tl.canvas.height
    aspect = W / H
    sw, sh = info["display_width"], info["display_height"]
    src_aspect = sw / sh
    if tl.canvas.aspect == "source" or abs(src_aspect - aspect) < 0.02 or mode == "original":
        return Reframe(mode="original", panels=[Panel(keyframes=[CropKeyframe(t=0, cx=0.5, cy=0.5, zoom=1.0)])],
                       note="Source composition preserved.")
    if mode == "fill" or (preserve_full_frame and mode == "auto"):
        z = fit_zoom(sw, sh, aspect)
        return Reframe(mode="fill", background="blur", panels=[Panel(keyframes=[CropKeyframe(t=0, cx=0.5, cy=0.5, zoom=round(z, 4))])],
                       note="Full frame kept with a blurred background so on-screen information is not cropped away.")
    segs = segments(tl)
    if not visual or not visual.get("samples") or not segs:
        return Reframe(mode=mode, panels=[Panel(keyframes=[CropKeyframe(t=0)])], confidence=0.0,
                       note="No visual analysis available — centred crop. Adjust manually if needed.")
    fps = visual.get("sample_fps", 4.0)
    pairs = _timeline_samples(segs, fps)
    times = [p[0] for p in pairs]
    src_times = [p[1] for p in pairs]
    cuts_src = visual.get("scene_cuts") or []
    cut_times = [sg.t0 for sg in segs[1:]] + [sg.to_timeline(c) for sg in segs for c in cuts_src if sg.s0 < c < sg.s1]
    if mode == "split":
        return _split(tl, info, visual, times, src_times, cut_times, aspect)
    sides = None
    if mode == "speaker" and speaker_sides and speaker_at:
        sides = [speaker_sides.get(speaker_at(st)) for st in src_times]
    targets, conf = _track_targets(src_times, visual, speaker_side=sides)
    if conf < 0.25:
        # Weak face evidence: use motion/edge saliency but keep movement gentle.
        sal = [_saliency_at(visual, st) for st in src_times]
        sm = np.convolve([s[0] for s in sal], np.ones(9) / 9, mode="same") if len(sal) >= 9 else [s[0] for s in sal]
        targets = [(float(x), 0.5) for x in sm]
        cam = _virtual_camera(times, targets, cut_times, dead_zone=0.12, max_speed=0.05, smooth=1.5)
        note = "Few faces detected — following on-screen activity gently. Consider Smart Fill to keep everything visible."
        rmode = mode
        confidence = round(conf, 2)
    else:
        bw, _ = base_crop(sw, sh, aspect)
        crop_frac = bw / sw  # crop width as a fraction of the source width
        cam = _virtual_camera(times, targets, cut_times, dead_zone=crop_frac * 0.12, max_speed=0.35, smooth=0.45)
        note = f"Tracking faces ({conf * 100:.0f}% of frames)."
        rmode = mode
        confidence = round(conf, 2)
    simp = _simplify(cam, eps=0.004)
    kfs = []
    for k, (t, x, y) in enumerate(simp):
        ease = "linear"
        if k > 0 and any(simp[k - 1][0] < c <= t + 1e-6 for c in cut_times) and abs(x - simp[k - 1][1]) > 0.02:
            ease = "hold"
        kfs.append(CropKeyframe(t=round(max(0.0, t), 3), cx=round(min(1, max(0, x)), 4), cy=round(min(1, max(0, y)), 4), zoom=1.0, ease=ease))
    return Reframe(mode=rmode, panels=[Panel(keyframes=kfs or [CropKeyframe(t=0)])], confidence=confidence, note=note)


def _split(tl, info, visual, times, src_times, cut_times, aspect) -> Reframe:
    """Two stacked panels following the left-most and right-most faces."""
    sw, sh = info["display_width"], info["display_height"]
    xs = []
    for st in src_times:
        for f in _faces_at(visual, st):
            xs.append(f[0] + f[2] / 2)
    if len(xs) < len(src_times) * 0.5 or (max(xs) - min(xs) if xs else 0) < 0.2:
        rf = auto_reframe(tl, info, visual, "auto")
        rf.note = "Split screen needs two people side by side — not detected reliably, so a single tracked crop is used."
        return rf
    left_x = float(np.percentile(xs, 20))
    right_x = float(np.percentile(xs, 80))
    panels = []
    W, H = tl.canvas.width, tl.canvas.height
    for pid, side, rect in (("top", left_x, (0.0, 0.0, 1.0, 0.5)), ("bottom", right_x, (0.0, 0.5, 1.0, 0.5))):
        tg = []
        for st in src_times:
            faces = _faces_at(visual, st)
            if faces:
                f = min(faces, key=lambda f: abs(f[0] + f[2] / 2 - side))
                tg.append((f[0] + f[2] / 2, f[1] + f[3] * 0.5))
            else:
                tg.append(None)
        pa = (rect[2] * W) / (rect[3] * H)
        bw, bh = base_crop(sw, sh, pa)
        cam = _virtual_camera(times, tg, cut_times, dead_zone=bw / sw * 0.12, max_speed=0.3, smooth=0.5)
        simp = _simplify(cam, 0.004)
        # Zoom in so each face fills its half nicely (faces are small in wide shots).
        zoom = 1.6 if bh >= sh * 0.99 else 1.2
        panels.append(Panel(id=pid, rect=rect, keyframes=[CropKeyframe(t=round(t, 3), cx=round(x, 4), cy=round(y, 4), zoom=zoom, ease="linear") for t, x, y in simp]))
    return Reframe(mode="split", panels=panels, confidence=0.7, note="Two speakers stacked top/bottom.")


def speaker_side_map(sentences: list[dict[str, Any]], visual: dict[str, Any] | None) -> tuple[dict[int, float], float]:
    """Associate diarised speaker labels with face x-positions via mouth activity.

    For each speaker label, average the mouth-motion of faces on the left vs
    right half during that speaker's sentences. Returns ({label: x}, confidence).
    """
    if not visual or not visual.get("samples"):
        return {}, 0.0
    acc: dict[int, dict[str, list[float]]] = {}
    for s in sentences:
        lab = s.get("speaker")
        if lab is None:
            continue
        fps = visual["sample_fps"]
        for smp in visual["samples"][int(s["start"] * fps) : int(s["end"] * fps) + 1]:
            for f in smp["faces"]:
                side = "L" if f[0] + f[2] / 2 < 0.5 else "R"
                acc.setdefault(lab, {"L": [], "R": []})[side].append(f[5] if len(f) > 5 else 0.0)
    out: dict[int, float] = {}
    margins = []
    for lab, d in acc.items():
        ml = float(np.mean(d["L"])) if d["L"] else 0.0
        mr = float(np.mean(d["R"])) if d["R"] else 0.0
        if max(ml, mr) < 0.004:
            continue
        out[lab] = 0.25 if ml > mr else 0.75
        margins.append(abs(ml - mr) / max(ml, mr))
    conf = float(np.mean(margins)) if margins else 0.0
    if len(set(out.values())) < 2:
        return {}, 0.0
    return out, conf
