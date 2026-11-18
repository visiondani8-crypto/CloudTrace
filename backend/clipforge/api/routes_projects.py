"""Projects, media sources, analysis, transcripts and highlights."""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field
from sqlmodel import select

from ..analysis.pipeline import latest_analysis, latest_highlights, load_transcript, project_dir, source_cache_dir
from ..config import get_config
from ..db import session_scope
from ..jobs.queue import get_manager
from ..media.ffprobe import probe
from ..models import Edit, Highlight, Job, MediaSource, Project, Render, utcnow
from ..schemas import AnalysisSettings, BatchSettings
from ..settings_service import get_settings
from ..transcribe.subtitles import cues_to_srt, cues_to_vtt, cues_to_words, parse_subtitles
from ..util.files import atomic_write_json, file_fingerprint, free_disk_bytes, human_bytes, new_id, read_json, sanitize_filename

router = APIRouter()

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mts", ".m2ts", ".ts", ".mxf", ".wmv", ".flv", ".3gp"}


def _project(s, pid: str) -> Project:
    p = s.get(Project, pid)
    if p is None:
        raise HTTPException(404, "Project not found")
    return p


def _source(s, sid: str) -> MediaSource:
    src = s.get(MediaSource, sid)
    if src is None:
        raise HTTPException(404, "Source not found")
    return src


def source_dict(src: MediaSource) -> dict[str, Any]:
    d = src.model_dump(mode="json")
    d["missing"] = not Path(src.path).exists()
    d["has_proxy"] = bool(src.proxy_path and Path(src.proxy_path).exists())
    d["referenced"] = src.kind == "reference"
    return d


# ----------------------------------------------------------------------------- projects

class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    archived: bool | None = None


@router.get("/projects")
def list_projects(archived: bool = False, q: str = ""):
    with session_scope() as s:
        rows = list(s.exec(select(Project).where(Project.archived == archived).order_by(Project.updated_at.desc())))
        out = []
        for p in rows:
            if q and q.lower() not in p.name.lower():
                continue
            srcs = list(s.exec(select(MediaSource).where(MediaSource.project_id == p.id)))
            n_h = len(latest_highlights(p.id))
            n_r = len(list(s.exec(select(Render).where(Render.project_id == p.id, Render.status == "completed"))))
            thumb = None
            hl = latest_highlights(p.id)
            if hl and hl[0].thumb_path:
                thumb = f"/api/highlights/{hl[0].id}/thumb"
            out.append({**p.model_dump(mode="json"), "sources": [source_dict(x) for x in srcs], "highlight_count": n_h,
                        "render_count": n_r, "thumb_url": thumb})
        return out


@router.post("/projects")
def create_project(body: ProjectIn):
    with session_scope() as s:
        p = Project(id=new_id("pr_"), name=body.name.strip(), settings=get_settings()["defaults"])
        s.add(p)
        s.commit()
        s.refresh(p)
        project_dir(p.id)
        return p.model_dump(mode="json")


@router.get("/projects/{pid}")
def get_project(pid: str):
    with session_scope() as s:
        p = _project(s, pid)
        srcs = list(s.exec(select(MediaSource).where(MediaSource.project_id == pid).order_by(MediaSource.created_at)))
        jobs = list(s.exec(select(Job).where(Job.project_id == pid).order_by(Job.created_at.desc()).limit(20)))
        return {**p.model_dump(mode="json"), "sources": [source_dict(x) for x in srcs],
                "jobs": [j.model_dump(mode="json") for j in jobs]}


@router.patch("/projects/{pid}")
def patch_project(pid: str, body: ProjectPatch):
    with session_scope() as s:
        p = _project(s, pid)
        if body.name is not None:
            p.name = body.name.strip() or p.name
        if body.archived is not None:
            p.archived = body.archived
        p.updated_at = utcnow()
        s.add(p)
        s.commit()
        s.refresh(p)
        return p.model_dump(mode="json")


@router.delete("/projects/{pid}")
def delete_project(pid: str, delete_files: bool = False):
    """Delete project metadata. Referenced original videos are NEVER deleted.

    With delete_files=true, ClipForge-managed files (copies, proxies, thumbnails,
    analysis) under the project folder are removed; exported clips are kept.
    """
    with session_scope() as s:
        p = _project(s, pid)
        running = s.exec(select(Job).where(Job.project_id == pid, Job.status.in_(["running", "queued"]))).first()
        if running:
            raise HTTPException(409, "This project has active jobs. Cancel them first.")
        for model in (Render, Edit, Highlight, MediaSource):
            for row in s.exec(select(model).where(model.project_id == pid)):
                s.delete(row)
        s.delete(p)
        s.commit()
    if delete_files:
        shutil.rmtree(get_config().projects_dir / pid, ignore_errors=True)
    return {"ok": True}


# ----------------------------------------------------------------------------- import

def _register_source(pid: str, path: Path, kind: str, original_name: str) -> dict[str, Any]:
    info = probe(path)
    with session_scope() as s:
        _project(s, pid)
        src = MediaSource(id=new_id("src_"), project_id=pid, kind=kind, path=str(path), original_name=original_name,
                          size_bytes=path.stat().st_size, mtime=path.stat().st_mtime, fingerprint=file_fingerprint(path), probe=info)
        s.add(src)
        p = s.get(Project, pid)
        p.updated_at = utcnow()
        s.add(p)
        s.commit()
        s.refresh(src)
        return source_dict(src)


@router.put("/projects/{pid}/upload")
async def upload_source(pid: str, request: Request, filename: str):
    """Stream a file into the project (no temp spooling, constant memory)."""
    ext = Path(filename).suffix.lower()
    if ext not in VIDEO_EXTS:
        raise HTTPException(415, f"Unsupported file type {ext or '(none)'}. Supported: {', '.join(sorted(VIDEO_EXTS))}")
    length = int(request.headers.get("content-length") or 0)
    dest_dir = get_config().projects_dir / pid / "source"
    dest_dir.mkdir(parents=True, exist_ok=True)
    if length and free_disk_bytes(dest_dir) < length * 1.05 + 200e6:
        raise HTTPException(507, f"Only {human_bytes(free_disk_bytes(dest_dir))} free; this file needs {human_bytes(length)}.")
    with session_scope() as s:
        _project(s, pid)
    safe = sanitize_filename(filename)
    dest = dest_dir / safe
    k = 2
    while dest.exists():
        dest = dest_dir / f"{Path(safe).stem}_{k}{Path(safe).suffix}"
        k += 1
    tmp = dest.with_name(dest.name + ".uploading")
    written = 0
    try:
        with open(tmp, "wb") as fh:
            async for chunk in request.stream():
                fh.write(chunk)
                written += len(chunk)
                if written > get_config().max_upload_bytes:
                    raise HTTPException(413, "File too large for upload; use ‘Link local file’ instead.")
        os.replace(tmp, dest)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    try:
        return _register_source(pid, dest, "copy", filename)
    except Exception:
        dest.unlink(missing_ok=True)
        raise


class ReferenceIn(BaseModel):
    path: str
    copy_file: bool = False


@router.post("/projects/{pid}/reference")
def reference_source(pid: str, body: ReferenceIn):
    """Link a local file without copying it (recommended for large videos)."""
    p = Path(os.path.expanduser(body.path.strip().strip('"').strip("'"))).resolve()
    if not p.is_file():
        raise HTTPException(404, f"No file at {p}")
    if p.suffix.lower() not in VIDEO_EXTS:
        raise HTTPException(415, f"Unsupported file type {p.suffix}")
    if body.copy_file:
        dest_dir = get_config().projects_dir / pid / "source"
        dest_dir.mkdir(parents=True, exist_ok=True)
        if free_disk_bytes(dest_dir) < p.stat().st_size * 1.05:
            raise HTTPException(507, "Not enough disk space to copy this file. Link it instead.")
        dest = dest_dir / sanitize_filename(p.name)
        shutil.copy2(p, dest)
        return _register_source(pid, dest, "copy", p.name)
    return _register_source(pid, p, "reference", p.name)


class UrlIn(BaseModel):
    url: str
    confirm_rights: bool = False
    then_analyze: bool = False
    settings: AnalysisSettings | None = None


@router.post("/projects/{pid}/url")
def import_url(pid: str, body: UrlIn):
    if not body.confirm_rights:
        raise HTTPException(400, "Confirm that you own this video or have permission to use it.")
    if not body.url.startswith(("http://", "https://")):
        raise HTTPException(400, "Enter a full http(s) URL.")
    with session_scope() as s:
        _project(s, pid)
    job = get_manager().submit("url_import", {"project_id": pid, "url": body.url, "then_analyze": body.then_analyze,
                                              "settings": body.settings.model_dump() if body.settings else None},
                               title=f"Import {body.url[:60]}", project_id=pid)
    return job.model_dump(mode="json")


class RelinkIn(BaseModel):
    path: str


@router.post("/sources/{sid}/relink")
def relink_source(sid: str, body: RelinkIn):
    p = Path(os.path.expanduser(body.path.strip())).resolve()
    if not p.is_file():
        raise HTTPException(404, f"No file at {p}")
    fp = file_fingerprint(p)
    with session_scope() as s:
        src = _source(s, sid)
        if src.fingerprint and fp != src.fingerprint:
            raise HTTPException(409, "This file's content differs from the original source. Relinking a different video would break existing edits.")
        src.path = str(p)
        src.status = "imported" if src.status == "missing" else src.status
        s.add(src)
        s.commit()
        s.refresh(src)
        return source_dict(src)


@router.get("/sources/{sid}")
def get_source(sid: str):
    with session_scope() as s:
        return source_dict(_source(s, sid))


@router.get("/sources/{sid}/proxy")
def source_proxy(sid: str):
    with session_scope() as s:
        src = _source(s, sid)
    if src.proxy_path and Path(src.proxy_path).exists():
        return FileResponse(src.proxy_path, media_type="video/mp4")
    if (src.probe or {}).get("browser_playable") and Path(src.path).exists():
        return FileResponse(src.path, media_type="video/mp4")
    raise HTTPException(404, "Preview proxy not ready yet — it is built during analysis.")


@router.get("/sources/{sid}/waveform")
def source_waveform(sid: str):
    with session_scope() as s:
        src = _source(s, sid)
    d = read_json(source_cache_dir(src.fingerprint) / "waveform.json")
    if not d:
        raise HTTPException(404, "Waveform not computed yet")
    return d


@router.get("/sources/{sid}/sprite")
def source_sprite(sid: str):
    with session_scope() as s:
        src = _source(s, sid)
    p = source_cache_dir(src.fingerprint) / "sprite.jpg"
    if not p.exists():
        raise HTTPException(404, "Thumbnail strip not ready")
    return FileResponse(p, media_type="image/jpeg")


@router.get("/sources/{sid}/sprite.json")
def source_sprite_meta(sid: str):
    with session_scope() as s:
        src = _source(s, sid)
    d = read_json(source_cache_dir(src.fingerprint) / "sprite.json")
    if not d:
        raise HTTPException(404, "Thumbnail strip not ready")
    return d


# ----------------------------------------------------------------------------- analysis

class AnalyzeIn(BaseModel):
    source_id: str
    settings: AnalysisSettings = Field(default_factory=AnalysisSettings)


@router.post("/projects/{pid}/analyze")
def analyze(pid: str, body: AnalyzeIn):
    with session_scope() as s:
        _project(s, pid)
        src = _source(s, body.source_id)
        if not Path(src.path).exists():
            raise HTTPException(404, "Source file is missing. Relink it first.")
        p = s.get(Project, pid)
        p.settings = body.settings.model_dump()
        s.add(p)
        s.commit()
    if body.settings.ai_provider == "anthropic" and not get_settings()["ai"]["cloud_consent"]:
        raise HTTPException(400, "Cloud AI is selected but cloud processing is not enabled in Settings → Privacy.")
    job = get_manager().submit("analyze", {"project_id": pid, "source_id": body.source_id, "settings": body.settings.model_dump()},
                               title=f"Analyse {src.original_name}", project_id=pid)
    return job.model_dump(mode="json")


class BatchIn(BaseModel):
    source_id: str
    settings: BatchSettings = Field(default_factory=BatchSettings)


@router.post("/projects/{pid}/batch")
def batch(pid: str, body: BatchIn):
    with session_scope() as s:
        _project(s, pid)
        src = _source(s, body.source_id)
    job = get_manager().submit("batch", {"project_id": pid, "source_id": body.source_id, "settings": body.settings.model_dump()},
                               title=f"Batch: {src.original_name}", project_id=pid)
    return job.model_dump(mode="json")


@router.get("/projects/{pid}/analysis")
def get_analysis(pid: str):
    a = latest_analysis(pid)
    if not a:
        raise HTTPException(404, "No analysis yet")
    return a


# ----------------------------------------------------------------------------- transcript

@router.get("/projects/{pid}/sources/{sid}/transcript")
def get_transcript(pid: str, sid: str):
    t = load_transcript(pid, sid)
    if not t:
        raise HTTPException(404, "No transcript yet")
    return t


class WordFix(BaseModel):
    i: int
    w: str


class TranscriptPatch(BaseModel):
    words: list[WordFix]


@router.patch("/projects/{pid}/sources/{sid}/transcript")
def patch_transcript(pid: str, sid: str, body: TranscriptPatch):
    """Correct transcript words (keeps timings). Future edits pick up the corrections."""
    t = load_transcript(pid, sid)
    if not t:
        raise HTTPException(404, "No transcript yet")
    fixes = {f.i: f.w for f in body.words}
    n = 0
    for seg in t["segments"]:
        for w in seg["words"]:
            if w["i"] in fixes:
                w["w"] = fixes[w["i"]]
                n += 1
        seg["text"] = " ".join(w["w"] for w in seg["words"])
    t["edited"] = True
    atomic_write_json(project_dir(pid) / "transcripts" / f"{sid}.json", t)
    return {"updated": n}


@router.get("/projects/{pid}/sources/{sid}/transcript.{fmt}")
def export_transcript(pid: str, sid: str, fmt: str):
    t = load_transcript(pid, sid)
    if not t:
        raise HTTPException(404, "No transcript yet")
    cues = [{"start": seg["start"], "end": seg["end"], "text": seg["text"]} for seg in t["segments"]]
    if fmt == "srt":
        return PlainTextResponse(cues_to_srt(cues), headers={"Content-Disposition": f'attachment; filename="{sid}.srt"'})
    if fmt == "vtt":
        return PlainTextResponse(cues_to_vtt(cues), media_type="text/vtt", headers={"Content-Disposition": f'attachment; filename="{sid}.vtt"'})
    if fmt == "txt":
        return PlainTextResponse("\n".join(c["text"] for c in cues))
    raise HTTPException(400, "Format must be srt, vtt or txt")


@router.post("/projects/{pid}/sources/{sid}/transcript/import")
async def import_transcript(pid: str, sid: str, request: Request):
    """Import SRT/VTT subtitles as the transcript (word timing is interpolated)."""
    text = (await request.body()).decode("utf-8", "replace")
    cues = parse_subtitles(text)
    words = cues_to_words(cues)
    for k, w in enumerate(words):
        w["i"] = k
    segs = []
    wi = 0
    for c in cues:
        n = len(c["text"].split())
        ws = words[wi : wi + n]
        wi += n
        segs.append({"id": len(segs), "start": c["start"], "end": c["end"], "text": c["text"], "words": ws})
    t = {"engine": "imported", "model": "subtitles", "language": "", "has_punctuation": True, "segments": segs,
         "word_count": len(words), "mean_confidence": 1.0, "warnings": ["Imported subtitles: word timings are interpolated."]}
    atomic_write_json(project_dir(pid) / "transcripts" / f"{sid}.json", t)
    return {"cues": len(cues), "words": len(words)}


# ----------------------------------------------------------------------------- highlights

def highlight_dict(h: Highlight) -> dict[str, Any]:
    d = h.model_dump(mode="json")
    d["duration"] = round(h.end - h.start, 2)
    d["thumb_url"] = f"/api/highlights/{h.id}/thumb" if h.thumb_path else None
    return d


@router.get("/projects/{pid}/highlights")
def list_highlights(pid: str):
    rows = latest_highlights(pid)
    with session_scope() as s:
        out = []
        for h in rows:
            edits = list(s.exec(select(Edit).where(Edit.highlight_id == h.id, Edit.is_current == True)))  # noqa: E712
            out.append({**highlight_dict(h), "edits": [{"id": e.id, "style": e.style, "version": e.version, "aspect": (e.timeline or {}).get("canvas", {}).get("aspect")} for e in edits]})
        return out


class HighlightPatch(BaseModel):
    selected: bool | None = None
    title: str | None = Field(default=None, max_length=200)
    start: float | None = None
    end: float | None = None


@router.patch("/highlights/{hid}")
def patch_highlight(hid: str, body: HighlightPatch):
    with session_scope() as s:
        h = s.get(Highlight, hid)
        if h is None:
            raise HTTPException(404, "Highlight not found")
        if body.selected is not None:
            h.selected = body.selected
        if body.title is not None:
            h.title = body.title
        if body.start is not None or body.end is not None:
            src = s.get(MediaSource, h.source_id)
            dur = (src.probe or {}).get("duration", 1e9)
            st = body.start if body.start is not None else h.start
            en = body.end if body.end is not None else h.end
            if not (0 <= st < en <= dur + 0.01) or en - st < 1.0:
                raise HTTPException(400, "Invalid range")
            h.start, h.end = round(st, 3), round(en, 3)
        s.add(h)
        s.commit()
        s.refresh(h)
        return highlight_dict(h)


@router.get("/highlights/{hid}/thumb")
def highlight_thumb(hid: str):
    with session_scope() as s:
        h = s.get(Highlight, hid)
    if h is None or not h.thumb_path or not Path(h.thumb_path).exists():
        raise HTTPException(404, "No thumbnail")
    return FileResponse(h.thumb_path, media_type="image/jpeg")
