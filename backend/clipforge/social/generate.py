"""Platform posting packages grounded in the clip's actual words.

Local generation is extractive: titles and descriptions are built from the
clip's own sentences, so they cannot contain invented quotes, statistics or
claims. Optional LLM generation is validated: any number or quoted phrase that
does not appear in the transcript is removed and reported.
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field

from ..analysis.highlights import guess_audience
from ..analysis.modes import MODES, PLATFORMS, cue_hits, negative_hits
from ..analysis.text import STOPWORDS, TfIdf, is_topic_phrase, keyphrases, stem, title_case, truncate_words
from ..edit.timemap import segments, source_to_timeline
from ..schemas import Timeline

DOMAIN_TAGS = {
    "personal finance and investing": ["PersonalFinance", "Investing", "MoneyTips"],
    "entrepreneurs and business builders": ["Business", "Entrepreneurship", "Startups"],
    "tech enthusiasts": ["Tech", "Technology"],
    "fitness and health audiences": ["Health", "Fitness", "Wellness"],
    "gamers": ["Gaming", "Gamer"],
    "sports fans": ["Sports"],
    "learners and students": ["Learning", "Education"],
    "people interested in relationships and self-improvement": ["SelfImprovement", "Mindset"],
    "food lovers": ["Food", "Cooking"],
    "travellers": ["Travel"],
}
MODE_TAGS = {"podcast": ["Podcast"], "interview": ["Interview"], "educational": ["LearnOnTikTok"], "gaming": ["Gaming"],
             "sports": ["Sports"], "entertainment": ["Funny"], "business": ["Business"], "custom": []}
PLATFORM_TAGS = {"shorts": ["Shorts"], "tiktok": [], "reels": [], "facebook": [], "linkedin": [], "x": [], "custom": []}
_LEAD = re.compile(r"^(so|and|but|well|okay|ok|honestly|look|basically|actually|now|anyway|yeah|right)[,\s]+", re.I)
_LESSON_LEAD = re.compile(r"^(so\s+)?(the lesson is( simple)?|the point is|the key is|the takeaway is|bottom line( is)?|what i learned( is)?)[,:\s]+", re.I)


class PackageContent(BaseModel):
    titles: list[dict[str, str]] = Field(default_factory=list)
    descriptions: dict[str, str] = Field(default_factory=dict)
    hashtags: list[str] = Field(default_factory=list)
    hook_text: str = ""
    thumbnail_title: str = ""
    keywords: list[str] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)
    grounding: dict[str, Any] = Field(default_factory=dict)


def clip_sentences(tl: Timeline, sentences: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sentences whose speech survives in the edit (in timeline order)."""
    segs = segments(tl)
    out = []
    for s in sentences:
        m = source_to_timeline(segs, s["start"], s["end"])
        if m is not None or any(sg.s0 <= s["start"] + 0.1 and s["end"] - 0.1 <= sg.s1 for sg in segs):
            out.append(s)
    return out


def _clean(s: str) -> str:
    s = _LEAD.sub("", s.strip())
    s = _LEAD.sub("", s)
    return s[:1].upper() + s[1:] if s else s


def _first_clause(s: str, max_words: int = 9) -> str:
    parts = re.split(r"(?<=[,;:—–-])\s+", s)
    out = parts[0].rstrip(",;:—–-")
    words = out.split()
    if len(words) > max_words:
        out = " ".join(words[:max_words])
    return out


def _hashtag(phrase: str) -> str | None:
    words = re.findall(r"[A-Za-z0-9]+", phrase)
    if not words:
        return None
    tag = "".join(w[:1].upper() + w[1:] for w in words)
    if len(tag) < 3 or len(tag) > 28 or tag.isdigit():
        return None
    return tag


def generate_local(tl: Timeline, sents: list[dict[str, Any]], platform: str, content_mode: str, max_hashtags: int | None,
                   project_name: str = "", face_presence: float = 0.0, corpus: list[str] | None = None) -> PackageContent:
    texts = [s["text"].strip() for s in sents] or [" ".join(w.text for w in tl.captions.words)]
    # IDF from the whole video's transcript makes clip keywords distinctive, not just frequent.
    tfidf = TfIdf(corpus or texts)
    kp_all = keyphrases(texts, tfidf, top=12)
    kp = [k for k in kp_all if is_topic_phrase(k)] or kp_all
    cues = [cue_hits(t) for t in texts]
    neg = [negative_hits(t) for t in texts]
    usable = [i for i, t in enumerate(texts) if not neg[i].get("greeting") and not neg[i].get("outro") and len(t.split()) >= 3]
    if not usable:
        usable = list(range(len(texts)))
    hook_i = usable[0]
    q_i = next((i for i in usable if texts[i].rstrip().endswith("?")), None)
    pay_i = next((i for i in reversed(usable) if cues[i].get("payoff") or cues[i].get("explain")), usable[-1])
    stmt = [i for i in usable if not texts[i].rstrip().endswith("?") and i != q_i]
    bold_i = next((i for i in stmt if any(c in cues[i] for c in ("bold", "warning", "opinion", "surprise"))),
                  next((i for i in stmt if i != pay_i), stmt[0] if stmt else hook_i))
    hook = _clean(texts[hook_i])
    payoff = _LESSON_LEAD.sub("", _clean(texts[pay_i]))
    payoff = payoff[:1].upper() + payoff[1:]
    topic = title_case(kp[0]) if kp else "This clip"
    titles = []
    if q_i is not None:
        titles.append({"style": "curiosity", "text": truncate_words(_clean(texts[q_i]), 80)})
    else:
        clause = _first_clause(hook, 9).rstrip(".!,;:")
        full = hook.rstrip(".!")
        if len(clause.split()) < 4 or clause == full:
            # Short clause: use the full opening line (an open loop only if we really cut it).
            titles.append({"style": "curiosity", "text": truncate_words(full, 80)})
        else:
            titles.append({"style": "curiosity", "text": clause + "…"})
    informative = f"{topic}: {payoff.rstrip('.')}" if kp and is_topic_phrase(kp[0]) else payoff.rstrip(".")
    titles.append({"style": "informative", "text": truncate_words(informative, 90)})
    bold_src = _clean(texts[bold_i]).rstrip(".")
    titles.append({"style": "bold", "text": truncate_words(f"“{bold_src}”", 90)})
    # Descriptions (extractive)
    order = sorted({hook_i, pay_i, bold_i})
    short = truncate_words(payoff if pay_i != hook_i else hook, 150)
    medium = truncate_words(" ".join(_clean(texts[i]) for i in order), 300)
    topics_line = ", ".join(kp[:4])
    src_line = f" From {project_name}." if project_name else ""
    long = truncate_words(" ".join(_clean(t) for i, t in enumerate(texts) if i in usable), 650)
    long = f"{long}\n\nTopics: {topics_line}.{src_line}".strip()
    # Hashtags
    terms = {stem(w) for t in texts for w in re.findall(r"[a-zA-Z']+", t.lower()) if w not in STOPWORDS}
    audience = guess_audience(terms, MODES.get(content_mode, MODES["podcast"]))
    kp_tags = [h for h in (_hashtag(p) for p in kp[:6]) if h]
    ordered = kp_tags[:3] + DOMAIN_TAGS.get(audience[:1].lower() + audience[1:], [])[:2] + PLATFORM_TAGS.get(platform, []) \
        + MODE_TAGS.get(content_mode, []) + kp_tags[3:]
    tags: list[str] = []
    for t in ordered:
        if t.lower() not in {x.lower() for x in tags}:
            tags.append(t)
    limit = max_hashtags if max_hashtags is not None else PLATFORMS.get(platform, PLATFORMS["tiktok"])["hashtags"]
    tags = ["#" + t for t in tags[: max(0, limit)]]
    if q_i is not None and len(texts[q_i].split()) <= 10:
        hook_text = _clean(texts[q_i])
    else:
        src_line = _clean(texts[q_i]) if q_i is not None else hook
        clause = _first_clause(src_line, 30).rstrip(".!,;:")
        if len(clause.split()) < 3:
            clause = src_line.rstrip(".!")
        hook_text = clause if len(clause.split()) <= 8 else truncate_words(clause, 44)
    thumb = title_case(kp[0]) if kp and is_topic_phrase(kp[0]) else title_case(" ".join(_first_clause(payoff, 4).split()[:4])).rstrip(".,")
    keywords = kp[:8]
    dur = tl.duration
    prof = PLATFORMS.get(platform, PLATFORMS["tiktok"])
    sug = []
    lo, hi = prof["ideal"]
    if dur > prof["max"]:
        sug.append(f"{dur:.0f}s is longer than {prof['label']} allows ({prof['max']}s) — trim before posting.")
    elif lo <= dur <= hi:
        sug.append(f"{dur:.0f}s fits {prof['label']}'s typical short-form length ({lo}–{hi}s).")
    else:
        sug.append(f"{dur:.0f}s is outside the typical {lo}–{hi}s range for {prof['label']}; it can still work if the pacing holds.")
    if tl.canvas.aspect != prof["aspect"]:
        sug.append(f"{prof['label']} usually favours {prof['aspect']}; this export is {tl.canvas.aspect}.")
    if tl.captions.enabled:
        sug.append("Captions are burned in, which helps viewers watching without sound.")
    else:
        sug.append("No burned-in captions: consider enabling them or uploading the SRT file.")
    if face_presence > 0.5:
        sug.append("Pick a cover frame that shows the speaker's face clearly.")
    sug.append(f"Use the hook text “{hook_text}” as the first on-screen line or caption opener.")
    if content_mode == "business" or audience.startswith("Personal finance"):
        sug.append("Keep the post educational; avoid presenting it as personalised financial advice.")
    return PackageContent(
        titles=titles, descriptions={"short": short, "medium": medium, "long": long}, hashtags=tags, hook_text=hook_text,
        thumbnail_title=thumb, keywords=keywords, suggestions=sug,
        grounding={"method": "extractive", "source_sentences": [texts[i] for i in order], "audience": audience},
    )


# ----------------------------------------------------------------------------- LLM generation

class LLMPackage(BaseModel):
    title_curiosity: str = Field(max_length=100)
    title_informative: str = Field(max_length=100)
    title_bold: str = Field(max_length=100)
    description_short: str = Field(max_length=220)
    description_medium: str = Field(max_length=500)
    description_long: str = Field(max_length=1200)
    hashtags: list[str] = Field(max_length=15)
    hook_text: str = Field(max_length=60)
    thumbnail_title: str = Field(max_length=40)
    keywords: list[str] = Field(max_length=12)
    posting_suggestions: list[str] = Field(max_length=5)


def _ground(text: str, transcript: str) -> tuple[str, list[str]]:
    """Remove numbers or quoted phrases not present in the transcript."""
    issues = []
    tl = transcript.lower()
    for q in re.findall(r"[“\"]([^”\"]{4,})[”\"]", text):
        if q.lower().strip(" .,!?") not in tl:
            issues.append(f"Removed unsupported quote: “{q}”")
            text = text.replace(f"“{q}”", q).replace(f"\"{q}\"", q)
    for n in re.findall(r"\$?\d[\d,.]*%?", text):
        if n.strip("$%,.") not in tl.replace(",", ""):
            issues.append(f"Removed unsupported figure: {n}")
            text = text.replace(n, "").replace("  ", " ")
    return text.strip(), issues


def generate_llm(provider, tl: Timeline, sents: list[dict[str, Any]], platform: str, content_mode: str, max_hashtags: int | None,
                 base: PackageContent) -> tuple[PackageContent, dict[str, Any]]:
    transcript = " ".join(s["text"] for s in sents)
    prof = PLATFORMS.get(platform, PLATFORMS["tiktok"])
    limit = max_hashtags if max_hashtags is not None else prof["hashtags"]
    system = ("You write social media copy for short video clips. Use ONLY information stated in the transcript. "
              "Never invent statistics, quotes, results or promises. Do not claim the clip will go viral. "
              "Hashtags are single words without spaces, relevant to the content, not generic spam.")
    prompt = (f"Platform: {prof['label']}. Content type: {MODES.get(content_mode, MODES['podcast']).label}. "
              f"Clip length: {tl.duration:.0f}s. Max hashtags: {limit}.\n\nTranscript of the clip:\n{transcript}\n\n"
              "Write three title options (curiosity-driven, clear and informative, bold), short/medium/long descriptions, "
              "hashtags, an opening hook text (max 6 words), a cover/thumbnail title (max 4 words), search keywords and "
              "up to 3 brief posting suggestions.")
    out, usage = provider.generate_json(system, prompt, LLMPackage, purpose="social_copy", max_tokens=3000)
    issues: list[str] = []

    def g(s: str) -> str:
        t, iss = _ground(s, transcript)
        issues.extend(iss)
        return t

    tags = []
    for h in out.hashtags:
        h = "#" + re.sub(r"[^A-Za-z0-9_]", "", h.lstrip("#"))
        if len(h) > 2 and h.lower() not in {x.lower() for x in tags}:
            tags.append(h)
    pkg = PackageContent(
        titles=[{"style": "curiosity", "text": g(out.title_curiosity)}, {"style": "informative", "text": g(out.title_informative)},
                {"style": "bold", "text": g(out.title_bold)}],
        descriptions={"short": g(out.description_short), "medium": g(out.description_medium), "long": g(out.description_long)},
        hashtags=tags[:limit], hook_text=g(out.hook_text), thumbnail_title=g(out.thumbnail_title),
        keywords=[k for k in out.keywords if k.strip()][:12],
        suggestions=[s for s in out.posting_suggestions if not re.search(r"viral|guarantee", s, re.I)][:3] + base.suggestions[:2],
        grounding={"method": f"llm:{provider.name}", "issues": issues},
    )
    return pkg, {"provider": usage.provider, "model": usage.model, "input_tokens": usage.input_tokens,
                 "output_tokens": usage.output_tokens, "cost_usd": round(usage.cost_usd, 5)}


def as_text(pkg: dict[str, Any], platform: str, video_name: str = "") -> str:
    c = pkg.get("chosen") or {}
    cont = pkg.get("content") or {}
    title = c.get("title") or (cont.get("titles") or [{}])[0].get("text", "")
    desc = c.get("description") or cont.get("descriptions", {}).get("medium", "")
    tags = c.get("hashtags") or cont.get("hashtags", [])
    lines = [f"Platform: {PLATFORMS.get(platform, {}).get('label', platform)}"]
    if video_name:
        lines.append(f"Video: {video_name}")
    lines += ["", "TITLE", title, "", "DESCRIPTION", desc, "", "HASHTAGS", " ".join(tags), "",
              "HOOK TEXT", cont.get("hook_text", ""), "", "THUMBNAIL TITLE", cont.get("thumbnail_title", ""), "",
              "TITLE OPTIONS"] + [f"- [{t['style']}] {t['text']}" for t in cont.get("titles", [])] + [
              "", "DESCRIPTIONS", f"Short: {cont.get('descriptions', {}).get('short', '')}",
              f"Medium: {cont.get('descriptions', {}).get('medium', '')}", f"Long: {cont.get('descriptions', {}).get('long', '')}",
              "", "KEYWORDS", ", ".join(cont.get("keywords", [])), "", "POSTING NOTES"] + [f"- {s}" for s in cont.get("suggestions", [])]
    return "\n".join(lines) + "\n"
