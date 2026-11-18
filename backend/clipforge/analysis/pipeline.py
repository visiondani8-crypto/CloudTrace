"""End-to-end analysis pipeline for one source video.

Stages (each cached by source fingerprint so re-runs are cheap):
  probe → audio extraction & features → preview proxy & thumbnail strip →
  transcription → visual analysis → structure (sentences/topics/speakers) →
  candidate generation & scoring → (optional LLM refinement) → selection →
  explanations & thumbnails → persistence.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any, Protocol

from sqlmodel import select

from ..ai.providers import ProviderError, get_provider
from ..ai.refine import refine_candidates
from ..config import get_config
from ..db import session_scope
from ..media import audio as audio_mod
from ..media.ffprobe import probe
from ..media.proxy import make_proxy, thumbnail, thumbnail_strip
from ..media.visual import analyse_video
from ..models import Highlight, MediaSource, Project, utcnow
from ..schemas import AnalysisSettings
from ..transcribe.service import transcribe
from ..util.files import atomic_write_json, new_id, read_json
from ..util.proc import CancelToken
from . import highlights as hl
from .features import sentence_features
from .modes import MODES, PLATFORMS, parse_instructions
from .segment import build_sentences, speaker_turns, topic_segments
from .text import TfIdf, keyphrases

log = logging.getLogger(__name__)

ANALYSIS_VERSION = 3

MODE_PARAMS = {
    "fast": {"sample_fps": 2.0, "face_every": 2, "beam": 1, "fast_candidates": True, "diarize": False, "llm_top": 0},
    "balanced": {"sample_fps": 4.0, "face_every": 1, "beam": 3, "fast_candidates": False, "diarize": True, "llm_top": 24},
    "deep": {"sample_fps": 6.0, "face_every": 1, "beam": 5, "fast_candidates": False, "diarize": True, "llm_top": 48},
}


class StageContext(Protocol):
    token: CancelToken

    def stage(self, name: str) -> None: ...
    def progress(self, p: float) -> None: ...
    def warn(self, msg: str) -> None: ...
    def info(self, msg: str) -> None: ...


def source_cache_dir(fingerprint: str) -> Path:
    d = get_config().cache_dir / fingerprint
    d.mkdir(parents=True, exist_ok=True)
    return d


def project_dir(project_id: str) -> Path:
    d = get_config().projects_dir / project_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def prepare_media(src: MediaSource, ctx: StageContext) -> dict[str, Any]:
    """Probe, extract analysis audio, compute audio features, build proxy and sprite (cached)."""
    path = Path(src.path)
    ctx.stage("probe")
    info = probe(path)
    with session_scope() as s:
        row = s.get(MediaSource, src.id)
        row.probe = info
        s.add(row)
        s.commit()
    cdir = source_cache_dir(src.fingerprint)
    out: dict[str, Any] = {"info": info, "cache_dir": cdir}
    ctx.stage("audio")
    wav = cdir / "analysis_16k.wav"
    feats_path = cdir / "audio_features.json"
    if info["has_audio"]:
        if not wav.exists():
            audio_mod.extract_analysis_audio(path, wav, info["duration"], ctx.token, ctx.progress)
        feats = read_json(feats_path)
        if not feats:
            feats = audio_mod.compute_audio_features(wav, ctx.token)
            atomic_write_json(feats_path, feats)
        peaks_path = cdir / "waveform.json"
        if not peaks_path.exists():
            atomic_write_json(peaks_path, {"per_second": 20, "peaks": audio_mod.waveform_peaks(feats, wav)})
        out["audio"] = feats
        out["wav"] = wav
    else:
        ctx.warn("Source has no audio track — transcription and audio signals are skipped.")
        out["audio"] = None
        out["wav"] = None
    ctx.stage("proxy")
    proxy = cdir / "proxy.mp4"
    if not proxy.exists():
        make_proxy(path, proxy, info, ctx.token, ctx.progress)
    sprite = cdir / "sprite.jpg"
    sprite_meta = cdir / "sprite.json"
    if not sprite.exists() or not sprite_meta.exists():
        meta = thumbnail_strip(path, sprite, info["duration"], info, ctx.token)
        atomic_write_json(sprite_meta, meta)
    with session_scope() as s:
        row = s.get(MediaSource, src.id)
        row.proxy_path = str(proxy)
        s.add(row)
        s.commit()
    return out


def run_analysis(project_id: str, source_id: str, settings: AnalysisSettings, ctx: StageContext, app_settings: dict[str, Any]) -> dict[str, Any]:
    t_start = time.time()
    with session_scope() as s:
        src = s.get(MediaSource, source_id)
        if src is None:
            raise ValueError("Source not found")
        proj = s.get(Project, project_id)
        proj.status = "analysing"
        s.add(proj)
        s.commit()
    if not Path(src.path).exists():
        raise FileNotFoundError(f"Source file is missing: {src.path}. Use Relink to locate it.")
    mp = MODE_PARAMS[settings.analysis_mode]
    media = prepare_media(src, ctx)
    info = media["info"]
    duration = info["duration"]
    cdir: Path = media["cache_dir"]
    silences = audio_mod.detect_silences(media["audio"]) if media["audio"] else []

    # ---------------- transcription
    ctx.stage("transcription")
    tcfg = app_settings.get("transcription", {})
    model = settings.whisper_model or tcfg.get("model") or get_config().whisper_model
    engine = settings.transcription_engine if settings.transcription_engine != "auto" else tcfg.get("engine", "auto")
    if media["wav"] is not None:
        transcript = transcribe(
            media["wav"], duration, silences, cdir, engine=engine, model=model,
            language=settings.language or tcfg.get("language") or None,
            compute_type=tcfg.get("compute_type", "auto"), beam_size=mp["beam"], token=ctx.token, progress=ctx.progress,
        )
        for w in transcript.get("warnings", []):
            ctx.warn(w)
        ctx.info(f"Transcribed with {transcript['engine']} ({transcript['model']}), language {transcript['language']}"
                 + (" — from cache" if transcript.get("from_cache") else ""))
    else:
        transcript = {"engine": "none", "model": "", "language": "", "segments": [], "has_punctuation": False,
                      "word_count": 0, "no_speech": True, "warnings": ["No audio"], "duration": duration}
    atomic_write_json(project_dir(project_id) / "transcripts" / f"{source_id}.json", transcript)

    # ---------------- visual
    ctx.stage("scene_detection")
    vkey = f"visual_{mp['sample_fps']:.1f}_{mp['face_every']}_v3.json"
    visual = read_json(cdir / vkey)
    if not visual:
        visual = analyse_video(Path(src.path), info, mp["sample_fps"], mp["face_every"], ctx.token, ctx.progress)
        atomic_write_json(cdir / vkey, visual)
    ctx.info(f"{len(visual['scene_cuts'])} scene cuts; faces visible {visual['stats']['face_presence'] * 100:.0f}% of the time")

    # ---------------- structure
    ctx.stage("understanding")
    sentences = build_sentences(transcript)
    if not sentences:
        result = _finish_no_speech(project_id, source_id, settings, visual, duration, ctx)
        return result
    tfidf = TfIdf([s["text"] for s in sentences])
    topics = topic_segments(sentences, tfidf, min_seconds=max(10.0, min(45.0, duration / 8.0)), scene_cuts=visual["scene_cuts"])
    speakers = None
    if settings.diarize and mp["diarize"] and media["wav"] is not None:
        sp_path = cdir / f"speakers_{transcript.get('engine')}_{len(sentences)}.json"
        speakers = read_json(sp_path)
        if not speakers:
            speakers = speaker_turns(sentences, media["wav"])
            atomic_write_json(sp_path, speakers)
    instructions = parse_instructions(settings.custom_instructions)
    feats = sentence_features(sentences, tfidf, media["audio"], visual, topics, speakers, instructions)
    summary = {
        "keywords": keyphrases([s["text"] for s in sentences], tfidf, top=12),
        "topics": [{k: t[k] for k in ("id", "start", "end", "label", "keywords")} for t in topics],
        "questions": sum(1 for s in sentences if s["is_question"]),
        "stories": sum(1 for f in feats if f["cues"].get("story")),
        "speakers": (speakers or {}).get("count", 1),
        "speaker_confidence": (speakers or {}).get("confidence", 0.0),
        "speech_ratio": transcript.get("speech_ratio", 0.0),
        "language": transcript.get("language"),
        "engine": transcript.get("engine"),
        "face_presence": visual["stats"]["face_presence"],
        "scene_count": visual["stats"]["scene_count"],
        "sentences": len(sentences),
        "duration": duration,
    }
    ctx.info(f"Understood {len(sentences)} sentences across {len(topics)} topic(s): " + ", ".join(t["label"] for t in topics[:6]))

    # ---------------- candidates & scoring
    ctx.stage("candidate_ranking")
    lo, hi = hl.DURATION_PRESETS.get(settings.duration_preset, hl.DURATION_PRESETS["auto"])
    if settings.duration_preset == "custom" or (settings.min_duration and settings.max_duration):
        lo = settings.min_duration or lo
        hi = settings.max_duration or hi
    if instructions.min_duration:
        lo = instructions.min_duration
    if instructions.max_duration:
        hi = instructions.max_duration
    if lo >= hi:
        hi = lo + 10
    platform = settings.platforms[0]
    mode_key = settings.content_mode
    sctx = hl.make_context(mode_key, instructions, platform, lo, hi, transcript.get("has_punctuation", True),
                           (speakers or {}).get("confidence", 0.0), settings.factor_weights)
    words_by_sentence = _words_by_sentence(transcript, sentences)
    cands = hl.generate_candidates(sentences, duration, visual["scene_cuts"], lo, hi, fast=mp["fast_candidates"])
    ctx.info(f"Generated {len(cands)} candidate windows ({lo:.0f}–{hi:.0f}s)")

    def rescore(c: dict[str, Any]) -> dict[str, Any]:
        return hl.score_candidate(c, sentences, feats, tfidf, sctx, words_by_sentence, visual, media["audio"], visual["scene_cuts"])

    scored = []
    for k, c in enumerate(cands):
        if k % 500 == 0:
            ctx.token.check()
            ctx.progress(k / max(1, len(cands)) * 0.8)
        scored.append(rescore(c))
    # Optional LLM refinement of the strongest distinct candidates
    llm_report = None
    if settings.ai_provider != "local" and mp["llm_top"]:
        try:
            provider = get_provider(settings.ai_provider, app_settings)
            st = provider.status()
            if not st.get("available"):
                ctx.warn(f"{settings.ai_provider} unavailable: {st.get('reason')} — using local ranking only.")
            else:
                pre, _ = hl.select_highlights(scored, sentences, tfidf, feats, mp["llm_top"], 0.0, duration)
                ctx.info(f"Refining {len(pre)} candidates with {provider.name}")
                refined, llm_report = refine_candidates(provider, pre, sentences, sctx, rescore,
                                                        MODES[mode_key].label, settings.custom_instructions, PLATFORMS[platform]["label"])
                by_key = {(c["s0"], c["s1"]): c for c in pre}
                for r, orig in zip(refined, pre):
                    by_key[(orig["s0"], orig["s1"])] = r
                scored = [by_key.get((c["s0"], c["s1"]), c) for c in scored]
                if llm_report["errors"]:
                    ctx.warn("AI refinement issues: " + "; ".join(llm_report["errors"][:2]))
        except ProviderError as e:
            ctx.warn(f"{e} {e.hint or ''}".strip())
    count = settings.count or instructions.count
    selected, sel_stats = hl.select_highlights(scored, sentences, tfidf, feats, count, settings.min_score, duration)
    if sel_stats.get("note"):
        ctx.warn(sel_stats["note"])
    ctx.progress(0.9)

    # ---------------- explanations, thumbnails, persistence
    ctx.stage("finalising")
    analysis_id = new_id("an_")
    pdir = project_dir(project_id)
    rows: list[Highlight] = []
    mode_cfg = MODES[mode_key]
    for rank, c in enumerate(selected, 1):
        ex = hl.explain(c, sentences, tfidf, mode_cfg)
        if c.get("llm"):
            llm = c["llm"]
            ex["title"] = llm["title"] or ex["title"]
            ex["topic"] = llm["topic"] or ex["topic"]
            ex["reason"] = llm["reason"] or ex["reason"]
            ex["audience"] = llm["audience"] or ex["audience"]
            c["issues"] = list(dict.fromkeys(c["issues"] + llm["issues"]))[:6]
        hid = new_id("hl_")
        tt = hl.choose_thumbnail_time(c, sentences, visual)
        thumb = pdir / "thumbs" / f"{hid}.jpg"
        try:
            thumbnail(Path(src.path), tt, thumb, 480, info)
        except Exception as e:  # thumbnails are non-critical
            log.warning("Thumbnail failed: %s", e)
            thumb = None
        text = " ".join(s["text"] for s in sentences[c["s0"] : c["s1"] + 1])
        rows.append(Highlight(
            id=hid, project_id=project_id, source_id=source_id, analysis_id=analysis_id, rank=rank,
            start=c["start"], end=c["end"], score=c["score"], breakdown=c["breakdown"],
            title=ex["title"], topic=ex["topic"], hook=ex["hook"], reason=ex["reason"], audience=ex["audience"],
            issues=c["issues"], transcript=text,
            evidence={"s0": c["s0"], "s1": c["s1"], "adjustments": c.get("adjustments", []), "metrics": c["metrics"],
                      "keywords": ex["keywords"], "thumb_t": tt, "llm": bool(c.get("llm")),
                      "speakers": sorted({feats[k]["speaker"] for k in range(c["s0"], c["s1"] + 1)})},
            thumb_path=str(thumb) if thumb else None,
        ))
    top = sorted(scored, key=lambda c: -c["score"])[:150]
    doc = {
        "id": analysis_id, "version": ANALYSIS_VERSION, "source_id": source_id, "created_at": time.time(),
        "settings": settings.model_dump(), "instructions": instructions.to_dict(), "summary": summary,
        "duration_range": [lo, hi], "selection": sel_stats, "llm": llm_report,
        "sentences": [{k: s[k] for k in ("id", "start", "end", "text", "is_question", "conf")} | {"speaker": feats[i]["speaker"], "topic": feats[i]["topic"]}
                      for i, s in enumerate(sentences)],
        "candidates": [{k: c[k] for k in ("s0", "s1", "start", "end", "duration", "score", "issues")} for c in top],
        "elapsed_s": round(time.time() - t_start, 1),
        "scoring_weights": sctx.factor_max,
    }
    atomic_write_json(pdir / "analysis" / f"{analysis_id}.json", doc)
    with session_scope() as s:
        for r in rows:
            s.add(r)
        proj = s.get(Project, project_id)
        proj.status = "ready"
        proj.summary = summary | {"analysis_id": analysis_id, "source_id": source_id}
        proj.settings = settings.model_dump()
        proj.updated_at = utcnow()
        s.add(proj)
        srow = s.get(MediaSource, source_id)
        srow.status = "analysed"
        s.add(srow)
        s.commit()
    ctx.progress(1.0)
    return {"analysis_id": analysis_id, "highlights": [r.id for r in rows], "selection": sel_stats, "summary": summary}


def _finish_no_speech(project_id, source_id, settings, visual, duration, ctx) -> dict[str, Any]:
    """Visual/audio-only fallback when there is no usable speech."""
    ctx.warn("No usable speech found. Highlights could not be built from dialogue; try Gaming/Sports mode "
             "or add subtitles via import. No clips were invented.")
    with session_scope() as s:
        proj = s.get(Project, project_id)
        proj.status = "ready"
        proj.summary = {"no_speech": True, "duration": duration, "scene_count": visual["stats"]["scene_count"]}
        s.add(proj)
        s.commit()
    return {"analysis_id": None, "highlights": [], "selection": {"returned": 0, "note": "No speech"}}


def _words_by_sentence(transcript, sentences) -> list[list[dict[str, Any]]]:
    words = [w for s in transcript.get("segments", []) for w in s.get("words", [])]
    by_i = {w["i"]: w for w in words}
    return [[by_i[k] for k in range(s["w0"], s["w1"] + 1) if k in by_i] for s in sentences]


def latest_analysis(project_id: str) -> dict[str, Any] | None:
    with session_scope() as s:
        proj = s.get(Project, project_id)
        aid = (proj.summary or {}).get("analysis_id") if proj else None
    if not aid:
        return None
    return read_json(project_dir(project_id) / "analysis" / f"{aid}.json")


def load_transcript(project_id: str, source_id: str) -> dict[str, Any] | None:
    return read_json(project_dir(project_id) / "transcripts" / f"{source_id}.json")


def latest_highlights(project_id: str) -> list[Highlight]:
    with session_scope() as s:
        proj = s.get(Project, project_id)
        aid = (proj.summary or {}).get("analysis_id") if proj else None
        if not aid:
            return []
        return list(s.exec(select(Highlight).where(Highlight.project_id == project_id, Highlight.analysis_id == aid).order_by(Highlight.rank)))
