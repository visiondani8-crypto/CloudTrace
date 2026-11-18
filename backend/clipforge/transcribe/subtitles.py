"""SRT / WebVTT import and export."""

from __future__ import annotations

import re
from typing import Any

_TS = re.compile(r"(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})")


def fmt_ts(t: float, sep: str = ",") -> str:
    t = max(0.0, t)
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def parse_ts(s: str) -> float:
    m = _TS.search(s.strip())
    if not m:
        raise ValueError(f"Invalid timestamp: {s!r}")
    h = int(m.group(1) or 0)
    frac = m.group(4).ljust(3, "0")
    return h * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(frac) / 1000.0


def cues_to_srt(cues: list[dict[str, Any]]) -> str:
    out = []
    for i, c in enumerate(cues, 1):
        out.append(f"{i}\n{fmt_ts(c['start'])} --> {fmt_ts(c['end'])}\n{c['text'].strip()}\n")
    return "\n".join(out)


def cues_to_vtt(cues: list[dict[str, Any]]) -> str:
    out = ["WEBVTT", ""]
    for c in cues:
        out.append(f"{fmt_ts(c['start'], '.')} --> {fmt_ts(c['end'], '.')}\n{c['text'].strip()}\n")
    return "\n".join(out)


def parse_subtitles(text: str) -> list[dict[str, Any]]:
    """Parse SRT or VTT into cues [{start, end, text}]. Raises ValueError on bad input."""
    text = text.replace("\r\n", "\n").replace("\r", "\n").lstrip("﻿")
    blocks = re.split(r"\n\s*\n", text.strip())
    cues: list[dict[str, Any]] = []
    for b in blocks:
        lines = [ln for ln in b.split("\n") if ln.strip()]
        if not lines or lines[0].startswith("WEBVTT") or lines[0].startswith("NOTE"):
            continue
        ti = next((i for i, ln in enumerate(lines) if "-->" in ln), None)
        if ti is None:
            continue
        a, _, rest = lines[ti].partition("-->")
        start = parse_ts(a)
        end = parse_ts(rest.split()[0] if rest.split() else rest)
        body = " ".join(re.sub(r"<[^>]+>", "", ln).strip() for ln in lines[ti + 1 :]).strip()
        if end <= start or not body:
            continue
        cues.append({"start": round(start, 3), "end": round(end, 3), "text": body})
    if not cues:
        raise ValueError("No subtitle cues found. Supported formats: SRT and WebVTT.")
    return cues


def cues_to_words(cues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Distribute cue time across its words (imported subtitles lack word timing)."""
    words: list[dict[str, Any]] = []
    for c in cues:
        toks = c["text"].split()
        if not toks:
            continue
        total_chars = sum(len(t) for t in toks) or 1
        t = c["start"]
        span = c["end"] - c["start"]
        for tok in toks:
            d = span * len(tok) / total_chars
            words.append({"w": tok, "s": round(t, 3), "e": round(t + d, 3), "p": 1.0})
            t += d
    return words
