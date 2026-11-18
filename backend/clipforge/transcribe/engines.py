"""Local speech-to-text engines.

* ``faster-whisper`` (default): multilingual, punctuation, word timestamps,
  Silero VAD. Models are downloaded once on first use (or pointed at a local
  CTranslate2 model directory) and then run fully offline.
* ``pocketsphinx``: English-only fallback whose acoustic model ships inside the
  Python wheel. Lower accuracy and no punctuation, but needs no download.

Audio is processed in chunks split at silences; finished chunks are cached so
an interrupted transcription resumes where it stopped.
"""

from __future__ import annotations

import logging
import os
import re
import threading
from pathlib import Path
from typing import Any

import numpy as np

from ..config import get_config
from ..media.audio import ANALYSIS_SR, load_wav_segment
from ..util.files import atomic_write_json, read_json
from ..util.proc import CancelToken

log = logging.getLogger(__name__)

CHUNK_SECONDS = 600.0


class TranscriptionUnavailable(Exception):
    def __init__(self, message: str, hint: str | None = None):
        super().__init__(message)
        self.hint = hint


def _split_points(duration: float, silences: list[tuple[float, float]], chunk: float = CHUNK_SECONDS) -> list[tuple[float, float]]:
    """Split [0, duration] into ~chunk-long pieces, cutting inside silences."""
    if duration <= chunk * 1.2:
        return [(0.0, duration)]
    bounds = [0.0]
    target = chunk
    while target < duration - chunk * 0.3:
        best = target
        best_d = 1e9
        for s0, s1 in silences:
            mid = (s0 + s1) / 2
            d = abs(mid - target)
            if d < best_d and d < 60:
                best, best_d = mid, d
        bounds.append(best)
        target = best + chunk
    bounds.append(duration)
    return list(zip(bounds, bounds[1:]))


# ---------------------------------------------------------------- faster-whisper

_fw_models: dict[tuple[str, str], Any] = {}
_fw_lock = threading.Lock()


def models_dir() -> Path:
    d = get_config().data_dir / "Models" / "whisper"
    d.mkdir(parents=True, exist_ok=True)
    return d


def faster_whisper_status(model: str) -> dict[str, Any]:
    try:
        import faster_whisper  # noqa: F401
    except Exception as e:  # pragma: no cover
        return {"available": False, "reason": f"faster-whisper not installed: {e}"}
    p = Path(model).expanduser()
    if p.is_dir():
        ok = (p / "model.bin").exists()
        return {"available": ok, "local_path": str(p), "reason": None if ok else "model.bin missing in model directory"}
    cached = any(models_dir().glob(f"models--Systran--faster-whisper-{model}*")) or any(
        models_dir().glob(f"models--*{model}*")
    )
    return {
        "available": True,
        "downloaded": cached,
        "reason": None if cached else f"Model '{model}' will be downloaded on first use (~{_model_size(model)}).",
    }


def _model_size(name: str) -> str:
    return {"tiny": "75 MB", "base": "145 MB", "small": "480 MB", "medium": "1.5 GB", "large-v3": "3 GB", "turbo": "1.6 GB", "large-v3-turbo": "1.6 GB", "distil-large-v3": "1.5 GB"}.get(name, "unknown size")


def _load_fw(model: str, compute_type: str):
    from faster_whisper import WhisperModel

    key = (model, compute_type)
    with _fw_lock:
        if key in _fw_models:
            return _fw_models[key]
        p = Path(model).expanduser()
        threads = max(1, (os.cpu_count() or 4) - 1)
        ct = "int8" if compute_type == "auto" else compute_type
        try:
            if p.is_dir():
                m = WhisperModel(str(p), device="cpu", compute_type=ct, cpu_threads=threads)
            else:
                try:
                    m = WhisperModel(model, device="cpu", compute_type=ct, cpu_threads=threads,
                                     download_root=str(models_dir()), local_files_only=True)
                except Exception:
                    m = WhisperModel(model, device="cpu", compute_type=ct, cpu_threads=threads,
                                     download_root=str(models_dir()))
        except Exception as e:
            raise TranscriptionUnavailable(
                f"Transcription model '{model}' is unavailable.",
                "Select a model in Settings → Transcription, connect to the internet once so it can download, "
                "or point the model setting at a local CTranslate2 model folder. "
                f"Details: {str(e)[:200]}",
            ) from e
        _fw_models[key] = m
        return m


def transcribe_faster_whisper(
    wav: Path, duration: float, silences: list[tuple[float, float]], cache_dir: Path,
    model: str, language: str | None, compute_type: str = "auto", beam_size: int = 5,
    token: CancelToken | None = None, progress=None,
) -> dict[str, Any]:
    m = _load_fw(model, compute_type)
    chunks = _split_points(duration, silences)
    segments: list[dict[str, Any]] = []
    detected_lang = language
    lang_prob = 1.0 if language else 0.0
    for ci, (c0, c1) in enumerate(chunks):
        cpath = cache_dir / f"fw_chunk_{ci:03d}.json"
        cached = read_json(cpath)
        if cached and cached.get("range") == [round(c0, 3), round(c1, 3)]:
            segments.extend(cached["segments"])
            detected_lang = detected_lang or cached.get("language")
            lang_prob = max(lang_prob, cached.get("language_probability", 0))
            continue
        audio = load_wav_segment(wav, c0, c1)
        if audio.size < ANALYSIS_SR * 0.2:
            continue
        segs, info = m.transcribe(
            audio, language=detected_lang, word_timestamps=True, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400}, beam_size=beam_size,
            condition_on_previous_text=False,
        )
        if detected_lang is None:
            detected_lang = info.language
            lang_prob = float(info.language_probability)
        chunk_segs: list[dict[str, Any]] = []
        for s in segs:
            if token:
                token.check()
            words = [
                {"w": w.word.strip(), "s": round(c0 + w.start, 3), "e": round(c0 + w.end, 3), "p": round(float(w.probability), 3)}
                for w in (s.words or []) if w.word.strip()
            ]
            if not words:
                continue
            chunk_segs.append({
                "start": round(c0 + s.start, 3), "end": round(c0 + s.end, 3), "text": s.text.strip(),
                "words": words, "avg_logprob": round(float(s.avg_logprob), 3),
                "no_speech_prob": round(float(s.no_speech_prob), 3),
            })
            if progress and duration > 0:
                progress(min(0.999, (c0 + s.end) / duration))
        atomic_write_json(cpath, {"range": [round(c0, 3), round(c1, 3)], "segments": chunk_segs,
                                  "language": detected_lang, "language_probability": lang_prob})
        segments.extend(chunk_segs)
    return {
        "engine": "faster-whisper", "model": model, "language": detected_lang or "unknown",
        "language_probability": round(lang_prob, 3), "has_punctuation": True, "segments": segments,
    }


# ---------------------------------------------------------------- pocketsphinx

_PS_SKIP = re.compile(r"^(<s>|</s>|<sil>|\[.*\]|\+\+.*\+\+)$")


def pocketsphinx_status() -> dict[str, Any]:
    try:
        import pocketsphinx  # noqa: F401

        return {"available": True, "reason": "English only, no punctuation, lower accuracy."}
    except Exception as e:  # pragma: no cover
        return {"available": False, "reason": str(e)}


def transcribe_pocketsphinx(
    wav: Path, duration: float, silences: list[tuple[float, float]], cache_dir: Path,
    token: CancelToken | None = None, progress=None,
) -> dict[str, Any]:
    try:
        from pocketsphinx import Decoder
    except Exception as e:  # pragma: no cover
        raise TranscriptionUnavailable("pocketsphinx is not installed.", str(e)) from e
    decoder = Decoder(samprate=ANALYSIS_SR, loglevel="FATAL")
    # Utterances: split at silences, cap at ~25 s for decoding speed.
    chunks = _split_points(duration, silences, chunk=25.0)
    words: list[dict[str, Any]] = []
    for ci, (c0, c1) in enumerate(chunks):
        if token:
            token.check()
        cpath = cache_dir / f"ps_chunk_{ci:04d}.json"
        cached = read_json(cpath)
        if cached and cached.get("range") == [round(c0, 3), round(c1, 3)]:
            words.extend(cached["words"])
            continue
        audio = load_wav_segment(wav, c0, c1)
        pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes()
        decoder.start_utt()
        decoder.process_raw(pcm, full_utt=True)
        decoder.end_utt()
        cw: list[dict[str, Any]] = []
        for seg in decoder.seg():
            w = re.sub(r"\(\d+\)$", "", seg.word)
            if _PS_SKIP.match(w):
                continue
            cw.append({"w": w, "s": round(c0 + seg.start_frame / 100.0, 3), "e": round(c0 + (seg.end_frame + 1) / 100.0, 3),
                       "p": round(float(seg.prob), 3)})
        atomic_write_json(cpath, {"range": [round(c0, 3), round(c1, 3)], "words": cw})
        words.extend(cw)
        if progress and duration > 0:
            progress(min(0.999, c1 / duration))
    # Group words into segments at pauses (no punctuation available).
    segments: list[dict[str, Any]] = []
    cur: list[dict[str, Any]] = []
    for w in words:
        if cur and (w["s"] - cur[-1]["e"] > 0.6 or len(cur) >= 28):
            segments.append(_mk_seg(cur))
            cur = []
        cur.append(w)
    if cur:
        segments.append(_mk_seg(cur))
    return {"engine": "pocketsphinx", "model": "en-us (bundled)", "language": "en", "language_probability": 1.0,
            "has_punctuation": False, "segments": segments}


def _mk_seg(words: list[dict[str, Any]]) -> dict[str, Any]:
    return {"start": words[0]["s"], "end": words[-1]["e"], "text": " ".join(w["w"] for w in words), "words": words}
