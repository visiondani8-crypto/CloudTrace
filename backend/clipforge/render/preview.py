"""Exact single-frame preview through the real export pipeline (compositor + libass)."""

from __future__ import annotations

import shutil
from pathlib import Path

import cv2

from ..config import FONTS_DIR, get_config
from ..edit.ops import timeline_ops
from ..edit.service import asset_paths_for
from ..models import Edit, MediaSource
from ..schemas import Timeline
from ..util.files import atomic_write_text, new_id
from .ass import build_ass
from .compositor import Compositor


def render_still(edit: Edit, src: MediaSource, t: float, width: int = 540) -> Path:
    tl = Timeline.model_validate(edit.timeline)
    t = max(0.0, min(t, tl.duration - 1.0 / tl.canvas.fps))
    W = width - width % 2
    H = int(round(W * tl.canvas.height / tl.canvas.width / 2) * 2)
    wd = get_config().tmp_dir / f"still_{new_id()}"
    wd.mkdir(parents=True)
    try:
        (wd / "fonts").symlink_to(FONTS_DIR, target_is_directory=True)
    except OSError:
        shutil.copytree(FONTS_DIR, wd / "fonts")
    comp = Compositor(tl, Path(src.path), src.probe, W, H, tl.canvas.fps, asset_paths_for(tl), start_at=t)
    try:
        frame = comp.compose(t)
    finally:
        comp.close()
    raw = wd / "raw.png"
    cv2.imwrite(str(raw), frame)
    out = get_config().tmp_dir / f"still_{edit.id}_{int(t * 1000)}_{new_id()}.png"
    ops = timeline_ops(tl)
    if ops:
        atomic_write_text(wd / "overlay.ass", build_ass(ops, tl.canvas.width, tl.canvas.height))
        _run_in(wd, t, out)
    else:
        shutil.copy(raw, out)
    shutil.rmtree(wd, ignore_errors=True)
    return out


def _run_in(wd: Path, t: float, out: Path) -> None:
    import subprocess

    r = subprocess.run([get_config().ffmpeg_bin, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", "raw.png",
                        "-vf", f"setpts=PTS+{t:.4f}/TB,subtitles=filename=overlay.ass:fontsdir=fonts", "-frames:v", "1", str(out)],
                       cwd=str(wd), capture_output=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError("Frame preview failed: " + r.stderr.decode("utf-8", "replace")[-300:])
