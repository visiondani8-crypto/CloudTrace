"""Personal tuning (ratings → learned weights) and the evaluation harness metrics."""

from __future__ import annotations

import json
import random
import sqlite3

import numpy as np
import pytest

from clipforge.analysis.modes import FACTORS


# ----------------------------------------------------------------------------- evaluation metrics
def test_evaluation_metrics_are_exact():
    from clipforge.devtools.evaluate import aggregate, score

    pred = [(0, 10), (20, 30), (50, 60)]
    gold = [(1, 11), (52, 62), (80, 90)]
    r = score(pred, gold, 0.5)
    assert (r["matched"], r["precision"], r["recall"]) == (2, pytest.approx(2 / 3), pytest.approx(2 / 3))
    assert r["average_precision"] == pytest.approx((1 / 1 + 2 / 3) / 3)  # matches at ranks 1 and 3
    assert r["mean_iou"] == pytest.approx((9 / 11 + 8 / 12) / 2)
    assert (r["start_error_s"], r["end_error_s"]) == (pytest.approx(1.5), pytest.approx(1.5))
    assert r["best_iou_per_golden"] == [0.818, 0.667, 0.0]
    # One-to-one: a duplicate prediction cannot match the same golden clip twice.
    dup = score([(0, 10), (0, 10)], [(0, 10)], 0.5)
    assert dup["matched"] == 1 and dup["precision"] == 0.5
    # Below the IoU threshold is a miss, not a partial hit.
    assert score([(0, 10)], [(6, 16)], 0.5)["matched"] == 0
    agg = aggregate([r, dup])
    assert (agg["matched"], agg["predictions"], agg["golden"]) == (3, 5, 4)


def test_golden_files_and_weights_are_validated(tmp_path):
    from clipforge.devtools.evaluate import load_golden, parse_weights

    (tmp_path / "a.json").write_text(json.dumps({"video": "ep1.mp4", "clips": [{"start": 1, "end": 20}]}))
    (tmp_path / "b.json").write_text(json.dumps([{"start": 5, "end": 9}]))
    docs = load_golden([str(tmp_path)])
    assert [d["video"] if "video" in d else None for _, d in docs] == [str(tmp_path / "ep1.mp4"), None]
    (tmp_path / "bad.json").write_text(json.dumps({"clips": [{"start": 9, "end": 5}]}))
    with pytest.raises(SystemExit):
        load_golden([str(tmp_path / "bad.json")])
    assert parse_weights("hook=30, coherence=20") == {"hook": 30.0, "coherence": 20.0}
    with pytest.raises(SystemExit):
        parse_weights("virality=99")


# ----------------------------------------------------------------------------- learning
def _ratings(n: int, seed: int = 1) -> list[dict]:
    """A user who likes strong hooks and dislikes clips that are merely coherent."""
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        raw = {k: rng.random() for k in FACTORS}
        util = 2.0 * raw["hook"] + 0.8 * raw["payoff"] - 0.8 * raw["coherence"] + rng.gauss(0, 0.3)
        out.append({"raw": raw, "rating": 1 if util > 0.9 else -1})
    return out


def test_learned_weights_follow_ratings_and_stay_regularised():
    from clipforge.analysis.tuning import FLOOR, learn_weights, valid_weights

    r = learn_weights(_ratings(40), "podcast")
    w, d = r["weights"], r["defaults"]
    assert valid_weights(w) and sum(w.values()) == pytest.approx(100, abs=0.01) and min(w.values()) >= FLOOR
    assert w["hook"] > d["hook"] + 3 and w["coherence"] < d["coherence"] - 3
    assert max(abs(w[k] - d[k]) for k in FACTORS) < 20  # nudged, not overturned
    cv = r["cv_accuracy"]
    assert cv["held_out"] == 40 and cv["learned"] > cv["default"] and r["recommended"]


def test_learning_refuses_too_few_or_one_sided_ratings():
    from clipforge.analysis.tuning import TuningError, learn_weights

    with pytest.raises(TuningError, match="at least 10"):
        learn_weights(_ratings(6), "podcast")
    one_sided = [{**x, "rating": 1} for x in _ratings(20)]
    with pytest.raises(TuningError, match="0 bad"):
        learn_weights(one_sided, "podcast")


def test_random_ratings_do_not_get_recommended():
    """Noise should not move weights far or be presented as an improvement."""
    from clipforge.analysis.tuning import learn_weights

    rng = random.Random(7)
    noise = [{"raw": {k: rng.random() for k in FACTORS}, "rating": rng.choice([1, -1])} for _ in range(30)]
    r = learn_weights(noise, "podcast")
    assert max(abs(r["weights"][k] - r["defaults"][k]) for k in FACTORS) < 12
    assert r["cv_accuracy"]["learned"] < 0.75


def test_simplex_projection():
    from clipforge.analysis.tuning import FLOOR, _project

    w = _project(np.array([90.0, -5, 3, 40, 0, 0, 0]))
    assert w.sum() == pytest.approx(100) and w.min() >= FLOOR - 1e-9


# ----------------------------------------------------------------------------- persistence + API + pipeline hook
def test_rating_migration_adds_column_to_old_databases(data_dir):
    from clipforge.config import get_config
    from clipforge.db import get_engine, reset_engine

    get_engine()
    db = get_config().db_path
    con = sqlite3.connect(db)
    con.execute("DROP INDEX IF EXISTS ix_highlights_rating")
    con.execute("ALTER TABLE highlights DROP COLUMN rating")  # simulate a v2 library
    con.execute("PRAGMA user_version = 2")
    con.commit()
    con.close()
    reset_engine()
    get_engine()
    con = sqlite3.connect(db)
    assert "rating" in {r[1] for r in con.execute("PRAGMA table_info(highlights)")}
    assert con.execute("PRAGMA user_version").fetchone()[0] == 3
    assert list(db.parent.glob("clipforge.v2.bak"))


def _seed_rated_highlights(n: int = 24) -> str:
    from clipforge.db import session_scope
    from clipforge.models import Highlight, MediaSource, Project

    with session_scope() as s:
        s.add(Project(id="pr_t", name="T", settings={"content_mode": "podcast"}))
        s.commit()
        s.add(MediaSource(id="src_t", project_id="pr_t", path="/x.mp4", original_name="x.mp4", fingerprint="f"))
        s.commit()
        for i, x in enumerate(_ratings(n)):
            s.add(Highlight(id=f"hl_{i}", project_id="pr_t", source_id="src_t", start=i, end=i + 20, score=50, rating=0,
                            breakdown={k: {"raw": x["raw"][k], "points": 0, "max": 10} for k in FACTORS}))
            x["id"] = f"hl_{i}"
        s.commit()
    return "pr_t"


def test_rating_api_learning_and_pipeline_weights(data_dir):
    from fastapi.testclient import TestClient

    from clipforge.analysis.tuning import active_weights
    from clipforge.api.app import create_app

    _seed_rated_highlights()
    ratings = _ratings(24)
    with TestClient(create_app(start_workers=False), headers={"X-ClipForge-Client": "1"}) as c:
        assert c.patch("/api/highlights/hl_0", json={"rating": 5}).status_code == 422
        for i in range(8):
            assert c.patch(f"/api/highlights/hl_{i}", json={"rating": ratings[i]["rating"]}).json()["rating"] == ratings[i]["rating"]
        st = c.get("/api/tuning").json()["modes"]["podcast"]
        assert sum(st["ratings"].values()) == 8 and st["can_learn"] is False
        assert c.post("/api/tuning/learn", json={"content_mode": "podcast"}).status_code == 400
        for i in range(8, 24):
            c.patch(f"/api/highlights/hl_{i}", json={"rating": ratings[i]["rating"]})
        res = c.post("/api/tuning/learn", json={"content_mode": "podcast"}).json()
        assert res["result"]["weights"]["hook"] > res["result"]["defaults"]["hook"]
        assert res["enabled"] == res["result"]["recommended"]
        c.post("/api/tuning/enabled", json={"content_mode": "podcast", "enabled": True})
        assert active_weights("podcast") == res["result"]["weights"]
        assert active_weights("gaming") is None  # other modes are untouched
        c.post("/api/tuning/enabled", json={"content_mode": "podcast", "enabled": False})
        assert active_weights("podcast") is None
        c.delete("/api/tuning/podcast")
        assert c.get("/api/tuning").json()["modes"]["podcast"]["learned"] is None
