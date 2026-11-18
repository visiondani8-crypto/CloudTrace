"""Editorial presets, cue lexicons and the natural-language instruction parser.

Everything here is a *configurable editorial heuristic*, not a validated
predictor of performance. Weights are surfaced in the score breakdown so every
number can be traced back to evidence.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .text import stem

FACTORS = ["coherence", "hook", "payoff", "clarity", "visual", "novelty", "platform"]
FACTOR_LABELS = {
    "coherence": "Narrative coherence",
    "hook": "Opening hook quality",
    "payoff": "Payoff or useful conclusion",
    "clarity": "Audio and speech clarity",
    "visual": "Visual engagement",
    "novelty": "Novelty or interesting insight",
    "platform": "Fit for the selected platform",
}
DEFAULT_MAX = {"coherence": 25, "hook": 20, "payoff": 15, "clarity": 10, "visual": 10, "novelty": 10, "platform": 10}

# --------------------------------------------------------------------------- cue lexicons
# Each cue: (name, regex, weight). Patterns run on lower-cased sentence text.
CUES: dict[str, list[tuple[str, str]]] = {
    "howto": [("howto", r"^(here's how|here is how|this is how|let me show you|let me explain|the trick is|the secret is|here's what|here's why|this is why)\b")],
    "question": [("question", r"\?\s*$|^(why|how|what|when|where|who|which|is|are|do|does|did|can|could|would|should|have you|ever wonder)\b")],
    "direct_address": [("you", r"^(you|your|if you|have you|did you|do you|imagine)\b|\byou need to\b|\byou should\b|\byou have to\b")],
    "warning": [("warning", r"\b(never|stop|don't|do not|avoid|mistake|mistakes|warning|careful|biggest|worst|dangerous|trap|wrong)\b")],
    "bold": [("bold", r"\b(always|never|everyone|everybody|nobody|no one|the only|the best|the most|the truth|the secret|secret|here's the thing|the real reason|literally changed|game changer|completely)\b")],
    "surprise": [("surprise", r"\b(actually|surprising|surprisingly|turns out|believe it or not|wait|crazy|insane|shocking|shocked|couldn't believe|can't believe|blew my mind|plot twist|no idea|unexpected)\b")],
    "story": [("story", r"\b(when i was|one time|i remember|years ago|so there i was|true story|let me tell you|back when|the day i|i was \w+ years old|my first)\b")],
    "opinion": [("opinion", r"\b(i think|i believe|in my opinion|honestly|the problem is|the thing is|hot take|unpopular opinion|overrated|underrated|i disagree|i'd argue|to be honest|frankly)\b")],
    "humor": [("humor", r"\b(haha+|lol|joke|joking|funny|hilarious|ridiculous|laugh|laughing|laughter|\[laughter\]|\(laughs\)|kidding)\b")],
    "emotion": [("emotion", r"\b(love|hate|amazing|incredible|terrible|scared|afraid|angry|excited|wow|oh my god|no way|unbelievable|heartbreaking|cried|proud|furious|insane)\b")],
    "payoff": [("conclusion", r"\b(so the lesson|the lesson|that's why|that is why|the point is|bottom line|in the end|what i learned|the key is|the answer is|which means|that's how|the takeaway|takeaway|so basically|the result|ended up|that's the secret|and that's|so remember|so if you)\b")],
    "explain": [("explanation", r"\b(because|the reason|here's how|for example|for instance|which means|in other words|step one|first|second|third|works by|that means|the way it works)\b")],
    "specific": [("specifics", r"(\$\s?\d|\d+\s?%|\b\d+(\.\d+)?\b|\b(one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion|percent|twice|half)\b)")],
    "excitement": [("excitement", r"\b(let's go|lets go|no way|clutch|oh my god|did you see|gg|headshot|what a|come on|yes+|noo+|insane|unreal|let's goo+)\b")],
    "sports": [("sports", r"\b(goal|score[sd]?|touchdown|what a (shot|save|play|goal)|incredible|winner|championship|final|record|penalty|overtime)\b")],
    "finance": [("finance", r"\b(invest\w*|money|interest|debt|budget\w*|stock\w*|market\w*|tax\w*|sav(e|ing|ings)|income|retire\w*|portfolio|compound\w*|credit|loan|mortgage|inflation|wealth)\b")],
    "education": [("education", r"\b(learn\w*|understand\w*|explain\w*|concept|example|step|lesson|technique|method|principle|framework|tip|tips)\b")],
}
NEGATIVE_CUES: dict[str, str] = {
    "dependent_open": r"^(and|but|or|so|because|which|that|then|also|plus|cause|'cause|like)\b",
    "pronoun_open": r"^(it|this|that|these|those|he|she|they|him|her|them)\b(?!'s (a|the|how|why|what))",
    "backchannel_open": r"^(yeah|yes|right|exactly|totally|sure|mhm|mm|uh|um|okay|ok|true|absolutely|definitely)\b",
    "outro": r"\b(thanks for watching|thank you for watching|see you next time|see you in the next|don't forget to subscribe|that's it for today|that's all for today|until next time)\b",
    "greeting": r"\b(welcome back|hey guys|hi guys|what's up (guys|everyone)|subscribe|like and subscribe|hit the bell|today we're going to|in today's video|before we start|sponsor)\b",
    "trailing": r"(\.\.\.|…|,|\b(and|but|or|so|because|the|a|to|of|with|my|your))\s*$",
    "profanity": r"\b(fuck\w*|shit\w*|bitch\w*|asshole\w*|damn)\b",
}
FILLERS = {"um", "uh", "erm", "er", "ah", "uhm", "hmm", "mm", "mhm", "umm", "uhh"}
SOFT_FILLERS = ("you know", "i mean", "sort of", "kind of")

_compiled = {k: [(n, re.compile(p)) for n, p in v] for k, v in CUES.items()}
_neg = {k: re.compile(p) for k, p in NEGATIVE_CUES.items()}


def cue_hits(text: str) -> dict[str, int]:
    t = text.lower().strip()
    out: dict[str, int] = {}
    for k, pats in _compiled.items():
        n = sum(len(p.findall(t)) for _name, p in pats)
        if n:
            out[k] = n
    return out


def negative_hits(text: str) -> dict[str, bool]:
    t = text.lower().strip()
    return {k: bool(p.search(t)) for k, p in _neg.items() if p.search(t)}


# --------------------------------------------------------------------------- platform profiles
PLATFORMS: dict[str, dict[str, Any]] = {
    "tiktok": {"label": "TikTok", "ideal": (21, 60), "max": 600, "aspect": "9:16", "safe": {"top": 0.10, "bottom": 0.22, "left": 0.06, "right": 0.15}, "hashtags": 5},
    "reels": {"label": "Instagram Reels", "ideal": (15, 60), "max": 180, "aspect": "9:16", "safe": {"top": 0.12, "bottom": 0.22, "left": 0.06, "right": 0.14}, "hashtags": 5},
    "shorts": {"label": "YouTube Shorts", "ideal": (20, 58), "max": 180, "aspect": "9:16", "safe": {"top": 0.10, "bottom": 0.20, "left": 0.06, "right": 0.14}, "hashtags": 3},
    "facebook": {"label": "Facebook Reels", "ideal": (15, 60), "max": 90, "aspect": "9:16", "safe": {"top": 0.12, "bottom": 0.22, "left": 0.06, "right": 0.14}, "hashtags": 4},
    "linkedin": {"label": "LinkedIn video", "ideal": (30, 90), "max": 600, "aspect": "4:5", "safe": {"top": 0.06, "bottom": 0.10, "left": 0.05, "right": 0.05}, "hashtags": 4},
    "x": {"label": "X video", "ideal": (15, 75), "max": 140, "aspect": "16:9", "safe": {"top": 0.06, "bottom": 0.10, "left": 0.05, "right": 0.05}, "hashtags": 2},
    "custom": {"label": "Custom", "ideal": (20, 60), "max": 600, "aspect": "9:16", "safe": {"top": 0.08, "bottom": 0.12, "left": 0.06, "right": 0.06}, "hashtags": 5},
}


# --------------------------------------------------------------------------- content modes
@dataclass
class ModeConfig:
    key: str
    label: str
    description: str
    factor_max: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_MAX))
    # Multipliers applied to hook/payoff/novelty cue families.
    cue_weights: dict[str, float] = field(default_factory=dict)
    exchange_bonus: float = 0.0  # reward speaker back-and-forth
    qa_bonus: float = 0.0  # reward question→answer structure
    motion_weight: float = 0.3  # how much motion contributes to visual engagement
    audio_peak_weight: float = 0.3  # energy peaks as hook/payoff evidence
    reframe_default: str = "auto"
    preserve_full_frame: bool = False


MODES: dict[str, ModeConfig] = {
    "podcast": ModeConfig(
        "podcast", "Podcast", "Compelling statements, opinions, stories and exchanges between speakers.",
        cue_weights={"opinion": 1.4, "story": 1.3, "bold": 1.2, "surprise": 1.2, "humor": 1.1},
        exchange_bonus=3.0, qa_bonus=2.0, reframe_default="speaker",
    ),
    "interview": ModeConfig(
        "interview", "Interview", "Strong answers, insights and reactions; keeps the question for context.",
        cue_weights={"opinion": 1.3, "story": 1.2, "explain": 1.2, "payoff": 1.2},
        qa_bonus=4.0, exchange_bonus=1.5, reframe_default="speaker",
    ),
    "educational": ModeConfig(
        "educational", "Educational", "Complete explanations and useful lessons with clear payoffs.",
        factor_max={"coherence": 27, "hook": 16, "payoff": 19, "clarity": 10, "visual": 6, "novelty": 12, "platform": 10},
        cue_weights={"explain": 1.6, "payoff": 1.5, "education": 1.5, "specific": 1.2, "question": 1.2},
        qa_bonus=1.5,
    ),
    "gaming": ModeConfig(
        "gaming", "Gaming", "Exceptional plays, reactions and funny moments; keeps gameplay visible.",
        factor_max={"coherence": 15, "hook": 22, "payoff": 15, "clarity": 6, "visual": 22, "novelty": 8, "platform": 12},
        cue_weights={"excitement": 2.0, "emotion": 1.5, "humor": 1.4, "surprise": 1.3},
        motion_weight=1.0, audio_peak_weight=1.0, reframe_default="fill", preserve_full_frame=True,
    ),
    "sports": ModeConfig(
        "sports", "Sports commentary", "Significant reactions and commentary; preserves the action.",
        factor_max={"coherence": 17, "hook": 21, "payoff": 15, "clarity": 8, "visual": 20, "novelty": 8, "platform": 11},
        cue_weights={"sports": 2.0, "excitement": 1.6, "emotion": 1.4},
        motion_weight=0.9, audio_peak_weight=1.0, reframe_default="fill", preserve_full_frame=True,
    ),
    "entertainment": ModeConfig(
        "entertainment", "Entertainment", "Humour, emotional reactions and memorable moments.",
        factor_max={"coherence": 22, "hook": 22, "payoff": 15, "clarity": 9, "visual": 12, "novelty": 10, "platform": 10},
        cue_weights={"humor": 1.8, "emotion": 1.5, "surprise": 1.4, "story": 1.2},
        audio_peak_weight=0.7,
    ),
    "business": ModeConfig(
        "business", "Business / Finance", "Insights, clear arguments and practical advice.",
        factor_max={"coherence": 26, "hook": 18, "payoff": 17, "clarity": 10, "visual": 6, "novelty": 13, "platform": 10},
        cue_weights={"finance": 1.3, "explain": 1.4, "payoff": 1.4, "specific": 1.3, "warning": 1.2, "opinion": 1.1},
        qa_bonus=1.5,
    ),
    "custom": ModeConfig("custom", "Custom", "Your own natural-language instructions steer selection and scoring."),
}


# --------------------------------------------------------------------------- custom instructions
@dataclass
class Instructions:
    raw: str = ""
    min_duration: float | None = None
    max_duration: float | None = None
    count: int | None = None
    boost_cues: dict[str, float] = field(default_factory=dict)
    boost_terms: list[str] = field(default_factory=list)  # stemmed
    avoid_terms: list[str] = field(default_factory=list)  # stemmed
    pause_penalty: float = 1.0
    avoid_intros: bool = False
    avoid_profanity: bool = False
    prefer_single_speaker: bool = False
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items()}


_THEME_WORDS: list[tuple[str, str, float, str]] = [
    (r"\b(funn(y|iest)|humou?r|jokes?|laugh\w*|hilarious|comedy|comedic)\b", "humor", 2.2, "Prioritising humour"),
    (r"\b(emotional|emotion|moving|touching|heartfelt|reactions?)\b", "emotion", 1.8, "Prioritising emotional moments"),
    (r"\b(insights?|lessons?|advice|tips?|takeaways?|actionable|practical)\b", "payoff", 1.8, "Prioritising lessons and takeaways"),
    (r"\b(explain\w*|educational|teach\w*|tutorial|how to)\b", "explain", 1.8, "Prioritising complete explanations"),
    (r"\b(stor(y|ies)|anecdotes?|personal)\b", "story", 2.0, "Prioritising stories"),
    (r"\b(controversial|hot takes?|opinions?|debate|argument|disagree\w*|spicy)\b", "opinion", 2.0, "Prioritising strong opinions"),
    (r"\b(questions?|q&a|answers?)\b", "question", 1.6, "Prioritising questions and answers"),
    (r"\b(surpris\w*|shocking|unexpected|mind.?blowing)\b", "surprise", 1.8, "Prioritising surprising statements"),
    (r"\b(exciting|hype|intense|epic|clutch|highlights? reel|plays?)\b", "excitement", 1.8, "Prioritising high-energy moments"),
    (r"\b(statistics?|numbers?|data|facts?)\b", "specific", 1.6, "Prioritising specific facts and figures"),
    (r"\b(warnings?|mistakes?|avoid(ing)? (these|common))\b", "warning", 1.6, "Prioritising warnings and mistakes"),
]

_NUM = r"(\d+(?:\.\d+)?)"


def _secs(v: str, unit: str | None) -> float:
    x = float(v)
    if unit and unit.startswith("m"):
        return x * 60
    return x


def parse_instructions(text: str) -> Instructions:
    """Convert free text into structured preferences that alter scoring.

    Example: "Find the funniest moments between 20 and 45 seconds and avoid clips
    with long pauses" → humour cue boost ×2.2, duration 20–45 s, pause penalty ×2.5.
    """
    ins = Instructions(raw=text or "")
    t = (text or "").lower()
    if not t.strip():
        return ins
    unit = r"\s*(s|sec|secs|seconds?|m|min|mins|minutes?)?"
    m = re.search(rf"between\s+{_NUM}{unit}\s+(?:and|to|-)\s+{_NUM}{unit}", t) or re.search(rf"{_NUM}{unit}\s*(?:-|–|to)\s*{_NUM}{unit}\b", t)
    if m:
        u2 = m.group(4) or m.group(2)
        ins.min_duration = _secs(m.group(1), m.group(2) or u2)
        ins.max_duration = _secs(m.group(3), u2)
        ins.notes.append(f"Duration {ins.min_duration:.0f}–{ins.max_duration:.0f} s")
    else:
        m = re.search(rf"(?:under|less than|shorter than|max(?:imum)?|at most|no longer than)\s+{_NUM}{unit}", t)
        if m:
            ins.max_duration = _secs(m.group(1), m.group(2))
            ins.notes.append(f"Maximum {ins.max_duration:.0f} s")
        m = re.search(rf"(?:over|more than|longer than|min(?:imum)?|at least)\s+{_NUM}{unit}", t)
        if m:
            ins.min_duration = _secs(m.group(1), m.group(2))
            ins.notes.append(f"Minimum {ins.min_duration:.0f} s")
    m = re.search(r"\b(?:top|best|give me|find|pick)\s+(\d{1,2})\b", t)
    if m:
        ins.count = max(1, min(50, int(m.group(1))))
        ins.notes.append(f"{ins.count} clips")
    # avoid clauses are parsed first so themes inside them don't count as boosts
    avoid_spans = [mm.span() for mm in re.finditer(r"\b(avoid|without|no|skip|exclude|don't include|not about)\b[^.,;]*", t)]

    def _in_avoid(pos: int) -> bool:
        return any(a <= pos < b for a, b in avoid_spans)

    for pat, cue, w, note in _THEME_WORDS:
        for mm in re.finditer(pat, t):
            if not _in_avoid(mm.start()):
                ins.boost_cues[cue] = max(ins.boost_cues.get(cue, 1.0), w)
                if note not in ins.notes:
                    ins.notes.append(note)
                break
    for a, b in avoid_spans:
        clause = t[a:b]
        if re.search(r"pauses?|silence|dead air|gaps?", clause):
            ins.pause_penalty = 2.5
            ins.notes.append("Penalising long pauses")
        elif re.search(r"intros?|greetings?|introductions?|sponsor", clause):
            ins.avoid_intros = True
            ins.notes.append("Avoiding intros and greetings")
        elif re.search(r"swear\w*|profanity|curs\w*|explicit", clause):
            ins.avoid_profanity = True
            ins.notes.append("Avoiding profanity")
        elif re.search(r"interrupt\w*|crosstalk|multiple speakers", clause):
            ins.prefer_single_speaker = True
            ins.notes.append("Preferring single-speaker passages")
        else:
            words = re.sub(r"^\W*(avoid|without|no|skip|exclude|don't include|not about)\b", "", clause)
            words = re.sub(r"\b(clips?|moments?|parts?|sections?|anything|about|that|with|the|mention\w*|talk\w*)\b", " ", words)
            terms = [stem(w) for w in re.findall(r"[a-z]{3,}", words)]
            if terms:
                ins.avoid_terms.extend(terms)
                ins.notes.append("Avoiding: " + ", ".join(sorted(set(terms))))
    for mm in re.finditer(r"\b(?:about|on|mentioning|related to|regarding|focus(?:ed|ing)? on|discussing|where (?:they|he|she|we) talks? about)\s+([a-z][a-z \-]{2,40})", t):
        if _in_avoid(mm.start()):
            continue
        phrase = re.split(r"\b(and|or|but|between|under|over|with|that|which|avoid)\b", mm.group(1))[0]
        terms = [stem(w) for w in re.findall(r"[a-z]{3,}", phrase) if w not in {"the", "moments", "clips", "parts"}]
        if terms:
            ins.boost_terms.extend(terms)
            ins.notes.append("Focusing on: " + " ".join(terms))
    ins.boost_terms = sorted(set(ins.boost_terms))
    ins.avoid_terms = sorted(set(ins.avoid_terms) - set(ins.boost_terms))
    return ins
