"""Measure highlight detection against clips a person chose by hand.

Golden file (JSON) — one per video:

    {
      "video": "/path/to/episode.mp4",          # not needed with --project
      "content_mode": "podcast",                # optional analysis settings
      "min_duration": 15, "max_duration": 60,
      "clips": [{"start": 812.4, "end": 851.0, "label": "pricing story"}, ...]
    }

Usage:

    python -m clipforge.devtools.evaluate golden.json [more.json | folder/]
    python -m clipforge.devtools.evaluate golden.json --project pr_xxx      # score an existing project
    python -m clipforge.devtools.evaluate golden.json --compare --learned   # default vs your learned weights
    python -m clipforge.devtools.evaluate golden.json --weights hook=30,coherence=20

Videos are analysed in a separate workspace (``<data dir>/eval-workspace`` unless --data-dir is given),
so evaluation runs never appear in your library; transcripts and visual analysis are cached there,
so re-running with other weights only re-scores.

Metrics (predictions taken in rank order, one-to-one matching at IoU ≥ --iou):
precision, recall, F1, average precision, mean IoU of matches, start/end boundary error, and for
every golden clip the best IoU any prediction reached.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path
from typing import Any


# ----------------------------------------------------------------------------- metrics (pure)
def iou(a: tuple[float, float], b: tuple[float, float]) -> float:
    inter = max(0.0, min(a[1], b[1]) - max(a[0], b[0]))
    union = (a[1] - a[0]) + (b[1] - b[0]) - inter
    return inter / union if union > 0 else 0.0


def score(pred: list[tuple[float, float]], gold: list[tuple[float, float]], thr: float = 0.5) -> dict[str, Any]:
    """``pred`` in rank order (best first)."""
    used: set[int] = set()
    matches: list[tuple[int, int, float]] = []
    ap_sum = 0.0
    for k, p in enumerate(pred):
        best, bj = 0.0, -1
        for j, g in enumerate(gold):
            if j in used:
                continue
            v = iou(p, g)
            if v > best:
                best, bj = v, j
        if bj >= 0 and best >= thr:
            used.add(bj)
            matches.append((k, bj, best))
            ap_sum += len(matches) / (k + 1)  # precision at this rank
    m = len(matches)
    precision = m / len(pred) if pred else 0.0
    recall = m / len(gold) if gold else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    ds = [abs(pred[k][0] - gold[j][0]) for k, j, _ in matches]
    de = [abs(pred[k][1] - gold[j][1]) for k, j, _ in matches]
    return {
        "predictions": len(pred), "golden": len(gold), "matched": m,
        "precision": precision, "recall": recall, "f1": f1,
        "average_precision": ap_sum / len(gold) if gold else 0.0,
        "mean_iou": statistics.fmean(v for *_, v in matches) if matches else 0.0,
        "start_error_s": statistics.fmean(ds) if ds else None,
        "end_error_s": statistics.fmean(de) if de else None,
        "best_iou_per_golden": [round(max((iou(p, g) for p in pred), default=0.0), 3) for g in gold],
        "matches": [{"rank": k + 1, "golden": j, "iou": round(v, 3)} for k, j, v in matches],
    }


def aggregate(results: list[dict[str, Any]]) -> dict[str, Any]:
    """Micro-averaged precision/recall over all videos; AP and IoU averaged per video."""
    P = sum(r["predictions"] for r in results)
    G = sum(r["golden"] for r in results)
    M = sum(r["matched"] for r in results)
    p = M / P if P else 0.0
    r = M / G if G else 0.0
    errs_s = [r_["start_error_s"] for r_ in results if r_["start_error_s"] is not None]
    errs_e = [r_["end_error_s"] for r_ in results if r_["end_error_s"] is not None]
    return {"videos": len(results), "predictions": P, "golden": G, "matched": M, "precision": p, "recall": r,
            "f1": 2 * p * r / (p + r) if p + r else 0.0,
            "average_precision": statistics.fmean(x["average_precision"] for x in results) if results else 0.0,
            "mean_iou": statistics.fmean(x["mean_iou"] for x in results if x["matched"]) if M else 0.0,
            "start_error_s": statistics.fmean(errs_s) if errs_s else None,
            "end_error_s": statistics.fmean(errs_e) if errs_e else None}


# ----------------------------------------------------------------------------- inputs
def load_golden(paths: list[str]) -> list[tuple[Path, dict[str, Any]]]:
    files: list[Path] = []
    for p in map(Path, paths):
        files += sorted(p.glob("*.json")) if p.is_dir() else [p]
    out = []
    for f in files:
        doc = json.loads(f.read_text())
        clips = doc.get("clips") if isinstance(doc, dict) else doc
        if not clips:
            raise SystemExit(f"{f}: no golden clips")
        for c in clips:
            if not (0 <= float(c["start"]) < float(c["end"])):
                raise SystemExit(f"{f}: invalid clip {c}")
        if isinstance(doc, list):
            doc = {"clips": doc}
        if doc.get("video") and not Path(doc["video"]).is_absolute():
            doc["video"] = str((f.parent / doc["video"]).resolve())
        out.append((f, doc))
    return out


def parse_weights(s: str | None) -> dict[str, float] | None:
    if not s:
        return None
    from ..analysis.modes import FACTORS

    w = {}
    for part in s.split(","):
        k, _, v = part.partition("=")
        k = k.strip()
        if k not in FACTORS:
            raise SystemExit(f"Unknown factor '{k}' (use {', '.join(FACTORS)})")
        w[k] = float(v)
    return w


class _Ctx:
    def __init__(self, quiet: bool):
        from ..util.proc import CancelToken

        self.token = CancelToken()
        self.quiet = quiet
        self.warnings: list[str] = []

    def stage(self, n):
        if not self.quiet:
            print(f"    · {n}", file=sys.stderr)

    def progress(self, p):
        pass

    def warn(self, m):
        self.warnings.append(m)

    def info(self, m):
        pass


# ----------------------------------------------------------------------------- running
def _use_data_dir(path: Path) -> None:
    from .. import config, db

    os.environ["CLIPFORGE_DATA_DIR"] = str(path)
    config.reset_config_cache()
    db.reset_engine()


def _project_for(video: Path) -> tuple[str, str]:
    """Reuse the workspace project for this file (keeps caches warm), else create one."""
    from sqlmodel import select

    from ..db import session_scope
    from ..media.ffprobe import probe
    from ..models import MediaSource, Project
    from ..util.files import file_fingerprint, new_id

    fp = file_fingerprint(video)
    with session_scope() as s:
        src = s.exec(select(MediaSource).where(MediaSource.fingerprint == fp)).first()
        if src:
            return src.project_id, src.id
        pid, sid = new_id("pr_"), new_id("src_")
        s.add(Project(id=pid, name=f"eval: {video.name}"))
        s.commit()
        s.add(MediaSource(id=sid, project_id=pid, path=str(video), original_name=video.name, size_bytes=video.stat().st_size,
                          fingerprint=fp, probe=probe(video)))
        s.commit()
        return pid, sid


def _analyse(video: Path, doc: dict[str, Any], args, weights: dict[str, float] | None) -> list[tuple[float, float]]:
    from ..analysis.pipeline import latest_highlights, run_analysis
    from ..schemas import AnalysisSettings

    pid, sid = _project_for(video)
    kw: dict[str, Any] = {"content_mode": doc.get("content_mode", args.mode), "transcription_engine": args.engine,
                          "whisper_model": args.whisper_model, "count": args.top or max(10, 2 * len(doc["clips"])),
                          "factor_weights": weights, "analysis_mode": args.analysis_mode}
    if doc.get("min_duration") or doc.get("max_duration"):
        kw.update(duration_preset="custom", min_duration=doc.get("min_duration"), max_duration=doc.get("max_duration"))
    ctx = _Ctx(args.quiet)
    run_analysis(pid, sid, AnalysisSettings(**{k: v for k, v in kw.items() if v is not None}), ctx, {})
    return [(h.start, h.end) for h in latest_highlights(pid)]


def _project_predictions(pid: str, top: int | None) -> list[tuple[float, float]]:
    from ..analysis.pipeline import latest_highlights

    hls = latest_highlights(pid)
    if not hls:
        raise SystemExit(f"Project {pid} has no highlights (analyse it first)")
    hls = sorted(hls, key=lambda h: h.rank)
    return [(h.start, h.end) for h in (hls[:top] if top else hls)]


def _learned_weights(mode: str) -> dict[str, float] | None:
    from ..analysis import tuning

    entry = tuning._load().get(mode) or {}
    return (entry.get("result") or {}).get("weights")


def _fmt(x: float | None, pct: bool = True) -> str:
    if x is None:
        return "—"
    return f"{x * 100:5.1f}%" if pct else f"{x:5.2f}s"


def _print_row(name: str, r: dict[str, Any]) -> None:
    print(f"  {name:<28} P {_fmt(r['precision'])}  R {_fmt(r['recall'])}  F1 {_fmt(r['f1'])}  AP {_fmt(r['average_precision'])}  "
          f"IoU {r['mean_iou']:.2f}  Δstart {_fmt(r['start_error_s'], False)}  Δend {_fmt(r['end_error_s'], False)}"
          f"  ({r['matched']}/{r['golden']} found, {r['predictions']} predicted)")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m clipforge.devtools.evaluate", description=__doc__.split("\n\n")[0])
    ap.add_argument("golden", nargs="+", help="golden JSON file(s) or folder(s)")
    ap.add_argument("--project", help="score this existing project's latest highlights instead of analysing")
    ap.add_argument("--iou", type=float, default=0.5, help="IoU needed for a match (default 0.5)")
    ap.add_argument("--top", type=int, help="number of highlights to request/score (default: max(10, 2×golden))")
    ap.add_argument("--mode", default="podcast", help="content mode when the golden file has none")
    ap.add_argument("--analysis-mode", default="balanced", choices=["fast", "balanced", "deep"])
    ap.add_argument("--engine", default="auto", choices=["auto", "faster-whisper", "pocketsphinx"])
    ap.add_argument("--whisper-model", help="faster-whisper model name or local path")
    ap.add_argument("--weights", help="factor weights, e.g. hook=30,coherence=20 (others keep their default)")
    ap.add_argument("--learned", action="store_true", help="use the weights learned from your ratings")
    ap.add_argument("--compare", action="store_true", help="also score the mode's default weights for comparison")
    ap.add_argument("--data-dir", help="evaluation workspace (default: <ClipForge data dir>/eval-workspace)")
    ap.add_argument("--json", help="write the full report here")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    from ..config import get_config

    golden = load_golden(args.golden)
    custom = parse_weights(args.weights)
    learned: dict[str, dict[str, float] | None] = {}
    if args.learned:  # read from the user's own library before switching to the workspace
        for _, doc in golden:
            mode = doc.get("content_mode", args.mode)
            learned[mode] = _learned_weights(mode)
            if not learned[mode]:
                raise SystemExit(f"No learned weights for '{mode}' yet (rate clips, then Settings → Personal tuning).")

    variants: list[tuple[str, Any]] = []
    if args.compare or not (custom or args.learned):
        variants.append(("default weights", None))
    if custom:
        variants.append(("custom weights", custom))
    if args.learned:
        variants.append(("learned weights", "learned"))

    if args.project:
        if len(golden) != 1:
            raise SystemExit("--project takes exactly one golden file")
        variants = [("project highlights", None)]
    else:
        _use_data_dir(Path(args.data_dir) if args.data_dir else get_config().data_dir / "eval-workspace")

    report: dict[str, Any] = {"iou_threshold": args.iou, "created_at": time.time(), "variants": {}}
    for name, w in variants:
        per = []
        print(f"\n{name}")
        for f, doc in golden:
            gold = [(float(c["start"]), float(c["end"])) for c in doc["clips"]]
            if args.project:
                pred = _project_predictions(args.project, args.top)
            else:
                video = Path(doc.get("video") or "")
                if not video.is_file():
                    raise SystemExit(f"{f}: video not found ({video})")
                weights = learned.get(doc.get("content_mode", args.mode)) if w == "learned" else w
                t0 = time.time()
                pred = _analyse(video, doc, args, weights)
                if not args.quiet:
                    print(f"    analysed {video.name} in {time.time() - t0:.0f}s", file=sys.stderr)
            r = score(pred, gold, args.iou)
            r["file"] = str(f)
            per.append(r)
            _print_row(f.stem[:28], r)
        agg = aggregate(per)
        if len(per) > 1:
            _print_row("ALL", agg)
        report["variants"][name] = {"aggregate": agg, "per_video": per}
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=1))
        print(f"\nreport → {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
