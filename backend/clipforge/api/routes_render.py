"""Rendering, exports, social packages, jobs and live progress events."""

from __future__ import annotations

import asyncio
import json
import platform
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlmodel import select

from ..db import session_scope
from ..jobs.handlers import queue_render
from ..jobs.queue import get_manager, job_to_dict
from ..models import Edit, Job, MediaSource, Render, SocialPackage
from ..render.encode import PRESETS, estimate_size_bytes, hardware_summary, output_dims, resolve_settings
from ..schemas import ExportSettings, Timeline
from ..settings_service import get_settings
from ..social.generate import as_text
from ..social.service import build_zip, generate_package, metadata_csv, metadata_record, package_rows, update_package

router = APIRouter()


# ----------------------------------------------------------------------------- export

@router.get("/export/presets")
def export_presets():
    return {"presets": PRESETS, "hardware": hardware_summary()}


class EstimateIn(BaseModel):
    edit_id: str
    settings: ExportSettings


@router.post("/export/estimate")
def estimate(body: EstimateIn):
    with session_scope() as s:
        e = s.get(Edit, body.edit_id)
        if e is None:
            raise HTTPException(404, "Edit not found")
        tl = Timeline.model_validate(e.timeline)
        src = s.get(MediaSource, tl.source_id)
    st = resolve_settings(body.settings)
    w, h, rep = output_dims(tl, st, src.probe)
    fps = st.fps or tl.canvas.fps
    return {"width": w, "height": h, "fps": fps, "duration": round(tl.duration, 2),
            "estimated_bytes": estimate_size_bytes(st, w, h, fps, tl.duration), "scale": rep, "resolved": st.model_dump(),
            "blocked": rep["upscale_factor"] > 2.05 and not st.allow_upscale}


class RenderIn(BaseModel):
    edit_ids: list[str] = Field(min_length=1)
    settings: ExportSettings = Field(default_factory=ExportSettings)
    generate_social: bool = True


@router.post("/renders")
def start_renders(body: RenderIn):
    out = []
    app = get_settings()
    for eid in body.edit_ids:
        with session_scope() as s:
            e = s.get(Edit, eid)
            if e is None:
                raise HTTPException(404, f"Edit {eid} not found")
            pid = e.project_id
        st = body.settings
        if not st.output_folder and app["storage"].get("exports_dir"):
            st = st.model_copy(update={"output_folder": None})
        out.append(queue_render(get_manager(), eid, st, pid, platform=st.platform, social=body.generate_social))
    return out


def render_dict(r: Render) -> dict[str, Any]:
    d = r.model_dump(mode="json")
    d["exists"] = bool(r.output_path and Path(r.output_path).exists())
    d["file_url"] = f"/api/renders/{r.id}/file" if d["exists"] else None
    return d


@router.get("/renders")
def list_renders(project_id: str | None = None, status: str | None = None):
    with session_scope() as s:
        q = select(Render)
        if project_id:
            q = q.where(Render.project_id == project_id)
        if status:
            q = q.where(Render.status == status)
        rows = list(s.exec(q.order_by(Render.created_at.desc()).limit(500)))
        return [render_dict(r) for r in rows]


@router.get("/renders/{rid}")
def get_render(rid: str):
    with session_scope() as s:
        r = s.get(Render, rid)
        if r is None:
            raise HTTPException(404, "Render not found")
        return render_dict(r)


@router.get("/renders/{rid}/file")
def render_file(rid: str, download: bool = False):
    with session_scope() as s:
        r = s.get(Render, rid)
    if r is None or not r.output_path or not Path(r.output_path).exists():
        raise HTTPException(404, "Rendered file not found (moved or deleted?)")
    p = Path(r.output_path)
    return FileResponse(p, media_type="video/quicktime" if p.suffix == ".mov" else "video/mp4",
                        filename=p.name if download else None)


@router.post("/renders/{rid}/reveal")
def reveal(rid: str):
    """Open the output folder in Finder/Explorer/file manager (local desktop only)."""
    with session_scope() as s:
        r = s.get(Render, rid)
    if r is None or not r.output_path:
        raise HTTPException(404, "Render not found")
    p = Path(r.output_path)
    folder = p.parent
    sysname = platform.system()
    cmd = ["open", "-R", str(p)] if sysname == "Darwin" else (["explorer", f"/select,{p}"] if sysname == "Windows" else ["xdg-open", str(folder)])
    try:
        subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        opened = True
    except (FileNotFoundError, OSError):
        opened = False
    return {"opened": opened, "folder": str(folder)}


@router.delete("/renders/{rid}")
def delete_render(rid: str, delete_file: bool = False):
    with session_scope() as s:
        r = s.get(Render, rid)
        if r is None:
            raise HTTPException(404, "Render not found")
        if delete_file and r.output_path:
            p = Path(r.output_path)
            for ext in ("", ".srt", ".vtt", ".render.json"):
                q = p if not ext else p.with_suffix(ext)
                q.unlink(missing_ok=True)
        s.delete(r)
        s.commit()
    return {"ok": True}


# ----------------------------------------------------------------------------- social

class SocialIn(BaseModel):
    edit_id: str
    platform: str = "tiktok"
    provider: str | None = None
    max_hashtags: int | None = Field(default=None, ge=0, le=30)
    render_id: str | None = None


@router.post("/social")
def social_generate(body: SocialIn):
    app = get_settings()
    sp = generate_package(body.edit_id, body.platform, body.provider or app["ai"]["provider"], app,
                          body.max_hashtags if body.max_hashtags is not None else app["defaults"].get("max_hashtags"), body.render_id)
    return sp.model_dump(mode="json")


@router.get("/social")
def social_list(edit_id: str | None = None, project_id: str | None = None):
    with session_scope() as s:
        q = select(SocialPackage)
        if edit_id:
            q = q.where(SocialPackage.edit_id == edit_id)
        if project_id:
            q = q.where(SocialPackage.project_id == project_id)
        return [x.model_dump(mode="json") for x in s.exec(q.order_by(SocialPackage.updated_at.desc()))]


class SocialPatch(BaseModel):
    chosen: dict[str, Any] | None = None
    content: dict[str, Any] | None = None


@router.patch("/social/{spid}")
def social_patch(spid: str, body: SocialPatch):
    return update_package(spid, body.chosen, body.content).model_dump(mode="json")


@router.get("/social/{spid}/export.{fmt}")
def social_export(spid: str, fmt: str):
    with session_scope() as s:
        sp = s.get(SocialPackage, spid)
        if sp is None:
            raise HTTPException(404, "Package not found")
        r = s.get(Render, sp.render_id) if sp.render_id else None
        e = s.get(Edit, sp.edit_id)
    name = (e.name if e else "clip")[:60]
    if fmt == "txt":
        return PlainTextResponse(as_text(sp.model_dump(), sp.platform, Path(r.output_path).name if r and r.output_path else ""),
                                 headers={"Content-Disposition": f'attachment; filename="{spid}.txt"'})
    if fmt == "json":
        return JSONResponse({"clip": name, "platform": sp.platform, "chosen": sp.chosen, **(sp.content or {})},
                            headers={"Content-Disposition": f'attachment; filename="{spid}.json"'})
    if fmt == "csv":
        rec = {"clip": name, "platform": sp.platform, "title": (sp.chosen or {}).get("title", ""),
               "description": (sp.chosen or {}).get("description", ""), "hashtags": " ".join((sp.chosen or {}).get("hashtags", [])),
               "hook_text": (sp.content or {}).get("hook_text", ""), "thumbnail_title": (sp.content or {}).get("thumbnail_title", ""),
               "keywords": ", ".join((sp.content or {}).get("keywords", []))}
        return PlainTextResponse(metadata_csv([rec]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{spid}.csv"'})
    raise HTTPException(400, "Format must be txt, json or csv")


@router.get("/projects/{pid}/package.zip")
def project_package(pid: str, render_ids: str | None = None, include_video: bool = True):
    ids = [x for x in (render_ids or "").split(",") if x] or None
    p = build_zip(pid, ids, include_video)
    return FileResponse(p, media_type="application/zip", filename=p.name.split("_package_")[0] + "_package.zip")


@router.get("/projects/{pid}/metadata.{fmt}")
def project_metadata(pid: str, fmt: str):
    recs = [metadata_record(r) for r in package_rows(pid)]
    if fmt == "json":
        return JSONResponse(recs, headers={"Content-Disposition": f'attachment; filename="{pid}_metadata.json"'})
    if fmt == "csv":
        return PlainTextResponse(metadata_csv(recs), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{pid}_metadata.csv"'})
    raise HTTPException(400, "Format must be json or csv")


# ----------------------------------------------------------------------------- jobs

@router.get("/jobs")
def list_jobs(status: str | None = None, project_id: str | None = None, limit: int = 100):
    with session_scope() as s:
        q = select(Job)
        if status:
            q = q.where(Job.status.in_(status.split(",")))
        if project_id:
            q = q.where(Job.project_id == project_id)
        return [job_to_dict(j) for j in s.exec(q.order_by(Job.created_at.desc()).limit(min(limit, 500)))]


@router.get("/jobs/{jid}")
def get_job(jid: str):
    with session_scope() as s:
        j = s.get(Job, jid)
        if j is None:
            raise HTTPException(404, "Job not found")
        return job_to_dict(j)


@router.post("/jobs/{jid}/{action}")
def job_action(jid: str, action: str):
    m = get_manager()
    fn = {"cancel": m.cancel, "pause": m.pause, "resume": m.resume, "retry": m.retry}.get(action)
    if fn is None:
        raise HTTPException(400, "Unknown action")
    j = fn(jid)
    if j is None:
        raise HTTPException(404, "Job not found")
    return get_job(jid)


@router.delete("/jobs")
def clear_history():
    with session_scope() as s:
        n = 0
        for j in s.exec(select(Job).where(Job.status.in_(["completed", "cancelled", "failed"]))):
            s.delete(j)
            n += 1
        s.commit()
    return {"deleted": n}


@router.get("/events")
async def events(request: Request):
    """Server-sent events stream of job updates."""
    mgr = get_manager()
    q = mgr.subscribe()

    async def gen():
        try:
            yield "retry: 2000\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"event: job\ndata: {json.dumps(data)}\n\n"
                except TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            mgr.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
