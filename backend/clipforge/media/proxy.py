"""Preview proxies, thumbnails and timeline thumbnail strips.

Proxies are only used for interactive preview in the browser. Final renders
always read the original source file.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config import get_config
from ..util.proc import CancelToken, ffmpeg_progress_parser, run

PROXY_HEIGHT = 540


def _tonemap_chain(info: dict[str, Any]) -> list[str]:
    from .hdr import tonemap_filters

    return tonemap_filters(info)


def make_proxy(src: Path, dst: Path, info: dict[str, Any], token: CancelToken | None = None, progress=None) -> Path:
    cfg = get_config()
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.stem + ".part.mp4")
    dw, dh = info["display_width"], info["display_height"]
    # Scale so the shorter side is PROXY_HEIGHT (never upscale).
    short = min(dw, dh)
    scale = min(1.0, PROXY_HEIGHT / short) if short else 1.0
    w = int(round(dw * scale / 2) * 2)
    h = int(round(dh * scale / 2) * 2)
    fps = info.get("fps") or 30
    vf = _tonemap_chain(info) + [f"scale={w}:{h}:flags=bicubic", "format=yuv420p"]
    if info.get("variable_frame_rate"):
        vf.insert(0, f"fps={min(60, round(fps))}")
    args = [
        cfg.ffmpeg_bin, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(src), "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
        "-vf", ",".join(vf),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
        "-g", str(max(1, int(round(fps / 2)))), "-keyint_min", "1", "-sc_threshold", "0",
        "-c:a", "aac", "-b:a", "128k", "-ac", "2",
        "-movflags", "+faststart", "-progress", "pipe:2", "-nostats", str(tmp),
    ]
    run(args, token=token, on_stderr_line=ffmpeg_progress_parser(info["duration"], progress) if progress else None)
    tmp.replace(dst)
    return dst


def thumbnail(src: Path, t: float, dst: Path, width: int = 480, info: dict[str, Any] | None = None) -> Path:
    cfg = get_config()
    dst.parent.mkdir(parents=True, exist_ok=True)
    vf = _tonemap_chain(info or {}) + [f"scale={width}:-2:flags=bicubic"]
    run([
        cfg.ffmpeg_bin, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{max(0.0, t):.3f}", "-i", str(src), "-frames:v", "1",
        "-vf", ",".join(vf), "-q:v", "4", str(dst),
    ], timeout=120)
    return dst


def thumbnail_strip(src: Path, dst: Path, duration: float, info: dict[str, Any], token: CancelToken | None = None) -> dict[str, Any]:
    """Sprite sheet of small frames for the timeline thumbnail strip."""
    cfg = get_config()
    dst.parent.mkdir(parents=True, exist_ok=True)
    # Aim for ~200 tiles regardless of length, at least one per 2 s for short sources.
    interval = max(1.0, duration / 200.0)
    interval = min(interval, 30.0)
    count = int(duration / interval) + 1
    cols = 20
    rows = (count + cols - 1) // cols
    tile_h = 90
    dw, dh = info["display_width"], info["display_height"]
    tile_w = int(round(tile_h * dw / dh / 2) * 2)
    vf = _tonemap_chain(info) + [f"fps=1/{interval:.4f}", f"scale={tile_w}:{tile_h}:flags=area", f"tile={cols}x{rows}"]
    # Long sources: decode keyframes only (fast, slightly less precise tiles).
    skip = ["-skip_frame", "nokey"] if duration > 900 else []
    run([
        cfg.ffmpeg_bin, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        *skip, "-i", str(src), "-an", "-sn",
        "-vf", ",".join(vf), "-frames:v", "1", "-q:v", "5", str(dst),
    ], token=token)
    return {"interval": interval, "count": count, "cols": cols, "rows": rows, "tile_w": tile_w, "tile_h": tile_h}
