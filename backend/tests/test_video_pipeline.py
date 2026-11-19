"""Video processing tests on real generated media (slow: they decode, analyse and encode)."""

from __future__ import annotations

import os
from pathlib import Path

import cv2
import numpy as np
import pytest

from conftest import Ctx, make_project

pytestmark = pytest.mark.slow

WHISPER = os.environ.get("CLIPFORGE_TEST_WHISPER_MODEL")
ENGINE = "faster-whisper" if WHISPER else "pocketsphinx"


@pytest.fixture(scope="module")
def env(tmp_path_factory):
    """Module-scoped data dir so the expensive analysis runs once."""
    from clipforge import config, db
    from clipforge.jobs import queue

    d = tmp_path_factory.mktemp("cfdata")
    old = os.environ.get("CLIPFORGE_DATA_DIR")
    os.environ["CLIPFORGE_DATA_DIR"] = str(d)
    if WHISPER:
        os.environ["CLIPFORGE_WHISPER_MODEL"] = WHISPER
    config.reset_config_cache()
    db.reset_engine()
    queue.reset_manager()
    yield d
    db.reset_engine()
    config.reset_config_cache()
    if old is None:
        os.environ.pop("CLIPFORGE_DATA_DIR", None)
    else:
        os.environ["CLIPFORGE_DATA_DIR"] = old


@pytest.fixture(scope="module")
def analysed(env, podcast_video):
    from clipforge.analysis.pipeline import latest_analysis, latest_highlights, run_analysis
    from clipforge.schemas import AnalysisSettings

    pid, sid = make_project(Path(podcast_video["video"]), "Podcast")
    ctx = Ctx()
    st = AnalysisSettings(content_mode="podcast", duration_preset="custom", min_duration=10, max_duration=35,
                          transcription_engine=ENGINE, whisper_model=WHISPER)
    run_analysis(pid, sid, st, ctx, {})
    return {"pid": pid, "sid": sid, "analysis": latest_analysis(pid), "highlights": latest_highlights(pid), "ctx": ctx, "manifest": podcast_video}


def _frame(path: Path, t: float, w: int = 160) -> np.ndarray:
    cap = cv2.VideoCapture(str(path))
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, f = cap.read()
    cap.release()
    assert ok, f"could not read frame at {t}"
    h = int(f.shape[0] * w / f.shape[1])
    return cv2.resize(f, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32)


def _render(edit_id: str, settings) -> dict:
    from clipforge.db import session_scope
    from clipforge.models import Edit, Render
    from clipforge.render.pipeline import render_edit
    from clipforge.util.files import new_id

    rid = new_id("rn_")
    with session_scope() as s:
        e = s.get(Edit, edit_id)
        s.add(Render(id=rid, project_id=e.project_id, edit_id=edit_id, status="running"))
        s.commit()
    return render_edit(edit_id, rid, settings, Ctx())


def _store_timeline(pid: str, tl) -> str:
    from clipforge.db import session_scope
    from clipforge.models import Edit
    from clipforge.util.files import new_id

    eid = new_id("ed_")
    with session_scope() as s:
        s.add(Edit(id=eid, project_id=pid, group_id=new_id("g_"), name="manual", timeline=tl.model_dump(mode="json")))
        s.commit()
    return eid


# ----------------------------------------------------------------------------- metadata

def test_probe_metadata(podcast_video, silent_video, portrait_rotated_video):
    from clipforge.media.ffprobe import probe

    info = probe(Path(podcast_video["video"]))
    assert (info["display_width"], info["display_height"]) == (1920, 1080)
    assert info["fps"] == pytest.approx(30.0) and not info["variable_frame_rate"] and not info["hdr"]
    assert info["has_audio"] and info["audio_channels"] == 2
    assert info["duration"] == pytest.approx(podcast_video["duration"], abs=0.1)
    nil = probe(silent_video)
    assert not nil["has_audio"] and any("No audio" in w for w in nil["warnings"])
    rot = probe(portrait_rotated_video)
    assert rot["rotation"] in (90, 270) and (rot["display_width"], rot["display_height"]) == (360, 640)


def test_corrupted_file_is_reported(tmp_path):
    from clipforge.media.ffprobe import ProbeError, probe

    bad = tmp_path / "broken.mp4"
    bad.write_bytes(b"\x00\x00\x00\x18ftypmp42" + os.urandom(4000))
    with pytest.raises(ProbeError) as e:
        probe(bad)
    assert "could not be read" in str(e.value).lower() or "no video" in str(e.value).lower()


# ----------------------------------------------------------------------------- analysis

def test_transcript_is_real(analysed):
    from clipforge.analysis.pipeline import load_transcript

    tr = load_transcript(analysed["pid"], analysed["sid"])
    text = " ".join(s["text"] for s in tr["segments"]).lower()
    assert tr["engine"] == ENGINE and tr["word_count"] > 150
    for kw in ("money", "password", "sleep", "cat"):
        assert kw in text, f"expected '{kw}' in transcript"
    words = [w for s in tr["segments"] for w in s["words"]]
    assert all(w["e"] >= w["s"] for w in words)
    assert all(a["s"] <= b["s"] + 1e-6 for a, b in zip(words, words[1:]))
    # Word timings line up with the scripted sentence timecodes.
    first = next(w for w in words if "mistake" in w["w"].lower())
    scripted = next(s for s in analysed["manifest"]["sentences"] if "money mistake" in s["text"])
    assert scripted["start"] - 0.5 <= first["s"] <= scripted["end"]


def test_highlights_have_valid_coherent_boundaries(analysed):
    hls = analysed["highlights"]
    man = analysed["manifest"]
    assert 2 <= len(hls) <= 10
    starts = [s["start"] for s in man["sentences"]]
    for h in hls:
        assert 0 <= h.start < h.end <= man["duration"] + 0.01
        assert 10 - 0.5 <= h.end - h.start <= 35 + 0.5
        # Each clip begins just before a real sentence start (padding only, never mid-sentence).
        assert min(abs(st - h.start) for st in starts) < 0.9, f"{h.title} starts mid-sentence at {h.start}"
        assert sum(f["points"] for f in h.breakdown.values()) > 0 and h.reason
    # The strongest clips are the scripted money Q&A and sleep story (checked on content, since the
    # offline pocketsphinx engine produces unpunctuated, lower-quality titles).
    top = " ".join(h.transcript.lower() for h in hls[:2])
    assert ("money" in top or "mistake" in top or "invest" in top) and ("sleep" in top or "compromise" in top or "bakery" in top), top
    intro_end = man["sentences"][1]["end"]
    assert not any(h.start < intro_end - 0.5 and h.end < 12 for h in hls), "intro greeting should not be a highlight"
    a = analysed["analysis"]
    assert a["summary"]["face_presence"] > 0.9
    assert len(a["summary"]["topics"]) >= 2
    if WHISPER:
        assert a["summary"]["speakers"] == 2


def test_no_audio_source_does_not_invent_highlights(env, silent_video):
    from clipforge.analysis.pipeline import latest_highlights, run_analysis
    from clipforge.schemas import AnalysisSettings

    pid, sid = make_project(silent_video, "Silent")
    ctx = Ctx()
    r = run_analysis(pid, sid, AnalysisSettings(transcription_engine="pocketsphinx"), ctx, {})
    assert r["highlights"] == [] and latest_highlights(pid) == []
    assert any("no audio" in w.lower() for w in ctx.warnings)


# ----------------------------------------------------------------------------- edits & renders

def test_render_vertical_with_captions_text_and_sync(analysed):
    from clipforge.edit.service import create_edit, save_timeline
    from clipforge.schemas import ExportSettings, TextLayer, Timeline

    e = create_edit(analysed["highlights"][0].id, style="dynamic", aspect="9:16")
    tl = Timeline.model_validate(e.timeline)
    assert len(tl.captions.words) > 10 and tl.reframe.mode in ("auto", "speaker")
    tl.captions.style.active_color = "#FF3366"
    tl.texts.append(TextLayer(id="t_test", text="TEST TITLE", start=0.2, end=3.0, y=0.85))
    save_timeline(e.id, tl)
    rep = _render(e.id, ExportSettings(preset="custom", resolution="720p", crf=23, encoder_speed="fast"))
    out = Path(rep["output"])
    assert out.exists() and out.with_suffix(".srt").exists()
    v = rep["validation"]
    assert v["ok"], v["checks"]
    names = {c["name"]: c for c in v["checks"]}
    for k in ("resolution", "duration", "av_sync", "decodes_cleanly", "overlay_captions", "overlay_text", "audio_not_silent"):
        assert names[k]["ok"], names[k]
    assert (rep["width"], rep["height"]) == (720, 1280)
    assert abs(v["loudness"]["integrated_lufs"] - (-14)) < 1.5


def test_trim_boundaries_are_frame_accurate(analysed):
    from clipforge.schemas import Canvas, ExportSettings, Reframe, Timeline, VideoClip

    src = Path(analysed["manifest"]["video"])
    tl = Timeline(source_id=analysed["sid"], canvas=Canvas(aspect="16:9", width=1920, height=1080, fps=30),
                  clips=[VideoClip(id="c", src_in=20.0, src_out=26.0)], reframe=Reframe(mode="original"))
    tl.captions.enabled = False
    eid = _store_timeline(analysed["pid"], tl)
    rep = _render(eid, ExportSettings(preset="custom", resolution="720p", crf=20, encoder_speed="fast"))
    out = Path(rep["output"])
    assert rep["duration"] == pytest.approx(6.0, abs=1 / 30)
    # The source has a running burned-in timecode, so frames from different times differ visibly.
    o0 = _frame(out, 0.0)
    exact = np.mean((o0 - _frame(src, 20.0)) ** 2)
    later = np.mean((o0 - _frame(src, 21.0)) ** 2)
    assert exact < later / 3, (exact, later)
    o_end = _frame(out, 5.9)
    assert np.mean((o_end - _frame(src, 25.9)) ** 2) < np.mean((o_end - _frame(src, 24.9)) ** 2)


@pytest.mark.parametrize("aspect,dims", [("1:1", (720, 720)), ("4:5", (720, 900)), ("16:9", (1280, 720))])
def test_aspect_ratio_conversion(analysed, aspect, dims):
    from clipforge.edit.service import create_edit
    from clipforge.schemas import ExportSettings

    e = create_edit(analysed["highlights"][1].id, style="clean", aspect=aspect)
    rep = _render(e.id, ExportSettings(preset="custom", resolution="720p", crf=26, encoder_speed="fast", export_srt=False))
    assert (rep["width"], rep["height"]) == dims
    assert rep["validation"]["ok"], rep["validation"]["checks"]


def test_render_without_audio_and_rotated_source(env, silent_video, portrait_rotated_video):
    from clipforge.schemas import Canvas, ExportSettings, Reframe, Timeline, VideoClip

    pid, sid = make_project(silent_video, "Silent render")
    tl = Timeline(source_id=sid, canvas=Canvas(aspect="16:9", width=1920, height=1080, fps=25), clips=[VideoClip(id="c", src_in=1, src_out=3)],
                  reframe=Reframe(mode="original"))
    rep = _render(_store_timeline(pid, tl), ExportSettings(preset="custom", resolution="720p", encoder_speed="fast"))
    names = {c["name"]: c for c in rep["validation"]["checks"]}
    assert rep["validation"]["ok"] and names["audio_stream"]["ok"]  # silent AAC track for platform compatibility
    assert not names["audio_not_silent"]["ok"] and names["audio_not_silent"]["severity"] == "warning"
    pid2, sid2 = make_project(portrait_rotated_video, "Rotated")
    tl2 = Timeline(source_id=sid2, canvas=Canvas(aspect="9:16", width=1080, height=1920, fps=30), clips=[VideoClip(id="c", src_in=0, src_out=2)],
                   reframe=Reframe(mode="original"))
    rep2 = _render(_store_timeline(pid2, tl2), ExportSettings(preset="custom", resolution="720p", encoder_speed="fast"))
    assert (rep2["width"], rep2["height"]) == (720, 1280)
    assert rep2["validation"]["ok"]


def test_social_package_is_grounded(analysed):
    from clipforge.edit.service import create_edit
    from clipforge.social.service import generate_package

    e = create_edit(analysed["highlights"][0].id, style="clean")
    sp = generate_package(e.id, "shorts", "local", {}, 5)
    c = sp.content
    assert len(c["titles"]) == 3 and {t["style"] for t in c["titles"]} == {"curiosity", "informative", "bold"}
    assert 1 <= len(c["hashtags"]) <= 5 and all(h.startswith("#") and " " not in h for h in c["hashtags"])
    assert c["descriptions"]["short"] and c["descriptions"]["long"]
    clip_text = analysed["highlights"][0].transcript.lower()
    # Extractive: the short description is made of the clip's own words.
    words = [w for w in c["descriptions"]["short"].lower().replace(".", "").replace(",", "").split() if len(w) > 3]
    assert sum(w in clip_text for w in words) / max(1, len(words)) > 0.8
    assert not any("viral" in s.lower() or "guarantee" in s.lower() for s in c["suggestions"])


# ----------------------------------------------------------------------------- language-model providers (protocol stubs)
def test_llm_refinement_and_social_copy_through_provider_protocols(analysed, protocol_stub, monkeypatch):
    """Full pipeline with AI enabled: highlight refinement over the Ollama protocol, social copy over the
    Anthropic SDK — both against local stubs. Checks what is sent, what is accepted and what is rejected."""
    import json
    import re

    from clipforge.analysis.pipeline import latest_analysis, latest_highlights, run_analysis
    from clipforge.edit.service import create_edit
    from clipforge.schemas import AnalysisSettings
    from clipforge.social.service import generate_package
    from conftest import anthropic_message

    video = analysed["manifest"]["video"]
    pid, sid = make_project(Path(video), "Podcast (AI)")  # same source → cached transcript/visual analysis

    def ollama(req):
        if req["path"] == "/api/tags":
            return 200, {"models": [{"name": "stub-model:latest"}]}
        prompt = req["json"]["messages"][1]["content"]
        js = []
        for k, a, b in re.findall(r"### Candidate (\d+) \(sentences (\d+)–(\d+)", prompt):
            k, a, b = int(k), int(a), int(b)
            js.append({"candidate_id": k, "hook": 9, "payoff": 8, "novelty": 7, "title": f"Stub title {k}",
                       "topic": "Stub topic", "reason": "Stub reason", "audience": "Stub audience", "issues": ["Stub issue"],
                       "start_sentence": a + (5 if k == 0 else 0), "end_sentence": b})  # k=0 tries an illegal 5-sentence move
        js.append({**js[0], "candidate_id": 99})  # unknown candidate → rejected
        return 200, {"message": {"role": "assistant", "content": json.dumps({"judgements": js})}, "prompt_eval_count": 1500, "eval_count": 400}

    protocol_stub.handler = ollama
    st = AnalysisSettings(content_mode="podcast", duration_preset="custom", min_duration=10, max_duration=35,
                          transcription_engine=ENGINE, whisper_model=WHISPER, ai_provider="ollama")
    run_analysis(pid, sid, st, Ctx(), {"ai": {"ollama_url": protocol_stub.url, "ollama_model": "stub-model:latest"}})
    rep = latest_analysis(pid)["llm"]
    chats = [r for r in protocol_stub.requests if r["path"] == "/api/chat"]
    assert chats and rep["provider"] == "ollama" and rep["errors"] == []
    assert rep["accepted"] >= 2 and rep["rejected"] >= 2 * len(chats)  # illegal move + unknown id, per batch
    assert rep["input_tokens"] == 1500 * len(chats)
    # Only transcript text is sent — never media or file paths.
    sent = json.dumps([r["json"] for r in chats])
    assert video not in sent and ".mp4" not in sent
    assert all(r["json"]["format"]["properties"]["judgements"] for r in chats)
    hls = latest_highlights(pid)
    refined = [h for h in hls if h.evidence.get("llm")]
    assert refined and all(h.title.startswith("Stub title") for h in refined)
    assert all(any("LLM rating" in e for e in h.breakdown["hook"]["evidence"]) for h in refined)
    # Boundaries stay sentence-aligned: the illegal 5-sentence move was refused.
    starts = [s["start"] for s in analysed["manifest"]["sentences"]]
    assert all(min(abs(s - h.start) for s in starts) < 0.9 for h in hls)

    # Social copy over the Anthropic SDK (needs explicit cloud consent; key is a dummy).
    from clipforge.ai import providers

    monkeypatch.setenv("ANTHROPIC_BASE_URL", protocol_stub.url)
    monkeypatch.setattr(providers, "get_secret", lambda name: "sk-ant-test-0000")
    edit = create_edit(hls[0].id, style="clean")
    n0 = len(protocol_stub.requests)
    local = generate_package(edit.id, "shorts", "anthropic", {"ai": {}}, 5)  # no consent → local, nothing sent
    assert local.provider == "local" and "Cloud processing is not enabled" in " ".join(local.content["warnings"])
    assert len(protocol_stub.requests) == n0
    copy = {"title_curiosity": "What most savers miss", "title_informative": "Saving early, explained",
            "title_bold": "73% of people get this wrong", "description_short": "A short take.", "description_medium": "Medium.",
            "description_long": "Long.", "hashtags": ["#Saving Tips", "money", "#money"], "hook_text": "Start here",
            "thumbnail_title": "Save early", "keywords": ["saving"], "posting_suggestions": ["Post this, it will go viral", "Pin a comment"]}
    protocol_stub.handler = (200, anthropic_message(json.dumps(copy), inp=900, out=250))
    sp = generate_package(edit.id, "shorts", "anthropic", {"ai": {"cloud_consent": True}}, 5)
    req = protocol_stub.requests[-1]
    assert req["path"].startswith("/v1/messages") and video not in json.dumps(req["json"])
    assert hls[0].transcript.split()[3] in req["json"]["messages"][0]["content"]  # the clip's own words are the input
    c = sp.content
    assert sp.provider == "anthropic" and sp.usage["cost_usd"] == pytest.approx((900 * 4 + 250 * 20) / 1e6, abs=1e-5)
    assert "73%" not in c["titles"][2]["text"] and any("73%" in i for i in c["grounding"]["issues"])  # unsupported figure removed
    assert c["hashtags"][:2] == ["#SavingTips", "#money"]  # sanitised and de-duplicated
    assert not any("viral" in s.lower() for s in c["suggestions"])


# ----------------------------------------------------------------------------- evaluation harness (keep last: re-analyses the source)
def test_evaluation_harness_cli(analysed, env, tmp_path, capsys):
    """Golden clips = the generated podcast's topic segments (known ground truth)."""
    import json

    from clipforge.devtools.evaluate import main

    topics = [t for t in analysed["manifest"]["topics"] if 12 <= t["end"] - t["start"] <= 35]
    golden = tmp_path / "podcast.json"
    golden.write_text(json.dumps({"video": analysed["manifest"]["video"], "content_mode": "podcast", "min_duration": 10,
                                  "max_duration": 35, "clips": [{"start": t["start"], "end": t["end"]} for t in topics]}))
    out = tmp_path / "report.json"
    # 1) Score the existing project's highlights.
    assert main([str(golden), "--project", analysed["pid"], "--json", str(out), "--quiet"]) == 0
    rep = json.loads(out.read_text())["variants"]["project highlights"]["per_video"][0]
    assert rep["golden"] == len(topics) and rep["predictions"] == len(analysed["highlights"])
    assert rep["recall"] >= 0.5, rep  # most topic segments are recovered as highlights
    assert rep["start_error_s"] is not None and rep["start_error_s"] < 3.0
    # 2) Analyse through the harness (cached) with default vs custom weights.
    args = [str(golden), "--data-dir", str(env), "--engine", ENGINE, "--compare", "--weights", "hook=60", "--json", str(out), "--quiet"]
    if WHISPER:
        args += ["--whisper-model", WHISPER]
    assert main(args) == 0
    variants = json.loads(out.read_text())["variants"]
    assert set(variants) == {"default weights", "custom weights"}
    for v in variants.values():
        assert 0 <= v["aggregate"]["precision"] <= 1 and v["aggregate"]["golden"] == len(topics)
    printed = capsys.readouterr().out
    assert "default weights" in printed and "AP" in printed
