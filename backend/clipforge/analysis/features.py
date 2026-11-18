"""Per-sentence multimodal features (text cues, audio energy, visual activity)."""

from __future__ import annotations

import re
from typing import Any

import numpy as np

from ..media.audio import energy_in_range
from ..media.visual import samples_in_range
from .modes import FILLERS, SOFT_FILLERS, Instructions, cue_hits, negative_hits
from .text import TfIdf, content_terms


def sentence_features(
    sentences: list[dict[str, Any]],
    tfidf: TfIdf,
    audio: dict[str, Any] | None,
    visual: dict[str, Any] | None,
    topics: list[dict[str, Any]],
    speakers: dict[str, Any] | None,
    instructions: Instructions,
) -> list[dict[str, Any]]:
    a_stats = (audio or {}).get("stats") or {}
    speech_mean = a_stats.get("mean_db", -30.0)
    # Spread of sentence loudness for z-scores
    sent_db = []
    for s in sentences:
        if audio:
            e = energy_in_range(audio, s["start"], s["end"])
            sent_db.append(float(np.mean(e[e > -60])) if np.any(e > -60) else -60.0)
        else:
            sent_db.append(speech_mean)
    db_std = float(np.std(sent_db)) or 3.0
    motions = []
    if visual and visual.get("samples"):
        allm = np.array([x["motion"] for x in visual["samples"]], dtype=np.float32)
        m_mean, m_std = float(allm.mean()), float(allm.std() or 0.01)
    else:
        m_mean, m_std = 0.0, 1.0
    topic_of = {}
    for t in topics:
        for k in range(t["s0"], t["s1"] + 1):
            topic_of[k] = t["id"]
    topic_starts = {t["s0"] for t in topics}
    labels = (speakers or {}).get("labels") or [0] * len(sentences)
    feats: list[dict[str, Any]] = []
    for i, s in enumerate(sentences):
        text = s["text"]
        low = text.lower()
        toks = [re.sub(r"[^\w']", "", w.lower()) for w in text.split()]
        fillers = sum(1 for w in toks if w in FILLERS) + sum(low.count(f) for f in SOFT_FILLERS)
        terms = tfidf.doc_terms[i] if i < len(tfidf.doc_terms) else content_terms(text)
        e_peak = 0.0
        if audio:
            e = energy_in_range(audio, s["start"], s["end"])
            e_peak = float(np.max(e))
        v_samples = samples_in_range(visual, s["start"], s["end"]) if visual else []
        if v_samples:
            mot = float(np.mean([x["motion"] for x in v_samples]))
            face = float(np.mean([1.0 if x["faces"] else 0.0 for x in v_samples]))
            bright = float(np.mean([x["brightness"] for x in v_samples]))
        else:
            mot, face, bright = m_mean, 0.0, 0.5
        motions.append(mot)
        boost = sum(1 for t in terms if t in instructions.boost_terms)
        avoid = sum(1 for t in terms if t in instructions.avoid_terms)
        feats.append({
            "i": i,
            "cues": cue_hits(text),
            "neg": negative_hits(text),
            "energy_db": round(sent_db[i], 2),
            "energy_z": round((sent_db[i] - float(np.mean(sent_db))) / db_std, 3),
            "energy_peak_z": round((e_peak - speech_mean) / db_std, 3) if audio else 0.0,
            "motion": round(mot, 4),
            "motion_z": round((mot - m_mean) / m_std, 3),
            "face": round(face, 3),
            "brightness": round(bright, 3),
            "fillers": fillers,
            "distinct": round(tfidf.distinctiveness(terms), 4),
            "n_terms": len(terms),
            "unique_terms": len(set(terms)),
            "topic": topic_of.get(i, 0),
            "topic_start": i in topic_starts,
            "speaker": labels[i] if i < len(labels) else 0,
            "boost_hits": boost,
            "avoid_hits": avoid,
        })
    return feats
