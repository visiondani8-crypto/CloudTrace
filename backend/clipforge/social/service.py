"""Social package persistence and export bundles."""

from __future__ import annotations

import csv
import io
import json
import zipfile
from pathlib import Path
from typing import Any

from sqlmodel import select

from ..ai.providers import ProviderError, get_provider
from ..analysis.pipeline import latest_analysis
from ..config import get_config
from ..db import session_scope
from ..models import Edit, Project, Render, SocialPackage, utcnow
from ..schemas import Timeline
from ..util.files import new_id, sanitize_filename
from .generate import as_text, clip_sentences, generate_llm, generate_local


def generate_package(edit_id: str, platform: str, provider_name: str, app_settings: dict[str, Any],
                     max_hashtags: int | None = None, render_id: str | None = None) -> SocialPackage:
    with session_scope() as s:
        edit = s.get(Edit, edit_id)
        if edit is None:
            raise ValueError("Edit not found")
        proj = s.get(Project, edit.project_id)
    tl = Timeline.model_validate(edit.timeline)
    analysis = latest_analysis(edit.project_id) or {}
    sents = clip_sentences(tl, analysis.get("sentences") or [])
    content_mode = (proj.settings or {}).get("content_mode", "podcast")
    face = (proj.summary or {}).get("face_presence", 0.0)
    corpus = [x["text"] for x in analysis.get("sentences") or []]
    base = generate_local(tl, sents, platform, content_mode, max_hashtags, proj.name if proj else "", face, corpus)
    pkg, usage, provider = base, {}, "local"
    warnings: list[str] = []
    if provider_name != "local":
        try:
            prov = get_provider(provider_name, app_settings)
            st = prov.status()
            if st.get("available"):
                pkg, usage = generate_llm(prov, tl, sents, platform, content_mode, max_hashtags, base)
                provider = prov.name
            else:
                warnings.append(f"{provider_name} unavailable ({st.get('reason')}); used local generation.")
        except ProviderError as e:
            warnings.append(f"{e} {e.hint or ''} Used local generation.".strip())
    content = pkg.model_dump()
    content["warnings"] = warnings
    with session_scope() as s:
        row = SocialPackage(id=new_id("sp_"), project_id=edit.project_id, edit_id=edit_id, render_id=render_id, platform=platform,
                            provider=provider, content=content, usage=usage,
                            chosen={"title": content["titles"][0]["text"] if content["titles"] else "",
                                    "description": content["descriptions"].get("medium", ""), "hashtags": content["hashtags"]})
        s.add(row)
        s.commit()
        s.refresh(row)
        return row


def package_rows(project_id: str, render_ids: list[str] | None = None) -> list[dict[str, Any]]:
    with session_scope() as s:
        q = select(Render).where(Render.project_id == project_id, Render.status == "completed")
        renders = [r for r in s.exec(q) if not render_ids or r.id in render_ids]
        rows = []
        for r in renders:
            edit = s.get(Edit, r.edit_id)
            sp = s.exec(select(SocialPackage).where(SocialPackage.edit_id == r.edit_id).order_by(SocialPackage.updated_at.desc())).first()
            rows.append({"render": r, "edit": edit, "social": sp})
        return rows


def metadata_record(row: dict[str, Any]) -> dict[str, Any]:
    r, e, sp = row["render"], row["edit"], row["social"]
    c = (sp.content if sp else {}) or {}
    ch = (sp.chosen if sp else {}) or {}
    return {
        "clip": e.name if e else "", "file": Path(r.output_path).name if r.output_path else "", "platform": sp.platform if sp else "",
        "duration_s": round(r.duration, 2), "resolution": f"{r.width}x{r.height}",
        "title": ch.get("title", ""), "description": ch.get("description", ""), "hashtags": " ".join(ch.get("hashtags", [])),
        "hook_text": c.get("hook_text", ""), "thumbnail_title": c.get("thumbnail_title", ""),
        "keywords": ", ".join(c.get("keywords", [])), "title_options": [t["text"] for t in c.get("titles", [])],
        "descriptions": c.get("descriptions", {}), "suggestions": c.get("suggestions", []),
    }


def metadata_csv(records: list[dict[str, Any]]) -> str:
    buf = io.StringIO()
    cols = ["clip", "file", "platform", "duration_s", "resolution", "title", "description", "hashtags", "hook_text", "thumbnail_title", "keywords"]
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for r in records:
        w.writerow(r)
    return buf.getvalue()


def build_zip(project_id: str, render_ids: list[str] | None = None, include_video: bool = True) -> Path:
    rows = package_rows(project_id, render_ids)
    if not rows:
        raise ValueError("No completed renders to package. Render clips first.")
    with session_scope() as s:
        proj = s.get(Project, project_id)
    name = sanitize_filename(proj.name if proj else "ClipForge")
    out = get_config().tmp_dir / f"{name}_package_{new_id()}.zip"
    records = []
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_STORED) as z:
        for k, row in enumerate(rows, 1):
            r, sp = row["render"], row["social"]
            rec = metadata_record(row)
            records.append(rec)
            folder = f"{k:02d}_{sanitize_filename(rec['clip'] or 'clip', 60).replace(' ', '_')}"
            if include_video and r.output_path and Path(r.output_path).exists():
                vp = Path(r.output_path)
                z.write(vp, f"{folder}/{vp.name}")
                for ext in (".srt", ".vtt"):
                    sc = vp.with_suffix(ext)
                    if sc.exists():
                        z.write(sc, f"{folder}/{sc.name}")
            z.writestr(f"{folder}/metadata.json", json.dumps(rec, indent=1, ensure_ascii=False))
            if sp:
                z.writestr(f"{folder}/post_{sp.platform}.txt", as_text({"content": sp.content, "chosen": sp.chosen}, sp.platform, rec["file"]))
        z.writestr("metadata.json", json.dumps(records, indent=1, ensure_ascii=False))
        z.writestr("metadata.csv", metadata_csv(records))
        z.writestr("README.txt", f"ClipForge Studio export package for {proj.name if proj else ''}\n"
                                 f"{len(records)} clip(s). Each folder contains the video, captions (SRT/VTT), metadata.json and post text.\n")
    return out


def update_package(pkg_id: str, chosen: dict[str, Any] | None, content: dict[str, Any] | None) -> SocialPackage:
    with session_scope() as s:
        row = s.get(SocialPackage, pkg_id)
        if row is None:
            raise ValueError("Package not found")
        if chosen is not None:
            row.chosen = chosen
        if content is not None:
            row.content = {**(row.content or {}), **content}
        row.updated_at = utcnow()
        s.add(row)
        s.commit()
        s.refresh(row)
        return row
