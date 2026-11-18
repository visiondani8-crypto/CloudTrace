"""Unit tests: transcript parsing, timecodes, segmentation, candidates, scoring, selection."""

from __future__ import annotations

import pytest

from clipforge.analysis import highlights as hl
from clipforge.analysis.features import sentence_features
from clipforge.analysis.modes import parse_instructions
from clipforge.analysis.segment import build_sentences, topic_segments
from clipforge.analysis.text import TfIdf, is_topic_phrase, keyphrases, stem, tokenize
from clipforge.transcribe.subtitles import cues_to_srt, cues_to_vtt, cues_to_words, fmt_ts, parse_subtitles, parse_ts


def _transcript(sentences: list[tuple[float, str]], punct: bool = True, wps: float = 2.8, gap: float = 0.7):
    """Build a word-timed transcript; sentences are laid out sequentially with ``gap`` s pauses."""
    segs = []
    wid = 0
    t_next = sentences[0][0]
    for _start, text in sentences:
        words = []
        t = t_next
        for tok in text.split():
            d = max(0.12, len(tok) / (wps * 5))
            words.append({"w": tok if punct else tok.strip(".,?!").lower(), "s": round(t, 3), "e": round(t + d, 3), "p": 0.95, "i": wid})
            wid += 1
            t += d + 0.04
        t_next = words[-1]["e"] + gap
        segs.append({"start": words[0]["s"], "end": words[-1]["e"], "text": text, "words": words})
    return {"segments": segs, "has_punctuation": punct}


SCRIPT = [
    (0.5, "Hey guys, welcome back to the show."),
    (3.5, "What is the biggest money mistake most beginners make?"),
    (7.0, "Honestly, the biggest mistake is waiting too long to start investing."),
    (11.0, "Compound interest needs time to work."),
    (13.5, "If you invest one hundred dollars a month from age twenty five, you end up with far more."),
    (19.0, "So the lesson is simple. Start early, even if the amount is small."),
    (25.0, "And then we kind of went to the place and it was fine I guess."),
    (31.0, "Let me tell you a story about a password manager."),
    (34.0, "It stores every password in an encrypted vault."),
    (37.0, "That means one strong password protects all the others."),
    (41.0, "Thanks for watching and don't forget to subscribe."),
]


def test_tokenize_and_stem():
    assert tokenize("Don't stop, it's GREAT!") == ["don't", "stop", "it's", "great"]
    assert stem("investing") == stem("invest") == "invest"
    assert stem("passwords") == "password"


def test_keyphrases_and_topic_filter():
    texts = ["A password manager stores every password.", "One strong password protects the password manager vault."]
    kp = keyphrases(texts, TfIdf(texts), top=5)
    assert any("password" in k for k in kp)
    assert not is_topic_phrase("slept four") and not is_topic_phrase("start") and is_topic_phrase("password manager")


@pytest.mark.parametrize("t,expect", [(0, "00:00:00,000"), (61.5, "00:01:01,500"), (3725.042, "01:02:05,042")])
def test_timecode_format(t, expect):
    assert fmt_ts(t) == expect
    assert abs(parse_ts(expect) - t) < 1e-3


def test_srt_vtt_roundtrip():
    cues = [{"start": 1.0, "end": 2.5, "text": "Hello there"}, {"start": 3.0, "end": 4.25, "text": "General Kenobi"}]
    assert parse_subtitles(cues_to_srt(cues)) == cues
    assert parse_subtitles(cues_to_vtt(cues)) == cues
    words = cues_to_words(cues)
    assert [w["w"] for w in words] == ["Hello", "there", "General", "Kenobi"]
    assert words[0]["s"] == 1.0 and abs(words[1]["e"] - 2.5) < 1e-6


def test_parse_subtitles_rejects_garbage():
    with pytest.raises(ValueError):
        parse_subtitles("this is not a subtitle file")


def test_sentence_segmentation_punctuated():
    sents = build_sentences(_transcript(SCRIPT))
    assert len(sents) == len(SCRIPT) + 1  # "So the lesson is simple." + "Start early…" split on the period
    assert sents[1]["is_question"]
    for s in sents:
        assert s["start"] < s["end"]


def test_sentence_segmentation_without_punctuation_uses_pauses():
    tr = _transcript(SCRIPT, punct=False)
    sents = build_sentences(tr)
    # Every scripted sentence boundary has a 0.7 s pause, so they all survive.
    starts = [s["start"] for s in sents]
    for seg in tr["segments"]:
        assert any(abs(seg["start"] - x) < 0.01 for x in starts)
    assert sents[1]["is_question"]  # interrogative-word heuristic


def _scored(min_d=8.0, max_d=20.0, mode="podcast", instructions=""):
    tr = _transcript(SCRIPT)
    sents = build_sentences(tr)
    tfidf = TfIdf([s["text"] for s in sents])
    topics = topic_segments(sents, tfidf, min_seconds=8)
    ins = parse_instructions(instructions)
    feats = sentence_features(sents, tfidf, None, None, topics, None, ins)
    ctx = hl.make_context(mode, ins, "tiktok", min_d, max_d, True, 0.0)
    words = [w for s in tr["segments"] for w in s["words"]]
    by = {w["i"]: w for w in words}
    wbs = [[by[k] for k in range(s["w0"], s["w1"] + 1)] for s in sents]
    cands = hl.generate_candidates(sents, sents[-1]["end"] + 1.0, [], min_d, max_d)
    scored = [hl.score_candidate(c, sents, feats, tfidf, ctx, wbs, None, None, []) for c in cands]
    return sents, tfidf, feats, scored


def test_candidates_respect_sentence_boundaries_and_duration():
    sents, _, _, scored = _scored()
    starts = {s["start"] for s in sents}
    ends = {s["end"] for s in sents}
    assert scored
    for c in scored:
        assert 8.0 - 1e-6 <= c["end"] - c["start"] <= 20.0 + 1e-6
        # padding only: the clip never starts inside a sentence
        assert any(0 <= st - c["start"] <= 0.26 for st in starts)
        assert any(0 <= c["end"] - en <= 0.46 for en in ends)


def test_score_breakdown_is_explainable_and_bounded():
    _, _, _, scored = _scored()
    for c in scored:
        total = sum(f["points"] for f in c["breakdown"].values()) + sum(a["points"] for a in c["adjustments"])
        assert abs(max(0, min(100, total)) - c["score"]) < 0.25
        for f in c["breakdown"].values():
            assert 0 <= f["points"] <= f["max"] + 1e-6
        assert sum(f["max"] for f in c["breakdown"].values()) == pytest.approx(100.0)


def test_scoring_is_reproducible():
    a = _scored()[3]
    b = _scored()[3]
    assert [c["score"] for c in a] == [c["score"] for c in b]


def test_question_answer_clip_beats_intro_and_rambling():
    sents, _, _, scored = _scored()
    best = max(scored, key=lambda c: c["score"])
    assert sents[best["s0"]]["text"].startswith("What is the biggest money mistake")
    intro = [c for c in scored if c["s0"] == 0]
    if intro:
        assert max(c["score"] for c in intro) < best["score"] - 10


def test_selection_removes_overlaps_and_respects_threshold():
    sents, tfidf, feats, scored = _scored()
    sel, stats = hl.select_highlights(scored, sents, tfidf, feats, count=10, min_score=None, source_duration=60)
    for i, a in enumerate(sel):
        for b in sel[i + 1 :]:
            inter = max(0, min(a["end"], b["end"]) - max(a["start"], b["start"]))
            assert inter / min(a["end"] - a["start"], b["end"] - b["start"]) <= 0.25
    assert stats["returned"] == len(sel) <= 10
    # A strict threshold returns fewer clips instead of padding with weak ones.
    sel2, stats2 = hl.select_highlights(scored, sents, tfidf, feats, count=10, min_score=95, source_duration=60)
    assert len(sel2) < len(sel) or not sel2
    assert "note" in stats2


def test_custom_instructions_change_scoring():
    ins = parse_instructions("Find the funniest moments between 20 and 45 seconds and avoid clips with long pauses, nothing about crypto")
    assert ins.min_duration == 20 and ins.max_duration == 45
    assert ins.boost_cues.get("humor", 1) > 1.5
    assert ins.pause_penalty > 1
    assert "crypto" in ins.avoid_terms
    base = {(c["s0"], c["s1"]): c["score"] for c in _scored()[3]}
    focused = {(c["s0"], c["s1"]): c["score"] for c in _scored(instructions="clips about password security")[3]}
    pw = [k for k in base if any("password" in s for s in [SCRIPT[min(k[0], len(SCRIPT) - 1)][1].lower()])]
    assert pw and all(focused[k] > base[k] for k in pw if k in focused)


def test_explanations_are_grounded():
    sents, tfidf, _, scored = _scored()
    best = max(scored, key=lambda c: c["score"])
    ex = hl.explain(best, sents, tfidf, hl.MODES["podcast"])
    clip_text = " ".join(s["text"] for s in sents[best["s0"] : best["s1"] + 1])
    assert ex["title"].rstrip("…").rstrip(".") in clip_text
    assert ex["hook"] == sents[best["s0"]]["text"]
    assert ex["reason"]
