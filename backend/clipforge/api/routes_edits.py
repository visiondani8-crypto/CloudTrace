"""Edits: timelines, versions, regeneration, hooks, captions and previews."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field
from sqlmodel import select

from ..db import session_scope
from ..edit.ops import CAPTION_PRESETS, caption_cues, preset_style, timeline_ops
from ..edit.recipes import apply_brand_kit, apply_hook, broll_suggestions, hook_suggestions
from ..edit.reframe import auto_reframe
from ..edit.service import create_edit, load_visual, new_version_from, save_timeline, sentences_for
from ..analysis.pipeline import load_transcript
from ..jobs.queue import get_manager
from ..models import Asset, BrandKit, Edit, Highlight, MediaSource
from ..render.preview import render_still
from ..schemas import ManualCue, Timeline
from ..transcribe.subtitles import cues_to_srt, cues_to_vtt, parse_subtitles
from ..util.files import new_id

router = APIRouter()


def _edit(s, eid: str) -> Edit:
    e = s.get(Edit, eid)
    if e is None:
        raise HTTPException(404, "Edit not found")
    return e


def edit_dict(e: Edit, with_timeline: bool = True) -> dict[str, Any]:
    d = e.model_dump(mode="json")
    if not with_timeline:
        d.pop("timeline", None)
        tl = e.timeline or {}
        d["aspect"] = tl.get("canvas", {}).get("aspect")
        d["duration"] = round(sum((c["src_out"] - c["src_in"]) / c.get("speed", 1) for c in tl.get("clips", [])), 2)
    return d


class EditIn(BaseModel):
    highlight_id: str
    style: str = "dynamic"
    aspect: str = "9:16"
    caption_style: str | None = None
    reframe_mode: str | None = None
    brand_kit_id: str | None = None
    platform: str | None = None


@router.post("/edits")
def new_edit(body: EditIn):
    e = create_edit(body.highlight_id, style=body.style, aspect=body.aspect, caption_preset=body.caption_style,
                    reframe_mode=body.reframe_mode, brand_kit_id=body.brand_kit_id, platform=body.platform)
    return edit_dict(e)


class PrepareIn(BaseModel):
    highlight_ids: list[str] = Field(min_length=1)
    style: str = "dynamic"
    aspect: str = "9:16"
    caption_style: str | None = None
    reframe_mode: str | None = None
    brand_kit_id: str | None = None
    platform: str | None = None


@router.post("/projects/{pid}/prepare-edits")
def prepare_edits(pid: str, body: PrepareIn):
    job = get_manager().submit("prepare_edits", {**body.model_dump()}, title=f"Prepare {len(body.highlight_ids)} edit(s)", project_id=pid)
    return job.model_dump(mode="json")


@router.get("/projects/{pid}/edits")
def list_edits(pid: str, all_versions: bool = False):
    with session_scope() as s:
        q = select(Edit).where(Edit.project_id == pid)
        if not all_versions:
            q = q.where(Edit.is_current == True)  # noqa: E712
        return [edit_dict(e, with_timeline=False) for e in s.exec(q.order_by(Edit.created_at))]


@router.get("/edits/{eid}")
def get_edit(eid: str):
    with session_scope() as s:
        e = _edit(s, eid)
        d = edit_dict(e)
        h = s.get(Highlight, e.highlight_id) if e.highlight_id else None
        d["highlight"] = h.model_dump(mode="json") if h else None
        tl = e.timeline or {}
        src = s.get(MediaSource, tl.get("source_id"))
        d["source"] = {"id": src.id, "probe": src.probe, "has_proxy": bool(src.proxy_path), "original_name": src.original_name} if src else None
        return d


@router.put("/edits/{eid}/timeline")
def put_timeline(eid: str, tl: Timeline):
    """Autosave target. The timeline is fully validated before it is stored."""
    with session_scope() as s:
        _edit(s, eid)
    e = save_timeline(eid, tl)
    return {"ok": True, "updated_at": e.updated_at.isoformat(), "duration": round(tl.duration, 3)}


class NameIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


@router.patch("/edits/{eid}")
def rename_edit(eid: str, body: NameIn):
    with session_scope() as s:
        e = _edit(s, eid)
        e.name = body.name
        s.add(e)
        s.commit()
        s.refresh(e)
        return edit_dict(e, with_timeline=False)


@router.get("/edits/{eid}/versions")
def versions(eid: str):
    with session_scope() as s:
        e = _edit(s, eid)
        rows = list(s.exec(select(Edit).where(Edit.group_id == e.group_id).order_by(Edit.version)))
        return [edit_dict(x, with_timeline=False) for x in rows]


@router.post("/edits/{eid}/make-current")
def make_current(eid: str):
    with session_scope() as s:
        e = _edit(s, eid)
        for x in s.exec(select(Edit).where(Edit.group_id == e.group_id)):
            x.is_current = x.id == eid
            s.add(x)
        s.commit()
    return {"ok": True}


class RegenIn(BaseModel):
    style: str | None = None
    aspect: str | None = None
    caption_style: str | None = None
    reframe_mode: str | None = None


@router.post("/edits/{eid}/regenerate")
def regenerate(eid: str, body: RegenIn):
    """New editing variation from the same source clip; previous versions are preserved."""
    with session_scope() as s:
        e = _edit(s, eid)
        if not e.highlight_id:
            raise HTTPException(400, "This edit is not linked to a highlight")
        seeds = [x.seed for x in s.exec(select(Edit).where(Edit.group_id == e.group_id))]
        tl = Timeline.model_validate(e.timeline)
    new = create_edit(e.highlight_id, style=body.style or e.style, aspect=body.aspect or tl.canvas.aspect,
                      caption_preset=body.caption_style, reframe_mode=body.reframe_mode, seed=max(seeds) + 1,
                      group_id=e.group_id, brand_kit_id=tl.brand_kit_id)
    return edit_dict(new)


@router.post("/edits/{eid}/snapshot")
def snapshot(eid: str, tl: Timeline):
    """Save the given timeline as a new version (manual ‘Save as version’)."""
    return edit_dict(new_version_from(eid, tl))


@router.post("/edits/{eid}/ops")
def compute_ops(eid: str, tl: Timeline):
    """Draw ops for the live preview (same layout the exporter uses)."""
    return {"ops": timeline_ops(tl), "duration": tl.duration}


@router.get("/edits/{eid}/frame")
def exact_frame(eid: str, t: float = 0.0, width: int = 540):
    with session_scope() as s:
        e = _edit(s, eid)
        src = s.get(MediaSource, (e.timeline or {}).get("source_id"))
    if src is None:
        raise HTTPException(404, "Source missing")
    p = render_still(e, src, t, max(160, min(width, 1440)))
    return FileResponse(p, media_type="image/png")


@router.post("/edits/{eid}/reframe")
def reframe(eid: str, body: dict[str, Any]):
    """Recompute automatic reframing for a mode (auto/speaker/split/fill/original)."""
    mode = body.get("mode", "auto")
    with session_scope() as s:
        e = _edit(s, eid)
        tl = Timeline.model_validate(body.get("timeline") or e.timeline)
        src = s.get(MediaSource, tl.source_id)
    from ..edit.reframe import speaker_side_map
    from ..edit.service import _speaker_lookup
    from ..analysis.pipeline import latest_analysis

    visual = load_visual(src.fingerprint)
    sents, at = _speaker_lookup(latest_analysis(e.project_id))
    sides, conf = speaker_side_map(sents, visual)
    rf = auto_reframe(tl, src.probe, visual, mode, sides if conf > 0.25 else None, at)
    if mode == "speaker" and not (sides and conf > 0.25):
        rf = auto_reframe(tl, src.probe, visual, "auto")
        rf.note = "Speaker focus needs visible mouth movement linked to voices; not reliable here — using auto focus."
    return rf.model_dump()


@router.get("/edits/{eid}/hooks")
def hooks(eid: str):
    with session_scope() as s:
        e = _edit(s, eid)
        h = s.get(Highlight, e.highlight_id) if e.highlight_id else None
    tl = Timeline.model_validate(e.timeline)
    tr = load_transcript(e.project_id, tl.source_id) or {}
    return hook_suggestions(tl, tr, h.model_dump() if h else {}, sentences_for(e.project_id))


class HookApply(BaseModel):
    suggestion: dict[str, Any]
    timeline: Timeline | None = None


@router.post("/edits/{eid}/hooks/apply")
def hooks_apply(eid: str, body: HookApply):
    """Apply a hook variation as a NEW version (the original is kept)."""
    with session_scope() as s:
        e = _edit(s, eid)
    tl = body.timeline or Timeline.model_validate(e.timeline)
    new_tl = apply_hook(tl, body.suggestion)
    return edit_dict(new_version_from(eid, new_tl))


@router.post("/edits/{eid}/hooks/preview")
def hooks_preview(eid: str, body: HookApply):
    with session_scope() as s:
        e = _edit(s, eid)
    tl = body.timeline or Timeline.model_validate(e.timeline)
    return apply_hook(tl, body.suggestion).model_dump()


@router.get("/edits/{eid}/broll")
def broll(eid: str):
    with session_scope() as s:
        e = _edit(s, eid)
        assets = [a.model_dump(mode="json") for a in s.exec(select(Asset).where(Asset.kind == "broll"))]
    return broll_suggestions(Timeline.model_validate(e.timeline), assets)


class BrandApply(BaseModel):
    brand_kit_id: str
    timeline: Timeline | None = None


@router.post("/edits/{eid}/brand")
def brand(eid: str, body: BrandApply):
    with session_scope() as s:
        e = _edit(s, eid)
        kit = s.get(BrandKit, body.brand_kit_id)
        if kit is None:
            raise HTTPException(404, "Brand kit not found")
        kd = {"id": kit.id, "data": kit.data}
    tl = body.timeline or Timeline.model_validate(e.timeline)
    return apply_brand_kit(tl, kd).model_dump()


@router.get("/caption-presets")
def caption_presets():
    return [{"key": k, "label": v["label"], "style": preset_style(k).model_dump()} for k, v in CAPTION_PRESETS.items()]


@router.get("/edits/{eid}/captions.{fmt}")
def edit_captions(eid: str, fmt: str):
    with session_scope() as s:
        e = _edit(s, eid)
    cues = caption_cues(Timeline.model_validate(e.timeline))
    if fmt == "srt":
        return PlainTextResponse(cues_to_srt(cues), headers={"Content-Disposition": f'attachment; filename="{eid}.srt"'})
    if fmt == "vtt":
        return PlainTextResponse(cues_to_vtt(cues), media_type="text/vtt", headers={"Content-Disposition": f'attachment; filename="{eid}.vtt"'})
    raise HTTPException(400, "Format must be srt or vtt")


@router.post("/edits/{eid}/captions/import")
async def edit_captions_import(eid: str, request: Request):
    """Import SRT/VTT as manual caption cues on this edit (timeline time)."""
    text = (await request.body()).decode("utf-8", "replace")
    cues = parse_subtitles(text)
    with session_scope() as s:
        e = _edit(s, eid)
    tl = Timeline.model_validate(e.timeline)
    tl.captions.manual_cues = [ManualCue(id=new_id("cue_"), start=c["start"], end=c["end"], text=c["text"]) for c in cues]
    for w in tl.captions.words:
        w.hidden = True
    save_timeline(eid, tl)
    return {"cues": len(cues), "timeline": tl.model_dump()}
