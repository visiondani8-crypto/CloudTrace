"""Edit creation, regeneration and versioning."""

from __future__ import annotations

import bisect
from pathlib import Path
from typing import Any

from sqlmodel import select

from ..analysis.pipeline import latest_analysis, load_transcript, source_cache_dir
from ..db import session_scope
from ..models import BrandKit, Edit, Highlight, MediaSource, Project, utcnow
from ..schemas import Timeline
from ..util.files import new_id, read_json
from .recipes import build_timeline
from .reframe import speaker_side_map


def load_visual(fingerprint: str) -> dict[str, Any] | None:
    d = source_cache_dir(fingerprint)
    files = sorted(d.glob("visual_*_v3.json"), key=lambda p: float(p.name.split("_")[1]), reverse=True)
    return read_json(files[0]) if files else None


def _speaker_lookup(analysis: dict[str, Any] | None):
    sents = (analysis or {}).get("sentences") or []
    starts = [s["start"] for s in sents]

    def at(t: float) -> int | None:
        i = bisect.bisect_right(starts, t) - 1
        if 0 <= i < len(sents) and sents[i]["start"] <= t <= sents[i]["end"] + 0.6:
            return sents[i].get("speaker")
        return None

    return sents, at


def create_edit(highlight_id: str, *, style: str = "dynamic", aspect: str = "9:16", caption_preset: str | None = None,
                reframe_mode: str | None = None, brand_kit_id: str | None = None, seed: int = 0,
                platform: str | None = None, group_id: str | None = None) -> Edit:
    with session_scope() as s:
        hl = s.get(Highlight, highlight_id)
        if hl is None:
            raise ValueError("Highlight not found")
        src = s.get(MediaSource, hl.source_id)
        proj = s.get(Project, hl.project_id)
        kit = s.get(BrandKit, brand_kit_id) if brand_kit_id else None
        kit_d = {"id": kit.id, "data": kit.data} if kit else None
    if not src.probe:
        raise ValueError("Source has not been analysed yet")
    transcript = load_transcript(hl.project_id, hl.source_id) or {"segments": []}
    analysis = latest_analysis(hl.project_id)
    visual = load_visual(src.fingerprint)
    psettings = proj.settings or {}
    content_mode = psettings.get("content_mode", "podcast")
    plat = platform or (psettings.get("platforms") or ["tiktok"])[0]
    sents, speaker_at = _speaker_lookup(analysis)
    sides, side_conf = speaker_side_map(sents, visual) if reframe_mode == "speaker" or content_mode in ("podcast", "interview") else ({}, 0.0)
    tl = build_timeline(
        source_id=src.id, info=src.probe, transcript=transcript,
        highlight={"id": hl.id, "start": hl.start, "end": hl.end, "title": hl.title, "topic": hl.topic},
        visual=visual, style=style, aspect=aspect, caption_preset=caption_preset, platform=plat,
        content_mode=content_mode, seed=seed, reframe_mode=reframe_mode, brand_kit=kit_d,
        speaker_sides=sides if side_conf > 0.25 else None, speaker_at=speaker_at,
    )
    with session_scope() as s:
        gid = group_id or new_id("grp_")
        prev = list(s.exec(select(Edit).where(Edit.group_id == gid)))
        for p in prev:
            p.is_current = False
            s.add(p)
        ver = max([p.version for p in prev], default=0) + 1
        e = Edit(id=new_id("ed_"), project_id=hl.project_id, highlight_id=hl.id, group_id=gid, version=ver,
                 name=hl.title or f"Clip {hl.rank}", style=style, seed=seed, timeline=tl.model_dump(mode="json"), is_current=True)
        s.add(e)
        s.commit()
        s.refresh(e)
        return e


def save_timeline(edit_id: str, tl: Timeline) -> Edit:
    with session_scope() as s:
        e = s.get(Edit, edit_id)
        if e is None:
            raise ValueError("Edit not found")
        e.timeline = tl.model_dump(mode="json")
        e.updated_at = utcnow()
        s.add(e)
        s.commit()
        s.refresh(e)
        return e


def new_version_from(edit_id: str, tl: Timeline, name_suffix: str = "") -> Edit:
    """Preserve the current version and store a modified copy as the new current one."""
    with session_scope() as s:
        cur = s.get(Edit, edit_id)
        if cur is None:
            raise ValueError("Edit not found")
        siblings = list(s.exec(select(Edit).where(Edit.group_id == cur.group_id)))
        for p in siblings:
            p.is_current = False
            s.add(p)
        e = Edit(id=new_id("ed_"), project_id=cur.project_id, highlight_id=cur.highlight_id, group_id=cur.group_id,
                 version=max(p.version for p in siblings) + 1, name=cur.name, style=cur.style, seed=cur.seed,
                 timeline=tl.model_dump(mode="json"), is_current=True)
        s.add(e)
        s.commit()
        s.refresh(e)
        return e


def source_for_edit(edit: Edit) -> tuple[MediaSource, Timeline]:
    tl = Timeline.model_validate(edit.timeline)
    with session_scope() as s:
        src = s.get(MediaSource, tl.source_id)
    if src is None:
        raise ValueError("Source media record missing")
    return src, tl


def sentences_for(project_id: str) -> list[dict[str, Any]]:
    a = latest_analysis(project_id)
    return (a or {}).get("sentences") or []


def asset_paths_for(tl: Timeline) -> dict[str, Path]:
    from ..models import Asset

    ids = {g.asset_id for g in tl.graphics if g.asset_id} | {a.asset_id for a in tl.audio_clips} | {o.source_id for o in tl.overlays if o.source_id}
    out: dict[str, Path] = {}
    if not ids:
        return out
    with session_scope() as s:
        for a in s.exec(select(Asset).where(Asset.id.in_(list(ids)))):
            out[a.id] = Path(a.path)
    return out
