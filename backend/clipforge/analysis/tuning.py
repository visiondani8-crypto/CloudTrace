"""Personal tuning: learn factor weights from the user's highlight ratings.

Each rated highlight carries the seven raw factor values (0–1) that produced its score.
We look for weights w (points per factor, Σw = 100, every factor ≥ FLOOR) under which the
clips the user liked outscore the ones they disliked:

    minimise  Σ_pairs log(1 + exp(−(s(liked) − s(disliked)) / T))  +  λ·‖w − w_mode‖²

with s(x) = Σ w_i·x_i. The penalty keeps the result close to the content mode's defaults, so a
handful of ratings nudges the weights instead of overturning them. Optimised by projected
gradient descent on the simplex. Quality is reported honestly as pairwise ranking accuracy
of the default and learned weights, cross-validated over held-out ratings, and the learned
weights are only proposed when there is enough data.
"""

from __future__ import annotations

import math
import random
import time
from typing import Any

import numpy as np

from .modes import FACTORS, MODES

MIN_RATINGS = 10
MIN_PER_CLASS = 3
FLOOR = 2.0  # points: no factor is ever switched off completely
TEMPERATURE = 4.0  # score points per logit unit
L2 = 0.002


class TuningError(ValueError):
    pass


def default_weights(content_mode: str) -> dict[str, float]:
    fm = dict(MODES.get(content_mode, MODES["podcast"]).factor_max)
    total = sum(fm.values()) or 1.0
    return {k: fm[k] * 100.0 / total for k in FACTORS}


def _project(v: np.ndarray, floor: float = FLOOR, total: float = 100.0) -> np.ndarray:
    """Euclidean projection onto {w ≥ floor, Σw = total}."""
    n = v.size
    budget = total - floor * n
    u = v - floor
    # Simplex projection (Duchi et al. 2008)
    s = np.sort(u)[::-1]
    css = np.cumsum(s) - budget
    rho = np.nonzero(s * np.arange(1, n + 1) > css)[0][-1]
    theta = css[rho] / (rho + 1.0)
    return np.maximum(u - theta, 0.0) + floor


def _pairs(y: np.ndarray, rng: random.Random, cap: int = 4000) -> list[tuple[int, int]]:
    pos = [i for i, v in enumerate(y) if v > 0]
    neg = [i for i, v in enumerate(y) if v <= 0]
    pairs = [(a, b) for a in pos for b in neg]
    if len(pairs) > cap:
        pairs = rng.sample(pairs, cap)
    return pairs


def _fit(X: np.ndarray, y: np.ndarray, w0: np.ndarray, iters: int = 800, lr: float = 20.0, seed: int = 0) -> np.ndarray:
    pairs = _pairs(y, random.Random(seed))
    if not pairs:
        return w0.copy()
    D = np.array([X[a] - X[b] for a, b in pairs])  # liked − disliked factor values
    w = w0.copy()
    for t in range(iters):
        margin = D @ w / TEMPERATURE
        g_loss = -(D * (1.0 / (1.0 + np.exp(np.clip(margin, -50, 50))))[:, None]).mean(axis=0) / TEMPERATURE
        grad = g_loss + 2 * L2 * (w - w0)
        w = _project(w - lr / math.sqrt(1 + t / 50) * grad)  # step in points, decaying
    return w


def pairwise_accuracy(X: np.ndarray, y: np.ndarray, w: np.ndarray) -> float | None:
    s = X @ w
    pos = s[y > 0]
    neg = s[y <= 0]
    if not len(pos) or not len(neg):
        return None
    wins = (pos[:, None] > neg[None, :]).sum() + 0.5 * (pos[:, None] == neg[None, :]).sum()
    return float(wins / (len(pos) * len(neg)))


def _folds(y: np.ndarray, k: int, seed: int = 0) -> list[np.ndarray]:
    """Stratified folds so every held-out fold has liked and disliked clips."""
    rng = random.Random(seed)
    idx_pos = [i for i, v in enumerate(y) if v > 0]
    idx_neg = [i for i, v in enumerate(y) if v <= 0]
    rng.shuffle(idx_pos)
    rng.shuffle(idx_neg)
    folds: list[list[int]] = [[] for _ in range(k)]
    for j, i in enumerate(idx_pos):
        folds[j % k].append(i)
    for j, i in enumerate(idx_neg):
        folds[j % k].append(i)
    return [np.array(f) for f in folds if f]


def learn_weights(samples: list[dict[str, Any]], content_mode: str) -> dict[str, Any]:
    """``samples``: [{"raw": {factor: 0..1}, "rating": ±1}]. Returns weights + honest evaluation."""
    rated = [s for s in samples if s.get("rating") in (1, -1) and all(k in (s.get("raw") or {}) for k in FACTORS)]
    n_pos = sum(1 for s in rated if s["rating"] > 0)
    n_neg = len(rated) - n_pos
    if len(rated) < MIN_RATINGS or n_pos < MIN_PER_CLASS or n_neg < MIN_PER_CLASS:
        raise TuningError(
            f"Need at least {MIN_RATINGS} rated clips with {MIN_PER_CLASS}+ good and {MIN_PER_CLASS}+ bad "
            f"(have {n_pos} good, {n_neg} bad)."
        )
    X = np.array([[float(s["raw"][k]) for k in FACTORS] for s in rated])
    y = np.array([1 if s["rating"] > 0 else -1 for s in rated])
    prior = default_weights(content_mode)
    w0 = np.array([prior[k] for k in FACTORS])
    w = _fit(X, y, w0)

    # Cross-validated pairwise accuracy (held-out ratings only).
    k = min(5, n_pos, n_neg)
    cv_default, cv_learned, n_eval = [], [], 0
    for fold in _folds(y, k):
        train = np.setdiff1d(np.arange(len(y)), fold)
        if len(set(y[train])) < 2 or len(set(y[fold])) < 2:
            continue
        wf = _fit(X[train], y[train], w0)
        a0, a1 = pairwise_accuracy(X[fold], y[fold], w0), pairwise_accuracy(X[fold], y[fold], wf)
        if a0 is not None and a1 is not None:
            cv_default.append(a0)
            cv_learned.append(a1)
            n_eval += len(fold)
    weights = {f: round(float(v), 2) for f, v in zip(FACTORS, w)}
    # Round so the published weights still sum to exactly 100.
    drift = round(100.0 - sum(weights.values()), 2)
    top = max(weights, key=weights.get)
    weights[top] = round(weights[top] + drift, 2)
    cvd = float(np.mean(cv_default)) if cv_default else None
    cvl = float(np.mean(cv_learned)) if cv_learned else None
    return {
        "content_mode": content_mode,
        "weights": weights,
        "defaults": {f: round(v, 2) for f, v in prior.items()},
        "ratings": {"good": n_pos, "bad": n_neg},
        "train_accuracy": {"default": pairwise_accuracy(X, y, w0), "learned": pairwise_accuracy(X, y, w)},
        "cv_accuracy": {"default": cvd, "learned": cvl, "folds": len(cv_default), "held_out": n_eval},
        # Recommend only when held-out ranking does not get worse.
        "recommended": cvd is not None and cvl is not None and cvl >= cvd - 1e-9,
        "learned_at": time.time(),
    }


def explain_change(result: dict[str, Any]) -> list[str]:
    out = []
    for f in FACTORS:
        d = result["weights"][f] - result["defaults"][f]
        if abs(d) >= 1.0:
            out.append(f"{f}: {result['defaults'][f]:.0f} → {result['weights'][f]:.0f} pts ({'+' if d > 0 else ''}{d:.0f})")
    return out


def valid_weights(weights: dict[str, float]) -> bool:
    """Sanity: weights are finite, ≥ floor and sum to 100."""
    return all(math.isfinite(v) and v >= FLOOR - 1e-6 for v in weights.values()) and abs(sum(weights.values()) - 100) < 0.05


# --------------------------------------------------------------------------- storage (Setting row "tuning")
def _load() -> dict[str, Any]:
    from ..db import session_scope
    from ..models import Setting

    with session_scope() as s:
        row = s.get(Setting, "tuning")
        return dict(row.value or {}) if row else {}


def _save(value: dict[str, Any]) -> None:
    from ..db import session_scope
    from ..models import Setting

    with session_scope() as s:
        row = s.get(Setting, "tuning")
        if row is None:
            row = Setting(key="tuning", value=value)
        else:
            row.value = value
        s.add(row)
        s.commit()


def collect_samples(content_mode: str) -> list[dict[str, Any]]:
    """Rated highlights from projects analysed in this content mode."""
    from sqlmodel import select

    from ..db import session_scope
    from ..models import Highlight, Project

    with session_scope() as s:
        modes = {p.id: (p.settings or {}).get("content_mode", "podcast") for p in s.exec(select(Project))}
        rows = s.exec(select(Highlight).where(Highlight.rating != 0))
        return [{"id": h.id, "rating": h.rating, "raw": {k: (h.breakdown or {}).get(k, {}).get("raw") for k in FACTORS}}
                for h in rows if modes.get(h.project_id) == content_mode]


def status() -> dict[str, Any]:
    stored = _load()
    out = {}
    for mode in MODES:
        samples = collect_samples(mode)
        good = sum(1 for x in samples if x["rating"] > 0)
        entry = stored.get(mode) or {}
        out[mode] = {"label": MODES[mode].label, "ratings": {"good": good, "bad": len(samples) - good},
                     "can_learn": len(samples) >= MIN_RATINGS and good >= MIN_PER_CLASS and len(samples) - good >= MIN_PER_CLASS,
                     "defaults": {f: round(v, 2) for f, v in default_weights(mode).items()},
                     "learned": entry.get("result"), "enabled": bool(entry.get("enabled"))}
    return {"modes": out, "min_ratings": MIN_RATINGS, "min_per_class": MIN_PER_CLASS}


def learn_and_store(content_mode: str) -> dict[str, Any]:
    if content_mode not in MODES:
        raise TuningError(f"Unknown content mode {content_mode}")
    result = learn_weights(collect_samples(content_mode), content_mode)
    result["changes"] = explain_change(result)
    stored = _load()
    stored[content_mode] = {"result": result, "enabled": bool(result["recommended"])}
    _save(stored)
    return stored[content_mode]


def set_enabled(content_mode: str, enabled: bool) -> None:
    stored = _load()
    if content_mode not in stored or not stored[content_mode].get("result"):
        raise TuningError("Nothing learned yet for this content mode")
    stored[content_mode]["enabled"] = bool(enabled)
    _save(stored)


def reset(content_mode: str) -> None:
    stored = _load()
    stored.pop(content_mode, None)
    _save(stored)


def active_weights(content_mode: str) -> dict[str, float] | None:
    """Learned weights for this mode when the user has them switched on."""
    entry = _load().get(content_mode) or {}
    res = entry.get("result") or {}
    w = res.get("weights")
    if entry.get("enabled") and w and valid_weights(w):
        return dict(w)
    return None
