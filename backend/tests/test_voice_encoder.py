"""Optional neural speaker embeddings: checkpoint reader, front-end, network, clustering.

The real-weights test needs the Resemblyzer 0.1.4 wheel on disk (no network in tests):
CLIPFORGE_TEST_VOICE_WHEEL=/path/to/Resemblyzer-0.1.4-py3-none-any.whl
"""

from __future__ import annotations

import collections
import os
import pickle
import struct
import subprocess
import sys
import types
from pathlib import Path

import numpy as np
import pytest

FIXTURES = Path(__file__).resolve().parent / "fixtures"
WHEEL = os.environ.get("CLIPFORGE_TEST_VOICE_WHEEL")


# ----------------------------------------------------------------------------- legacy checkpoint reader
def _write_legacy_checkpoint(path: Path, monkeypatch, malicious: bool = False) -> np.ndarray:
    """Write a file in torch's legacy format using stand-in torch globals (PyTorch is not installed)."""
    torch = types.ModuleType("torch")
    utils = types.ModuleType("torch._utils")

    class FloatStorage:
        pass

    def _rebuild_tensor_v2(*_a):
        raise AssertionError("never called while writing")

    FloatStorage.__module__, FloatStorage.__qualname__ = "torch", "FloatStorage"
    _rebuild_tensor_v2.__module__, _rebuild_tensor_v2.__qualname__ = "torch._utils", "_rebuild_tensor_v2"
    torch.FloatStorage, torch._utils, utils._rebuild_tensor_v2 = FloatStorage, utils, _rebuild_tensor_v2
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(sys.modules, "torch._utils", utils)

    data = np.arange(12, dtype=np.float32) * 0.5

    class Ref:
        key = "140230"

    class T:
        def __init__(self, offset, size, stride):
            self.args = (Ref(), offset, size, stride, False, collections.OrderedDict())

        def __reduce__(self):
            return (_rebuild_tensor_v2, self.args)

    class Evil:
        def __reduce__(self):
            return (os.system, ("echo pwned",))

    class P(pickle.Pickler):
        def persistent_id(self, obj):
            if isinstance(obj, Ref):
                return ("storage", FloatStorage, obj.key, "cpu", data.size, None)
            return None

    state = collections.OrderedDict(a=T(0, (3, 4), (4, 1)), at=T(0, (4, 3), (1, 4)), every_other=T(2, (5,), (2,)))
    obj = {"step": 7, "model_state": state, **({"x": Evil()} if malicious else {})}
    with open(path, "wb") as fh:
        for header in (0x1950A86A20F9469CFC6C, 1001, {"protocol_version": 1001, "little_endian": True}):
            pickle.dump(header, fh, protocol=2)
        P(fh, protocol=2).dump(obj)
        pickle.dump(["140230"], fh, protocol=2)
        fh.write(struct.pack("<q", data.size) + data.tobytes())
    return data


def test_legacy_checkpoint_reader_rebuilds_strided_tensors(tmp_path, monkeypatch):
    from clipforge.media.torch_legacy import load_legacy_checkpoint

    data = _write_legacy_checkpoint(tmp_path / "ok.pt", monkeypatch)
    ck = load_legacy_checkpoint(tmp_path / "ok.pt")
    st = ck["model_state"]
    assert ck["step"] == 7 and list(st) == ["a", "at", "every_other"]
    np.testing.assert_array_equal(st["a"], data.reshape(3, 4))
    np.testing.assert_array_equal(st["at"], data.reshape(3, 4).T)
    np.testing.assert_array_equal(st["every_other"], data[2:12:2])


def test_legacy_checkpoint_reader_refuses_code(tmp_path, monkeypatch):
    from clipforge.media.torch_legacy import load_legacy_checkpoint

    _write_legacy_checkpoint(tmp_path / "evil.pt", monkeypatch, malicious=True)
    with pytest.raises(pickle.UnpicklingError, match="Refusing to load"):
        load_legacy_checkpoint(tmp_path / "evil.pt")
    (tmp_path / "zip.pt").write_bytes(b"PK\x03\x04rest")
    with pytest.raises(ValueError, match="zip-format"):
        load_legacy_checkpoint(tmp_path / "zip.pt")


# ----------------------------------------------------------------------------- front-end + network
def test_mel_front_end_matches_librosa_reference():
    """Fixture made with librosa 0.10.2 melspectrogram(sr=16k, n_fft=400, hop=160, n_mels=40, pad_mode=reflect)."""
    from clipforge.media.voice_encoder import mel_spectrogram

    sr = 16000
    t = np.arange(int(1.5 * sr)) / sr
    rng = np.random.default_rng(1234)
    y = (0.3 * np.sin(2 * np.pi * (180 + 120 * t) * t) + 0.15 * np.sin(2 * np.pi * (900 + 600 * t) * t)
         + 0.05 * np.sin(2 * np.pi * 3100 * t) + 0.01 * rng.standard_normal(t.size)).astype(np.float32)
    ref = np.load(FIXTURES / "mel_reference.npz")["mel"]
    ours = mel_spectrogram(y)
    assert ours.shape == ref.shape
    assert np.abs(ours - ref).max() <= 1e-5 * ref.max()


def _random_weights(rng) -> dict[str, np.ndarray]:
    w = {}
    for k in range(3):
        n_in = 40 if k == 0 else 256
        w[f"lstm__weight_ih_l{k}"] = rng.normal(0, 0.1, (1024, n_in)).astype(np.float32)
        w[f"lstm__weight_hh_l{k}"] = rng.normal(0, 0.1, (1024, 256)).astype(np.float32)
        w[f"lstm__bias_ih_l{k}"] = rng.normal(0, 0.1, 1024).astype(np.float32)
        w[f"lstm__bias_hh_l{k}"] = rng.normal(0, 0.1, 1024).astype(np.float32)
    w["linear__weight"] = rng.normal(0, 0.1, (256, 256)).astype(np.float32)
    w["linear__bias"] = rng.normal(0, 0.1, 256).astype(np.float32)
    return w


def test_batched_lstm_matches_step_by_step_reference():
    from clipforge.media.voice_encoder import VoiceEncoder

    rng = np.random.default_rng(0)
    w = _random_weights(rng)
    mels = rng.random((2, 12, 40)).astype(np.float32)
    got = VoiceEncoder(w).forward(mels)

    def sig(x):
        return 1 / (1 + np.exp(-x))

    for b in range(2):
        seq = [mels[b, t].astype(np.float64) for t in range(12)]
        for k in range(3):
            h, c, out = np.zeros(256), np.zeros(256), []
            for x in seq:
                z = w[f"lstm__weight_ih_l{k}"] @ x + w[f"lstm__bias_ih_l{k}"] + w[f"lstm__weight_hh_l{k}"] @ h + w[f"lstm__bias_hh_l{k}"]
                i, f, g, o = sig(z[:256]), sig(z[256:512]), np.tanh(z[512:768]), sig(z[768:])
                c = f * c + i * g
                h = o * np.tanh(c)
                out.append(h)
            seq = out
        e = np.maximum(0, w["linear__weight"] @ seq[-1] + w["linear__bias"])
        np.testing.assert_allclose(got[b], e / np.linalg.norm(e), atol=2e-5)


# ----------------------------------------------------------------------------- clustering
class _FakeEncoder:
    """Hands out queued embeddings, one per sentence in order (None = too short to embed)."""

    def __init__(self):
        self.queue: list[np.ndarray | None] = []

    def embed_utterance(self, _wav):
        return self.queue.pop(0)


def _sentences(n: int) -> list[dict]:
    return [{"start": i * 2.0, "end": i * 2.0 + 1.8, "text": f"s{i}"} for i in range(n)]


def test_neural_clustering_finds_speaker_count(tmp_path):
    import wave

    from clipforge.analysis.segment import neural_speaker_turns

    wav = tmp_path / "x.wav"
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(np.zeros(16000 * 60, np.int16).tobytes())
    rng = np.random.default_rng(3)
    centres = rng.normal(0, 1, (3, 256))
    truth = [0, 0, 1, 1, 0, 2, 2, 1, 0, 2, 1, 1, 0, 2, 0, 1, 2, 0]

    def emb(k):
        v = np.abs(centres[k] + rng.normal(0, 0.35, 256))
        return v / np.linalg.norm(v)

    enc = _FakeEncoder()
    enc.queue = [emb(k) for k in truth]
    r = neural_speaker_turns(_sentences(len(truth)), wav, enc)
    assert r["count"] == 3 and r["confidence"] > 0.5
    remap = {}
    for t, lab in zip(truth, r["labels"]):
        remap.setdefault(t, lab)
    assert [remap[t] for t in truth] == r["labels"] and r["labels"][0] == 0  # speaker 0 talks first
    # One voice throughout → one speaker; un-embeddable short sentences inherit the previous label.
    enc.queue = [emb(0) for _ in range(9)] + [None]
    one = neural_speaker_turns(_sentences(10), wav, enc)
    assert one["count"] == 1 and set(one["labels"]) == {0}


# ----------------------------------------------------------------------------- real weights (opt-in)
@pytest.mark.skipif(not WHEEL, reason="set CLIPFORGE_TEST_VOICE_WHEEL to the Resemblyzer 0.1.4 wheel")
def test_real_voice_encoder_separates_the_podcast_voices(data_dir, podcast_video, tmp_path):
    import zipfile

    from clipforge.analysis.segment import speaker_turns
    from clipforge.media import voice_encoder as ve

    bad = tmp_path / "tampered.whl"
    with zipfile.ZipFile(WHEEL) as src, zipfile.ZipFile(bad, "w") as dst:
        for item in src.infolist():
            payload = src.read(item)
            dst.writestr(item, payload[:-1] + b"\x00" if item.filename.endswith("pretrained.pt") else payload)
    with pytest.raises(ValueError, match="checksum"):
        ve.install_from_wheel(bad)
    assert ve.status()["installed"] is False
    ve.install_from_wheel(Path(WHEEL))
    assert ve.status()["installed"] and ve.load_encoder() is not None
    wav = tmp_path / "p.wav"
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i", podcast_video["video"], "-ac", "1", "-ar", "16000",
                    "-c:a", "pcm_s16le", str(wav)], check=True)
    sents = [dict(s) for s in podcast_video["sentences"]]
    r = speaker_turns(sents, wav, encoder=ve.load_encoder())
    assert r["method"].startswith("neural") and r["count"] == 2
    first = {}
    for s, lab in zip(sents, r["labels"]):
        first.setdefault(s["speaker"], lab)
    assert sum(first[s["speaker"]] == lab for s, lab in zip(sents, r["labels"])) == len(sents)
    ve.remove()
    assert ve.load_encoder() is None
