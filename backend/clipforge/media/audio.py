"""Audio extraction and signal analysis (streaming, disk based)."""

from __future__ import annotations

import wave
from pathlib import Path
from typing import Any

import numpy as np

from ..config import get_config
from ..util.proc import CancelToken, ffmpeg_progress_parser, run

ANALYSIS_SR = 16000
ENVELOPE_HZ = 20  # energy envelope resolution (frames per second)


def extract_analysis_audio(src: Path, dst: Path, duration: float, token: CancelToken | None = None, progress=None) -> Path:
    """Decode the first audio stream to 16 kHz mono PCM WAV for analysis.

    This is an analysis-only copy; renders always read audio from the original.
    """
    cfg = get_config()
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".part.wav")
    args = [
        cfg.ffmpeg_bin, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(src), "-map", "0:a:0", "-vn", "-sn", "-dn",
        "-ac", "1", "-ar", str(ANALYSIS_SR), "-c:a", "pcm_s16le",
        "-progress", "pipe:2", "-nostats", str(tmp),
    ]
    run(args, token=token, on_stderr_line=ffmpeg_progress_parser(duration, progress) if progress else None)
    tmp.replace(dst)
    return dst


def iter_wav_chunks(path: Path, seconds: float = 30.0):
    with wave.open(str(path), "rb") as w:
        sr = w.getframerate()
        n = int(sr * seconds)
        while True:
            raw = w.readframes(n)
            if not raw:
                break
            yield sr, np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def load_wav_segment(path: Path, start: float, end: float) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        sr = w.getframerate()
        w.setpos(max(0, min(w.getnframes(), int(start * sr))))
        raw = w.readframes(max(0, int((end - start) * sr)))
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def load_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def _frame_spectral(frame: np.ndarray, sr: int) -> tuple[float, float]:
    """Return (spectral centroid Hz, spectral flatness) for one analysis frame."""
    if frame.size < 64:
        return 0.0, 0.0
    win = frame * np.hanning(frame.size)
    mag = np.abs(np.fft.rfft(win)) + 1e-9
    freqs = np.fft.rfftfreq(frame.size, 1.0 / sr)
    centroid = float((mag * freqs).sum() / mag.sum())
    flatness = float(np.exp(np.mean(np.log(mag))) / np.mean(mag))
    return centroid, flatness


def compute_audio_features(wav_path: Path, token: CancelToken | None = None) -> dict[str, Any]:
    """Energy envelope (dBFS), spectral centroid/flatness, waveform peaks.

    Streaming: memory use is bounded by the chunk size regardless of length.
    """
    hop_s = 1.0 / ENVELOPE_HZ
    rms_db: list[float] = []
    peaks: list[float] = []
    centroid: list[float] = []
    flatness: list[float] = []
    carry = np.zeros(0, dtype=np.float32)
    sr = ANALYSIS_SR
    for sr, chunk in iter_wav_chunks(wav_path):
        if token:
            token.check()
        data = np.concatenate([carry, chunk])
        hop = int(sr * hop_s)
        n = data.size // hop
        if n == 0:
            carry = data
            continue
        frames = data[: n * hop].reshape(n, hop)
        carry = data[n * hop :]
        r = np.sqrt(np.mean(frames**2, axis=1) + 1e-12)
        rms_db.extend((20 * np.log10(r)).tolist())
        peaks.extend(np.max(np.abs(frames), axis=1).tolist())
        for f in frames[::2]:  # spectral features at 10 Hz is plenty
            c, fl = _frame_spectral(f, sr)
            centroid.extend([c, c])
            flatness.extend([fl, fl])
    centroid = centroid[: len(rms_db)]
    flatness = flatness[: len(rms_db)]
    arr = np.array(rms_db, dtype=np.float32) if rms_db else np.zeros(1, dtype=np.float32)
    voiced = arr[arr > -50]
    stats = {
        "mean_db": float(np.mean(voiced)) if voiced.size else -90.0,
        "p90_db": float(np.percentile(voiced, 90)) if voiced.size else -90.0,
        "p10_db": float(np.percentile(arr, 10)),
        "noise_floor_db": float(np.percentile(arr, 5)),
        "clipping_ratio": float(np.mean(np.array(peaks) > 0.99)) if peaks else 0.0,
    }
    return {
        "hz": ENVELOPE_HZ,
        "rms_db": [round(x, 2) for x in rms_db],
        "centroid": [round(x, 1) for x in centroid],
        "flatness": [round(x, 4) for x in flatness],
        "stats": stats,
        "sample_rate": sr,
    }


def waveform_peaks(features: dict[str, Any], wav_path: Path | None = None, per_second: int = 20) -> list[int]:
    """Compact 0-255 waveform peaks for the timeline UI."""
    if wav_path is not None and wav_path.exists():
        peaks: list[float] = []
        hop = ANALYSIS_SR // per_second
        carry = np.zeros(0, dtype=np.float32)
        for _sr, chunk in iter_wav_chunks(wav_path):
            data = np.concatenate([carry, chunk])
            n = data.size // hop
            peaks.extend(np.max(np.abs(data[: n * hop].reshape(n, hop)), axis=1).tolist() if n else [])
            carry = data[n * hop :]
        return [int(min(255, p * 255 * 1.2)) for p in peaks]
    db = np.array(features.get("rms_db") or [], dtype=np.float32)
    return [int(max(0, min(255, (d + 60) / 60 * 255))) for d in db]


def detect_silences(features: dict[str, Any], threshold_db: float | None = None, min_dur: float = 0.35) -> list[tuple[float, float]]:
    """Silence intervals from the energy envelope with an adaptive threshold."""
    db = np.array(features.get("rms_db") or [], dtype=np.float32)
    if db.size == 0:
        return []
    hz = features.get("hz", ENVELOPE_HZ)
    if threshold_db is None:
        floor = features["stats"]["noise_floor_db"]
        speech = features["stats"]["mean_db"]
        threshold_db = max(floor + 6, min(speech - 18, -35))
    quiet = db < threshold_db
    out: list[tuple[float, float]] = []
    start = None
    for i, q in enumerate(quiet):
        if q and start is None:
            start = i
        elif not q and start is not None:
            if (i - start) / hz >= min_dur:
                out.append((start / hz, i / hz))
            start = None
    if start is not None and (len(quiet) - start) / hz >= min_dur:
        out.append((start / hz, len(quiet) / hz))
    return out


def energy_in_range(features: dict[str, Any], t0: float, t1: float) -> np.ndarray:
    hz = features.get("hz", ENVELOPE_HZ)
    db = features.get("rms_db") or []
    a = max(0, int(t0 * hz))
    b = max(a + 1, int(t1 * hz))
    return np.array(db[a:b] or [-90.0], dtype=np.float32)
