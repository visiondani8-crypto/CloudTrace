"""Neural speaker embeddings without PyTorch (optional).

Runs the GE2E voice encoder published with Resemblyzer (Apache-2.0; 3-layer LSTM over 40
mel bands → 256-d d-vector) in plain numpy. The weights are *not* bundled: the user installs
them once, explicitly — from a Resemblyzer wheel they already have, or downloaded from PyPI
on request — and they are converted to a local .npz. Without them, diarisation falls back to
the spectral heuristic.

Front-end matches Resemblyzer: 16 kHz audio, volume normalised up to −30 dBFS, a power
mel spectrogram (25 ms Hann window, 10 ms hop, 40 Slaney mel bands, reflect-padded centred
STFT — librosa's ``melspectrogram`` defaults of its era), 1.6 s partial windows at 1.3 per
second whose embeddings are averaged and L2-normalised.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import zipfile
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

log = logging.getLogger(__name__)

SR = 16000
N_FFT = 400
HOP = 160
N_MELS = 40
PARTIAL_FRAMES = 160
WHEEL_NAME = "Resemblyzer-0.1.4-py3-none-any.whl"
WHEEL_URL = ("https://files.pythonhosted.org/packages/d9/b5/d897d5de5b2123a1ad5d32e8e007d83f76582f5c32c60992577263bd7c7e/"
             + WHEEL_NAME)
WHEEL_SHA256 = "8f12eb2f1a9982d32e8db7856de754709b59c93a77bcf0ff536584b619a9dd1f"
WEIGHTS_SHA256 = "39373b86598fa3da9fcddee6142382efe09777e8d37dc9c0561f41f0070f134e"  # resemblyzer/pretrained.pt
MODEL_FILE = "voice_encoder_resemblyzer_0.1.4.npz"
_KEYS = [f"lstm.{w}_l{k}" for k in range(3) for w in ("weight_ih", "weight_hh", "bias_ih", "bias_hh")] + ["linear.weight", "linear.bias"]


# ----------------------------------------------------------------------------- install
def model_path() -> Path:
    from ..config import get_config

    return get_config().models_dir / MODEL_FILE


def status() -> dict[str, Any]:
    p = model_path()
    if p.exists():
        return {"installed": True, "path": str(p), "source": "Resemblyzer 0.1.4 voice encoder (Apache-2.0)", "size_mb": round(p.stat().st_size / 1e6, 1)}
    return {"installed": False, "download_mb": 15.7, "source": "Resemblyzer 0.1.4 voice encoder (Apache-2.0)",
            "how": "Settings → Transcription → Speaker detection, or: python -m clipforge.devtools.voice_model install"}


def install_from_wheel(wheel: Path | bytes) -> Path:
    """Extract + verify the pretrained weights from a Resemblyzer wheel and convert them to .npz."""
    from .torch_legacy import load_legacy_checkpoint

    data = wheel if isinstance(wheel, bytes) else Path(wheel).read_bytes()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        try:
            pt = z.read("resemblyzer/pretrained.pt")
            lic = z.read("Resemblyzer-0.1.4.dist-info/LICENSE")
        except KeyError as e:
            raise ValueError("Not a Resemblyzer 0.1.4 wheel") from e
    if hashlib.sha256(pt).hexdigest() != WEIGHTS_SHA256:
        raise ValueError("Voice encoder weights do not match the expected checksum")
    dest = model_path()
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp_pt = dest.with_suffix(".pt.tmp")
    tmp_pt.write_bytes(pt)
    try:
        state = load_legacy_checkpoint(tmp_pt)["model_state"]
    finally:
        tmp_pt.unlink(missing_ok=True)
    arrays = {k.replace(".", "__"): np.asarray(state[k], dtype=np.float32) for k in _KEYS}
    tmp = dest.with_suffix(".tmp.npz")
    np.savez(tmp, **arrays)
    tmp.replace(dest)
    dest.with_name("voice_encoder_LICENSE.txt").write_bytes(lic)
    dest.with_name("voice_encoder_SOURCE.json").write_text(json.dumps(
        {"package": "Resemblyzer 0.1.4", "url": WHEEL_URL, "weights_sha256": WEIGHTS_SHA256, "license": "Apache-2.0"}, indent=1))
    load_encoder.cache_clear()
    return dest


def download_and_install(timeout: float = 120.0) -> Path:
    """Explicit, user-initiated download of the public wheel from PyPI (no media leaves the machine)."""
    import httpx

    r = httpx.get(WHEEL_URL, timeout=timeout, follow_redirects=True)
    r.raise_for_status()
    if hashlib.sha256(r.content).hexdigest() != WHEEL_SHA256:
        raise ValueError("Downloaded wheel failed checksum verification")
    return install_from_wheel(r.content)


def remove() -> None:
    p = model_path()
    for f in (p, p.with_name("voice_encoder_LICENSE.txt"), p.with_name("voice_encoder_SOURCE.json")):
        f.unlink(missing_ok=True)
    load_encoder.cache_clear()


# ----------------------------------------------------------------------------- front-end
def _hz_to_mel(f: np.ndarray) -> np.ndarray:
    """Slaney mel scale (librosa default, htk=False)."""
    f = np.asarray(f, dtype=np.float64)
    f_sp = 200.0 / 3
    mels = f / f_sp
    min_log_hz = 1000.0
    min_log_mel = min_log_hz / f_sp
    logstep = np.log(6.4) / 27.0
    return np.where(f >= min_log_hz, min_log_mel + np.log(np.maximum(f, 1e-10) / min_log_hz) / logstep, mels)


def _mel_to_hz(m: np.ndarray) -> np.ndarray:
    m = np.asarray(m, dtype=np.float64)
    f_sp = 200.0 / 3
    min_log_hz = 1000.0
    min_log_mel = min_log_hz / f_sp
    logstep = np.log(6.4) / 27.0
    return np.where(m >= min_log_mel, min_log_hz * np.exp(logstep * (m - min_log_mel)), f_sp * m)


@lru_cache(maxsize=1)
def mel_filterbank() -> np.ndarray:
    """librosa.filters.mel(sr=16000, n_fft=400, n_mels=40) — Slaney scale and area normalisation."""
    fftfreqs = np.linspace(0, SR / 2, 1 + N_FFT // 2)
    mel_f = _mel_to_hz(np.linspace(_hz_to_mel(0.0), _hz_to_mel(SR / 2), N_MELS + 2))
    fdiff = np.diff(mel_f)
    ramps = mel_f[:, None] - fftfreqs[None, :]
    lower = -ramps[:-2] / fdiff[:-1, None]
    upper = ramps[2:] / fdiff[1:, None]
    weights = np.maximum(0, np.minimum(lower, upper))
    weights *= (2.0 / (mel_f[2 : N_MELS + 2] - mel_f[:N_MELS]))[:, None]
    return weights.astype(np.float32)


def mel_spectrogram(wav: np.ndarray) -> np.ndarray:
    """Power mel spectrogram, shape (frames, 40) — not log-compressed (as the encoder expects)."""
    y = np.pad(wav.astype(np.float32), N_FFT // 2, mode="reflect")
    n_frames = 1 + (len(y) - N_FFT) // HOP
    window = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT)).astype(np.float32)  # periodic Hann
    frames = np.lib.stride_tricks.as_strided(y, shape=(n_frames, N_FFT), strides=(y.strides[0] * HOP, y.strides[0]))
    power = np.abs(np.fft.rfft(frames * window, axis=1)) ** 2
    return (power @ mel_filterbank().T).astype(np.float32)


def normalize_volume(wav: np.ndarray, target_dbfs: float = -30.0) -> np.ndarray:
    rms = float(np.sqrt(np.mean((wav * 32767.0) ** 2)) + 1e-9)
    change = target_dbfs - 20 * np.log10(rms / 32767.0)
    return wav if change < 0 else wav * (10 ** (change / 20))


def trim_silence(wav: np.ndarray, frame: int = 480, keep: int = 6) -> np.ndarray:
    """Energy-based stand-in for Resemblyzer's VAD trim: drop silent runs longer than ``keep`` 30 ms windows."""
    n = len(wav) // frame
    if n < 3:
        return wav
    e = np.sqrt((wav[: n * frame].reshape(n, frame) ** 2).mean(axis=1) + 1e-12)
    voiced = e > max(1e-4, 0.1 * np.percentile(e, 90))
    keep_mask = voiced.copy()
    for k in range(1, keep + 1):  # dilate voiced regions
        keep_mask[k:] |= voiced[:-k]
        keep_mask[:-k] |= voiced[k:]
    return wav[: n * frame][np.repeat(keep_mask, frame)] if keep_mask.any() else wav


# ----------------------------------------------------------------------------- network
def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 0.5 * (1.0 + np.tanh(0.5 * x))  # numerically stable logistic


class VoiceEncoder:
    def __init__(self, weights: dict[str, np.ndarray]):
        self.w = weights

    def forward(self, mels: np.ndarray) -> np.ndarray:
        """mels: (batch, frames, 40) → L2-normalised embeddings (batch, 256). PyTorch LSTM gate order i, f, g, o."""
        x = mels.astype(np.float32)
        B, T, _ = x.shape
        h = None
        for k in range(3):
            Wih, Whh = self.w[f"lstm__weight_ih_l{k}"], self.w[f"lstm__weight_hh_l{k}"]
            b = self.w[f"lstm__bias_ih_l{k}"] + self.w[f"lstm__bias_hh_l{k}"]
            H = Whh.shape[1]
            xp = x @ Wih.T + b  # (B, T, 4H): input projection for all steps at once
            h = np.zeros((B, H), np.float32)
            c = np.zeros((B, H), np.float32)
            out = np.empty((B, T, H), np.float32)
            WhhT = Whh.T.copy()
            for t in range(T):
                g = xp[:, t] + h @ WhhT
                i, f, gg, o = _sigmoid(g[:, :H]), _sigmoid(g[:, H : 2 * H]), np.tanh(g[:, 2 * H : 3 * H]), _sigmoid(g[:, 3 * H :])
                c = f * c + i * gg
                h = o * np.tanh(c)
                out[:, t] = h
            x = out
        e = np.maximum(0.0, h @ self.w["linear__weight"].T + self.w["linear__bias"])
        return e / (np.linalg.norm(e, axis=1, keepdims=True) + 1e-9)

    def embed_utterance(self, wav: np.ndarray, rate: float = 1.3, min_coverage: float = 0.75, preprocess: bool = True) -> np.ndarray | None:
        """d-vector of one utterance (16 kHz float audio), or None when it is too short to judge."""
        if preprocess:
            wav = trim_silence(normalize_volume(wav))
        if len(wav) < SR * 0.6:
            return None
        mel = mel_spectrogram(wav)
        n_frames = mel.shape[0]
        step = int(round(SR / rate / HOP))
        starts = list(range(0, max(1, n_frames - PARTIAL_FRAMES + step + 1), step))
        last = starts[-1]
        coverage = (len(wav) - last * HOP) / (PARTIAL_FRAMES * HOP)
        if coverage < min_coverage and len(starts) > 1:
            starts = starts[:-1]
        need = starts[-1] + PARTIAL_FRAMES
        if need > n_frames:
            mel = np.pad(mel, ((0, need - n_frames), (0, 0)))
        batch = np.stack([mel[s : s + PARTIAL_FRAMES] for s in starts])
        e = self.forward(batch).mean(axis=0)
        return e / (np.linalg.norm(e) + 1e-9)


@lru_cache(maxsize=1)
def load_encoder() -> VoiceEncoder | None:
    p = model_path()
    if not p.exists():
        return None
    try:
        with np.load(p) as z:
            w = {k: z[k] for k in z.files}
        missing = [k for k in _KEYS if k.replace(".", "__") not in w]
        if missing:
            raise ValueError(f"missing {missing}")
        return VoiceEncoder(w)
    except Exception:
        log.exception("Voice encoder model at %s is unreadable; using spectral diarisation", p)
        return None
