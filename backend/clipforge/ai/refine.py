"""Optional language-model refinement of highlight candidates.

The model never proposes raw timestamps. It sees numbered sentences and may
only (a) rate hook/payoff/novelty within bounds, (b) suggest a title, topic and
reason, and (c) suggest moving the start/end by whole sentences. Every field is
validated; anything out of range is discarded and the deterministic value kept.
"""

from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field

from .providers import Provider, ProviderError

log = logging.getLogger(__name__)


class CandidateJudgement(BaseModel):
    candidate_id: int
    hook: float = Field(ge=0, le=10)
    payoff: float = Field(ge=0, le=10)
    novelty: float = Field(ge=0, le=10)
    title: str = Field(max_length=90)
    topic: str = Field(max_length=60)
    reason: str = Field(max_length=300)
    audience: str = Field(max_length=100)
    issues: list[str] = Field(max_length=4)
    start_sentence: int
    end_sentence: int


class RefineResponse(BaseModel):
    judgements: list[CandidateJudgement]


SYSTEM = (
    "You are a senior short-form video editor. You review candidate clips cut from a longer video's transcript. "
    "Judge each candidate only on the words provided. Never invent quotes, facts, numbers or claims. "
    "Titles must describe what is actually said, without clickbait promises. Scores are 0-10."
)


def build_prompt(cands: list[dict[str, Any]], sentences: list[dict[str, Any]], mode_label: str, instructions: str, platform: str) -> str:
    lines = [f"Content type: {mode_label}. Target platform: {platform}."]
    if instructions:
        lines.append(f"User instructions: {instructions}")
    lines.append("For each candidate, rate: hook (first seconds grab attention), payoff (satisfying conclusion), "
                 "novelty (interesting/insightful). You may adjust start_sentence/end_sentence by at most 2 sentences "
                 "to fix a broken opening or ending; otherwise return the given values.\n")
    for k, c in enumerate(cands):
        lo = max(0, c["s0"] - 2)
        hi = min(len(sentences) - 1, c["s1"] + 2)
        lines.append(f"### Candidate {k} (sentences {c['s0']}–{c['s1']}, {c['duration']:.0f}s)")
        for i in range(lo, hi + 1):
            mark = " " if c["s0"] <= i <= c["s1"] else "~"
            lines.append(f"{mark}[{i}] {sentences[i]['text']}")
        lines.append("")
    lines.append("Sentences marked ~ are context outside the candidate.")
    return "\n".join(lines)


def refine_candidates(
    provider: Provider, cands: list[dict[str, Any]], sentences: list[dict[str, Any]], ctx, rescore,
    mode_label: str, instructions: str, platform: str, batch: int = 8,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return refined candidates and a report. ``rescore(c)`` recomputes deterministic scores."""
    report = {"provider": provider.name, "model": getattr(provider, "model", None), "accepted": 0, "rejected": 0,
              "errors": [], "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}
    out = list(cands)
    for b0 in range(0, len(cands), batch):
        group = cands[b0 : b0 + batch]
        prompt = build_prompt(group, sentences, mode_label, instructions, platform)
        try:
            resp, usage = provider.generate_json(SYSTEM, prompt, RefineResponse, purpose="highlight_refine")
        except ProviderError as e:
            report["errors"].append(str(e))
            log.warning("LLM refinement failed: %s", e)
            break
        report["input_tokens"] += usage.input_tokens
        report["output_tokens"] += usage.output_tokens
        report["cost_usd"] += usage.cost_usd
        for j in resp.judgements:
            if not 0 <= j.candidate_id < len(group):
                report["rejected"] += 1
                continue
            orig = group[j.candidate_id]
            new = dict(orig)
            # Boundary changes: whole sentences only, max 2, and must keep duration in range.
            s0, s1 = j.start_sentence, j.end_sentence
            if (s0, s1) != (orig["s0"], orig["s1"]):
                ok = (0 <= s0 <= s1 < len(sentences) and abs(s0 - orig["s0"]) <= 2 and abs(s1 - orig["s1"]) <= 2)
                if ok:
                    dur = sentences[s1]["end"] - sentences[s0]["start"]
                    ok = ctx.min_dur - 1 <= dur <= ctx.max_dur + 1
                if ok:
                    new.update(s0=s0, s1=s1, start=max(0.0, sentences[s0]["start"] - 0.15), end=sentences[s1]["end"] + 0.3)
                    new = rescore(new)
                else:
                    report["rejected"] += 1
            # Blend LLM ratings into three factors (50/50 with deterministic evidence).
            bd = new["breakdown"]
            for key, val in (("hook", j.hook), ("payoff", j.payoff), ("novelty", j.novelty)):
                f = bd[key]
                det = f["raw"]
                blended = 0.5 * det + 0.5 * (val / 10.0)
                f["raw"] = round(blended, 3)
                f["points"] = round(blended * f["max"], 1)
                f["evidence"] = (f["evidence"] + [f"LLM rating {val:.0f}/10"])[:5]
            total = sum(v["points"] for v in bd.values()) + sum(a["points"] for a in new.get("adjustments", []))
            new["score"] = round(max(0.0, min(100.0, total)), 1)
            new["llm"] = {"title": j.title.strip(), "topic": j.topic.strip(), "reason": j.reason.strip(),
                          "audience": j.audience.strip(), "issues": [x.strip() for x in j.issues if x.strip()][:4]}
            out[b0 + j.candidate_id] = new
            report["accepted"] += 1
    report["cost_usd"] = round(report["cost_usd"], 5)
    return out, report
