"""Render orchestration: timeline → validated video file + sidecars."""

from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path
from typing import Any

from ..config import FONTS_DIR, get_config
from ..db import session_scope
from ..edit.ops import caption_cues, timeline_ops
from ..edit.service import asset_paths_for, source_for_edit
from ..media.ffprobe import probe
from ..models import Edit, Project, Render, utcnow
from ..schemas import ExportSettings
from ..transcribe.subtitles import cues_to_srt, cues_to_vtt
from ..util.files import atomic_write_json, atomic_write_text, free_disk_bytes, human_bytes, sanitize_filename
from ..util.proc import CancelToken
from .ass import build_ass
from .audio_mix import render_audio
from .compositor import Compositor, render_video
from .encode import audio_codec_args, estimate_size_bytes, output_dims, resolve_settings, video_codec_args
from .validate import validate_output

log = logging.getLogger(__name__)


def _prepare_workdir(render_id: str) -> Path:
    wd = get_config().tmp_dir / f"render_{render_id}"
    wd.mkdir(parents=True, exist_ok=True)
    fonts = wd / "fonts"
    if not fonts.exists():
        try:
            os.symlink(FONTS_DIR, fonts, target_is_directory=True)
        except OSError:
            shutil.copytree(FONTS_DIR, fonts)
    return wd


def _output_path(folder: Path, base: str, ext: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / f"{base}.{ext}"
    k = 2
    while p.exists():
        p = folder / f"{base}_{k}.{ext}"
        k += 1
    return p


def _check_specs(ops: list[dict[str, Any]], scale: float) -> list[dict[str, Any]]:
    """Pick moments to verify overlays survived into the encoded file.

    One check for captions, one per distinct text layer (up to 3) and one for vector graphics.
    """
    specs = []

    def spec(label: str, op: dict[str, Any]) -> None:
        t = op["t0"] + min(0.6, (op["t1"] - op["t0"]) / 2)
        if op["k"] == "text":
            w = max(op["size"], len(op["text"]) * op["em"] * 0.55)
            bbox = [op["x"] - w / 2, op["y"] - op["size"] / 2, op["x"] + w / 2, op["y"] + op["size"] / 2]
        else:
            bbox = [op["x"], op["y"], op["x"] + op["w"], op["y"] + op["h"]]
        specs.append({"label": label, "t": t, "bbox": [v * scale for v in bbox]})

    cap = next((o for o in ops if o["k"] == "text" and o["l"] == 2 and o["t1"] - o["t0"] > 0.25), None)
    if cap:
        spec("captions", cap)
    seen: set[tuple[int, int]] = set()
    for o in ops:
        if o["k"] == "text" and o["l"] >= 4 and o["t1"] - o["t0"] > 0.25:
            key = (int(o["x"]), int(o["y"]))
            if key in seen:
                continue
            seen.add(key)
            spec("text" if len(seen) == 1 else f"text_{len(seen)}", o)
            if len(seen) >= 3:
                break
    gfx = next((o for o in ops if o["k"] in ("rect", "ellipse", "arrow") and o["l"] == 3 and not o.get("grow") and o["t1"] - o["t0"] > 0.25), None)
    if gfx:
        spec("graphics", gfx)
    return specs


def render_edit(edit_id: str, render_id: str, settings: ExportSettings, ctx) -> dict[str, Any]:
    token: CancelToken = ctx.token
    with session_scope() as s:
        edit = s.get(Edit, edit_id)
        if edit is None:
            raise ValueError("Edit not found")
        proj = s.get(Project, edit.project_id)
    src, tl = source_for_edit(edit)
    src_path = Path(src.path)
    if not src_path.exists():
        raise FileNotFoundError(f"Source video is missing: {src.path}. Relink it from the Library before rendering.")
    info = src.probe or probe(src_path)
    s = resolve_settings(settings)
    if s.fps:
        tl.canvas.fps = float(s.fps)
    fps = tl.canvas.fps
    if tl.duration <= 0.1:
        raise ValueError("The timeline is empty — add at least one clip before rendering.")
    out_w, out_h, scale_report = output_dims(tl, s, info)
    if scale_report["upscale_factor"] > 2.05 and not s.allow_upscale:
        raise ValueError(
            f"Requested {s.resolution} would upscale the visible crop {scale_report['upscale_factor']}× "
            f"(only ~{scale_report['effective_source_height']} source lines). Choose a lower resolution or enable "
            "“Allow upscaling” — upscaling never adds real detail."
        )
    vargs, ext = video_codec_args(s, fps)
    aargs = audio_codec_args(s)
    duration = tl.duration
    est = estimate_size_bytes(s, out_w, out_h, fps, duration)
    folder = Path(s.output_folder or (get_config().exports_dir / sanitize_filename(proj.name if proj else "ClipForge")))
    need = est * 1.3 + duration * 48000 * 2 * 4 * 2 + 50e6
    free = free_disk_bytes(folder)
    if free < need:
        raise OSError(28, f"Only {human_bytes(free)} free; this render needs about {human_bytes(need)}.")
    base = sanitize_filename(s.name or edit.name or "clip", max_len=80).replace(" ", "_")
    base = f"{base}_{tl.canvas.aspect.replace(':', 'x')}_{out_h if out_w < out_h else out_w}p"
    out_path = _output_path(folder, base, ext)
    wd = _prepare_workdir(render_id)
    try:
        ops = timeline_ops(tl)
        if not s.burn_captions:
            ops = [o for o in ops if o["l"] not in (0, 1, 2)]
        ass_name = None
        if ops:
            atomic_write_text(wd / "overlay.ass", build_ass(ops, tl.canvas.width, tl.canvas.height))
            ass_name = "overlay.ass"
        assets = asset_paths_for(tl)
        ctx.stage("audio_mix")
        wav = wd / "mix.wav"
        audio_report = render_audio(tl, src_path, info, assets, wav, token, ctx.progress)
        ctx.stage("compose")
        comp = Compositor(tl, src_path, info, out_w, out_h, fps, assets, token)
        specs = _check_specs(ops, out_w / tl.canvas.width)
        vrep = render_video(comp, wd, ass_name, wav, out_path, vargs, aargs, [c["t"] for c in specs], token, ctx.progress)
        ctx.stage("validate")
        checks = []
        for spec in specs:
            fr = int(round(spec["t"] * fps))
            saved = next((c for c in vrep["checks"] if c["frame"] == fr), None)
            if saved:
                checks.append({**spec, "path": saved["path"], "t": saved["t"]})
        validation = validate_output(out_path, expect_w=out_w, expect_h=out_h, expect_dur=duration, fps=fps,
                                     expect_codec=s.codec, expect_audio=True, overlay_checks=checks, workdir=wd)
        sidecars = {}
        if s.export_srt and tl.captions.enabled:
            cues = caption_cues(tl)
            if cues:
                srt = out_path.with_suffix(".srt")
                atomic_write_text(srt, cues_to_srt(cues))
                vtt = out_path.with_suffix(".vtt")
                atomic_write_text(vtt, cues_to_vtt(cues))
                sidecars = {"srt": str(srt), "vtt": str(vtt)}
        report = {
            "output": str(out_path), "settings": s.model_dump(), "width": out_w, "height": out_h, "fps": fps, "duration": duration,
            "scale": scale_report, "audio": audio_report, "video": {k: v for k, v in vrep.items() if k != "checks"},
            "validation": validation, "sidecars": sidecars, "estimated_size": est,
            "source_quality": {"width": info["display_width"], "height": info["display_height"], "codec": info["video_codec"],
                               "hdr": info.get("hdr"), "hdr_tonemapped": bool(info.get("hdr"))},
        }
        atomic_write_json(out_path.with_suffix(".render.json"), report)
        with session_scope() as s2:
            r = s2.get(Render, render_id)
            r.output_path = str(out_path)
            r.status = "completed" if validation["ok"] else "failed_validation"
            r.validation = validation
            r.file_size = out_path.stat().st_size
            r.duration = duration
            r.width, r.height = out_w, out_h
            r.finished_at = utcnow()
            r.settings = {**s.model_dump(), "report": {k: report[k] for k in ("scale", "audio", "video", "sidecars")}}
            s2.add(r)
            s2.commit()
        if not validation["ok"]:
            failed = [c for c in validation["checks"] if not c["ok"] and c["severity"] == "error"]
            raise ValueError("Render finished but failed validation: " + "; ".join(f"{c['name']}: {c['detail']}" for c in failed))
        return report
    finally:
        if not os.environ.get("CLIPFORGE_KEEP_RENDER_TEMP"):
            shutil.rmtree(wd, ignore_errors=True)
