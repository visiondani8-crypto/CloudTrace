"""Lightweight, dependency-free text analytics (tokenising, TF-IDF, keyphrases)."""

from __future__ import annotations

import math
import re
from collections import Counter
from collections.abc import Iterable, Sequence

STOPWORDS = frozenset(
    """
a about above after again against all almost also am an and any are aren't as at be because been before being below
between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each else even
ever every few for from further get gets getting got gonna gotta had hadn't has hasn't have haven't having he he'd he'll
he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself
just kind know let's like lot make made many may me might more most much must mustn't my myself need no nor not now of
off oh ok okay on once one only or other ought our ours ourselves out over own pretty quite really right said same say
says see she she'd she'll she's should shouldn't so some something sort still such than that that's the their theirs
them themselves then there there's these they they'd they'll they're they've thing things think this those though
through to too uh um under until up us very want wanna was wasn't way we we'd we'll we're we've well were weren't what
what's when when's where where's whether which while who who's whom why why's will with won't would wouldn't yeah yes
yet you you'd you'll you're you've your yours yourself yourselves actually basically literally going go goes went come
comes came take takes took put puts look looks looked mean means meant thing guy guys stuff
""".split()
)

_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’\-]*")


def clean_word(w: str) -> str:
    return re.sub(r"^[^\w$%]+|[^\w%]+$", "", w.replace("’", "'")).lower()


def tokenize(text: str) -> list[str]:
    return [m.group(0).lower().replace("’", "'") for m in _WORD.finditer(text)]


def stem(w: str) -> str:
    """Tiny suffix-stripping stemmer (good enough for topic overlap)."""
    w = w.lower().strip("'")
    if w.endswith("'s"):
        w = w[:-2]
    if len(w) <= 4:
        return w
    for suf in ("ational", "ization", "fulness", "ousness", "iveness", "ments", "ment", "ings", "ing", "edly", "ies",
                "ied", "ness", "able", "ible", "ally", "ful", "ers", "ed", "es", "ly", "er", "s"):
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            base = w[: -len(suf)]
            if suf in ("ies", "ied"):
                base += "y"
            return base
    return w


def content_terms(text: str) -> list[str]:
    return [stem(t) for t in tokenize(text) if t not in STOPWORDS and len(t) > 2 and not t.isdigit()]


class TfIdf:
    """TF-IDF model over a list of documents (sentences or windows)."""

    def __init__(self, docs: Sequence[str]):
        self.doc_terms = [content_terms(d) for d in docs]
        df: Counter[str] = Counter()
        for terms in self.doc_terms:
            df.update(set(terms))
        n = max(1, len(docs))
        self.n = n
        self.idf = {t: math.log((1 + n) / (1 + c)) + 1.0 for t, c in df.items()}
        self.global_tf: Counter[str] = Counter()
        for terms in self.doc_terms:
            self.global_tf.update(terms)

    def vector(self, terms: Iterable[str]) -> dict[str, float]:
        tf = Counter(terms)
        v = {t: (1 + math.log(c)) * self.idf.get(t, math.log(1 + self.n) + 1.0) for t, c in tf.items()}
        norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        return {t: x / norm for t, x in v.items()}

    def doc_vector(self, i: int) -> dict[str, float]:
        return self.vector(self.doc_terms[i])

    def range_vector(self, i: int, j: int) -> dict[str, float]:
        terms: list[str] = []
        for k in range(i, j + 1):
            terms.extend(self.doc_terms[k])
        return self.vector(terms)

    def distinctiveness(self, terms: Sequence[str]) -> float:
        """Mean IDF of content terms normalised to 0..1 (rare vocabulary = higher)."""
        if not terms:
            return 0.0
        max_idf = math.log(1 + self.n) + 1.0
        return sum(self.idf.get(t, max_idf) for t in terms) / len(terms) / max_idf


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    if len(a) > len(b):
        a, b = b, a
    return sum(v * b.get(t, 0.0) for t, v in a.items())


GENERIC = frozenset("""
start started starts make makes work works biggest big small little long short simple good bad great best better
time times way ways people person everyone someone something anything everything nothing day days year years
lot lots part point thing things kind sort really need needs want wants said tell told talk talking keep give
first second third last next new old whole far more most less much many end ends sure maybe course able single
one two three four five six seven eight nine ten twenty thirty forty fifty hundred thousand million billion half
never always wait actually really honestly basically
""".split())
VERBISH = frozenset("""
steals steal stole slept sleep fell fall changed change learned learn open opens opened works worked stores store protects
protect remember remembers thought think thinks went goes said says got gets made makes took takes came comes found
finds felt feels knew knows told tells asked asks started starts tried tries wanted wants needed needs used uses
""".split())


def is_topic_phrase(phrase: str) -> bool:
    """Heuristic noun-phrase check for display topics (no POS tagger needed)."""
    ws = phrase.lower().split()
    return bool(ws) and not any(w in GENERIC or w in VERBISH or (w.endswith("ed") and len(w) > 4) for w in ws)


def keyphrases(texts: Sequence[str], tfidf: TfIdf | None = None, top: int = 8) -> list[str]:
    """Extract display keyphrases (unigrams + bigrams of content words), surface form preserved.

    Generic words are excluded; bigrams of two distinctive content words count
    even when they occur once ("compound interest", "password manager")."""
    surface: dict[str, Counter[str]] = {}
    uni: Counter[str] = Counter()
    bi: Counter[str] = Counter()
    for text in texts:
        toks = tokenize(text)
        prev = None
        for t in toks:
            if t in STOPWORDS or t in GENERIC or len(t) <= 2 or t.isdigit():
                prev = None
                continue
            s = stem(t)
            uni[s] += 1
            surface.setdefault(s, Counter())[t] += 1
            if prev:
                key = f"{prev[0]} {s}"
                bi[key] += 1
                surface.setdefault(key, Counter())[f"{prev[1]} {t}"] += 1
            prev = (s, t)
    scored: list[tuple[float, str]] = []
    for s, c in uni.items():
        idf = tfidf.idf.get(s, 1.0) if tfidf else 1.0
        scored.append((c * idf, s))
    for s, c in bi.items():
        parts = s.split()
        if c >= 2 or all(len(p) >= 4 for p in parts):
            idf = sum(tfidf.idf.get(p, 1.0) for p in parts) / 2 if tfidf else 1.0
            scored.append(((c + 0.6) * idf * 1.4, s))
    scored.sort(reverse=True)
    out: list[str] = []
    used: set[str] = set()
    for _score, s in scored:
        parts = set(s.split())
        if parts & used and len(parts) == 1:
            continue
        out.append(surface[s].most_common(1)[0][0])
        used |= parts
        if len(out) >= top:
            break
    return out


def title_case(s: str) -> str:
    small = {"a", "an", "the", "and", "but", "or", "for", "nor", "on", "at", "to", "by", "of", "in", "vs", "is"}
    words = s.split()
    out = []
    for i, w in enumerate(words):
        lw = w.lower()
        if i not in (0, len(words) - 1) and lw in small:
            out.append(lw)
        elif w.isupper() and len(w) > 1:
            out.append(w)
        else:
            out.append(w[:1].upper() + w[1:])
    return " ".join(out)


def truncate_words(s: str, max_chars: int) -> str:
    s = " ".join(s.split())
    if len(s) <= max_chars:
        return s
    cut = s[: max_chars + 1].rsplit(" ", 1)[0].rstrip(",;:-–— ")
    return cut + "…"
