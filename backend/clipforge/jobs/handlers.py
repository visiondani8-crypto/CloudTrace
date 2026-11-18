"""Job handlers: analysis, URL import, edit preparation, rendering, batch."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any


from ..analysis.pipeline import latest_highlights, run_analysis
from ..config import get_config
from ..db import session_scope
from ..edit.service import create_edit
from ..media.ffprobe import probe
from ..models import Edit, Highlight, MediaSource, Render
from ..render.pipeline import render_edit
from ..schemas import AnalysisSettings, BatchSettings, ExportSettings
from ..settings_service import get_settings
from ..social.service import generate_package
from ..util.files import file_fingerprint, new_id
from .queue import JobContext, JobManager

log = logging.getLogger(__name__)


def handle_analyze(ctx: JobContext, p: dict[str, Any]) -> dict[str, Any]:
    st = AnalysisSettings.model_validate(p.get("settings") or {})
    return run_analysis(p["project_id"], p["source_id"], st, ctx, get_settings())


def handle_url_import(ctx: JobContext, p: dict[str, Any]) -> dict[str, Any]:
    """Download an authorised URL with yt-dlp (no DRM circumvention, no cookies/credentials)."""
    import yt_dlp

    project_id = p["project_id"]
    dest = get_config().projects_dir / project_id / "source"
    dest.mkdir(parents=True, exist_ok=True)
    ctx.stage("download")

    def hook(d: dict[str, Any]) -> None:
        ctx.token.check()
        if d.get("status") == "downloading":
            tot = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if tot:
                ctx.progress(d.get("downloaded_bytes", 0) / tot)

    opts = {
        "outtmpl": str(dest / "%(title).80s [%(id)s].%(ext)s"),
        "format": "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
        "merge_output_format": "mp4",
        "noplaylist": True,
        "restrictfilenames": True,
        "progress_hooks": [hook],
        "quiet": True,
        "no_warnings": True,
        "allow_unplayable_formats": False,  # never bypass DRM
        "ffmpeg_location": get_config().ffmpeg_bin if "/" in get_config().ffmpeg_bin else None,
    }
    try:
        with yt_dlp.YoutubeDL({k: v for k, v in opts.items() if v is not None}) as ydl:
            info = ydl.extract_info(p["url"], download=True)
            path = Path(ydl.prepare_filename(info))
            if not path.exists():
                cands = sorted(dest.glob(f"*[{info.get('id')}]*"))
                path = cands[0] if cands else path
    except yt_dlp.utils.DownloadError as e:
        msg = str(e)
        if "DRM" in msg:
            raise ValueError("This video is DRM-protected and cannot be imported.") from e
        raise ValueError(f"Download failed: {msg[:300]}") from e
    ctx.stage("probe")
    meta = probe(path)
    sid = new_id("src_")
    with session_scope() as s:
        s.add(MediaSource(id=sid, project_id=project_id, kind="url", path=str(path), original_name=path.name, origin_url=p["url"],
                          size_bytes=path.stat().st_size, mtime=path.stat().st_mtime, fingerprint=file_fingerprint(path), probe=meta))
        s.commit()
    result = {"source_id": sid, "path": str(path)}
    if p.get("then_analyze"):
        job = ctx.manager.submit("analyze", {"project_id": project_id, "source_id": sid, "settings": p.get("settings") or {}},
                                 title=f"Analyse {path.name}", project_id=project_id)
        result["analyze_job_id"] = job.id
    return result


def handle_prepare_edits(ctx: JobContext, p: dict[str, Any]) -> dict[str, Any]:
    ctx.stage("edits")
    ids = p["highlight_ids"]
    out = []
    for k, hid in enumerate(ids):
        ctx.token.check()
        e = create_edit(hid, style=p.get("style", "dynamic"), aspect=p.get("aspect", "9:16"),
                        caption_preset=p.get("caption_style"), reframe_mode=p.get("reframe_mode"),
                        brand_kit_id=p.get("brand_kit_id"), platform=p.get("platform"))
        out.append(e.id)
        ctx.progress((k + 1) / len(ids))
    return {"edit_ids": out}


def handle_render(ctx: JobContext, p: dict[str, Any]) -> dict[str, Any]:
    st = ExportSettings.model_validate(p.get("settings") or {})
    rid = p["render_id"]
    with session_scope() as s:
        r = s.get(Render, rid)
        r.status = "running"
        r.job_id = ctx.job_id
        s.add(r)
        s.commit()
    try:
        report = render_edit(p["edit_id"], rid, st, ctx)
    except BaseException:
        with session_scope() as s:
            r = s.get(Render, rid)
            if r and r.status in ("running", "queued"):
                r.status = "failed" if not ctx.token.cancelled else "cancelled"
                s.add(r)
                s.commit()
        raise
    if p.get("social", True):
        ctx.stage("social")
        app = get_settings()
        try:
            platform = st.platform or p.get("platform") or app["defaults"]["platform"]
            sp = generate_package(p["edit_id"], platform, p.get("ai_provider") or app["ai"]["provider"], app,
                                  app["defaults"].get("max_hashtags"), render_id=rid)
            report["social_package_id"] = sp.id
        except Exception as e:  # social copy must never fail a finished render
            ctx.warn(f"Social copy generation failed: {e}")
    return {"render_id": rid, "output": report["output"], "validation_ok": report["validation"]["ok"],
            "scale": report["scale"], "social_package_id": report.get("social_package_id")}


def handle_batch(ctx: JobContext, p: dict[str, Any]) -> dict[str, Any]:
    """Analyse → select top N → prepare edits → (optionally) queue renders. Review happens in the UI."""
    bs = BatchSettings.model_validate(p.get("settings") or {})
    project_id, source_id = p["project_id"], p["source_id"]
    res = run_analysis(project_id, source_id, bs.analysis, ctx, get_settings())
    hls = latest_highlights(project_id)
    n = bs.prepare_count or bs.analysis.count or len(hls)
    chosen = [h for h in hls][:n]
    ctx.stage("edits")
    edit_ids = []
    for k, h in enumerate(chosen):
        ctx.token.check()
        e = create_edit(h.id, style=bs.edit_style, aspect=bs.aspect, caption_preset=bs.caption_style,
                        brand_kit_id=bs.brand_kit_id, platform=bs.analysis.platforms[0])
        edit_ids.append(e.id)
        with session_scope() as s:
            row = s.get(Highlight, h.id)
            row.selected = True
            s.add(row)
            s.commit()
        ctx.progress((k + 1) / max(1, len(chosen)))
    ctx.stage("render_queue")
    render_jobs = []
    if bs.auto_render and bs.export:
        for eid in edit_ids:
            job = queue_render(ctx.manager, eid, bs.export.model_copy(update={"output_folder": bs.output_folder or bs.export.output_folder}),
                               project_id, parent_id=ctx.job_id, platform=bs.analysis.platforms[0], social=bs.generate_social)
            render_jobs.append(job["job_id"])
    return {"analysis": res.get("analysis_id"), "highlights": len(hls), "edit_ids": edit_ids, "render_job_ids": render_jobs,
            "note": None if bs.auto_render else "Edits prepared. Review them, then export from the Export Centre."}


def queue_render(manager: JobManager, edit_id: str, settings: ExportSettings, project_id: str, parent_id: str | None = None,
                 platform: str | None = None, social: bool = True, ai_provider: str | None = None) -> dict[str, Any]:
    with session_scope() as s:
        e = s.get(Edit, edit_id)
        if e is None:
            raise ValueError("Edit not found")
        rid = new_id("rn_")
        s.add(Render(id=rid, project_id=project_id, edit_id=edit_id, name=settings.name or e.name, settings=settings.model_dump(), status="queued"))
        s.commit()
        name = e.name
    job = manager.submit("render", {"edit_id": edit_id, "render_id": rid, "settings": settings.model_dump(), "platform": platform,
                                    "social": social, "ai_provider": ai_provider},
                         title=f"Render “{name}”", project_id=project_id, parent_id=parent_id)
    with session_scope() as s:
        r = s.get(Render, rid)
        r.job_id = job.id
        s.add(r)
        s.commit()
    return {"render_id": rid, "job_id": job.id}


def register_all(manager: JobManager) -> None:
    manager.register("analyze", handle_analyze)
    manager.register("url_import", handle_url_import)
    manager.register("prepare_edits", handle_prepare_edits)
    manager.register("render", handle_render)
    manager.register("batch", handle_batch)
