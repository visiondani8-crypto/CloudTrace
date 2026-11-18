"""Export presets, output geometry and encoder selection."""

from __future__ import annotations

import functools
import platform
import subprocess
from typing import Any

from ..config import get_config
from ..schemas import ExportSettings, Timeline

RES_SHORT_SIDE = {"720p": 720, "1080p": 1080, "1440p": 1440, "2160p": 2160}

PRESETS: dict[str, dict[str, Any]] = {
    "social_standard": {"label": "Social Standard", "resolution": "1080p", "codec": "h264", "crf": 21, "encoder_speed": "medium", "audio_bitrate_kbps": 160,
                        "description": "Balanced quality and file size for everyday posting."},
    "social_hq": {"label": "Social High Quality", "resolution": "1080p", "codec": "h264", "crf": 17, "encoder_speed": "slow", "audio_bitrate_kbps": 192,
                  "description": "High-quality H.264 that survives platform re-compression well."},
    "4k_hq": {"label": "4K High Quality", "resolution": "2160p", "codec": "hevc", "crf": 18, "encoder_speed": "slow", "audio_bitrate_kbps": 256,
              "description": "4K when the source has the detail for it. HEVC for manageable file sizes."},
    "archival": {"label": "Archival Master", "resolution": "source", "codec": "prores", "crf": 0, "encoder_speed": "medium", "audio_bitrate_kbps": 0,
                 "description": "ProRes 422 HQ + PCM audio intermediate for further editing (large files)."},
    "custom": {"label": "Custom", "description": "Full control over resolution, codec and rate control."},
}


@functools.lru_cache(maxsize=1)
def available_encoders() -> dict[str, bool]:
    cfg = get_config()
    try:
        out = subprocess.run([cfg.ffmpeg_bin, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=20).stdout
    except Exception:
        out = ""
    names = ["libx264", "libx265", "h264_videotoolbox", "hevc_videotoolbox", "prores_ks", "aac", "libfdk_aac"]
    return {n: f" {n} " in out for n in names}


@functools.lru_cache(maxsize=1)
def hardware_summary() -> dict[str, Any]:
    enc = available_encoders()
    mac = platform.system() == "Darwin"
    arm = platform.machine() in ("arm64", "aarch64")
    return {
        "os": platform.system(), "machine": platform.machine(), "apple_silicon": mac and arm,
        "videotoolbox": enc.get("h264_videotoolbox", False),
        "encoders": enc,
        "notes": ["VideoToolbox hardware encoding available." if enc.get("h264_videotoolbox") else
                  "No hardware encoder detected; using CPU (libx264/libx265)."],
    }


def resolve_settings(s: ExportSettings) -> ExportSettings:
    """Fill preset-defined values (unless custom)."""
    if s.preset == "custom":
        return s if s.resolution else s.model_copy(update={"resolution": "1080p"})
    p = PRESETS[s.preset]
    upd = {k: p[k] for k in ("resolution", "codec", "crf", "encoder_speed", "audio_bitrate_kbps") if k in p}
    if s.preset != "archival" and s.resolution:
        upd["resolution"] = s.resolution  # an explicitly chosen resolution wins within a preset
    if s.encoder_speed != "medium":
        upd["encoder_speed"] = s.encoder_speed
    return s.model_copy(update=upd)


def output_dims(tl: Timeline, s: ExportSettings, info: dict[str, Any]) -> tuple[int, int, dict[str, Any]]:
    """Compute output size. Never silently downscale; refuse unrequested upscaling.

    Returns (width, height, report) where report explains the effective source
    detail so the UI can show honest upscale/downscale information.
    """
    cw, ch = tl.canvas.width, tl.canvas.height
    aspect = cw / ch
    sw, sh = info["display_width"], info["display_height"]
    # Effective source pixels inside the base crop (zoom 1) of the main panel.
    from ..edit.reframe import base_crop

    panel = tl.reframe.panels[0] if tl.reframe.panels else None
    pa = aspect
    if panel:
        pa = (panel.rect[2] * cw) / max(1e-6, panel.rect[3] * ch)
    bw, bh = base_crop(sw, sh, pa)
    max_zoom = max((k.zoom for p in tl.reframe.panels for k in p.keyframes), default=1.0)
    eff_h = bh / max(1.0, max_zoom) / (panel.rect[3] if panel else 1.0)
    if s.resolution == "source":
        short = int(min(eff_h * aspect, eff_h)) if aspect < 1 else int(eff_h)
        short = max(240, short - short % 2)
    else:
        short = RES_SHORT_SIDE[s.resolution]
    if aspect >= 1:
        h = short
        w = int(round(h * aspect / 2) * 2)
    else:
        w = short
        h = int(round(w / aspect / 2) * 2)
    out_h_equiv = h
    upscale = out_h_equiv / eff_h if eff_h > 0 else 1.0
    report = {
        "effective_source_height": round(eff_h),
        "upscale_factor": round(upscale, 2),
        "is_upscaled": upscale > 1.05,
        "message": (f"The visible crop contains ~{eff_h:.0f} source lines; output {w}×{h} is a {upscale:.2f}× upscale. "
                    "Upscaling does not add detail.") if upscale > 1.05 else
                   (f"Output {w}×{h} is at or below source detail (~{eff_h:.0f} lines): no upscaling."),
    }
    return w, h, report


def video_codec_args(s: ExportSettings, fps: float) -> tuple[list[str], str]:
    """Return (ffmpeg args, container extension)."""
    enc = available_encoders()
    gop = str(max(1, int(round(fps * 2))))
    if s.codec == "prores":
        return (["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-vendor", "apl0"], "mov")
    hw = s.hardware == "videotoolbox" or (s.hardware == "auto" and enc.get("h264_videotoolbox"))
    if s.codec == "hevc":
        if hw and enc.get("hevc_videotoolbox"):
            rate = ["-b:v", f"{s.bitrate_kbps or 20000}k"] if s.quality_mode == "bitrate" else ["-q:v", str(max(1, min(100, 100 - s.crf * 2)))]
            return (["-c:v", "hevc_videotoolbox", *rate, "-tag:v", "hvc1", "-pix_fmt", "yuv420p"], "mp4")
        preset = {"fast": "fast", "medium": "medium", "slow": "slow"}[s.encoder_speed]
        rate = (["-b:v", f"{s.bitrate_kbps}k", "-maxrate", f"{int(s.bitrate_kbps * 1.5)}k", "-bufsize", f"{s.bitrate_kbps * 2}k"]
                if s.quality_mode == "bitrate" and s.bitrate_kbps else ["-crf", str(s.crf)])
        return (["-c:v", "libx265", "-preset", preset, *rate, "-tag:v", "hvc1", "-pix_fmt", "yuv420p",
                 "-x265-params", f"log-level=error:keyint={gop}"], "mp4")
    if hw and enc.get("h264_videotoolbox"):
        rate = ["-b:v", f"{s.bitrate_kbps or 16000}k"] if s.quality_mode == "bitrate" else ["-q:v", str(max(1, min(100, 100 - s.crf * 2)))]
        return (["-c:v", "h264_videotoolbox", *rate, "-profile:v", "high", "-pix_fmt", "yuv420p"], "mp4")
    preset = {"fast": "veryfast", "medium": "medium", "slow": "slow"}[s.encoder_speed]
    rate = (["-b:v", f"{s.bitrate_kbps}k", "-maxrate", f"{int(s.bitrate_kbps * 1.5)}k", "-bufsize", f"{s.bitrate_kbps * 2}k"]
            if s.quality_mode == "bitrate" and s.bitrate_kbps else ["-crf", str(s.crf)])
    return (["-c:v", "libx264", "-preset", preset, *rate, "-profile:v", "high", "-pix_fmt", "yuv420p", "-g", gop], "mp4")


def audio_codec_args(s: ExportSettings) -> list[str]:
    if s.codec == "prores":
        return ["-c:a", "pcm_s24le"]
    return ["-c:a", "aac", "-b:a", f"{s.audio_bitrate_kbps}k"]


def estimate_size_bytes(s: ExportSettings, w: int, h: int, fps: float, duration: float) -> int:
    """Rough output size estimate for the export screen."""
    px = w * h * fps
    if s.codec == "prores":
        vbps = px * 2.2 * 8 / 8 * 1.0  # ~220 Mbps at 1080p30 for HQ
    elif s.quality_mode == "bitrate" and s.bitrate_kbps:
        vbps = s.bitrate_kbps * 1000
    else:
        bpp = {"h264": 0.11, "hevc": 0.07}.get(s.codec, 0.1) * (2 ** ((18 - s.crf) / 6))
        vbps = px * bpp
    abps = 0 if s.codec == "prores" else s.audio_bitrate_kbps * 1000
    if s.codec == "prores":
        abps = 48000 * 24 * 2
    return int((vbps + abps) / 8 * duration)
