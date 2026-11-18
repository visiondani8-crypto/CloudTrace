"""Media inspection with ffprobe.

Produces a normalised ``MediaInfo`` dict with everything the UI shows on the
video detail screen and everything the pipeline needs (display dimensions
after rotation, VFR/HDR flags, audio presence…).
"""

from __future__ import annotations

import json
import shutil
import statistics
from fractions import Fraction
from pathlib import Path
from typing import Any

from ..config import get_config
from ..util.proc import ProcessError, run

HDR_TRANSFERS = {"smpte2084", "arib-std-b67", "smpte428"}
BROWSER_VIDEO_CODECS = {"h264", "vp8", "vp9", "av1"}


class ProbeError(Exception):
    def __init__(self, message: str, hint: str | None = None):
        super().__init__(message)
        self.hint = hint


def ffmpeg_available() -> bool:
    cfg = get_config()
    return shutil.which(cfg.ffmpeg_bin) is not None and shutil.which(cfg.ffprobe_bin) is not None


def _fraction(v: str | None) -> float:
    if not v or v in ("0/0", "N/A"):
        return 0.0
    try:
        return float(Fraction(v))
    except (ValueError, ZeroDivisionError):
        return 0.0


def _rotation(stream: dict[str, Any]) -> int:
    for sd in stream.get("side_data_list") or []:
        if "rotation" in sd:
            try:
                return int(round(float(sd["rotation"]))) % 360
            except (TypeError, ValueError):
                pass
    tag = (stream.get("tags") or {}).get("rotate")
    if tag:
        try:
            return int(tag) % 360
        except ValueError:
            pass
    return 0


def _probe_raw(path: Path, extra: list[str] | None = None) -> dict[str, Any]:
    cfg = get_config()
    args = [
        cfg.ffprobe_bin,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        *(extra or []),
        str(path),
    ]
    try:
        _, out, _ = run(args, timeout=120)
    except FileNotFoundError as e:
        raise ProbeError("FFmpeg is not installed.", "Install FFmpeg (macOS: `brew install ffmpeg`).") from e
    except ProcessError as e:
        raise ProbeError(
            "This file could not be read as video. It may be corrupted or use an unsupported codec.",
            e.stderr_tail[-400:] or None,
        ) from e
    return json.loads(out or b"{}")


def _detect_vfr(path: Path, stream_index: int, avg_fps: float) -> bool:
    """Sample ~10 s of packet timestamps; a wide spread of frame durations means VFR."""
    cfg = get_config()
    try:
        _, out, _ = run(
            [
                cfg.ffprobe_bin,
                "-v",
                "error",
                "-select_streams",
                str(stream_index),
                "-read_intervals",
                "%+10",
                "-show_entries",
                "packet=pts_time,duration_time",
                "-print_format",
                "json",
                str(path),
            ],
            timeout=60,
        )
        pkts = json.loads(out or b"{}").get("packets", [])
        pts = sorted(float(p["pts_time"]) for p in pkts if p.get("pts_time") not in (None, "N/A"))
        if len(pts) < 20 or avg_fps <= 0:
            return False
        deltas = [b - a for a, b in zip(pts, pts[1:]) if b > a]
        if len(deltas) < 10:
            return False
        med = statistics.median(deltas)
        outliers = sum(1 for d in deltas if abs(d - med) > med * 0.25)
        return outliers / len(deltas) > 0.05
    except Exception:
        return False


def probe(path: Path, detect_vfr: bool = True) -> dict[str, Any]:
    path = Path(path)
    if not path.exists():
        raise ProbeError(f"File not found: {path.name}", "The file may have been moved or deleted. Use Relink.")
    data = _probe_raw(path)
    fmt = data.get("format") or {}
    streams = data.get("streams") or []
    v = next((s for s in streams if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if v is None:
        if a is not None:
            raise ProbeError("This file contains audio only. ClipForge needs a video stream.")
        raise ProbeError("No video stream was found in this file.")

    duration = float(fmt.get("duration") or v.get("duration") or 0.0)
    if duration <= 0:
        raise ProbeError("Could not determine the video duration; the file may be truncated or corrupted.")
    width = int(v.get("width") or 0)
    height = int(v.get("height") or 0)
    rotation = _rotation(v)
    disp_w, disp_h = (height, width) if rotation in (90, 270) else (width, height)
    sar = _fraction(v.get("sample_aspect_ratio")) or 1.0
    if sar and abs(sar - 1.0) > 1e-3:
        # Non-square pixels: display width differs from coded width.
        disp_w = int(round(disp_w * sar)) if rotation in (0, 180) else disp_w
    r_fps = _fraction(v.get("r_frame_rate"))
    avg_fps = _fraction(v.get("avg_frame_rate")) or r_fps
    fps = avg_fps or r_fps or 30.0
    vfr = False
    if r_fps and avg_fps and abs(r_fps - avg_fps) / max(r_fps, 1e-6) > 0.01:
        vfr = True
    elif detect_vfr:
        vfr = _detect_vfr(path, int(v.get("index", 0)), fps)
    transfer = v.get("color_transfer") or ""
    primaries = v.get("color_primaries") or ""
    side = [sd.get("side_data_type", "") for sd in v.get("side_data_list") or []]
    hdr = transfer in HDR_TRANSFERS or any("Mastering display" in s or "Content light" in s for s in side)
    hdr_format = None
    if hdr:
        hdr_format = "HLG" if transfer == "arib-std-b67" else ("Dolby Vision" if any("DOVI" in s for s in side) else "HDR10/PQ")
    bit_rate = int(fmt.get("bit_rate") or 0)
    pix_fmt = v.get("pix_fmt") or ""
    bit_depth = int(v.get("bits_per_raw_sample") or (10 if "10" in pix_fmt else 12 if "12" in pix_fmt else 8))
    dar = v.get("display_aspect_ratio") or (f"{disp_w}:{disp_h}" if disp_h else "")
    container = (fmt.get("format_name") or "").split(",")[0]
    vcodec = v.get("codec_name") or "unknown"
    browser_ok = vcodec in BROWSER_VIDEO_CODECS and pix_fmt in ("yuv420p", "yuvj420p") and not hdr and rotation == 0
    info: dict[str, Any] = {
        "duration": duration,
        "size_bytes": int(fmt.get("size") or path.stat().st_size),
        "container": container,
        "bit_rate": bit_rate,
        "width": width,
        "height": height,
        "display_width": disp_w,
        "display_height": disp_h,
        "rotation": rotation,
        "display_aspect_ratio": dar,
        "sample_aspect_ratio": v.get("sample_aspect_ratio") or "1:1",
        "fps": round(fps, 3),
        "r_frame_rate": v.get("r_frame_rate"),
        "avg_frame_rate": v.get("avg_frame_rate"),
        "variable_frame_rate": vfr,
        "video_codec": vcodec,
        "video_profile": v.get("profile"),
        "video_bit_rate": int(v.get("bit_rate") or 0),
        "pix_fmt": pix_fmt,
        "bit_depth": bit_depth,
        "color_space": v.get("color_space"),
        "color_transfer": transfer or None,
        "color_primaries": primaries or None,
        "color_range": v.get("color_range"),
        "hdr": hdr,
        "hdr_format": hdr_format,
        "has_audio": a is not None,
        "audio_codec": a.get("codec_name") if a else None,
        "audio_channels": int(a.get("channels") or 0) if a else 0,
        "audio_channel_layout": a.get("channel_layout") if a else None,
        "audio_sample_rate": int(a.get("sample_rate") or 0) if a else 0,
        "audio_bit_rate": int(a.get("bit_rate") or 0) if a else 0,
        "audio_stream_count": sum(1 for s in streams if s.get("codec_type") == "audio"),
        "subtitle_stream_count": sum(1 for s in streams if s.get("codec_type") == "subtitle"),
        "browser_playable": browser_ok and container in ("mov", "mp4", "webm", "matroska"),
        "warnings": [],
    }
    warnings: list[str] = info["warnings"]
    if not info["has_audio"]:
        warnings.append("No audio track: transcription and audio-based highlight signals are unavailable.")
    if vfr:
        warnings.append("Variable frame rate detected: renders are conformed to a constant frame rate to keep audio in sync.")
    if hdr:
        warnings.append(f"HDR source ({hdr_format}): SDR exports apply an explicit tone-mapping step.")
    if rotation:
        warnings.append(f"Rotation metadata ({rotation}°) will be applied so the picture is upright.")
    if width * height >= 3840 * 2160 and fps > 50:
        warnings.append("High-resolution, high-frame-rate source: analysis uses low-resolution samples; renders may be slow.")
    return info


def probe_output(path: Path) -> dict[str, Any]:
    """Lightweight probe for validation of rendered output."""
    data = _probe_raw(path)
    return data
