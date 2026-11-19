"""Automatic edit recipes: turn a highlight into an editable timeline.

Each style is a concrete editing recipe (not a label):

* ``clean``     – Clean Professional: removes only long pauses, hard cuts, clean
  captions, no punch-ins, neutral colour, podcast-clean audio.
* ``dynamic``   – Social Dynamic: tight silence removal, filler-word removal,
  alternating punch-in zooms to hide jump cuts, bold animated captions, hook
  heading, progress bar, voice-forward audio.
* ``cinematic`` – Cinematic: keeps natural pauses, slow push-in, fades from/to
  black, warm low-saturation grade with vignette, minimal italic captions,
  cinematic audio preset.

``seed`` drives Regenerate Edit variations deterministically.
"""

from __future__ import annotations

import random
import re
from typing import Any

from ..analysis.modes import FILLERS, MODES, PLATFORMS
from ..analysis.text import STOPWORDS, truncate_words
from ..schemas import (
    Animation,
    AudioSettings,
    Canvas,
    CaptionWord,
    Captions,
    ColorSettings,
    Effect,
    EqBand,
    GraphicLayer,
    TextLayer,
    TextStyle,
    Timeline,
    Transition,
    VideoClip,
    default_tracks,
)
from ..util.files import new_id
from .ops import preset_style
from .reframe import auto_reframe

ASPECTS = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080), "4:5": (1080, 1350)}

STYLE_DEFAULTS: dict[str, dict[str, Any]] = {
    "clean": {"gap": 0.9, "pad": 0.18, "fillers": False, "caption": "clean_white", "audio": "podcast_clean"},
    "dynamic": {"gap": 0.38, "pad": 0.09, "fillers": True, "caption": "bold_social", "audio": "voice_forward"},
    "cinematic": {"gap": 1.4, "pad": 0.3, "fillers": False, "caption": "cinematic_minimal", "audio": "cinematic"},
}

AUDIO_PRESETS: dict[str, dict[str, Any]] = {
    "natural": {"highpass": 0, "eq": [], "compressor": False, "denoise": 0.0},
    "podcast_clean": {"highpass": 80, "eq": [EqBand(f=250, g=-2.0, q=1.0), EqBand(f=3000, g=2.0, q=1.2)], "compressor": True, "denoise": 0.25},
    "voice_forward": {"highpass": 90, "eq": [EqBand(f=300, g=-3.0, q=1.0), EqBand(f=3500, g=3.0, q=1.0)], "compressor": True, "denoise": 0.2},
    "cinematic": {"highpass": 60, "eq": [EqBand(f=120, g=1.5, q=0.8), EqBand(f=8000, g=1.0, q=0.7)], "compressor": True, "denoise": 0.15},
    "gaming": {"highpass": 100, "eq": [EqBand(f=2500, g=3.0, q=1.0)], "compressor": True, "denoise": 0.1},
    "off": {"highpass": 0, "eq": [], "compressor": False, "denoise": 0.0},
}


def canvas_for(aspect: str, info: dict[str, Any], platform: str | None = None, fps: float | None = None) -> Canvas:
    if aspect == "source":
        w, h = info["display_width"], info["display_height"]
        scale = 1080 / min(w, h)
        w, h = int(round(w * scale / 2) * 2), int(round(h * scale / 2) * 2)
    else:
        w, h = ASPECTS[aspect]
    safe = dict(PLATFORMS.get(platform or "custom", PLATFORMS["custom"])["safe"])
    if aspect in ("16:9", "source") and w > h:
        safe = {"top": 0.06, "bottom": 0.08, "left": 0.05, "right": 0.05}
    src_fps = info.get("fps") or 30.0
    if info.get("variable_frame_rate"):
        # VFR: conform to the nominal rate (r_frame_rate), not the average, snapped to a standard rate.
        from fractions import Fraction

        try:
            nominal = float(Fraction(info.get("r_frame_rate") or "0/1"))
        except (ValueError, ZeroDivisionError):
            nominal = 0.0
        ref = nominal if 10 <= nominal <= 120 else src_fps
        src_fps = min((24.0, 25.0, 30.0, 50.0, 60.0), key=lambda r: abs(r - ref))
    out_fps = fps or (round(src_fps) if abs(src_fps - round(src_fps)) < 0.02 else round(src_fps, 3))
    out_fps = min(out_fps, 60)
    return Canvas(aspect=aspect, width=w, height=h, fps=float(out_fps), safe_area=safe)


def apply_audio_preset(a: AudioSettings, preset: str) -> AudioSettings:
    p = AUDIO_PRESETS.get(preset, AUDIO_PRESETS["natural"])
    return a.model_copy(update={"preset": preset, "highpass": p["highpass"], "eq": list(p["eq"]),
                                "compressor": p["compressor"], "denoise": p["denoise"], "enabled": preset != "off"})


def keep_intervals(words: list[dict[str, Any]], start: float, end: float, gap: float, pad: float,
                   remove_fillers: bool) -> tuple[list[tuple[float, float]], dict[str, Any]]:
    """Silence/filler removal producing source intervals to keep."""
    ws = [w for w in words if w["e"] > start and w["s"] < end]
    stats = {"pauses_removed": 0, "fillers_removed": 0, "time_removed": 0.0}
    if not ws:
        return [(start, end)], stats
    cuts: list[tuple[float, float]] = []
    for a, b in zip(ws, ws[1:]):
        if b["s"] - a["e"] > gap:
            cuts.append((a["e"] + pad, b["s"] - pad))
            stats["pauses_removed"] += 1
    # Lead-in / tail silence beyond padding
    if ws[0]["s"] - start > gap:
        cuts.append((start, ws[0]["s"] - pad))
    if end - ws[-1]["e"] > gap:
        cuts.append((ws[-1]["e"] + pad * 1.5, end))
    if remove_fillers:
        for k, w in enumerate(ws):
            tok = re.sub(r"[^\w']", "", w["w"].lower())
            if tok in FILLERS:
                prev_e = ws[k - 1]["e"] if k > 0 else start
                next_s = ws[k + 1]["s"] if k + 1 < len(ws) else end
                a = max(prev_e + 0.02, w["s"] - 0.03)
                b = min(next_s - 0.02, w["e"] + 0.03)
                if b - a > 0.08:
                    cuts.append((a, b))
                    stats["fillers_removed"] += 1
    cuts = sorted((a, b) for a, b in cuts if b - a > 0.06)
    merged: list[list[float]] = []
    for a, b in cuts:
        if merged and a <= merged[-1][1] + 0.05:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    keep: list[tuple[float, float]] = []
    cur = start
    for a, b in merged:
        if a > cur:
            keep.append((cur, a))
        cur = max(cur, b)
    if cur < end:
        keep.append((cur, end))
    # Drop slivers, merge near-adjacent pieces
    out: list[tuple[float, float]] = []
    for a, b in keep:
        if b - a < 0.25:
            continue
        if out and a - out[-1][1] < 0.08:
            out[-1] = (out[-1][0], b)
        else:
            out.append((a, b))
    stats["time_removed"] = round((end - start) - sum(b - a for a, b in out), 2)
    return out or [(start, end)], stats


def _emphasis_ids(words: list[dict[str, Any]], rng: random.Random, every: int) -> set[int]:
    """Pick content words to emphasise: numbers, long rare-ish words, cue words."""
    cues = {"never", "always", "biggest", "worst", "best", "mistake", "secret", "truth", "free", "money", "everything",
            "nothing", "only", "first", "simple", "changed", "important", "huge", "crazy", "insane", "hilarious"}
    out = set()
    window: list[dict[str, Any]] = []
    for w in words:
        window.append(w)
        if len(window) >= every:
            def score(x):
                t = re.sub(r"[^\w$%]", "", x["w"].lower())
                if t in STOPWORDS or not t:
                    return -1
                return (3 if t in cues else 0) + (2.5 if re.search(r"\d|\$|%", t) else 0) + min(len(t), 10) / 5 + rng.random() * 0.8
            best = max(window, key=score)
            if score(best) > 1.4:
                out.add(best["i"])
            window = []
    return out


def build_timeline(
    *, source_id: str, info: dict[str, Any], transcript: dict[str, Any], highlight: dict[str, Any],
    visual: dict[str, Any] | None, style: str = "dynamic", aspect: str = "9:16", caption_preset: str | None = None,
    platform: str = "tiktok", content_mode: str = "podcast", seed: int = 0, reframe_mode: str | None = None,
    brand_kit: dict[str, Any] | None = None, speaker_sides: dict[int, float] | None = None, speaker_at: Any = None,
) -> Timeline:
    rng = random.Random(seed * 7919 + hash(highlight.get("id", "")) % 1000)
    sd = dict(STYLE_DEFAULTS.get(style, STYLE_DEFAULTS["clean"]))
    if seed:
        sd["gap"] = round(sd["gap"] * rng.uniform(0.85, 1.2), 3)
    start, end = float(highlight["start"]), float(highlight["end"])
    words = [w for s in transcript.get("segments", []) for w in s.get("words", [])]
    keep, cut_stats = keep_intervals(words, start, end, sd["gap"], sd["pad"], sd["fillers"])
    canvas = canvas_for(aspect, info, platform)
    clips: list[VideoClip] = []
    zoom_hi = round(rng.uniform(1.1, 1.18), 3) if style == "dynamic" else 1.12
    phase = rng.randint(0, 1) if seed else 0
    for k, (a, b) in enumerate(keep):
        effects: list[Effect] = []
        if style == "dynamic" and len(keep) > 1 and (k + phase) % 2 == 1:
            effects.append(Effect(id=new_id("fx_"), type="zoom", params={"from": zoom_hi, "to": zoom_hi}))
        clips.append(VideoClip(id=new_id("c_"), src_in=round(a, 3), src_out=round(b, 3), effects=effects, label=f"Part {k + 1}"))
    tl = Timeline(source_id=source_id, canvas=canvas, tracks=default_tracks(), clips=clips)
    total = tl.duration

    # Cinematic: continuous slow push-in expressed per clip so it survives trimming.
    if style == "cinematic":
        t = 0.0
        z0, z1 = 1.0, round(1.0 + rng.uniform(0.05, 0.08) if seed else 1.06, 3)
        for c in tl.clips:
            d = c.duration
            fz = z0 + (z1 - z0) * (t / total)
            tz = z0 + (z1 - z0) * ((t + d) / total)
            c.effects.append(Effect(id=new_id("fx_"), type="zoom", params={"from": round(fz, 4), "to": round(tz, 4)}))
            t += d
        tl.clips[0].effects.append(Effect(id=new_id("fx_"), type="fade_in", end=0.6, params={"color": "#000000"}))
        tl.clips[-1].effects.append(Effect(id=new_id("fx_"), type="fade_out", start=max(0.0, tl.clips[-1].duration - 0.7), params={"color": "#000000"}))
    if style == "dynamic" and tl.clips:
        # Opening punch-in for the first second draws attention to the hook.
        tl.clips[0].effects.append(Effect(id=new_id("fx_"), type="zoom", start=0.0, end=min(0.6, tl.clips[0].duration),
                                          params={"from": 1.0, "to": 1.08}))

    # Captions
    cap_key = caption_preset or sd["caption"]
    cwords = [w for w in words if w["e"] > start and w["s"] < end]
    emph = _emphasis_ids(cwords, rng, every=5 if style == "dynamic" else 9) if style != "cinematic" else set()
    style_over: dict[str, Any] = {}
    if seed and style == "dynamic":
        style_over["position_y"] = round(rng.uniform(0.62, 0.72), 3)
    cap_style = preset_style(cap_key, style_over)
    tl.captions = Captions(
        enabled=True, style=cap_style, language=transcript.get("language") or "en",
        words=[CaptionWord(id=w["i"], src_s=w["s"], src_e=w["e"], text=w["w"], emphasis=w["i"] in emph,
                           hidden=sd["fillers"] and re.sub(r"[^\w']", "", w["w"].lower()) in FILLERS) for w in cwords],
    )

    # Hook heading (on-screen text, grounded in the highlight's own title).
    title = (highlight.get("title") or "").strip()
    if style == "dynamic" and title:
        options = [title, (highlight.get("topic") or "").split(" · ")[0].title()]
        txt = options[0] if not seed else rng.choice([o for o in options if o] or [title])
        tl.texts.append(TextLayer(
            id=new_id("tx_"), kind="hook", text=truncate_words(txt, 48), start=0.0, end=min(3.2, total),
            x=0.5, y=0.2, width=0.82,
            style=TextStyle(font="Montserrat", weight=900, size=0.042, color="#0B0E14", background="rounded",
                            background_color="#FFFFFF", background_opacity=0.96, uppercase=False),
            anim_in=Animation(type="pop", duration=0.3), anim_out=Animation(type="fade", duration=0.2),
        ))
        tl.graphics.append(GraphicLayer(id=new_id("gf_"), kind="progress_bar", start=0.0, end=total, x=0.5, y=0.0035,
                                        w=1.0, h=0.007, color="#5B8CFF", radius=0.0, fill_opacity=1.0))
    if style == "cinematic" and title:
        tl.texts.append(TextLayer(
            id=new_id("tx_"), kind="title", text=truncate_words(title, 60), start=0.4, end=min(3.4, total),
            x=0.5, y=0.16, width=0.8,
            style=TextStyle(font="PlayfairDisplay", weight=500, italic=True, size=0.034, color="#F3EFE6", shadow=0.002,
                            letter_spacing=0.02),
            anim_in=Animation(type="fade", duration=0.8), anim_out=Animation(type="fade", duration=0.6),
        ))

    # Colour
    if style == "dynamic":
        tl.color = ColorSettings(contrast=1.05, saturation=1.1)
    elif style == "cinematic":
        tl.color = ColorSettings(contrast=1.1, saturation=0.86, temperature=0.18 if not seed else round(rng.uniform(0.1, 0.25), 2),
                                 vignette=0.32, exposure=-0.05)
    tl.audio = apply_audio_preset(AudioSettings(loudness_target=-14.0), sd["audio"] if content_mode != "gaming" else "gaming")
    if style == "cinematic":
        tl.audio.fade_in, tl.audio.fade_out = 0.5, 0.7

    # Reframing
    mode_cfg = MODES.get(content_mode, MODES["podcast"])
    rmode = reframe_mode or ("fill" if mode_cfg.preserve_full_frame else mode_cfg.reframe_default)
    if rmode == "speaker" and not speaker_sides:
        rmode = "auto"
    tl.reframe = auto_reframe(tl, info, visual, rmode, speaker_sides, speaker_at, mode_cfg.preserve_full_frame)
    if reframe_mode == "speaker" and rmode == "auto":
        tl.reframe.note = "Speaker focus unavailable (no reliable link between voices and faces); following the main face instead."

    tl.notes = [
        f"Style: {style}. Removed {cut_stats['pauses_removed']} pause(s) and {cut_stats['fillers_removed']} filler(s), "
        f"{cut_stats['time_removed']:.1f}s total.",
        tl.reframe.note,
    ]
    if brand_kit:
        apply_brand_kit(tl, brand_kit)
    return tl


# ----------------------------------------------------------------------------- brand kits

def contrast_text(hex_bg: str) -> str:
    """Black or white text, whichever reads better on the given background (WCAG luminance)."""
    h = hex_bg.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))

    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    return "#0B0E14" if lum > 0.45 else "#FFFFFF"


def apply_brand_kit(tl: Timeline, kit: dict[str, Any]) -> Timeline:
    """Apply a brand kit to editable timeline properties (never to source media)."""
    d = kit.get("data", kit)
    cs = tl.captions.style
    if d.get("caption_font"):
        cs.font = d["caption_font"]
        cs.weight = int(d.get("caption_weight", cs.weight))
    if d.get("primary_color"):
        if cs.background == "word_box":
            # Brand colour goes on the box; the active word keeps a contrasting text colour.
            cs.background_color = d["primary_color"]
            cs.active_color = contrast_text(d["primary_color"])
        else:
            cs.active_color = d["primary_color"]
    if d.get("caption_color"):
        cs.color = d["caption_color"]
    if d.get("caption_preset"):
        new = preset_style(d["caption_preset"])
        keep_words = tl.captions.words
        tl.captions.style = new
        tl.captions.words = keep_words
        cs = new
        if d.get("primary_color"):
            if cs.background == "word_box":
                cs.background_color = d["primary_color"]
                cs.active_color = contrast_text(d["primary_color"])
            else:
                cs.active_color = d["primary_color"]
    for t in tl.texts:
        if d.get("heading_font"):
            t.style.font = d["heading_font"]
            t.style.weight = int(d.get("heading_weight", t.style.weight))
        if d.get("secondary_color") and t.kind == "hook":
            t.style.background_color = d["secondary_color"]
    for g in tl.graphics:
        if g.kind == "progress_bar" and d.get("primary_color"):
            g.color = d["primary_color"]
    # Logo / watermark as a graphic layer (removable, re-positionable)
    tl.graphics = [g for g in tl.graphics if g.kind != "logo"]
    if d.get("logo_asset_id"):
        pos = d.get("logo_position", "top_right")
        size = float(d.get("logo_size", 0.14))
        aspect = float(d.get("logo_aspect", 1.0))
        W, H = tl.canvas.width, tl.canvas.height
        gw = size
        gh = size * W / H / max(0.2, aspect)
        sa = tl.canvas.safe_area
        xs = {"top_left": sa.get("left", 0.05) + gw / 2, "top_right": 1 - sa.get("right", 0.05) - gw / 2,
              "bottom_left": sa.get("left", 0.05) + gw / 2, "bottom_right": 1 - sa.get("right", 0.05) - gw / 2}
        ys = {"top_left": sa.get("top", 0.05) + gh / 2, "top_right": sa.get("top", 0.05) + gh / 2,
              "bottom_left": 1 - sa.get("bottom", 0.1) - gh / 2, "bottom_right": 1 - sa.get("bottom", 0.1) - gh / 2}
        tl.graphics.append(GraphicLayer(id=new_id("gf_"), kind="logo", asset_id=d["logo_asset_id"], start=0.0, end=tl.duration,
                                        x=round(xs.get(pos, xs["top_right"]), 4), y=round(ys.get(pos, ys["top_right"]), 4),
                                        w=round(gw, 4), h=round(gh, 4), opacity=float(d.get("logo_opacity", 0.9))))
    if d.get("audio_preset"):
        tl.audio = apply_audio_preset(tl.audio, d["audio_preset"])
    if d.get("loudness_target"):
        tl.audio.loudness_target = float(d["loudness_target"])
    if d.get("transition") and d["transition"] != "cut":
        for c in tl.clips[1:]:
            c.transition_in = Transition(type=d["transition"], duration=float(d.get("transition_duration", 0.3)))
    tl.brand_kit_id = kit.get("id")
    return tl


# ----------------------------------------------------------------------------- hook suggestions

def hook_suggestions(tl: Timeline, transcript: dict[str, Any], highlight: dict[str, Any], sentences: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Up to three hook variations. Each is a list of operations on the timeline.

    Operations only re-cut existing speech, add on-screen text derived from the
    clip's own words, or add visual emphasis — never new or re-ordered speech.
    """
    from ..analysis.modes import cue_hits, negative_hits

    if not tl.clips:
        return []
    clip_start = tl.clips[0].src_in
    clip_end = tl.clips[-1].src_out
    inside = [s for s in sentences if s["start"] >= clip_start - 0.3 and s["end"] <= clip_end + 0.3]
    out: list[dict[str, Any]] = []
    if not inside:
        return out

    def hook_strength(s: dict[str, Any]) -> float:
        c = cue_hits(s["text"])
        n = negative_hits(s["text"])
        v = sum(1 for k in ("question", "howto", "warning", "bold", "surprise", "story", "opinion", "direct_address") if k in c)
        v -= 1.5 * bool(n.get("greeting") or n.get("backchannel_open") or n.get("dependent_open"))
        v += 0.5 if 4 <= len(s["text"].split()) <= 16 else 0
        return v

    first = inside[0]
    cur = hook_strength(first)
    total = clip_end - clip_start
    best = max(inside[1 : max(2, len(inside) // 2)] or [first], key=hook_strength)
    if best is not first and hook_strength(best) > cur + 0.9 and (clip_end - best["start"]) >= min(10.0, total * 0.6):
        out.append({
            "id": "stronger_start", "label": "Start at a stronger sentence",
            "description": f"Open on “{truncate_words(best['text'], 70)}” and drop {best['start'] - clip_start:.1f}s of lead-in.",
            "ops": [{"op": "trim_start_to", "src_t": round(max(clip_start, best["start"] - 0.12), 3)}],
        })
    weak = negative_hits(first["text"])
    if (weak.get("greeting") or weak.get("backchannel_open")) and len(inside) > 1:
        nxt = inside[1]
        out.append({
            "id": "trim_intro", "label": "Remove the weak introduction",
            "description": f"Cut “{truncate_words(first['text'], 50)}” so the clip starts with the substance.",
            "ops": [{"op": "trim_start_to", "src_t": round(nxt["start"] - 0.1, 3)}],
        })
    heading = truncate_words((highlight.get("title") or first["text"]).rstrip("."), 48)
    out.append({
        "id": "heading_zoom", "label": "Heading + opening zoom",
        "description": f"Add the on-screen heading “{heading}” for 3 s and a gentle 1.0→1.12 punch-in on the first line.",
        "ops": [{"op": "add_heading", "text": heading, "duration": 3.0}, {"op": "opening_zoom", "to": 1.12, "duration": 0.8}],
    })
    key = max((w for w in tl.captions.words[:14] if len(re.sub(r"\W", "", w.text)) > 3 and w.text.lower() not in STOPWORDS),
              key=lambda w: len(w.text), default=None)
    if key is not None:
        out.append({
            "id": "emphasise", "label": "Emphasise the key opening word",
            "description": f"Highlight “{key.text.strip(',.')}” in the captions and add a short punch-in when it is spoken.",
            "ops": [{"op": "emphasise_word", "word_id": key.id}, {"op": "punch_at_word", "word_id": key.id, "to": 1.1}],
        })
    return out[:3]


def apply_hook(tl: Timeline, suggestion: dict[str, Any]) -> Timeline:
    tl = tl.model_copy(deep=True)
    for op in suggestion.get("ops", []):
        kind = op["op"]
        if kind == "trim_start_to":
            t = float(op["src_t"])
            while tl.clips and tl.clips[0].src_out <= t + 0.2:
                tl.clips.pop(0)
            if tl.clips and tl.clips[0].src_in < t:
                tl.clips[0].src_in = round(t, 3)
        elif kind == "add_heading":
            tl.texts = [x for x in tl.texts if x.kind != "hook"]
            tl.texts.append(TextLayer(
                id=new_id("tx_"), kind="hook", text=op["text"], start=0.0, end=float(op.get("duration", 3.0)), x=0.5, y=0.2,
                width=0.82, style=TextStyle(font="Montserrat", weight=900, size=0.042, color="#0B0E14", background="rounded",
                                            background_color="#FFFFFF", background_opacity=0.96),
                anim_in=Animation(type="pop", duration=0.3)))
        elif kind == "opening_zoom" and tl.clips:
            c = tl.clips[0]
            c.effects = [e for e in c.effects if not (e.type == "zoom" and e.start == 0.0 and e.end is not None)]
            c.effects.append(Effect(id=new_id("fx_"), type="zoom", start=0.0, end=min(float(op.get("duration", 0.8)), c.duration),
                                    params={"from": 1.0, "to": float(op.get("to", 1.12))}))
        elif kind == "emphasise_word":
            for w in tl.captions.words:
                if w.id == op["word_id"]:
                    w.emphasis = True
        elif kind == "punch_at_word":
            w = next((w for w in tl.captions.words if w.id == op["word_id"]), None)
            if w:
                t = 0.0
                for c in tl.clips:
                    if c.src_in <= w.src_s < c.src_out:
                        rel = (w.src_s - c.src_in) / c.speed
                        c.effects.append(Effect(id=new_id("fx_"), type="zoom", start=round(rel, 3), end=round(min(c.duration, rel + 0.9), 3),
                                                params={"from": float(op.get("to", 1.1)), "to": float(op.get("to", 1.1))}))
                        break
                    t += c.duration
    return Timeline.model_validate(tl.model_dump())


def broll_suggestions(tl: Timeline, assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Suggest the user's own (licensed) B-roll where its name/tags match spoken words."""
    from ..analysis.text import stem
    from .timemap import segments, source_to_timeline

    segs = segments(tl)
    out = []
    for a in assets:
        tags = {stem(x) for x in re.findall(r"[a-zA-Z]{3,}", (a.get("name", "") + " " + " ".join((a.get("meta") or {}).get("tags", []))).lower())}
        tags -= {stem(x) for x in STOPWORDS}
        if not tags:
            continue
        for w in tl.captions.words:
            if stem(re.sub(r"[^\w]", "", w.text.lower())) in tags:
                m = source_to_timeline(segs, w.src_s, w.src_e)
                if m:
                    out.append({"asset_id": a["id"], "asset_name": a.get("name"), "word": w.text, "t": round(m[0], 3),
                                "duration": 2.5, "reason": f"“{w.text.strip(',.')}” is spoken here"})
                    break
    return out[:8]
