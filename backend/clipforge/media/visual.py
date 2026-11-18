"""Streaming visual analysis.

FFmpeg decodes low-resolution frames at a modest sample rate straight into a
pipe; each frame is analysed and discarded, so memory stays flat even for
multi-hour sources. Per sample we record:

* scene-cut decisions (PySceneDetect ``ContentDetector``)
* motion energy (frame difference)
* brightness / colourfulness
* faces (OpenCV Haar cascades, frontal + profile) with a mouth-activity value
* a coarse saliency centroid (motion + edge energy) used for reframing when
  no faces are present (gameplay, screen recordings, sports)
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from scenedetect.common import FrameTimecode
from scenedetect.detectors import ContentDetector

from ..config import get_config
from ..util.proc import CancelToken

log = logging.getLogger(__name__)

ANALYSIS_WIDTH = 480

_cascades: dict[str, cv2.CascadeClassifier] = {}


def _cascade(name: str) -> cv2.CascadeClassifier:
    if name not in _cascades:
        path = Path(cv2.data.haarcascades) / name
        c = cv2.CascadeClassifier(str(path))
        if c.empty():
            raise RuntimeError(f"OpenCV cascade {name} could not be loaded")
        _cascades[name] = c
    return _cascades[name]


def detect_faces(gray: np.ndarray, allow_profile: bool = True) -> list[tuple[int, int, int, int, float]]:
    """Return faces as (x, y, w, h, confidence) in pixel coords of ``gray``.

    Uses the ``alt2`` frontal cascade on the raw grayscale frame (global
    histogram equalisation was found to suppress detections on studio sets);
    the profile cascade runs only when no frontal face is found and the
    caller allows it (it is ~2x more expensive).
    """
    h, w = gray.shape[:2]
    min_side = max(20, int(min(w, h) * 0.06))
    out: list[tuple[int, int, int, int, float]] = []
    front = _cascade("haarcascade_frontalface_alt2.xml")
    rects, _levels, weights = front.detectMultiScale3(
        gray, scaleFactor=1.12, minNeighbors=4, minSize=(min_side, min_side), outputRejectLevels=True
    )
    for (x, y, fw, fh), wt in zip(rects, weights):
        out.append((int(x), int(y), int(fw), int(fh), float(min(1.0, max(0.1, 0.5 + wt / 10.0)))))
    if not out and allow_profile:
        prof = _cascade("haarcascade_profileface.xml")
        for flip in (False, True):
            img = cv2.flip(gray, 1) if flip else gray
            rects = prof.detectMultiScale(img, scaleFactor=1.15, minNeighbors=5, minSize=(min_side, min_side))
            for x, y, fw, fh in rects:
                if flip:
                    x = w - x - fw
                out.append((int(x), int(y), int(fw), int(fh), 0.45))
    # Non-maximum suppression (cascades often return nested boxes)
    out.sort(key=lambda r: r[2] * r[3], reverse=True)
    kept: list[tuple[int, int, int, int, float]] = []
    for r in out:
        if all(_iou(r, k) < 0.3 for k in kept):
            kept.append(r)
    return kept[:6]


def _iou(a, b) -> float:
    ax, ay, aw, ah = a[:4]
    bx, by, bw, bh = b[:4]
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def analyse_video(
    src: Path,
    info: dict[str, Any],
    sample_fps: float = 4.0,
    detect_faces_every: int = 1,
    token: CancelToken | None = None,
    progress=None,
) -> dict[str, Any]:
    cfg = get_config()
    dw, dh = info["display_width"], info["display_height"]
    aw = ANALYSIS_WIDTH if dw >= dh else int(ANALYSIS_WIDTH * dw / dh)
    aw -= aw % 2
    ah = int(round(aw * dh / dw))
    ah -= ah % 2
    vf = [f"fps={sample_fps}", f"scale={aw}:{ah}:flags=area"]
    if info.get("hdr"):
        # Analysis only: a cheap approximate SDR mapping is enough for detection.
        vf.insert(1, "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable,zscale=t=bt709:m=bt709:r=tv,format=yuv420p")
    args = [
        cfg.ffmpeg_bin, "-nostdin", "-hide_banner", "-loglevel", "error",
        "-i", str(src), "-map", "0:v:0", "-an", "-sn",
        "-vf", ",".join(vf), "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1",
    ]
    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, bufsize=aw * ah * 3 * 4)
    if token:
        token.register(p)
    frame_bytes = aw * ah * 3
    detector = ContentDetector(threshold=27.0, min_scene_len=max(2, int(sample_fps * 0.8)))
    samples: list[dict[str, Any]] = []
    cuts: list[float] = []
    prev_gray = None
    prev_faces: list[tuple[int, int, int, int, float]] = []
    edge_kernel = np.ones((3, 3), np.uint8)
    idx = 0
    duration = info["duration"]
    try:
        assert p.stdout is not None
        while True:
            if token:
                token.check()
            buf = p.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            frame = np.frombuffer(buf, dtype=np.uint8).reshape(ah, aw, 3)
            t = idx / sample_fps
            for c in detector.process_frame(FrameTimecode(idx, sample_fps), frame):
                cuts.append(round(float(c.frame_num) / sample_fps, 3))
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            small = cv2.resize(gray, (aw // 4, ah // 4), interpolation=cv2.INTER_AREA)
            motion = 0.0
            diff_map = None
            if prev_gray is not None:
                diff_map = cv2.absdiff(gray, prev_gray)
                motion = float(np.mean(diff_map) / 255.0)
            hsv = cv2.cvtColor(cv2.resize(frame, (aw // 4, ah // 4)), cv2.COLOR_BGR2HSV)
            brightness = float(np.mean(small) / 255.0)
            colourfulness = float(np.mean(hsv[..., 1]) / 255.0)
            edges = cv2.Canny(small, 80, 160)
            edge_density = float(np.mean(edges > 0))
            # Saliency: motion + edges on a coarse grid → weighted centroid
            sal = cv2.dilate(edges, edge_kernel).astype(np.float32) / 255.0 * 0.4
            if diff_map is not None:
                sal += cv2.resize(diff_map, (aw // 4, ah // 4)).astype(np.float32) / 255.0 * 2.0
            tot = float(sal.sum())
            if tot > 1e-3:
                ys, xs = np.mgrid[0 : sal.shape[0], 0 : sal.shape[1]]
                scx = float((sal * xs).sum() / tot / sal.shape[1])
                scy = float((sal * ys).sum() / tot / sal.shape[0])
            else:
                scx, scy = 0.5, 0.5
            faces_out = []
            if idx % detect_faces_every == 0:
                faces = detect_faces(gray, allow_profile=(idx % 4 == 0))
            else:
                faces = prev_faces
            for (x, y, fw, fh, conf) in faces:
                mouth = 0.0
                if prev_gray is not None:
                    my0 = y + int(fh * 0.62)
                    my1 = min(ah, y + int(fh * 0.95))
                    mx0 = x + int(fw * 0.25)
                    mx1 = min(aw, x + int(fw * 0.75))
                    if my1 > my0 and mx1 > mx0:
                        a = gray[my0:my1, mx0:mx1].astype(np.int16)
                        b = prev_gray[my0:my1, mx0:mx1].astype(np.int16)
                        mouth = float(np.mean(np.abs(a - b)) / 255.0)
                faces_out.append([
                    round(x / aw, 4), round(y / ah, 4), round(fw / aw, 4), round(fh / ah, 4),
                    round(conf, 3), round(mouth, 4),
                ])
            prev_faces = faces
            samples.append({
                "t": round(t, 3),
                "motion": round(motion, 4),
                "brightness": round(brightness, 3),
                "colour": round(colourfulness, 3),
                "edges": round(edge_density, 4),
                "sal": [round(scx, 3), round(scy, 3)],
                "faces": faces_out,
            })
            prev_gray = gray
            idx += 1
            if progress and duration > 0 and idx % 8 == 0:
                progress(min(1.0, t / duration))
        p.wait(timeout=30)
    finally:
        if token:
            token.unregister(p)
        if p.poll() is None:
            p.kill()
    if token and token.cancelled:
        token.check()
    if p.returncode not in (0, None) and not samples:
        err = (p.stderr.read() if p.stderr else b"").decode("utf-8", "replace")[-400:]
        raise RuntimeError(f"Video decoding failed during analysis: {err}")
    # Merge cuts that are too close together.
    merged: list[float] = []
    for c in sorted(set(cuts)):
        if not merged or c - merged[-1] > 0.75:
            merged.append(c)
    face_presence = float(np.mean([1.0 if s["faces"] else 0.0 for s in samples])) if samples else 0.0
    return {
        "sample_fps": sample_fps,
        "analysis_size": [aw, ah],
        "samples": samples,
        "scene_cuts": merged,
        "stats": {
            "face_presence": round(face_presence, 3),
            "mean_motion": round(float(np.mean([s["motion"] for s in samples])) if samples else 0.0, 4),
            "scene_count": len(merged) + 1,
        },
    }


def samples_in_range(visual: dict[str, Any], t0: float, t1: float) -> list[dict[str, Any]]:
    fps = visual.get("sample_fps", 4.0)
    s = visual.get("samples") or []
    a = max(0, int(t0 * fps))
    b = min(len(s), int(t1 * fps) + 1)
    return s[a:b]
