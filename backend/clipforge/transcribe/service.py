"""Transcription service with content-addressed caching.

Transcripts are cached per *source fingerprint + engine + model + language*,
so re-importing the same file (or changing caption colours) never repeats the
expensive transcription.
"""

from __future__ import annotations

import hashlib
import logging
import time
from pathlib import Path
from typing import Any

from ..util.files import atomic_write_json, read_json
from ..util.proc import CancelToken
from .engines import (
    TranscriptionUnavailable,
    faster_whisper_status,
    pocketsphinx_status,
    transcribe_faster_whisper,
    transcribe_pocketsphinx,
)

log = logging.getLogger(__name__)

TRANSCRIPT_VERSION = 2


def transcript_key(engine: str, model: str, language: str | None) -> str:
    raw = f"v{TRANSCRIPT_VERSION}|{engine}|{model}|{language or 'auto'}"
    return hashlib.sha1(raw.encode()).hexdigest()[:12]


def finalize(tr: dict[str, Any], duration: float) -> dict[str, Any]:
    """Normalise, sort, and compute quality metadata."""
    segs = []
    wid = 0
    for i, s in enumerate(sorted(tr["segments"], key=lambda s: s["start"])):
        words = []
        for w in s.get("words") or []:
            if w["e"] <= w["s"]:
                w["e"] = round(w["s"] + 0.05, 3)
            w["i"] = wid
            wid += 1
            words.append(w)
        segs.append({**s, "id": i, "words": words})
    tr["segments"] = segs
    probs = [w["p"] for s in segs for w in s["words"]]
    mean_p = sum(probs) / len(probs) if probs else 0.0
    speech_time = sum(s["end"] - s["start"] for s in segs)
    tr["duration"] = duration
    tr["word_count"] = len(probs)
    tr["mean_confidence"] = round(mean_p, 3)
    tr["speech_ratio"] = round(speech_time / duration, 3) if duration else 0.0
    tr["low_confidence"] = bool(probs) and mean_p < 0.55
    tr["no_speech"] = len(probs) < 3
    tr["version"] = TRANSCRIPT_VERSION
    tr.setdefault("warnings", [])
    if tr["low_confidence"]:
        tr["warnings"].append("Low transcription confidence: review captions before export.")
    if tr["no_speech"]:
        tr["warnings"].append("Little or no speech detected: highlights rely on audio and visual signals.")
    tr["created_at"] = time.time()
    return tr


def transcribe(
    wav: Path, duration: float, silences: list[tuple[float, float]], cache_root: Path,
    engine: str = "auto", model: str = "small", language: str | None = None,
    compute_type: str = "auto", beam_size: int = 5,
    token: CancelToken | None = None, progress=None,
) -> dict[str, Any]:
    """Return a transcript dict, using the cache when possible."""
    warnings: list[str] = []
    chosen = engine
    if engine == "auto":
        st = faster_whisper_status(model)
        chosen = "faster-whisper" if st["available"] else "pocketsphinx"
    key = transcript_key(chosen, model if chosen == "faster-whisper" else "en-us", language)
    final_path = cache_root / f"transcript_{key}.json"
    cached = read_json(final_path)
    if cached and cached.get("version") == TRANSCRIPT_VERSION:
        cached["from_cache"] = True
        return cached
    work = cache_root / f"transcript_{key}.parts"
    work.mkdir(parents=True, exist_ok=True)
    if chosen == "faster-whisper":
        try:
            tr = transcribe_faster_whisper(wav, duration, silences, work, model, language, compute_type, beam_size, token, progress)
        except TranscriptionUnavailable as e:
            if engine != "auto":
                raise
            log.warning("faster-whisper unavailable (%s); falling back to pocketsphinx", e)
            warnings.append(f"{e} Fell back to the bundled English pocketsphinx engine (lower accuracy). {e.hint or ''}".strip())
            chosen = "pocketsphinx"
            key = transcript_key(chosen, "en-us", language)
            final_path = cache_root / f"transcript_{key}.json"
            work = cache_root / f"transcript_{key}.parts"
            work.mkdir(parents=True, exist_ok=True)
            tr = transcribe_pocketsphinx(wav, duration, silences, work, token, progress)
    elif chosen == "pocketsphinx":
        if language and not language.startswith("en"):
            raise TranscriptionUnavailable("The pocketsphinx engine only supports English.", "Use faster-whisper for other languages.")
        tr = transcribe_pocketsphinx(wav, duration, silences, work, token, progress)
    else:
        raise TranscriptionUnavailable(f"Unknown transcription engine '{engine}'.")
    tr["warnings"] = warnings
    tr = finalize(tr, duration)
    atomic_write_json(final_path, tr)
    tr["from_cache"] = False
    return tr


def engine_status(model: str) -> dict[str, Any]:
    return {"faster-whisper": faster_whisper_status(model), "pocketsphinx": pocketsphinx_status()}


def all_words(tr: dict[str, Any]) -> list[dict[str, Any]]:
    return [w for s in tr.get("segments", []) for w in s.get("words", [])]
