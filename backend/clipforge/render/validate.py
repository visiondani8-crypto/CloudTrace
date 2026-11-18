"""Post-render validation of the actual output file."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from ..config import get_config
from ..util.proc import run


def _probe(path: Path) -> dict[str, Any]:
    cfg = get_config()
    _, out, _ = run([cfg.ffprobe_bin, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)], timeout=60)
    return json.loads(out or b"{}")


def extract_frame(path: Path, t: float, dst: Path) -> Path:
    cfg = get_config()
    run([cfg.ffmpeg_bin, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{t:.4f}", "-i", str(path),
         "-frames:v", "1", "-pix_fmt", "bgr24", str(dst)], timeout=120)
    return dst


def validate_output(path: Path, *, expect_w: int, expect_h: int, expect_dur: float, fps: float, expect_codec: str,
                    expect_audio: bool, overlay_checks: list[dict[str, Any]], workdir: Path) -> dict[str, Any]:
    cfg = get_config()
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str, severity: str = "error") -> None:
        checks.append({"name": name, "ok": bool(ok), "detail": detail, "severity": severity})

    if not path.exists() or path.stat().st_size < 1024:
        add("file_exists", False, "Output file missing or empty")
        return {"ok": False, "checks": checks}
    add("file_exists", True, f"{path.stat().st_size / 1e6:.2f} MB")
    data = _probe(path)
    streams = data.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    add("video_stream", v is not None, v.get("codec_name", "") if v else "none")
    if v is None:
        return {"ok": False, "checks": checks, "probe": data}
    codec_map = {"h264": "h264", "hevc": "hevc", "prores": "prores"}
    add("codec", v.get("codec_name") == codec_map.get(expect_codec, expect_codec), f"{v.get('codec_name')} (expected {expect_codec})")
    w, h = int(v.get("width", 0)), int(v.get("height", 0))
    add("resolution", (w, h) == (expect_w, expect_h), f"{w}×{h} (expected {expect_w}×{expect_h})")
    add("aspect_ratio", abs(w / h - expect_w / expect_h) < 0.005 and v.get("sample_aspect_ratio", "1:1") in ("1:1", "0:1", None),
        f"{w / h:.4f}, SAR {v.get('sample_aspect_ratio', '1:1')}")
    fr = v.get("avg_frame_rate", "0/1")
    try:
        num, den = fr.split("/")
        vfps = float(num) / float(den)
    except (ValueError, ZeroDivisionError):
        vfps = 0.0
    add("frame_rate", abs(vfps - fps) < 0.05, f"{vfps:.3f} fps (expected {fps:.3f})")
    vdur = float(v.get("duration") or data.get("format", {}).get("duration") or 0)
    tol = max(0.1, 2.0 / fps)
    add("duration", abs(vdur - expect_dur) <= tol, f"{vdur:.3f}s (timeline {expect_dur:.3f}s)")
    if expect_audio:
        add("audio_stream", a is not None, a.get("codec_name", "") if a else "missing")
        if a is not None:
            adur = float(a.get("duration") or 0)
            add("av_sync", abs(adur - vdur) <= 0.1 and abs(float(a.get("start_time") or 0) - float(v.get("start_time") or 0)) < 0.05,
                f"audio {adur:.3f}s vs video {vdur:.3f}s")
    # Full decode (catches corrupt output that still probes fine) + loudness/silence.
    af = ["-af", "ebur128=peak=true", "-map", "0:a:0"] if a is not None else []
    _, _, err = run([cfg.ffmpeg_bin, "-nostdin", "-hide_banner", "-v", "info", "-i", str(path), "-map", "0:v:0", *af,
                     "-f", "null", "-"], timeout=max(120, expect_dur * 4), check=False)
    decode_errors = [ln for ln in err.splitlines() if re.search(r"error|corrupt|invalid", ln, re.I) and "Error while" not in ln]
    add("decodes_cleanly", not decode_errors, "OK" if not decode_errors else decode_errors[-1][:200])
    loud = {}
    if a is not None:
        m = re.search(r"Integrated loudness:\s+I:\s+(-?[\d.]+|-inf) LUFS", err)
        p = re.search(r"True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS", err)
        if m:
            loud["integrated_lufs"] = float(m.group(1)) if m.group(1) != "-inf" else None
        if p:
            loud["true_peak_dbfs"] = float(p.group(1)) if p.group(1) != "-inf" else None
        if expect_audio:
            silent = loud.get("integrated_lufs") is None or loud["integrated_lufs"] < -60
            add("audio_not_silent", not silent, f"{loud.get('integrated_lufs')} LUFS", severity="warning")
            if loud.get("true_peak_dbfs") is not None:
                add("no_clipping", loud["true_peak_dbfs"] <= 0.0, f"true peak {loud['true_peak_dbfs']} dBFS", severity="warning")
    # Overlays: compare encoded frame to the pre-overlay composite inside the overlay's box.
    for k, oc in enumerate(overlay_checks):
        raw = cv2.imread(oc["path"])
        if raw is None:
            continue
        dst = workdir / f"out_check_{k}.png"
        try:
            extract_frame(path, max(0.0, oc["t"] - 0.25 / fps), dst)
        except Exception as e:  # noqa: BLE001
            add(f"overlay_{oc['label']}", False, f"could not extract frame: {e}")
            continue
        enc = cv2.imread(str(dst))
        if enc is None or enc.shape != raw.shape:
            add(f"overlay_{oc['label']}", False, "frame size mismatch")
            continue
        x0, y0, x1, y1 = [int(v) for v in oc["bbox"]]
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(raw.shape[1], x1), min(raw.shape[0], y1)
        if x1 <= x0 or y1 <= y0:
            add(f"overlay_{oc['label']}", False, "overlay box outside frame")
            continue
        # Fraction of pixels in the overlay box changed by >30 levels: robust for solid text and thin strokes,
        # while H.264 noise on the untouched composite almost never moves a pixel that far.
        d = cv2.absdiff(raw[y0:y1, x0:x1], enc[y0:y1, x0:x1]).max(axis=2)
        changed = float(np.mean(d > 30))
        ok = changed > 0.004
        add(f"overlay_{oc['label']}", ok, f"{changed * 100:.1f}% of overlay box pixels changed by the overlay at {oc['t']:.2f}s")
    ok = all(c["ok"] for c in checks if c["severity"] == "error")
    return {"ok": ok, "checks": checks, "loudness": loud, "probe": {"video": {k: v.get(k) for k in ("codec_name", "width", "height", "pix_fmt", "avg_frame_rate", "color_space", "duration")},
                                                                "audio": {k: a.get(k) for k in ("codec_name", "channels", "sample_rate", "duration")} if a else None,
                                                                "format": {k: data.get("format", {}).get(k) for k in ("format_name", "duration", "size", "bit_rate")}}}
