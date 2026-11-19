"""Unit tests: schemas, geometry (shared with the TS editor), LLM validation, persistence, API security, jobs."""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

import pytest
from pydantic import ValidationError

from clipforge.edit.reframe import crop_rect, fit_zoom, interp_keyframes
from clipforge.render.compositor import color_matrix
from clipforge.schemas import AnalysisSettings, CropKeyframe, ExportSettings, Timeline, VideoClip

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "geometry_fixtures.json"


# ----------------------------------------------------------------------------- schemas

def test_timeline_validation_and_layout():
    tl = Timeline(source_id="s", clips=[VideoClip(id="a", src_in=0, src_out=2), VideoClip(id="b", src_in=5, src_out=9, speed=2)])
    assert tl.clips[1].start == pytest.approx(2.0)
    assert tl.duration == pytest.approx(4.0)
    with pytest.raises(ValidationError):
        VideoClip(id="x", src_in=3, src_out=2)
    with pytest.raises(ValidationError):
        AnalysisSettings(min_duration=40, max_duration=20)
    assert AnalysisSettings(platforms=[]).platforms == ["tiktok"]


def test_export_presets_resolve_without_silent_downscale():
    from clipforge.render.encode import output_dims, resolve_settings

    s = resolve_settings(ExportSettings(preset="4k_hq"))
    assert s.resolution == "2160p" and s.codec == "hevc"
    s2 = resolve_settings(ExportSettings(preset="4k_hq", resolution="1080p"))
    assert s2.resolution == "1080p"
    tl = Timeline(source_id="s", clips=[VideoClip(id="a", src_in=0, src_out=5)])
    info = {"display_width": 1920, "display_height": 1080}
    w, h, rep = output_dims(tl, s, info)
    assert (w, h) == (2160, 3840) and rep["is_upscaled"] and rep["upscale_factor"] > 2
    w, h, rep = output_dims(tl, ExportSettings(preset="custom", resolution="source"), info)
    assert h == 1080 * 1 or rep["upscale_factor"] <= 1.05


# ----------------------------------------------------------------------------- geometry fixtures (also checked by vitest)

GEOM_CASES = [
    # cx, cy, zoom, src_w, src_h, aspect
    (0.5, 0.5, 1.0, 1920, 1080, 9 / 16),
    (0.1, 0.5, 1.0, 1920, 1080, 9 / 16),
    (0.95, 0.2, 1.4, 1920, 1080, 9 / 16),
    (0.5, 0.5, 0.3164, 1920, 1080, 9 / 16),
    (0.3, 0.7, 1.0, 1080, 1920, 16 / 9),
    (0.5, 0.5, 1.2, 1280, 720, 1.0),
    (0.6, 0.4, 1.0, 3840, 2160, 4 / 5),
]


def _geometry_doc():
    kfs = [CropKeyframe(t=0, cx=0.2, cy=0.5, zoom=1.0), CropKeyframe(t=2, cx=0.8, cy=0.4, zoom=1.3, ease="ease_in_out"),
           CropKeyframe(t=3, cx=0.5, cy=0.5, zoom=1.0, ease="hold"), CropKeyframe(t=4, cx=0.1, cy=0.1, zoom=2.0, ease="linear")]
    return {
        "crop": [{"args": list(c), "rect": [round(v, 6) for v in crop_rect(*c)]} for c in GEOM_CASES],
        "fit_zoom": [{"args": [1920, 1080, 9 / 16], "value": round(fit_zoom(1920, 1080, 9 / 16), 6)}],
        "keyframes": [k.model_dump() for k in kfs],
        "interp": [{"t": t, "value": [round(v, 6) for v in interp_keyframes(kfs, t)]} for t in (-1, 0, 0.5, 1, 1.99, 2.5, 3, 3.5, 5)],
        "color": [{"args": list(a), "matrix_bgr": [[round(float(v), 6) for v in row] for row in color_matrix(*a)]}
                  for a in ((0.2, 1.1, 0.9, 0.15), (0, 1.2, 1, 0), (-0.3, 1, 1.4, -0.5))],
    }


def test_geometry_fixtures_are_current():
    """The fixture file is consumed by the frontend tests; it must match the Python implementation."""
    doc = _geometry_doc()
    if not FIXTURES.exists():
        FIXTURES.parent.mkdir(parents=True, exist_ok=True)
        FIXTURES.write_text(json.dumps(doc, indent=1))
    assert json.loads(FIXTURES.read_text()) == json.loads(json.dumps(doc)), "Run: python -m clipforge.devtools.fixtures to regenerate"


def test_crop_stays_inside_source():
    for cx, cy, z, w, h, a in GEOM_CASES:
        x0, y0, cw, ch = crop_rect(cx, cy, z, w, h, a)
        assert cw / ch == pytest.approx(a, rel=1e-6)
        if cw <= w:
            assert -1e-6 <= x0 and x0 + cw <= w + 1e-6
        else:
            assert x0 == pytest.approx((w - cw) / 2)


# ----------------------------------------------------------------------------- LLM validation (fake provider)

class FakeProvider:
    name = "fake"
    model = "fake-1"

    def __init__(self, payload):
        self.payload = payload

    def generate_json(self, system, prompt, schema, purpose, max_tokens=4000):
        from clipforge.ai.providers import Usage

        return schema.model_validate(self.payload), Usage("fake", "fake-1", 100, 50)


def test_llm_refinement_rejects_hallucinated_boundaries():
    from clipforge.ai.refine import refine_candidates
    from clipforge.analysis import highlights as hl
    from clipforge.analysis.modes import parse_instructions

    sents = [{"start": i * 5.0, "end": i * 5.0 + 4.0, "text": f"Sentence {i}."} for i in range(10)]
    bd = {k: {"label": k, "points": 5.0, "max": 10.0, "raw": 0.5, "evidence": []} for k in hl.FACTORS}
    cand = {"s0": 2, "s1": 4, "start": 10.0, "end": 24.0, "duration": 14.0, "score": 35.0, "breakdown": bd, "adjustments": [], "issues": []}
    ctx = hl.make_context("podcast", parse_instructions(""), "tiktok", 10, 30, True, 0.0)
    bad = {"judgements": [
        {"candidate_id": 0, "hook": 9, "payoff": 8, "novelty": 7, "title": "T", "topic": "x", "reason": "r", "audience": "a", "issues": [],
         "start_sentence": 9, "end_sentence": 9},  # moves 7 sentences: must be rejected
        {"candidate_id": 5, "hook": 9, "payoff": 8, "novelty": 7, "title": "T", "topic": "x", "reason": "r", "audience": "a", "issues": [],
         "start_sentence": 2, "end_sentence": 4},  # unknown candidate id
    ]}
    out, rep = refine_candidates(FakeProvider(bad), [cand], sents, ctx, lambda c: c, "Podcast", "", "TikTok")
    assert out[0]["s0"] == 2 and out[0]["s1"] == 4  # boundaries unchanged
    assert rep["rejected"] == 2 and rep["accepted"] == 1
    # Out-of-range scores fail schema validation entirely
    with pytest.raises(ValidationError):
        from clipforge.ai.refine import RefineResponse

        RefineResponse.model_validate({"judgements": [{**bad["judgements"][0], "hook": 42}]})


def test_social_grounding_removes_invented_figures():
    from clipforge.social.generate import _ground

    text, issues = _ground("Investing $500 turns into “guaranteed riches” over 30 years", "if you invest one hundred dollars a month for 30 years")
    assert "$500" not in text and "guaranteed riches" in text and "“" not in text
    assert "30" in text
    assert len(issues) == 2


# ----------------------------------------------------------------------------- persistence, migrations, API

def test_database_migrations_and_backup(data_dir):
    from clipforge.config import get_config
    from clipforge.db import SCHEMA_VERSION, get_engine, reset_engine

    get_engine()
    db = get_config().db_path
    con = sqlite3.connect(db)
    assert con.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    con.execute("PRAGMA user_version = 1")
    con.commit()
    con.close()
    reset_engine()
    get_engine()  # re-migrates from v1 and backs up first
    assert list(db.parent.glob("clipforge.v1.bak"))


@pytest.fixture()
def client(data_dir):
    from fastapi.testclient import TestClient

    from clipforge.api.app import create_app

    with TestClient(create_app(start_workers=False), headers={"X-ClipForge-Client": "1"}) as c:
        yield c


def test_api_security_guards(client):
    from fastapi.testclient import TestClient

    from clipforge.api.app import create_app

    with TestClient(create_app(start_workers=False)) as bare:
        assert bare.post("/api/projects", json={"name": "x"}).status_code == 403  # no client header
        assert bare.get("/api/health", headers={"Host": "attacker.example"}).status_code == 403  # DNS rebinding
    assert client.post("/api/projects", json={"name": "ok"}).status_code == 200
    assert client.get("/api/fonts/file/..%2F..%2Fconfig.py").status_code == 404


def test_project_and_timeline_persistence(client, podcast_video):
    p = client.post("/api/projects", json={"name": "Persist"}).json()
    r = client.post(f"/api/projects/{p['id']}/reference", json={"path": podcast_video["video"]})
    assert r.status_code == 200, r.text
    src = r.json()
    assert src["probe"]["display_width"] == 1920 and src["referenced"]
    # Unsupported file types are rejected with a readable message
    bad = client.post(f"/api/projects/{p['id']}/reference", json={"path": __file__})
    assert bad.status_code == 415
    # Relinking to a different file is refused
    other = Path(podcast_video["video"]).with_name("no_audio.mp4")
    if other.exists():
        assert client.post(f"/api/sources/{src['id']}/relink", json={"path": str(other)}).status_code == 409
    # Store & reload a timeline through an edit row
    from clipforge.db import session_scope
    from clipforge.models import Edit

    tl = Timeline(source_id=src["id"], clips=[VideoClip(id="c1", src_in=8, src_out=20)])
    with session_scope() as s:
        s.add(Edit(id="ed_test", project_id=p["id"], group_id="g", timeline=tl.model_dump(mode="json")))
        s.commit()
    tl.texts = []
    body = tl.model_dump(mode="json")
    body["clips"][0]["src_out"] = 15.5
    assert client.put("/api/edits/ed_test/timeline", json=body).status_code == 200
    got = client.get("/api/edits/ed_test").json()
    assert got["timeline"]["clips"][0]["src_out"] == 15.5
    bad_tl = dict(body, clips=[{"id": "c", "src_in": 5, "src_out": 2}])
    assert client.put("/api/edits/ed_test/timeline", json=bad_tl).status_code == 422


def test_atomic_json_write(tmp_path):
    from clipforge.util.files import atomic_write_json, read_json, safe_join, sanitize_filename

    p = tmp_path / "x.json"
    atomic_write_json(p, {"a": 1})
    assert read_json(p) == {"a": 1}
    assert not list(tmp_path.glob(".x.json.*"))
    assert sanitize_filename("../../etc/passwd") == "etc_passwd"
    with pytest.raises(ValueError):
        safe_join(tmp_path, "..", "escape")


# ----------------------------------------------------------------------------- jobs

def test_job_queue_cancel_retry_and_recovery(data_dir):
    from clipforge.db import session_scope
    from clipforge.jobs.queue import JobManager
    from clipforge.models import Job

    m = JobManager()
    calls = {"n": 0}

    def slow(ctx, payload):
        if payload.get("fail"):
            calls["n"] += 1
        ctx.stage("compose")
        for _ in range(100):
            ctx.token.check()
            time.sleep(0.02)
        if payload.get("fail") and calls["n"] == 1:
            raise ValueError("Simulated failure")
        return {"ok": True}

    m.register("render", slow)
    m.start(analysis_workers=1, render_workers=1)
    try:
        j = m.submit("render", {}, title="cancel me")
        for _ in range(100):
            if m.running_ids():
                break
            time.sleep(0.02)
        m.cancel(j.id)
        _wait(j.id, {"cancelled"})
        f = m.submit("render", {"fail": True}, title="fails once")
        row = _wait(f.id, {"failed"})
        assert row.error == "Simulated failure"
        m.retry(f.id)
        assert _wait(f.id, {"completed"}).result["ok"] is True
    finally:
        m.stop()
    # Simulate a crash: a job left "running" is re-queued on start-up.
    with session_scope() as s:
        s.add(Job(id="job_crash", kind="render", queue="render", status="running", title="interrupted"))
        s.commit()
    m2 = JobManager()
    m2._recover()
    with session_scope() as s:
        assert s.get(Job, "job_crash").status == "queued"


def _wait(job_id, statuses, timeout=20):
    from clipforge.db import session_scope
    from clipforge.models import Job

    end = time.time() + timeout
    while time.time() < end:
        with session_scope() as s:
            j = s.get(Job, job_id)
            if j.status in statuses:
                return j
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not reach {statuses}")


def test_brand_kit_keeps_word_box_text_readable():
    from clipforge.edit.ops import preset_style
    from clipforge.edit.recipes import apply_brand_kit, contrast_text

    tl = Timeline(source_id="s", clips=[VideoClip(id="a", src_in=0, src_out=5)])
    tl.captions.style = preset_style("creator")
    apply_brand_kit(tl, {"id": "k", "data": {"primary_color": "#FF5A36"}})
    cs = tl.captions.style
    assert cs.background_color == "#FF5A36" and cs.active_color != cs.background_color
    assert contrast_text("#FFFFFF") == "#0B0E14" and contrast_text("#101010") == "#FFFFFF"


def test_audio_graph_honours_track_gain_envelopes_and_mutes(tmp_path):
    from clipforge.render.audio_mix import build_mix_graph
    from clipforge.schemas import AudioClip, VolumePoint

    tl = Timeline(source_id="s", clips=[VideoClip(id="a", src_in=0, src_out=4, envelope=[VolumePoint(t=0, gain_db=0), VolumePoint(t=2, gain_db=-12)])])
    next(t for t in tl.tracks if t.id == "a1").gain_db = 3.0
    music = tmp_path / "m.mp3"
    music.write_bytes(b"x")
    tl.audio_clips = [AudioClip(id="m", asset_id="as1", start=0, src_out=4, label="music")]
    _, g = build_mix_graph(tl, tmp_path / "src.mp4", True, {"as1": music}, 4.0)
    assert "volume=3.0dB" in g and "if(lt(t,2" in g and "sidechaincompress" in g
    next(t for t in tl.tracks if t.id == "a2").muted = True
    _, g2 = build_mix_graph(tl, tmp_path / "src.mp4", True, {"as1": music}, 4.0)
    assert "sidechaincompress" not in g2 and "[m0]" not in g2


def test_dialogue_envelope_stays_clip_relative_across_transition_handles(tmp_path):
    """The chain of a clip with an incoming crossfade starts half a transition early; envelope times must shift with it."""
    from clipforge.render.audio_mix import build_mix_graph
    from clipforge.schemas import Transition, VolumePoint

    tl = Timeline(source_id="s", clips=[
        VideoClip(id="a", src_in=0, src_out=4),
        VideoClip(id="b", src_in=10, src_out=14, transition_in=Transition(type="crossfade", duration=1.0),
                  envelope=[VolumePoint(t=1, gain_db=0), VolumePoint(t=2, gain_db=-12)]),
    ])
    _, g = build_mix_graph(tl, tmp_path / "src.mp4", True, {}, 8.0)
    chain_b = next(p for p in g.split(";") if p.endswith("[d1]"))
    assert "atrim=start=9.5000" in chain_b
    assert "if(lt(t,2.5)" in chain_b and "if(lt(t,1.5)" in chain_b  # 1 s and 2 s clip-relative, +0.5 s handle
