"""Candidate generation, explainable scoring, selection and explanations.

Design:
1. Every candidate is a contiguous run of *complete sentences*, so clips never
   begin or end mid-sentence. Boundaries get context padding from the
   surrounding pauses and are snapped to scene cuts to avoid flash frames.
2. Each candidate is scored on seven editorial factors. Each factor is a raw
   value in [0, 1] built from named pieces of evidence; points = raw × the
   factor's configurable maximum for the active content mode.
3. Selection is greedy with temporal non-maximum suppression, transcript
   similarity filtering and a topic-diversity penalty, and stops when quality
   falls below the threshold — fewer, better clips rather than filler.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .modes import FACTOR_LABELS, FACTORS, MODES, PLATFORMS, Instructions, ModeConfig
from .text import TfIdf, cosine, keyphrases, title_case, truncate_words

DURATION_PRESETS = {
    "10-20": (10.0, 20.0),
    "20-35": (20.0, 35.0),
    "35-60": (35.0, 60.0),
    "60-90": (60.0, 90.0),
    "90-180": (90.0, 180.0),
    "30-60": (30.0, 60.0),
    "auto": (18.0, 75.0),
}

HOOK_CUE_W = {"howto": 0.24, "question": 0.24, "direct_address": 0.18, "warning": 0.24, "bold": 0.2, "surprise": 0.24, "story": 0.18,
              "opinion": 0.16, "humor": 0.16, "emotion": 0.14, "specific": 0.1, "excitement": 0.22, "sports": 0.16,
              "finance": 0.04, "education": 0.04}


@dataclass
class ScoringContext:
    mode: ModeConfig
    instructions: Instructions
    platform: str
    min_dur: float
    max_dur: float
    has_punct: bool
    speaker_conf: float
    factor_max: dict[str, float] = field(default_factory=dict)

    def cue_w(self, cue: str) -> float:
        return self.mode.cue_weights.get(cue, 1.0) * self.instructions.boost_cues.get(cue, 1.0)


def make_context(mode_key: str, instructions: Instructions, platform: str, min_dur: float, max_dur: float,
                 has_punct: bool, speaker_conf: float, factor_overrides: dict[str, float] | None = None) -> ScoringContext:
    mode = MODES.get(mode_key, MODES["podcast"])
    fm = dict(mode.factor_max)
    if factor_overrides:
        fm.update({k: float(v) for k, v in factor_overrides.items() if k in FACTORS})
    total = sum(fm.values()) or 1.0
    fm = {k: v * 100.0 / total for k, v in fm.items()}  # always sums to 100
    return ScoringContext(mode, instructions, platform, min_dur, max_dur, has_punct, speaker_conf, fm)


# --------------------------------------------------------------------------- candidates

def generate_candidates(sentences, duration: float, scene_cuts: list[float], min_dur: float, max_dur: float,
                        fast: bool = False) -> list[dict[str, Any]]:
    n = len(sentences)
    out: list[dict[str, Any]] = []
    cuts = sorted(scene_cuts or [])
    for i in range(n):
        si = sentences[i]
        if fast and i > 0 and si["pause_before"] < 0.25:
            continue
        prev_end = sentences[i - 1]["end"] if i > 0 else 0.0
        pad_in = min(0.25, max(0.0, (si["start"] - prev_end) * 0.5))
        start = max(0.0, si["start"] - pad_in)
        for j in range(i, n):
            sj = sentences[j]
            next_start = sentences[j + 1]["start"] if j + 1 < n else duration
            pad_out = min(0.45, max(0.0, (next_start - sj["end"]) * 0.6))
            end = min(duration, sj["end"] + pad_out)
            dur = end - start
            if dur > max_dur:
                break
            if dur < min_dur:
                continue
            s_adj, e_adj = _snap_to_cuts(start, si["start"], end, sj["end"], cuts)
            out.append({"s0": i, "s1": j, "start": round(s_adj, 3), "end": round(e_adj, 3)})
    return out


def _snap_to_cuts(start: float, speech_start: float, end: float, speech_end: float, cuts: list[float]) -> tuple[float, float]:
    """Avoid one-frame flashes of a neighbouring shot at clip edges."""
    for c in cuts:
        if start - 0.6 <= c <= speech_start - 0.02:
            start = max(start, c + 0.04) if c > start else c + 0.04
        if speech_end + 0.02 <= c <= end + 0.6:
            end = min(end, c - 0.04)
    if end - start < 0.5:
        return start, max(end, start + 0.5)
    return start, end


# --------------------------------------------------------------------------- scoring

def _clip01(x: float) -> float:
    return max(0.0, min(1.0, x))


def score_candidate(c: dict[str, Any], sentences, feats, tfidf: TfIdf, ctx: ScoringContext,
                    words_by_sentence: list[list[dict[str, Any]]], visual: dict[str, Any] | None,
                    audio: dict[str, Any] | None, scene_cuts: list[float]) -> dict[str, Any]:
    i, j = c["s0"], c["s1"]
    S = sentences
    F = feats
    first, last = S[i], S[j]
    f0, fl = F[i], F[j]
    dur = c["end"] - c["start"]
    ev: dict[str, list[str]] = {k: [] for k in FACTORS}
    issues: list[str] = []
    adjustments: list[dict[str, Any]] = []

    # ---------------- coherence
    coh = 0.55
    if first["pause_before"] >= 0.35 or i == 0:
        coh += 0.12
        ev["coherence"].append("Starts after a natural pause")
    if f0["topic_start"]:
        coh += 0.05
        ev["coherence"].append("Starts at a topic boundary")
    if f0["neg"].get("dependent_open"):
        coh -= 0.22
        issues.append(f"Opens with “{first['text'].split()[0]}” — may depend on earlier context")
    elif f0["neg"].get("pronoun_open"):
        coh -= 0.1
        issues.append("Opens with a pronoun that may refer to something said earlier")
    if f0["neg"].get("backchannel_open"):
        coh -= 0.15
    complete_end = (last["text"].rstrip().endswith((".", "!", "?")) if ctx.has_punct else last["pause_after"] >= 0.6)
    if complete_end and not fl["neg"].get("trailing"):
        coh += 0.12
        ev["coherence"].append("Ends on a completed thought")
    else:
        coh -= 0.15
        issues.append("May end mid-thought")
    if j + 1 < len(S):
        nxt = F[j + 1]
        if nxt["neg"].get("dependent_open") and last["pause_after"] < 0.5:
            coh -= 0.15
            issues.append(f"Next sentence continues the thought (“{S[j + 1]['text'][:40]}…”)")
    if i > 0 and S[i - 1]["is_question"] and first["pause_before"] < 1.2 and not first["is_question"]:
        coh -= 0.1 * (1 + ctx.mode.qa_bonus / 4)
        issues.append("Answers a question that is not included in the clip")
    # Lexical cohesion: how tightly the sentences share vocabulary
    if j > i:
        cen = tfidf.range_vector(i, j)
        sims = [cosine(tfidf.doc_vector(k), cen) for k in range(i, j + 1) if tfidf.doc_terms[k]]
        cohesion = float(np.mean(sims)) if sims else 0.2
        coh += _clip01((cohesion - 0.15) / 0.35) * 0.15
        if cohesion > 0.35:
            ev["coherence"].append("Sentences stay on one subject")
    topic_changes = len({F[k]["topic"] for k in range(i, j + 1)}) - 1
    if topic_changes:
        coh -= 0.12 * min(2, topic_changes)
        issues.append("Crosses a topic change")
    if any(F[k]["neg"].get("outro") for k in range(i, j + 1)):
        coh -= 0.2
        issues.append("Includes a sign-off/outro")
    q_idx = [k for k in range(i, min(j, i + 2) + 1) if S[k]["is_question"]]
    if q_idx and j - q_idx[0] >= 2:
        coh += 0.05 + 0.02 * ctx.mode.qa_bonus
        ev["coherence"].append("Contains a question and its answer")
    if ctx.speaker_conf > 0.3:
        spk = [F[k]["speaker"] for k in range(i, j + 1)]
        turns = sum(1 for a, b in zip(spk, spk[1:]) if a != b)
        if turns >= 2 and ctx.mode.exchange_bonus:
            coh += 0.02 * min(3, turns) * ctx.mode.exchange_bonus / 3
            ev["coherence"].append(f"Back-and-forth exchange ({turns} speaker changes)")
        if turns >= 3 and ctx.instructions.prefer_single_speaker:
            coh -= 0.15
    coh = _clip01(coh)

    # ---------------- hook
    hook = 0.18
    hook_s = [i] + ([i + 1] if first["n_words"] < 5 and i + 1 <= j else [])
    for k_idx, k in enumerate(hook_s):
        scale = 1.0 if k_idx == 0 else 0.5
        for cue, n in F[k]["cues"].items():
            w = HOOK_CUE_W.get(cue, 0.0)
            if w:
                hook += w * min(1.5, 0.75 + 0.25 * n) * ctx.cue_w(cue) * scale
                ev["hook"].append(_cue_label(cue))
    if 4 <= first["n_words"] <= 16:
        hook += 0.1
        ev["hook"].append(f"Short, punchy opening line ({first['n_words']} words)")
    elif first["n_words"] > 30:
        hook -= 0.1
        issues.append("Long opening sentence delays the hook")
    if f0["energy_z"] > 0.5:
        hook += 0.1 * min(1.0, f0["energy_z"]) * (0.5 + ctx.mode.audio_peak_weight)
        ev["hook"].append("Energetic delivery at the start")
    if f0["neg"].get("greeting"):
        hook -= 0.3 * (1.6 if ctx.instructions.avoid_intros else 1.0)
        issues.append("Starts with an intro/greeting")
    if f0["neg"].get("backchannel_open"):
        hook -= 0.2
    if f0["neg"].get("dependent_open"):
        hook -= 0.12
    if f0["fillers"]:
        hook -= 0.08
    hook = _clip01(hook)

    # ---------------- payoff
    pay = 0.15
    tail = list(range(max(i, j - 1), j + 1))
    pay_cues = sum(F[k]["cues"].get("payoff", 0) for k in tail)
    if pay_cues:
        pay += 0.35 * min(1.4, pay_cues) * ctx.cue_w("payoff") / max(1.0, ctx.cue_w("payoff") ** 0.5)
        ev["payoff"].append("Ends with a conclusion or takeaway")
    explains = sum(F[k]["cues"].get("explain", 0) for k in range(i, j + 1))
    if explains:
        pay += min(0.15, 0.05 * explains) * ctx.cue_w("explain")
        ev["payoff"].append("Includes an explanation")
    if (first["is_question"] or f0["cues"].get("story")) and (pay_cues or complete_end):
        pay += 0.15
        ev["payoff"].append("Resolves the question/story it opens with")
    humor_tail = sum(F[k]["cues"].get("humor", 0) for k in tail)
    if humor_tail:
        pay += 0.15 * min(1.5, ctx.cue_w("humor"))
        ev["payoff"].append("Lands on a humorous beat")
    late = [F[k]["energy_peak_z"] for k in range(i, j + 1) if S[k]["start"] >= c["start"] + dur * 0.55]
    if late and max(late) > 1.0:
        pay += 0.1 * ctx.mode.audio_peak_weight + 0.05
        ev["payoff"].append("Energy peak in the second half")
    if complete_end:
        pay += 0.1
    if last["is_question"] and j + 1 < len(S) and last["pause_after"] < 1.0:
        pay -= 0.12
        issues.append("Ends on an unanswered question")
    pay = _clip01(pay)

    # ---------------- clarity
    ws = [w for k in range(i, j + 1) for w in words_by_sentence[k]]
    conf = float(np.mean([w["p"] for w in ws])) if ws else 0.0
    cla = _clip01((conf - 0.4) / 0.5) * 0.5
    speech_time = sum(S[k]["end"] - S[k]["start"] for k in range(i, j + 1))
    speech_ratio = speech_time / max(0.1, dur)
    cla += _clip01((speech_ratio - 0.5) / 0.4) * 0.3
    long_pauses = [(a["e"], b["s"] - a["e"]) for a, b in zip(ws, ws[1:]) if b["s"] - a["e"] > 1.0]
    if long_pauses:
        cla -= min(0.4, 0.08 * len(long_pauses) * ctx.instructions.pause_penalty)
        worst = max(long_pauses, key=lambda x: x[1])
        issues.append(f"{len(long_pauses)} long pause(s), longest {worst[1]:.1f}s at {_mmss(worst[0] - c['start'])}")
    fill = sum(F[k]["fillers"] for k in range(i, j + 1))
    if ws and fill / len(ws) > 0.03:
        cla -= min(0.2, fill / len(ws) * 3)
        issues.append(f"{fill} filler words (can be removed automatically)")
    if audio:
        snr = audio["stats"]["mean_db"] - audio["stats"]["noise_floor_db"]
        cla += _clip01((snr - 12) / 20) * 0.2
        if audio["stats"].get("clipping_ratio", 0) > 0.002:
            cla -= 0.1
            issues.append("Audio clipping detected in source")
    if conf >= 0.8:
        ev["clarity"].append(f"Clear speech ({conf * 100:.0f}% transcription confidence)")
    elif conf < 0.55:
        issues.append(f"Low transcription confidence ({conf * 100:.0f}%) — review captions")
    if speech_ratio > 0.85:
        ev["clarity"].append("Little dead air")
    cla = _clip01(cla)

    # ---------------- visual
    if visual and visual.get("samples"):
        rng = [F[k] for k in range(i, j + 1)]
        face = float(np.mean([x["face"] for x in rng]))
        mz = float(np.mean([x["motion_z"] for x in rng]))
        bright = float(np.mean([x["brightness"] for x in rng]))
        n_cuts = sum(1 for t in scene_cuts if c["start"] < t < c["end"])
        mw = ctx.mode.motion_weight
        vis = 0.25
        vis += face * 0.45 * (1 - mw * 0.6)
        vis += _clip01((mz + 0.5) / 2.0) * 0.4 * mw
        vis += min(0.15, n_cuts / max(1.0, dur / 15.0) * 0.08)
        if 0.18 <= bright <= 0.85:
            vis += 0.08
        else:
            issues.append("Very dark or very bright footage")
        if face > 0.6:
            ev["visual"].append("Speaker visible on screen")
        if mz > 0.5:
            ev["visual"].append("High on-screen action")
        if n_cuts:
            ev["visual"].append(f"{n_cuts} shot change(s)")
        if face < 0.1 and not ctx.mode.preserve_full_frame:
            issues.append("No faces detected — check framing")
        vis = _clip01(vis)
    else:
        vis = 0.5
        ev["visual"].append("No visual analysis available (neutral)")

    # ---------------- novelty
    rng_f = [F[k] for k in range(i, j + 1)]
    distinct = float(np.mean([x["distinct"] for x in rng_f if x["n_terms"]] or [0.4]))
    nov = _clip01((distinct - 0.35) / 0.45) * 0.5
    spec = sum(x["cues"].get("specific", 0) for x in rng_f)
    nov += min(0.2, spec * 0.05) * ctx.cue_w("specific")
    insight = sum(x["cues"].get(k, 0) for x in rng_f for k in ("payoff", "explain", "opinion", "surprise", "warning"))
    nov += min(0.25, insight * 0.05)
    boost_hits = sum(x["boost_hits"] for x in rng_f)
    if boost_hits:
        nov += min(0.3, 0.1 * boost_hits)
        ev["novelty"].append("Matches your focus topics")
    terms = sum(x["n_terms"] for x in rng_f)
    uniq = sum(x["unique_terms"] for x in rng_f)
    if terms > 20 and uniq / terms < 0.45:
        nov -= 0.1
        issues.append("Repetitive wording")
    if distinct > 0.6:
        ev["novelty"].append("Distinctive vocabulary for this video")
    if spec:
        ev["novelty"].append("Contains specific details or figures")
    if insight >= 2:
        ev["novelty"].append("Several insight/opinion markers")
    nov = _clip01(nov)

    # ---------------- platform fit
    prof = PLATFORMS.get(ctx.platform, PLATFORMS["tiktok"])
    lo, hi = prof["ideal"]
    if lo <= dur <= hi:
        dfit = 1.0
        ev["platform"].append(f"{dur:.0f}s is in the {prof['label']} sweet spot ({lo}–{hi}s)")
    elif dur > prof["max"]:
        dfit = 0.0
        issues.append(f"Longer than {prof['label']} allows ({prof['max']}s)")
    elif dur < lo:
        dfit = _clip01(1 - (lo - dur) / lo)
    else:
        dfit = _clip01(1 - (dur - hi) / max(1.0, prof["max"] - hi))
    wps = sum(S[k]["n_words"] for k in range(i, j + 1)) / max(0.1, dur)
    pace = 1.0 if 2.0 <= wps <= 3.9 else _clip01(1 - abs(wps - 2.9) / 2.5)
    if wps < 1.5:
        issues.append(f"Slow pacing ({wps:.1f} words/s) — consider silence removal")
    plat = 0.7 * dfit + 0.3 * pace

    raw = {"coherence": coh, "hook": hook, "payoff": pay, "clarity": cla, "visual": vis, "novelty": nov, "platform": plat}
    pts = {k: raw[k] * ctx.factor_max[k] for k in FACTORS}
    total = sum(pts.values())

    # ---------------- instruction-driven adjustments (explicit, shown in breakdown)
    ins = ctx.instructions
    avoid = sum(x["avoid_hits"] for x in rng_f)
    if avoid:
        adjustments.append({"label": "Mentions a topic you asked to avoid", "points": -15.0})
    if ins.avoid_profanity and any(x["neg"].get("profanity") for x in rng_f):
        adjustments.append({"label": "Contains profanity", "points": -20.0})
    if ins.avoid_intros and any(x["neg"].get("greeting") for x in rng_f):
        adjustments.append({"label": "Contains intro/greeting", "points": -10.0})
    if boost_hits:
        adjustments.append({"label": "Matches your focus instructions", "points": min(8.0, 3.0 * boost_hits)})
    if ins.min_duration and dur < ins.min_duration - 0.5:
        adjustments.append({"label": "Shorter than your requested duration", "points": -25.0})
    if ins.max_duration and dur > ins.max_duration + 0.5:
        adjustments.append({"label": "Longer than your requested duration", "points": -25.0})
    total += sum(a["points"] for a in adjustments)
    total = max(0.0, min(100.0, total))

    breakdown = {
        k: {"label": FACTOR_LABELS[k], "points": round(pts[k], 1), "max": round(ctx.factor_max[k], 1),
            "raw": round(raw[k], 3), "evidence": _dedupe(ev[k])[:4]}
        for k in FACTORS
    }
    return {
        **c,
        "duration": round(dur, 2),
        "score": round(total, 1),
        "breakdown": breakdown,
        "adjustments": adjustments,
        "issues": _dedupe(issues)[:6],
        "metrics": {"confidence": round(conf, 3), "speech_ratio": round(speech_ratio, 3), "wps": round(wps, 2),
                    "fillers": fill, "long_pauses": len(long_pauses), "topic_changes": topic_changes},
    }


def _cue_label(cue: str) -> str:
    return {
        "question": "Opens with a question", "direct_address": "Speaks directly to the viewer",
        "warning": "Opens with a warning or mistake", "bold": "Bold claim up front", "surprise": "Surprising statement",
        "story": "Starts a story", "howto": "Promises an explanation (\u201chere's how\u201d)", "opinion": "Strong opinion", "humor": "Humour", "emotion": "Emotional language",
        "specific": "Concrete specifics", "excitement": "Excited reaction", "sports": "Big sporting moment",
        "finance": "Money topic", "education": "Learning topic",
    }.get(cue, cue)


_PROPER = {"TikTok", "Instagram", "YouTube", "Facebook", "LinkedIn", "X", "LLM", "I"}


def _lower_first(s: str) -> str:
    first = s.split(" ", 1)[0]
    if first in _PROPER or first[:1].isdigit() or (len(first) > 1 and first[1].isupper()):
        return s
    return s[:1].lower() + s[1:]


def _dedupe(xs: list[str]) -> list[str]:
    seen: set[str] = set()
    out = []
    for x in xs:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _mmss(t: float) -> str:
    t = max(0.0, t)
    return f"{int(t // 60)}:{int(t % 60):02d}"


# --------------------------------------------------------------------------- selection

def select_highlights(scored: list[dict[str, Any]], sentences, tfidf: TfIdf, feats, count: int | None,
                      min_score: float | None, source_duration: float) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not scored:
        return [], {"reason": "No candidate windows matched the duration range."}
    ranked = sorted(scored, key=lambda c: (-c["score"], c["start"]))
    best = ranked[0]["score"]
    auto_count = int(round(min(20, max(5, source_duration / 300.0))))
    target = count or auto_count
    floor = min_score if min_score is not None else max(40.0, best - 30.0)
    selected: list[dict[str, Any]] = []
    vecs: list[dict[str, float]] = []
    topic_uses: dict[int, int] = {}
    rejected = {"overlap": 0, "similar": 0, "below_threshold": 0}
    pool = ranked[:4000]
    # MMR-style: re-rank with a topic diversity penalty each round
    while len(selected) < target and pool:
        best_c, best_adj = None, -1e9
        for c in pool[:600]:
            t = feats[c["s0"]]["topic"]
            adj = c["score"] - 4.0 * topic_uses.get(t, 0)
            if adj > best_adj:
                best_c, best_adj = c, adj
        if best_c is None:
            break
        pool.remove(best_c)
        if best_c["score"] < floor:
            rejected["below_threshold"] += 1
            break
        if any(_overlap(best_c, s) > 0.25 for s in selected):
            rejected["overlap"] += 1
            continue
        v = tfidf.range_vector(best_c["s0"], best_c["s1"])
        if any(cosine(v, u) > 0.6 for u in vecs):
            rejected["similar"] += 1
            continue
        selected.append(best_c)
        vecs.append(v)
        t = feats[best_c["s0"]]["topic"]
        topic_uses[t] = topic_uses.get(t, 0) + 1
        # Prune heavily-overlapping candidates early for speed.
        pool = [c for c in pool if _overlap(c, best_c) <= 0.25]
    stats = {
        "candidates": len(scored),
        "target": target,
        "auto_count": auto_count,
        "threshold": round(floor, 1),
        "best_score": best,
        "rejected": rejected,
        "returned": len(selected),
    }
    if len(selected) < target:
        stats["note"] = (f"Only {len(selected)} clip(s) met the quality threshold ({floor:.0f}). "
                         "Lower the minimum score or widen the duration range to see more.")
    return selected, stats


def _overlap(a: dict[str, Any], b: dict[str, Any]) -> float:
    inter = max(0.0, min(a["end"], b["end"]) - max(a["start"], b["start"]))
    shorter = min(a["end"] - a["start"], b["end"] - b["start"])
    return inter / shorter if shorter > 0 else 0.0


# --------------------------------------------------------------------------- explanations

DOMAINS = {
    "personal finance and investing": {"invest", "money", "stock", "debt", "budget", "sav", "retir", "tax", "interest", "compound", "wealth", "income", "credit", "loan", "inflation", "portfolio"},
    "entrepreneurs and business builders": {"business", "startup", "custom", "market", "sale", "product", "company", "founder", "revenue", "client", "brand", "hire"},
    "tech enthusiasts": {"software", "code", "app", "computer", "phone", "tech", "data", "program", "internet", "ai", "model", "algorithm"},
    "fitness and health audiences": {"workout", "train", "muscle", "diet", "health", "sleep", "protein", "weight", "run", "exercise", "body", "fitness"},
    "gamers": {"game", "play", "level", "boss", "team", "match", "rank", "spawn", "loot", "kill", "gameplay"},
    "sports fans": {"goal", "team", "season", "coach", "player", "match", "championship", "score", "league"},
    "learners and students": {"learn", "study", "school", "lesson", "understand", "teach", "student", "skill", "practice"},
    "people interested in relationships and self-improvement": {"relationship", "friend", "partner", "habit", "mindset", "confidence", "anxiety", "happy", "life"},
    "food lovers": {"cook", "recipe", "food", "eat", "kitchen", "taste", "restaurant"},
    "travellers": {"travel", "trip", "flight", "hotel", "country", "city", "visit"},
}


def guess_audience(terms: set[str], mode: ModeConfig) -> str:
    best, best_n = None, 0
    for label, keys in DOMAINS.items():
        n = len(terms & keys)
        if n > best_n:
            best, best_n = label, n
    if best and best_n >= 1:
        return best[:1].upper() + best[1:]
    return {
        "podcast": "Podcast listeners who like strong conversations",
        "interview": "Viewers who follow interviews and expert answers",
        "educational": "Learners looking for clear explanations",
        "gaming": "Gamers and stream viewers",
        "sports": "Sports fans",
        "entertainment": "General entertainment audiences",
        "business": "Professionals interested in business insights",
    }.get(mode.key, "General short-form audiences")


def explain(c: dict[str, Any], sentences, tfidf: TfIdf, mode: ModeConfig) -> dict[str, Any]:
    i, j = c["s0"], c["s1"]
    texts = [s["text"] for s in sentences[i : j + 1]]
    kp = keyphrases(texts, tfidf, top=4)
    first = sentences[i]["text"].strip()
    title = _make_title(sentences, i, j, kp)
    terms = {t for k in range(i, j + 1) for t in tfidf.doc_terms[k]}
    bd = c["breakdown"]
    strengths = sorted(bd.items(), key=lambda kv: -(kv[1]["raw"]))
    parts = []
    for _k, v in strengths:
        if v["evidence"] and v["raw"] >= 0.55 and not v["evidence"][0].startswith("No visual"):
            e = v["evidence"][0]
            parts.append(_lower_first(e) if parts else e)
        if len(parts) >= 3:
            break
    reason = ("; ".join(parts) + ".") if parts else "Best available complete passage in this range, but no strong editorial signals."
    if c["score"] < 50:
        reason += " Moderate score — review before using."
    return {
        "title": title,
        "topic": " · ".join(kp[:3]) if kp else "General",
        "hook": truncate_words(first, 140),
        "reason": reason[:1].upper() + reason[1:],
        "audience": guess_audience(terms, mode),
        "keywords": kp,
    }


def _make_title(sentences, i: int, j: int, kp: list[str]) -> str:
    """Title grounded in the clip's own words (no invented claims).

    Scores the opening sentences: questions and hook cues win, the first
    sentence gets a bonus, and ~8 words is the preferred length.
    """
    from .modes import cue_hits, negative_hits

    best, best_v = None, -1e9
    for k in range(i, min(j, i + 3) + 1):
        t = sentences[k]["text"].strip().rstrip(".")
        n = len(t.split())
        if not 3 <= n <= 16:
            continue
        cues = cue_hits(t)
        neg = negative_hits(t)
        v = 2.0 * sentences[k]["is_question"]
        v += 1.5 * any(c in cues for c in ("howto", "warning", "bold", "surprise", "opinion", "payoff"))
        v += 0.8 * ("story" in cues) + (1.0 if k == i else 0.0)
        v -= 0.15 * abs(n - 8)
        v -= 1.5 * bool(neg.get("dependent_open") or neg.get("pronoun_open") or neg.get("backchannel_open") or neg.get("greeting"))
        if v > best_v:
            best, best_v = t, v
    if best:
        return truncate_words(best[:1].upper() + best[1:], 70)
    if kp:
        return title_case(" & ".join(kp[:2]))
    return truncate_words(sentences[i]["text"], 60)


def choose_thumbnail_time(c: dict[str, Any], sentences, visual: dict[str, Any] | None) -> float:
    s = sentences[c["s0"]]
    t = min(c["end"] - 0.1, s["start"] + min(1.5, (s["end"] - s["start"]) / 2))
    if visual and visual.get("samples"):
        fps = visual["sample_fps"]
        best, best_v = t, -1.0
        for x in visual["samples"][int(c["start"] * fps) : int(min(c["end"], c["start"] + 10) * fps)]:
            v = (1.0 if x["faces"] else 0.0) + 0.3 * (0.2 < x["brightness"] < 0.85) - 0.5 * x["motion"]
            if v > best_v:
                best, best_v = x["t"], v
        return float(best)
    return float(t)


def default_count(duration: float) -> int:
    return int(min(20, max(5, math.ceil(duration / 300.0))))
