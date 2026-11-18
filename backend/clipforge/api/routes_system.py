"""Settings, providers, fonts, assets, brand kits, library, dashboard, diagnostics."""

from __future__ import annotations

import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any

import psutil
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlmodel import func, select

from ..ai.providers import AnthropicProvider, OllamaProvider, ProviderError
from ..ai.secrets import masked, set_secret, storage_backend
from ..config import FONTS_DIR, get_config
from ..db import SCHEMA_VERSION, session_scope
from ..edit.fonts import list_fonts
from ..jobs.queue import get_manager
from ..media.ffprobe import ffmpeg_available, probe
from ..models import Asset, BrandKit, Edit, Highlight, Job, MediaSource, Project, Render, SocialPackage, UsageRecord, utcnow
from ..render.encode import hardware_summary
from ..settings_service import get_settings, update_settings
from ..transcribe.service import engine_status
from ..util.files import dir_size, free_disk_bytes, human_bytes, new_id, sanitize_filename

router = APIRouter()
STARTED = time.time()


@router.get("/health")
def health():
    return {"ok": True, "version": "0.1.0", "uptime_s": round(time.time() - STARTED)}


# ----------------------------------------------------------------------------- settings & providers

@router.get("/settings")
def settings_get():
    st = get_settings()
    st["secrets"] = {"anthropic_api_key": masked("anthropic_api_key"), "storage": storage_backend()}
    st["data_dir"] = str(get_config().data_dir)
    return st


@router.patch("/settings")
def settings_patch(patch: dict[str, Any]):
    return update_settings(patch)


class KeyIn(BaseModel):
    api_key: str | None = Field(default=None, max_length=400)


@router.put("/providers/anthropic/key")
def set_anthropic_key(body: KeyIn):
    where = set_secret("anthropic_api_key", (body.api_key or "").strip() or None)
    return {"stored_in": where, "masked": masked("anthropic_api_key")}


@router.get("/providers")
def providers_status():
    st = get_settings()
    ai = st["ai"]
    ollama = OllamaProvider(ai["ollama_url"], ai["ollama_model"]).status()
    anth = AnthropicProvider(ai["anthropic_model"], ai["anthropic_effort"]).status()
    with session_scope() as s:
        usage = s.exec(select(func.coalesce(func.sum(UsageRecord.input_tokens), 0), func.coalesce(func.sum(UsageRecord.output_tokens), 0),
                              func.coalesce(func.sum(UsageRecord.estimated_cost_usd), 0.0))).one()
    return {
        "local": {"available": True, "reason": "Deterministic local analysis and extractive copy — always available offline."},
        "ollama": ollama,
        "anthropic": {**anth, "cloud_consent": ai["cloud_consent"], "masked_key": masked("anthropic_api_key")},
        "usage": {"input_tokens": int(usage[0]), "output_tokens": int(usage[1]), "estimated_cost_usd": round(float(usage[2]), 4)},
        "transcription": engine_status(st["transcription"]["model"]),
    }


@router.post("/providers/anthropic/verify")
def verify_anthropic():
    ai = get_settings()["ai"]
    try:
        return AnthropicProvider(ai["anthropic_model"]).verify_key()
    except ProviderError as e:
        return {"ok": False, "error": str(e)}


# ----------------------------------------------------------------------------- fonts

@router.get("/fonts")
def fonts():
    return list_fonts()


@router.get("/fonts/file/{name}")
def font_file(name: str):
    p = (FONTS_DIR / sanitize_filename(name)).resolve()
    if p.parent != FONTS_DIR.resolve() or not p.exists() or p.suffix != ".ttf":
        raise HTTPException(404, "Font not found")
    return FileResponse(p, media_type="font/ttf", headers={"Cache-Control": "public, max-age=604800"})


# ----------------------------------------------------------------------------- assets

ASSET_EXTS = {"logo": {".png", ".jpg", ".jpeg", ".webp"}, "image": {".png", ".jpg", ".jpeg", ".webp"},
              "music": {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"}, "sfx": {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"},
              "broll": {".mp4", ".mov", ".mkv", ".webm", ".m4v"}}


@router.put("/assets")
async def upload_asset(request: Request, kind: str, filename: str, license_note: str = "", tags: str = ""):
    if kind not in ASSET_EXTS:
        raise HTTPException(400, f"kind must be one of {', '.join(ASSET_EXTS)}")
    ext = Path(filename).suffix.lower()
    if ext not in ASSET_EXTS[kind]:
        raise HTTPException(415, f"Unsupported {kind} file type {ext}")
    d = get_config().assets_dir / kind
    d.mkdir(parents=True, exist_ok=True)
    aid = new_id("as_")
    dest = d / f"{aid}_{sanitize_filename(filename)}"
    with open(dest, "wb") as fh:
        async for chunk in request.stream():
            fh.write(chunk)
    meta: dict[str, Any] = {"tags": [t.strip() for t in tags.split(",") if t.strip()]}
    try:
        if kind in ("logo", "image"):
            import cv2

            img = cv2.imread(str(dest), cv2.IMREAD_UNCHANGED)
            if img is None:
                raise ValueError("Not a readable image")
            meta.update(width=int(img.shape[1]), height=int(img.shape[0]), has_alpha=img.ndim == 3 and img.shape[2] == 4)
        else:
            info = probe(dest, detect_vfr=False) if kind == "broll" else None
            if kind != "broll":
                from ..media.ffprobe import _probe_raw

                raw = _probe_raw(dest)
                meta["duration"] = float(raw.get("format", {}).get("duration") or 0)
            else:
                meta.update(duration=info["duration"], width=info["display_width"], height=info["display_height"])
    except Exception as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(422, f"Could not read this {kind} file: {e}") from e
    with session_scope() as s:
        a = Asset(id=aid, kind=kind, name=Path(filename).stem, path=str(dest), size_bytes=dest.stat().st_size, meta=meta, license_note=license_note)
        s.add(a)
        s.commit()
        s.refresh(a)
        return a.model_dump(mode="json")


@router.get("/assets")
def list_assets(kind: str | None = None):
    with session_scope() as s:
        q = select(Asset)
        if kind:
            q = q.where(Asset.kind == kind)
        return [{**a.model_dump(mode="json"), "url": f"/api/assets/{a.id}/file"} for a in s.exec(q.order_by(Asset.created_at.desc()))]


@router.get("/assets/{aid}/file")
def asset_file(aid: str):
    with session_scope() as s:
        a = s.get(Asset, aid)
    if a is None or not Path(a.path).exists():
        raise HTTPException(404, "Asset not found")
    return FileResponse(a.path)


@router.delete("/assets/{aid}")
def delete_asset(aid: str):
    with session_scope() as s:
        a = s.get(Asset, aid)
        if a is None:
            raise HTTPException(404, "Asset not found")
        Path(a.path).unlink(missing_ok=True)
        s.delete(a)
        s.commit()
    return {"ok": True}


# ----------------------------------------------------------------------------- brand kits

class BrandKitIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    data: dict[str, Any] = Field(default_factory=dict)


@router.get("/brand-kits")
def list_kits():
    with session_scope() as s:
        return [k.model_dump(mode="json") for k in s.exec(select(BrandKit).order_by(BrandKit.name))]


@router.post("/brand-kits")
def create_kit(body: BrandKitIn):
    with session_scope() as s:
        k = BrandKit(id=new_id("bk_"), name=body.name, data=body.data)
        s.add(k)
        s.commit()
        s.refresh(k)
        return k.model_dump(mode="json")


@router.put("/brand-kits/{kid}")
def update_kit(kid: str, body: BrandKitIn):
    with session_scope() as s:
        k = s.get(BrandKit, kid)
        if k is None:
            raise HTTPException(404, "Brand kit not found")
        k.name, k.data, k.updated_at = body.name, body.data, utcnow()
        s.add(k)
        s.commit()
        s.refresh(k)
        return k.model_dump(mode="json")


@router.post("/brand-kits/{kid}/duplicate")
def duplicate_kit(kid: str):
    with session_scope() as s:
        k = s.get(BrandKit, kid)
        if k is None:
            raise HTTPException(404, "Brand kit not found")
        n = BrandKit(id=new_id("bk_"), name=f"{k.name} copy", data=dict(k.data or {}))
        s.add(n)
        s.commit()
        s.refresh(n)
        return n.model_dump(mode="json")


@router.delete("/brand-kits/{kid}")
def delete_kit(kid: str):
    with session_scope() as s:
        k = s.get(BrandKit, kid)
        if k is None:
            raise HTTPException(404, "Brand kit not found")
        s.delete(k)
        s.commit()
    return {"ok": True}


# ----------------------------------------------------------------------------- dashboard & library

@router.get("/dashboard")
def dashboard():
    cfg = get_config()
    with session_scope() as s:
        n_proj = s.exec(select(func.count()).select_from(Project).where(Project.archived == False)).one()  # noqa: E712
        n_src = s.exec(select(func.count()).select_from(MediaSource)).one()
        n_hl = s.exec(select(func.count()).select_from(Highlight)).one()
        n_ed = s.exec(select(func.count()).select_from(Edit)).one()
        renders = list(s.exec(select(Render).where(Render.status == "completed").order_by(Render.finished_at.desc())))
        jobs_done = list(s.exec(select(Job).where(Job.status == "completed", Job.kind.in_(["analyze", "batch"]))))
        active = list(s.exec(select(Job).where(Job.status.in_(["queued", "running", "paused"])).order_by(Job.created_at)))
    analysed_seconds = 0.0
    with session_scope() as s:
        for src in s.exec(select(MediaSource).where(MediaSource.status == "analysed")):
            analysed_seconds += (src.probe or {}).get("duration", 0.0)
    analysis_times = [(j.finished_at - j.started_at).total_seconds() for j in jobs_done if j.finished_at and j.started_at]
    return {
        "projects": n_proj, "sources": n_src, "highlights": n_hl, "edits": n_ed, "renders": len(renders),
        "rendered_seconds": round(sum(r.duration for r in renders), 1), "analysed_seconds": round(analysed_seconds, 1),
        "avg_analysis_s": round(sum(analysis_times) / len(analysis_times), 1) if analysis_times else None,
        "recent_renders": [{"id": r.id, "name": r.name, "duration": r.duration, "width": r.width, "height": r.height,
                            "finished_at": r.finished_at.isoformat() if r.finished_at else None, "project_id": r.project_id,
                            "file_url": f"/api/renders/{r.id}/file"} for r in renders[:8]],
        "active_jobs": [j.model_dump(mode="json") for j in active],
        "storage": {"data_dir": str(cfg.data_dir), "projects_bytes": dir_size(cfg.projects_dir), "cache_bytes": dir_size(cfg.cache_dir),
                    "exports_bytes": dir_size(cfg.exports_dir), "temp_bytes": dir_size(cfg.tmp_dir), "free_bytes": free_disk_bytes(cfg.data_dir)},
    }


@router.get("/library")
def library(q: str = "", kind: str = "all", include_archived: bool = False):
    ql = q.lower().strip()

    def match(*fields: Any) -> bool:
        return not ql or any(ql in str(f or "").lower() for f in fields)

    out: dict[str, list[dict[str, Any]]] = {}
    with session_scope() as s:
        if kind in ("all", "sources"):
            out["sources"] = [{**src.model_dump(mode="json"), "missing": not Path(src.path).exists()}
                              for src in s.exec(select(MediaSource).order_by(MediaSource.created_at.desc())) if match(src.original_name, src.path)]
        if kind in ("all", "projects"):
            out["projects"] = [p.model_dump(mode="json") for p in s.exec(select(Project).order_by(Project.updated_at.desc()))
                               if (include_archived or not p.archived or kind == "projects") and match(p.name)]
        if kind in ("all", "edits"):
            out["edits"] = [{"id": e.id, "name": e.name, "style": e.style, "version": e.version, "project_id": e.project_id,
                             "is_current": e.is_current, "updated_at": e.updated_at.isoformat(), "aspect": (e.timeline or {}).get("canvas", {}).get("aspect")}
                            for e in s.exec(select(Edit).order_by(Edit.updated_at.desc())) if match(e.name, e.style)]
        if kind in ("all", "renders"):
            out["renders"] = [{**r.model_dump(mode="json"), "exists": bool(r.output_path and Path(r.output_path).exists()),
                               "file_url": f"/api/renders/{r.id}/file"}
                              for r in s.exec(select(Render).order_by(Render.created_at.desc())) if match(r.name, r.output_path)]
        if kind in ("all", "highlights"):
            out["highlights"] = [{"id": h.id, "title": h.title, "score": h.score, "project_id": h.project_id, "start": h.start, "end": h.end,
                                  "thumb_url": f"/api/highlights/{h.id}/thumb" if h.thumb_path else None}
                                 for h in s.exec(select(Highlight).order_by(Highlight.created_at.desc()).limit(500)) if match(h.title, h.topic, h.transcript)]
        if kind in ("all", "social"):
            out["social"] = [{"id": sp.id, "edit_id": sp.edit_id, "platform": sp.platform, "title": (sp.chosen or {}).get("title"),
                              "updated_at": sp.updated_at.isoformat()}
                             for sp in s.exec(select(SocialPackage).order_by(SocialPackage.updated_at.desc())) if match((sp.chosen or {}).get("title"), (sp.chosen or {}).get("description"))]
        if kind in ("all", "assets"):
            out["assets"] = [{**a.model_dump(mode="json"), "url": f"/api/assets/{a.id}/file"} for a in s.exec(select(Asset)) if match(a.name, a.kind)]
    return out


# ----------------------------------------------------------------------------- diagnostics & maintenance

def _ver(cmd: list[str]) -> str | None:
    import subprocess

    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return (out.stdout or out.stderr).splitlines()[0][:120]
    except Exception:
        return None


@router.get("/diagnostics")
def diagnostics():
    cfg = get_config()
    st = get_settings()
    deps = []

    def dep(name: str, ok: bool, detail: str, fix: str | None = None, required: bool = True) -> None:
        deps.append({"name": name, "ok": ok, "detail": detail, "fix": fix, "required": required})

    ff = ffmpeg_available()
    dep("FFmpeg", ff, _ver([cfg.ffmpeg_bin, "-version"]) or "not found", None if ff else "Install FFmpeg: brew install ffmpeg (macOS) or your package manager.")
    hw = hardware_summary()
    enc = hw["encoders"]
    dep("libass (captions)", True, "FFmpeg subtitles filter", None)
    dep("H.264 encoder", enc.get("libx264", False) or enc.get("h264_videotoolbox", False), "libx264" if enc.get("libx264") else "videotoolbox")
    dep("HEVC encoder", enc.get("libx265", False) or enc.get("hevc_videotoolbox", False), "libx265/videotoolbox", required=False)
    dep("ProRes encoder", enc.get("prores_ks", False), "prores_ks (Archival Master)", required=False)
    tr = engine_status(st["transcription"]["model"])
    fw = tr["faster-whisper"]
    dep("faster-whisper", fw.get("available", False), fw.get("reason") or f"model {st['transcription']['model']} ready",
        None if fw.get("available") else "pip install faster-whisper; then choose a model in Settings.", required=False)
    dep("pocketsphinx (offline fallback)", tr["pocketsphinx"]["available"], tr["pocketsphinx"].get("reason") or "", required=False)
    try:
        import cv2

        dep("OpenCV", True, cv2.__version__)
    except Exception as e:  # pragma: no cover
        dep("OpenCV", False, str(e))
    try:
        import scenedetect

        dep("PySceneDetect", True, scenedetect.__version__)
    except Exception as e:  # pragma: no cover
        dep("PySceneDetect", False, str(e))
    try:
        import yt_dlp

        dep("yt-dlp (URL import)", True, yt_dlp.version.__version__, required=False)
    except Exception:
        dep("yt-dlp (URL import)", False, "not installed", "pip install yt-dlp", required=False)
    vm = psutil.virtual_memory()
    with session_scope() as s:
        missing = [src.original_name for src in s.exec(select(MediaSource)) if not Path(src.path).exists()]
        failed = s.exec(select(func.count()).select_from(Job).where(Job.status == "failed")).one()
    return {
        "dependencies": deps,
        "hardware": {**hw, "cpu_count": os.cpu_count(), "memory_gb": round(vm.total / 1024**3, 1), "memory_available_gb": round(vm.available / 1024**3, 1)},
        "workers": get_manager().queue_sizes,
        "python": sys.version.split()[0],
        "database": {"path": str(cfg.db_path), "schema_version": SCHEMA_VERSION},
        "data_dir": str(cfg.data_dir), "free_disk": human_bytes(free_disk_bytes(cfg.data_dir)),
        "missing_sources": missing, "failed_jobs": failed,
        "network": {"bind": f"{cfg.host}:{cfg.port}", "telemetry": "none"},
        "log_file": str(cfg.logs_dir / "clipforge.log"),
    }


class CleanupIn(BaseModel):
    temp: bool = True
    proxies: bool = False
    analysis_cache: bool = False


@router.post("/maintenance/cleanup")
def cleanup(body: CleanupIn):
    """Remove temporary files / caches. Original videos and exports are never touched."""
    cfg = get_config()
    freed = 0
    if body.temp:
        running = get_manager().running_ids()
        for p in cfg.tmp_dir.iterdir() if cfg.tmp_dir.exists() else []:
            if any(r in p.name for r in running):
                continue
            freed += dir_size(p) if p.is_dir() else p.stat().st_size
            shutil.rmtree(p, ignore_errors=True) if p.is_dir() else p.unlink(missing_ok=True)
    if body.proxies or body.analysis_cache:
        for d in cfg.cache_dir.iterdir() if cfg.cache_dir.exists() else []:
            for f in d.iterdir():
                is_proxy = f.name in ("proxy.mp4", "sprite.jpg")
                if (body.proxies and is_proxy) or (body.analysis_cache and not is_proxy):
                    freed += dir_size(f) if f.is_dir() else f.stat().st_size
                    shutil.rmtree(f, ignore_errors=True) if f.is_dir() else f.unlink(missing_ok=True)
        if body.proxies:
            with session_scope() as s:
                for src in s.exec(select(MediaSource)):
                    if src.proxy_path and not Path(src.proxy_path).exists():
                        src.proxy_path = None
                        s.add(src)
                s.commit()
    return {"freed_bytes": freed, "freed": human_bytes(freed)}
