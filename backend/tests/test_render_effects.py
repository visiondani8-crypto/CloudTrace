"""Render tests: every effect and transition must be *observable* in the output,
and edge-case sources (VFR, HDR10/HLG, 4K, MKV/HEVC) must render correctly."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import cv2
import numpy as np
import pytest

from conftest import ARTIFACTS, Ctx, make_project

pytestmark = pytest.mark.slow


@pytest.fixture(scope="module")
def env(tmp_path_factory):
    from clipforge import config, db
    from clipforge.jobs import queue

    d = tmp_path_factory.mktemp("cfx")
    old = os.environ.get("CLIPFORGE_DATA_DIR")
    os.environ["CLIPFORGE_DATA_DIR"] = str(d)
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
def edge_media():
    import sys

    sys.path.insert(0, str(Path(__file__).parent / "fixtures"))
    from make_edge_media import build

    return build(ARTIFACTS)


@pytest.fixture(scope="module")
def podcast(env, podcast_video):
    pid, sid = make_project(Path(podcast_video["video"]), "Effects")
    return {"pid": pid, "sid": sid, "path": Path(podcast_video["video"])}


def _timeline(sid, clips, aspect="16:9", fps=30, **kw):
    from clipforge.schemas import Canvas, Reframe, Timeline, VideoClip

    W, H = {"16:9": (1920, 1080), "9:16": (1080, 1920)}[aspect]
    tl = Timeline(source_id=sid, canvas=Canvas(aspect=aspect, width=W, height=H, fps=fps),
                  clips=[VideoClip(**c) for c in clips], reframe=Reframe(mode="original") if aspect == "16:9" else Reframe(mode="auto"))
    tl.captions.enabled = False
    for k, v in kw.items():
        setattr(tl, k, v)
    return tl


def _render(pid, tl, **settings):
    from clipforge.db import session_scope
    from clipforge.models import Edit, Render
    from clipforge.render.pipeline import render_edit
    from clipforge.schemas import ExportSettings
    from clipforge.util.files import new_id

    eid, rid = new_id("ed_"), new_id("rn_")
    with session_scope() as s:
        s.add(Edit(id=eid, project_id=pid, group_id=new_id("g_"), name=f"fx_{eid}", timeline=tl.model_dump(mode="json")))
        s.add(Render(id=rid, project_id=pid, edit_id=eid, status="running"))
        s.commit()
    st = {"preset": "custom", "resolution": "720p", "crf": 18, "encoder_speed": "fast", "export_srt": False}
    st.update(settings)
    rep = render_edit(eid, rid, ExportSettings(**st), Ctx())
    assert rep["validation"]["ok"], rep["validation"]["checks"]
    return rep


def _frames(path: str, times: list[float]) -> list[np.ndarray]:
    out = []
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    for t in times:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(t * fps)))
        ok, f = cap.read()
        assert ok, t
        out.append(f.astype(np.float32))
    cap.release()
    return out


def _sat(f):
    return float(cv2.cvtColor(f.astype(np.uint8), cv2.COLOR_BGR2HSV)[..., 1].mean())


def _sharp(f):
    return float(cv2.Laplacian(cv2.cvtColor(f.astype(np.uint8), cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())


BASE = {"id": "c", "src_in": 20.0, "src_out": 21.6}


@pytest.fixture(scope="module")
def baseline(podcast):
    rep = _render(podcast["pid"], _timeline(podcast["sid"], [BASE]))
    return _frames(rep["output"], [0.1, 0.8, 1.4])


def _fx(podcast, effect, aspect="16:9"):
    clip = dict(BASE, effects=[{"id": "e", **effect}])
    rep = _render(podcast["pid"], _timeline(podcast["sid"], [clip], aspect=aspect))
    return _frames(rep["output"], [0.1, 0.8, 1.4])


def test_exposure_contrast_saturation_grade(podcast, baseline):
    b = baseline[1]
    exp = _fx(podcast, {"type": "exposure", "params": {"value": 0.6}})[1]
    assert exp.mean() > b.mean() + 15
    con = _fx(podcast, {"type": "contrast", "params": {"value": 1.6}})[1]
    assert con.std() > b.std() * 1.2
    sat = _fx(podcast, {"type": "saturation", "params": {"value": 2.0}})[1]
    assert _sat(sat) > _sat(b) * 1.3
    gray = _fx(podcast, {"type": "saturation", "params": {"value": 0.0}})[1]
    assert _sat(gray) < 8
    warm = _fx(podcast, {"type": "grade", "params": {"temperature": 1.0, "exposure": 0, "contrast": 1, "saturation": 1}})[1]
    assert (warm[..., 2].mean() - warm[..., 0].mean()) > (b[..., 2].mean() - b[..., 0].mean()) + 15  # R−B up


def test_blur_sharpen_vignette_mask(podcast, baseline):
    b = baseline[1]
    assert _sharp(_fx(podcast, {"type": "blur", "params": {"radius": 0.02}})[1]) < _sharp(b) * 0.3
    assert _sharp(_fx(podcast, {"type": "sharpen", "params": {"amount": 1.0}})[1]) > _sharp(b) * 1.15
    v = _fx(podcast, {"type": "vignette", "params": {"amount": 0.9}})[1]
    h, w = b.shape[:2]
    corner = (slice(0, h // 8), slice(w - w // 8, w))
    assert v[corner].mean() < b[corner].mean() * 0.7
    assert abs(v[h // 2 - 20 : h // 2 + 20, w // 2 - 20 : w // 2 + 20].mean() - b[h // 2 - 20 : h // 2 + 20, w // 2 - 20 : w // 2 + 20].mean()) < 6
    m = _fx(podcast, {"type": "mask", "params": {"shape": "circle", "size": 0.6, "feather": 0.0, "color": "#FF0000"}})[1]
    assert m[5, 5, 2] > 200 and m[5, 5, 0] < 40  # corner filled with red


def test_fades_and_freeze(podcast, baseline):
    fi = _fx(podcast, {"type": "fade_in", "start": 0, "end": 0.6, "params": {"color": "#000000"}})
    assert fi[0].mean() < baseline[0].mean() * 0.4 and abs(fi[2].mean() - baseline[2].mean()) < 5
    fo = _fx(podcast, {"type": "fade_out", "start": 1.0, "end": None, "params": {"color": "#FFFFFF"}})
    assert fo[2].mean() > baseline[2].mean() + 40
    fr = _fx(podcast, {"type": "freeze", "start": 0.2, "end": 1.5, "params": {}})
    # The source has a running timecode; frozen frames are identical, unfrozen ones differ.
    assert np.abs(fr[1] - fr[2]).mean() < 1.0
    assert np.abs(baseline[1] - baseline[2]).mean() > np.abs(fr[1] - fr[2]).mean() + 0.3


def test_zoom_and_pan_geometry(podcast):
    base = _render(podcast["pid"], _timeline(podcast["sid"], [BASE], aspect="9:16"))
    b = _frames(base["output"], [0.8])[0]
    z = _fx(podcast, {"type": "zoom", "params": {"from": 1.5, "to": 1.5}}, aspect="9:16")[1]
    h, w = b.shape[:2]
    # The 9:16 auto crop may be clamped at the frame edge, so compare against best-matching 1/1.5 crops.
    best = min(
        np.abs(cv2.resize(b[y : y + int(h / 1.5), x : x + int(w / 1.5)], (w, h)) - z).mean()
        for y in range(0, h - int(h / 1.5) + 1, 16) for x in range(0, w - int(w / 1.5) + 1, 16)
    )
    assert best < np.abs(b - z).mean() * 0.5
    p = _fx(podcast, {"type": "pan", "params": {"dx": 0.2, "dy": 0.0}}, aspect="9:16")
    assert np.abs(p[2] - _frames(base["output"], [1.4])[0]).mean() > 5


@pytest.mark.parametrize("kind", ["crossfade", "fade_black", "fade_white", "slide", "zoom", "blur"])
def test_transitions(podcast, kind):
    # Clip A: blue "money" set (#16324f), clip B: purple "sleep" set (#3b2440).
    clips = [{"id": "a", "src_in": 20.0, "src_out": 21.5}, {"id": "b", "src_in": 50.0, "src_out": 51.5, "transition_in": {"type": kind, "duration": 0.6}}]
    rep = _render(podcast["pid"], _timeline(podcast["sid"], clips))
    T = 1.5
    pre, mid, post = _frames(rep["output"], [0.2, T, 2.8])
    patch = (slice(620, 690), slice(30, 110))  # plain background, bottom-left (720p)
    a, m, b = pre[patch].mean(axis=(0, 1)), mid[patch].mean(axis=(0, 1)), post[patch].mean(axis=(0, 1))
    if kind == "crossfade":
        assert np.abs(m - (a + b) / 2).max() < 12 and np.abs(m - a).max() > 8 and np.abs(m - b).max() > 8
    elif kind == "fade_black":
        assert _frames(rep["output"], [T - 0.04])[0].mean() < 25
    elif kind == "fade_white":
        assert _frames(rep["output"], [T - 0.04])[0].mean() > 220
    elif kind == "slide":
        f = _frames(rep["output"], [T])[0]
        left, right = f[620:690, 30:110].mean(axis=(0, 1)), f[620:690, 1170:1250].mean(axis=(0, 1))
        assert np.abs(left - a).max() < 12 and np.abs(right - b).max() < 12
    elif kind == "zoom":
        assert np.abs(m - a).max() > 6 and np.abs(m - b).max() > 6
    elif kind == "blur":
        f = _frames(rep["output"], [T - 0.05])[0]
        assert _sharp(f) < _sharp(pre) * 0.4


def test_speed_change_and_sync(podcast):
    clips = [{"id": "a", "src_in": 20.0, "src_out": 22.0, "speed": 2.0}, {"id": "b", "src_in": 30.0, "src_out": 31.0, "speed": 0.5}]
    rep = _render(podcast["pid"], _timeline(podcast["sid"], clips))
    assert rep["duration"] == pytest.approx(1.0 + 2.0, abs=0.04)


# ----------------------------------------------------------------------------- edge-case sources

def _sdr_testsrc_frame(t: float) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=3", "-ss", str(t),
                          "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(720, 1280, 3)


def _probe_json(p):
    return json.loads(subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", p], capture_output=True, check=True).stdout)


def test_vfr_source_is_conformed(env, edge_media):
    from clipforge.edit.recipes import canvas_for
    from clipforge.media.ffprobe import probe

    info = probe(edge_media["vfr"])
    assert info["variable_frame_rate"]
    assert canvas_for("16:9", info).fps == 30.0  # nominal rate, not the 23.08 fps average
    pid, sid = make_project(edge_media["vfr"], "VFR")
    rep = _render(pid, _timeline(sid, [{"id": "c", "src_in": 0.5, "src_out": 3.5}]))
    v = next(s for s in _probe_json(rep["output"])["streams"] if s["codec_type"] == "video")
    assert v["avg_frame_rate"] == v["r_frame_rate"] == "30/1"
    assert rep["duration"] == pytest.approx(3.0, abs=0.05)


@pytest.mark.parametrize("key", ["pq", "hlg"])
def test_hdr_source_is_tonemapped_to_sdr(env, edge_media, key):
    from clipforge.media.ffprobe import probe

    info = probe(edge_media[key])
    assert info["hdr"] and info["bit_depth"] == 10
    pid, sid = make_project(edge_media[key], f"HDR {key}")
    rep = _render(pid, _timeline(sid, [{"id": "c", "src_in": 0.2, "src_out": 2.2}]))
    assert rep["source_quality"]["hdr_tonemapped"]
    v = next(s for s in _probe_json(rep["output"])["streams"] if s["codec_type"] == "video")
    assert v.get("color_transfer") == "bt709" and v.get("color_primaries") == "bt709" and v["pix_fmt"] == "yuv420p"
    f = _frames(rep["output"], [1.0])[0]
    # Compare with the SDR original the HDR file was mastered from (testsrc2): brightness and saturation
    # must stay close — Hable lost ~35 % brightness here, Mobius keeps it within ~15 %.
    ref = cv2.resize(_sdr_testsrc_frame(1.2), (f.shape[1], f.shape[0])).astype(np.float32)
    assert abs(f.mean() - ref.mean()) / ref.mean() < 0.2, (f.mean(), ref.mean())
    assert _sat(f) > _sat(ref) * 0.85 and f.std() > 30


def test_4k_source_renders_at_source_detail(env, edge_media):
    pid, sid = make_project(edge_media["uhd"], "4K")
    rep = _render(pid, _timeline(sid, [{"id": "c", "src_in": 0.0, "src_out": 1.0}]), resolution="source")
    assert (rep["width"], rep["height"]) == (3840, 2160)
    assert not rep["scale"]["is_upscaled"]


def test_mkv_hevc_source_gets_browser_proxy_and_renders(env, edge_media, tmp_path):
    from clipforge.media.ffprobe import probe
    from clipforge.media.proxy import make_proxy

    info = probe(edge_media["mkv"])
    assert info["container"] == "matroska" and info["video_codec"] == "hevc" and not info["browser_playable"]
    proxy = make_proxy(edge_media["mkv"], tmp_path / "proxy.mp4", info)
    pv = next(s for s in _probe_json(str(proxy))["streams"] if s["codec_type"] == "video")
    assert pv["codec_name"] == "h264" and pv["height"] == 540
    pid, sid = make_project(edge_media["mkv"], "MKV")
    rep = _render(pid, _timeline(sid, [{"id": "c", "src_in": 0.5, "src_out": 2.5}], fps=25))
    assert rep["duration"] == pytest.approx(2.0, abs=0.05)


def test_volume_envelope_is_audible(podcast):
    from clipforge.schemas import AudioSettings

    clip = dict(BASE, src_in=11.5, src_out=15.5, envelope=[{"t": 0, "gain_db": 0}, {"t": 1.9, "gain_db": 0}, {"t": 2.0, "gain_db": -24}, {"t": 4.0, "gain_db": -24}])
    tl = _timeline(podcast["sid"], [clip], audio=AudioSettings(preset="off", enabled=False, normalize=False, limiter=False))
    rep = _render(podcast["pid"], tl)

    def rms(a, b):
        out = subprocess.run(["ffmpeg", "-nostdin", "-ss", str(a), "-t", str(b - a), "-i", rep["output"], "-af", "astats=metadata=0", "-f", "null", "-"],
                             capture_output=True, text=True).stderr
        return float(next(ln.split(":")[-1] for ln in out.splitlines() if "RMS level dB" in ln and "Overall" not in ln))

    first, second = rms(0.2, 1.8), rms(2.2, 3.8)
    assert first - second > 15, (first, second)
