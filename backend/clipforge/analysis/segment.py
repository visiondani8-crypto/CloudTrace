"""Structure extraction: sentences, topic segments and (experimental) speaker turns."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import numpy as np

from ..media.audio import ANALYSIS_SR, load_wav_segment
from .text import TfIdf, cosine, is_topic_phrase, keyphrases, title_case

_ABBREV = re.compile(r"\b(mr|mrs|ms|dr|prof|st|vs|etc|e\.g|i\.e|inc|ltd|jr|sr|no|vol|approx)\.$", re.I)
_END = re.compile(r"[.!?]+[\"')\]]*$")
_INTERROGATIVE = re.compile(r"^(why|how|what|when|where|who|which|is|are|do|does|did|can|could|would|should|have you|ever wonder|isn't|aren't|don't|doesn't)\b", re.I)
_DISCOURSE = {"so", "but", "and", "because", "anyway", "now", "okay", "ok", "well", "then"}


def build_sentences(transcript: dict[str, Any], max_words: int = 40) -> list[dict[str, Any]]:
    words = [w for s in transcript.get("segments", []) for w in s.get("words", [])]
    punct = transcript.get("has_punctuation", True)
    sentences: list[dict[str, Any]] = []
    cur: list[dict[str, Any]] = []

    def flush() -> None:
        if not cur:
            return
        text = " ".join(w["w"] for w in cur).strip()
        text = re.sub(r"\s+([,.!?;:])", r"\1", text)
        sentences.append({
            "id": len(sentences),
            "start": cur[0]["s"],
            "end": cur[-1]["e"],
            "text": text,
            "w0": cur[0]["i"],
            "w1": cur[-1]["i"],
            "n_words": len(cur),
            "conf": float(np.mean([w["p"] for w in cur])),
        })
        cur.clear()

    for _k, w in enumerate(words):
        if cur:
            gap = w["s"] - cur[-1]["e"]
            prev = cur[-1]["w"]
            ends = bool(_END.search(prev)) and not _ABBREV.search(prev)
            lw = re.sub(r"\W", "", w["w"].lower())
            if punct:
                if ends or gap > 1.5 or len(cur) >= max_words + 15:
                    flush()
            else:
                # No punctuation: use pauses, discourse markers and length.
                if gap > 0.55 or (gap > 0.3 and lw in _DISCOURSE and len(cur) >= 6) or len(cur) >= max_words:
                    flush()
        cur.append(w)
    flush()
    merged: list[dict[str, Any]] = []
    for snt in sentences:
        if merged and snt["n_words"] <= 1 and snt["end"] - snt["start"] < 0.4 and snt["start"] - merged[-1]["end"] < 0.3:
            m = merged[-1]
            m["end"], m["w1"], m["n_words"] = snt["end"], snt["w1"], m["n_words"] + snt["n_words"]
            m["text"] = m["text"] + " " + snt["text"]
            continue
        merged.append(snt)
    sentences = merged
    for i, s in enumerate(sentences):
        s["id"] = i
        s["pause_before"] = round(s["start"] - sentences[i - 1]["end"], 3) if i > 0 else round(s["start"], 3)
        s["pause_after"] = round(sentences[i + 1]["start"] - s["end"], 3) if i + 1 < len(sentences) else 2.0
        txt = s["text"].strip()
        s["is_question"] = txt.endswith("?") or (not punct and bool(_INTERROGATIVE.match(txt)))
        dur = max(0.2, s["end"] - s["start"])
        s["wps"] = round(s["n_words"] / dur, 2)
    return sentences


def topic_segments(sentences: list[dict[str, Any]], tfidf: TfIdf, min_seconds: float = 45.0, window: int = 4,
                   scene_cuts: list[float] | None = None) -> list[dict[str, Any]]:
    """TextTiling-style lexical cohesion segmentation, reinforced by long
    pauses and scene cuts at the same position (multimodal boundary evidence)."""
    n = len(sentences)
    if n == 0:
        return []
    if n < window * 2 + 2:
        return [_mk_topic(0, n - 1, sentences, tfidf, 0)]
    gaps = []
    for g in range(1, n):
        a = tfidf.range_vector(max(0, g - window), g - 1)
        b = tfidf.range_vector(g, min(n - 1, g + window - 1))
        gaps.append(cosine(a, b))
    sims = np.array(gaps)
    # Depth score at each gap
    depth = np.zeros_like(sims)
    for i in range(len(sims)):
        lpeak = max(sims[max(0, i - window * 2) : i + 1])
        rpeak = max(sims[i : min(len(sims), i + window * 2 + 1)])
        depth[i] = (lpeak - sims[i]) + (rpeak - sims[i])
    # Multimodal boost: a long pause and/or a scene cut at a gap supports a boundary.
    cuts = sorted(scene_cuts or [])
    for i in range(len(depth)):
        g = i + 1
        pause = sentences[g]["start"] - sentences[g - 1]["end"]
        boost = 0.0
        if pause >= 0.9:
            boost += min(0.25, 0.1 + (pause - 0.9) * 0.1)
        if any(sentences[g - 1]["end"] - 0.5 <= c <= sentences[g]["start"] + 0.5 for c in cuts):
            boost += 0.15
        depth[i] += boost
    thresh = float(depth.mean() + depth.std() * 0.5) if depth.size else 1.0
    cands = [i for i in np.argsort(-depth) if depth[i] > thresh]
    bounds: list[int] = []
    for i in cands:
        g = int(i) + 1  # boundary before sentence g
        t = sentences[g]["start"]
        if all(abs(t - sentences[b]["start"]) >= min_seconds for b in bounds) and t >= min_seconds and sentences[-1]["end"] - t >= min_seconds:
            bounds.append(g)
    bounds.sort()
    topics = []
    start = 0
    for k, b in enumerate(bounds + [n]):
        topics.append(_mk_topic(start, b - 1, sentences, tfidf, k))
        start = b
    return topics


def _mk_topic(i: int, j: int, sentences, tfidf: TfIdf, k: int) -> dict[str, Any]:
    texts = [s["text"] for s in sentences[i : j + 1]]
    kp_all = keyphrases(texts, tfidf, top=8)
    kp = [k for k in kp_all if is_topic_phrase(k)][:4] or kp_all[:4]
    return {
        "id": k,
        "s0": i,
        "s1": j,
        "start": sentences[i]["start"],
        "end": sentences[j]["end"],
        "keywords": kp,
        "label": title_case(" · ".join(kp[:2])) if kp else f"Section {k + 1}",
    }


# ----------------------------------------------------------------------- speaker turns (experimental)

def _mel_filterbank(sr: int, n_fft: int, n_mels: int = 24) -> np.ndarray:
    def hz2mel(h):
        return 2595 * np.log10(1 + h / 700.0)

    def mel2hz(m):
        return 700 * (10 ** (m / 2595.0) - 1)

    mels = np.linspace(hz2mel(80), hz2mel(sr / 2 - 200), n_mels + 2)
    hz = mel2hz(mels)
    bins = np.floor((n_fft + 1) * hz / sr).astype(int)
    fb = np.zeros((n_mels, n_fft // 2 + 1))
    for m in range(1, n_mels + 1):
        a, b, c = bins[m - 1], bins[m], bins[m + 1]
        for k in range(a, b):
            fb[m - 1, k] = (k - a) / max(1, b - a)
        for k in range(b, c):
            fb[m - 1, k] = (c - k) / max(1, c - b)
    return fb


NEURAL_ONE_SPEAKER = 0.80  # if even the two most different groups are this alike, it is one voice


def _silhouette(sim: np.ndarray, labels: np.ndarray) -> float:
    """Mean silhouette with cosine distance (1 - similarity)."""
    dist = 1.0 - sim
    ks = np.unique(labels)
    if len(ks) < 2:
        return -1.0
    s = []
    for i in range(len(labels)):
        own = labels == labels[i]
        n_own = own.sum() - 1
        if n_own == 0:
            s.append(0.0)
            continue
        a = dist[i, own].sum() / n_own
        b = min(dist[i, labels == k].mean() for k in ks if k != labels[i])
        s.append((b - a) / max(a, b, 1e-9))
    return float(np.mean(s))


def neural_speaker_turns(sentences: list[dict[str, Any]], wav: Path, encoder, max_speakers: int = 4) -> dict[str, Any] | None:
    """Speaker labels from neural d-vectors (see media/voice_encoder.py).

    One embedding per sentence (up to 10 s of audio). Average-linkage agglomerative clustering on
    cosine similarity gives a partition for every speaker count; the count is the one with the best
    silhouette score (2…max_speakers), or one speaker when even the best split leaves groups that
    sound alike. Stray single-sentence clusters join their nearest speaker; sentences too short to
    embed inherit the previous label.
    """
    embs: dict[int, np.ndarray] = {}
    for i, s in enumerate(sentences):
        e = encoder.embed_utterance(load_wav_segment(wav, s["start"], min(s["end"], s["start"] + 10.0)))
        if e is not None:
            embs[i] = e
    if len(embs) < 2:
        return None
    idx = sorted(embs)
    X = np.array([embs[i] for i in idx])
    sim = X @ X.T
    n = len(idx)

    def link(a: list[int], b: list[int]) -> float:
        return float(sim[np.ix_(a, b)].mean())

    # Full merge history; keep the partitions for k = 1..max_speakers.
    clusters = [[k] for k in range(n)]
    partitions: dict[int, list[list[int]]] = {}
    while len(clusters) > 1:
        if len(clusters) <= max_speakers:
            partitions[len(clusters)] = [list(c) for c in clusters]
        best, bi, bj = -2.0, -1, -1
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                v = link(clusters[i], clusters[j])
                if v > best:
                    best, bi, bj = v, i, j
        clusters[bi] = clusters[bi] + clusters.pop(bj)
    partitions[1] = [list(range(n))]
    min_size = max(2, int(0.05 * n))

    def tidy(parts: list[list[int]]) -> list[list[int]]:
        big = [list(c) for c in parts if len(c) >= min_size] or [list(max(parts, key=len))]
        for c in parts:
            if len(c) < min_size and c not in big:
                max(big, key=lambda b: link(c, b)).extend(c)
        return big

    scored = []
    for k in range(2, min(max_speakers, n - 1) + 1):
        if k in partitions:
            parts = tidy(partitions[k])
            lab = np.empty(n, int)
            for m, c in enumerate(parts):
                lab[c] = m
            scored.append((_silhouette(sim, lab), len(parts), parts))
    best_parts = [list(range(n))]
    if scored:
        sil, _, parts = max(scored, key=lambda x: (round(x[0], 3), -x[1]))
        between = min(link(a, b) for m, a in enumerate(parts) for b in parts[m + 1 :]) if len(parts) > 1 else 1.0
        if len(parts) > 1 and sil > 0.05 and between < NEURAL_ONE_SPEAKER:
            best_parts = parts
    best_parts.sort(key=min)  # speaker 0 = first to talk
    label_of = {idx[k]: m for m, c in enumerate(best_parts) for k in c}
    labels, last = [], 0
    for i in range(len(sentences)):
        last = label_of.get(i, last)
        labels.append(last)
    if len(best_parts) > 1:
        lab = np.empty(n, int)
        for m, c in enumerate(best_parts):
            lab[c] = m
        conf = _silhouette(sim, lab) / 0.4
    else:
        conf = (float(sim[~np.eye(n, dtype=bool)].mean()) - 0.6) / 0.3
    return {"labels": labels, "count": len(best_parts), "confidence": round(float(max(0.0, min(1.0, conf))), 3),
            "method": "neural (Resemblyzer voice encoder)", "embedded": n}


def speaker_turns(sentences: list[dict[str, Any]], wav: Path, max_speakers: int = 4, encoder=None) -> dict[str, Any]:
    """Speaker labels per sentence: neural d-vectors when the optional voice encoder is installed
    (``encoder``), otherwise spectral voice signatures.

    Experimental heuristic (no neural diarisation model): mean/std of log-mel
    energies per sentence, cepstral mean normalisation, agglomerative
    clustering with a cosine threshold. Returns labels plus a confidence.
    """
    if len(sentences) < 2 or not wav.exists():
        return {"labels": [0] * len(sentences), "count": 1, "confidence": 0.0, "method": "none"}
    if encoder is not None:
        res = neural_speaker_turns(sentences, wav, encoder, max_speakers)
        if res is not None:
            return res
    n_fft = 512
    hop = 160
    fb = _mel_filterbank(ANALYSIS_SR, n_fft)
    win = np.hanning(n_fft)
    feats = []
    valid = []
    for s in sentences:
        y = load_wav_segment(wav, s["start"], min(s["end"], s["start"] + 8.0))
        if y.size < n_fft * 4:
            feats.append(None)
            continue
        frames = np.lib.stride_tricks.sliding_window_view(y, n_fft)[::hop]
        spec = np.abs(np.fft.rfft(frames * win, axis=1)) ** 2
        mel = np.log(spec @ fb.T + 1e-8)
        energy = mel.mean(axis=1)
        voiced = mel[energy > np.percentile(energy, 40)]
        if voiced.shape[0] < 5:
            feats.append(None)
            continue
        # DCT → cepstra, drop c0 (loudness)
        n = voiced.shape[1]
        dct = np.cos(np.pi / n * (np.arange(n)[:, None] + 0.5) * np.arange(n)[None, :])
        cep = voiced @ dct
        v = np.concatenate([cep[:, 1:13].mean(axis=0), cep[:, 1:13].std(axis=0) * 0.5])
        feats.append(v)
        valid.append(len(feats) - 1)
    if len(valid) < 2:
        return {"labels": [0] * len(sentences), "count": 1, "confidence": 0.0, "method": "spectral"}
    X = np.array([feats[i] for i in valid])
    X = X - X.mean(axis=0)
    X = X / (np.linalg.norm(X, axis=1, keepdims=True) + 1e-9)
    # Agglomerative clustering (average linkage, cosine distance)
    clusters = [[i] for i in range(len(X))]
    cents = [X[i].copy() for i in range(len(X))]
    threshold = 0.85  # cosine distance merge threshold

    def dist(a, b):
        return 1.0 - float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))

    while len(clusters) > 1:
        best = (1e9, -1, -1)
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                d = dist(cents[i], cents[j])
                if d < best[0]:
                    best = (d, i, j)
        d, i, j = best
        if d > threshold and len(clusters) <= max_speakers:
            break
        clusters[i].extend(clusters[j])
        cents[i] = X[clusters[i]].mean(axis=0)
        del clusters[j], cents[j]
    # Drop tiny clusters into nearest big cluster
    sizes = [len(c) for c in clusters]
    big = [k for k, sz in enumerate(sizes) if sz >= max(2, int(0.08 * len(X)))] or [int(np.argmax(sizes))]
    label_of = {}
    for k, c in enumerate(clusters):
        tgt = k if k in big else min(big, key=lambda b: dist(cents[k], cents[b]))
        for idx in c:
            label_of[valid[idx]] = big.index(tgt)
    labels = []
    last = 0
    for i in range(len(sentences)):
        last = label_of.get(i, last)
        labels.append(last)
    # Confidence: separation between cluster centroids vs within-cluster spread
    conf = 0.0
    if len(big) > 1:
        within = np.mean([np.mean([dist(X[idx], cents[k]) for idx in clusters[k]]) for k in big])
        between = np.mean([dist(cents[a], cents[b]) for a in big for b in big if a < b])
        conf = float(max(0.0, min(1.0, (between - within) / max(between, 1e-6))))
    return {"labels": labels, "count": len(big), "confidence": round(conf, 3), "method": "spectral-clustering (experimental)"}
