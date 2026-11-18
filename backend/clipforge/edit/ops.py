"""Renderer-neutral draw operations for captions, text layers and graphics.

The layout is computed once, here, from the timeline. The *same* op list is
consumed by:
  * the libass/ASS writer for the final export (``render/ass.py``), and
  * the browser canvas preview (``frontend/src/editor/preview/drawOps.ts``),
so caption wrapping, word positions, timing, colours and animations match.

Op fields (all pixel values are in composition pixels, e.g. 1080×1920):
  k      "text" | "rect" | "ellipse" | "arrow" | "img"
  l      layer (higher draws on top)
  t0,t1  timeline seconds
  x,y    anchor position; text uses an (5 = centre, 4 = middle-left, 6 = middle-right)
  text, font (bundled font key), size (ASS size = line box px), em, asc
  fill/fa, stroke/sw/sa, shadow/shc/sha, blur, spacing
  w,h,r  rect size & corner radius (x,y = top-left for rect/ellipse/arrow/img)
  rot    rotation degrees (arrow)
  grow   progress-bar growth (x scale 0→1 over the op)
  anim   {"alpha": [[t, a]...], "scale": [[t, s]...], "move": [dx, dy, dur]}
"""

from __future__ import annotations

import re
from typing import Any

from ..schemas import CaptionStyle, GraphicLayer, TextLayer, TextStyle, Timeline
from .fonts import FontFace, resolve, space_width, text_width
from .timemap import segments, source_to_timeline

CAPTION_PRESETS: dict[str, dict[str, Any]] = {
    "clean_white": dict(label="Clean White", font="Inter", weight=600, size=0.040, color="#FFFFFF", active_color="#FFFFFF",
                        outline_color="#000000", outline=0.0022, shadow=0.0025, shadow_color="#000000", background="none",
                        uppercase=False, mode="phrase", max_words=7, max_lines=2, animation="fade", position_y=0.72, line_height=1.12),
    "bold_social": dict(label="Bold Social", font="Montserrat", weight=900, size=0.052, color="#FFFFFF", active_color="#FFE14D",
                        outline_color="#000000", outline=0.0065, shadow=0.004, shadow_color="#000000", background="none",
                        uppercase=True, mode="highlight", max_words=3, max_lines=2, animation="pop", active_scale=1.06, position_y=0.68),
    "word_by_word": dict(label="Word-by-Word", font="Montserrat", weight=800, size=0.075, color="#FFFFFF", active_color="#FFFFFF",
                         outline_color="#000000", outline=0.007, shadow=0.004, background="none", uppercase=True, mode="word",
                         max_words=1, max_lines=1, animation="pop", position_y=0.62),
    "karaoke": dict(label="Karaoke Highlight", font="Poppins", weight=800, size=0.046, color="#FFFFFF", active_color="#39E6A0",
                    outline_color="#0B0E14", outline=0.0055, shadow=0.0, background="none", uppercase=False, mode="karaoke",
                    max_words=6, max_lines=2, animation="fade", position_y=0.7),
    "cinematic_minimal": dict(label="Cinematic Minimal", font="PlayfairDisplay", weight=500, italic=True, size=0.036,
                              color="#F3EFE6", active_color="#F3EFE6", outline_color="#000000", outline=0.0, shadow=0.0022,
                              shadow_color="#000000", background="none", letter_spacing=0.02, uppercase=False, mode="phrase",
                              max_words=8, max_lines=2, animation="fade", animation_speed=0.6, position_y=0.8),
    "documentary": dict(label="Documentary", font="Inter", weight=600, size=0.034, color="#FFFFFF", active_color="#FFFFFF",
                        outline=0.0, shadow=0.0, background="box", background_color="#000000", background_opacity=0.62,
                        align="left", position_x=0.08, position_y=0.8, max_width=0.8, uppercase=False, mode="phrase",
                        max_words=9, max_lines=2, animation="fade"),
    "creator": dict(label="Creator Style", font="Poppins", weight=800, size=0.05, color="#FFFFFF", active_color="#FFFFFF",
                    outline_color="#000000", outline=0.0045, shadow=0.0, background="word_box", background_color="#5B8CFF",
                    background_opacity=1.0, uppercase=False, mode="highlight", max_words=4, max_lines=2, animation="pop", position_y=0.68),
    "neon": dict(label="Neon Highlight", font="SpaceGrotesk", weight=700, size=0.05, color="#E9FCFF", active_color="#39F3FF",
                 outline_color="#00343D", outline=0.002, shadow=0.0, glow=0.012, background="none", uppercase=True,
                 mode="highlight", max_words=3, max_lines=2, animation="scale", active_scale=1.08, position_y=0.68),
    "gaming": dict(label="Gaming", font="Bangers", weight=400, size=0.066, color="#FFFFFF", active_color="#7CFF4F",
                   outline_color="#000000", outline=0.0075, shadow=0.005, shadow_color="#000000", background="none",
                   uppercase=True, mode="highlight", max_words=3, max_lines=2, animation="bounce", active_scale=1.12,
                   letter_spacing=0.02, position_y=0.7),
    "custom_brand": dict(label="Custom Brand", font="Oswald", weight=600, size=0.05, color="#FFFFFF", active_color="#5B8CFF",
                         outline_color="#000000", outline=0.0, shadow=0.0, background="rounded", background_color="#0B0E14",
                         background_opacity=0.7, uppercase=True, mode="highlight", max_words=4, max_lines=2,
                         animation="slide", position_y=0.7),
}


def preset_style(key: str, overrides: dict[str, Any] | None = None) -> CaptionStyle:
    p = dict(CAPTION_PRESETS.get(key, CAPTION_PRESETS["bold_social"]))
    p.pop("label", None)
    if overrides:
        p.update(overrides)
    return CaptionStyle(preset=key, **p)


_SENT_END = re.compile(r"[.!?…]$")
_STRIP_FOR_CAPTION = re.compile(r"^[\"'“‘(]+|[\"'”’)]+$")


def _alpha(opacity: float) -> float:
    return max(0.0, min(1.0, opacity))


def _anim_in(kind: str, dur: float, H: float) -> dict[str, Any]:
    if kind in ("none", None) or dur <= 0:
        return {}
    if kind == "fade":
        return {"alpha": [[0, 0.0], [dur, 1.0]]}
    if kind == "pop":
        return {"alpha": [[0, 0.0], [dur * 0.5, 1.0]], "scale": [[0, 0.7], [dur * 0.65, 1.08], [dur, 1.0]]}
    if kind == "scale":
        return {"alpha": [[0, 0.0], [dur * 0.6, 1.0]], "scale": [[0, 0.85], [dur, 1.0]]}
    if kind == "bounce":
        return {"alpha": [[0, 0.0], [dur * 0.4, 1.0]], "scale": [[0, 0.5], [dur * 0.55, 1.18], [dur * 0.8, 0.94], [dur, 1.0]]}
    if kind in ("slide", "slide_up"):
        return {"alpha": [[0, 0.0], [dur, 1.0]], "move": [0, round(H * 0.025, 1), dur]}
    if kind == "slide_down":
        return {"alpha": [[0, 0.0], [dur, 1.0]], "move": [0, -round(H * 0.025, 1), dur]}
    return {"alpha": [[0, 0.0], [dur, 1.0]]}


def _with_fade_out(anim: dict[str, Any], op_dur: float, out: float) -> dict[str, Any]:
    if out <= 0 or op_dur <= out + 0.02:
        return anim
    a = list(anim.get("alpha") or [[0, 1.0]])
    if a[-1][0] < op_dur - out:
        a.append([round(op_dur - out, 3), a[-1][1] if a[-1][0] > 0 else 1.0])
    a.append([round(op_dur, 3), 0.0])
    return {**anim, "alpha": a}


def _text_base(face: FontFace, size_px: float, fill: str, stroke: str, sw: float, shadow: float, shc: str,
               spacing: float, layer: int) -> dict[str, Any]:
    return {
        "k": "text", "l": layer, "font": face.key, "size": round(size_px, 2),
        "em": round(face.em_for_size(size_px), 2), "asc": round(face.ascent_for_size(size_px), 2),
        "fill": fill, "fa": 1.0, "stroke": stroke, "sw": round(sw, 2), "sa": 1.0,
        "shadow": round(shadow, 2), "shc": shc, "sha": 0.55, "blur": 0.0, "spacing": round(spacing, 2), "an": 5,
    }


# ----------------------------------------------------------------------------- captions

def caption_words_on_timeline(tl: Timeline) -> list[dict[str, Any]]:
    segs = segments(tl)
    out = []
    for w in tl.captions.words:
        if w.hidden or not w.text.strip():
            continue
        m = source_to_timeline(segs, w.src_s, w.src_e)
        if m is None:
            continue
        out.append({"id": w.id, "t0": m[0], "t1": max(m[1], m[0] + 0.04), "text": w.text.strip(), "emphasis": w.emphasis, "color": w.color})
    for cue in tl.captions.manual_cues:
        toks = cue.text.split()
        if not toks:
            continue
        d = (cue.end - cue.start) / len(toks)
        for k, tok in enumerate(toks):
            out.append({"id": f"{cue.id}-{k}", "t0": cue.start + k * d, "t1": cue.start + (k + 1) * d, "text": tok, "emphasis": False, "color": None})
    out.sort(key=lambda x: x["t0"])
    return out


def _break_lines(words: list[dict[str, Any]], face: FontFace, size: float, spacing: float, max_w: float,
                 slot_scale: float = 1.0) -> list[list[dict[str, Any]]]:
    lines: list[list[dict[str, Any]]] = [[]]
    sp = space_width(face, size)
    cur_w = 0.0
    for w in words:
        # Slots reserve room for the active-word scale so neighbours never collide.
        ww = text_width(face, w["disp"], size, spacing) * slot_scale
        w["w"] = ww
        add = ww if not lines[-1] else sp + ww
        if lines[-1] and cur_w + add > max_w:
            lines.append([w])
            cur_w = ww
        else:
            lines[-1].append(w)
            cur_w += add
    return [ln for ln in lines if ln]


def caption_layout(tl: Timeline) -> list[dict[str, Any]]:
    """Pages → lines → positioned words (composition pixels)."""
    cs: CaptionStyle = tl.captions.style
    W, H = tl.canvas.width, tl.canvas.height
    face = resolve(cs.font, cs.weight, cs.italic)
    size = cs.size * H
    spacing = cs.letter_spacing * face.em_for_size(size)
    max_w = cs.max_width * W
    words = caption_words_on_timeline(tl)
    for w in words:
        t = _STRIP_FOR_CAPTION.sub("", w["text"])
        if cs.uppercase:
            t = t.upper()
        w["disp"] = t
    max_words = 1 if cs.mode == "word" else cs.max_words
    slot = max(1.0, cs.active_scale) if cs.mode == "highlight" else 1.0
    pages: list[list[dict[str, Any]]] = []
    cur: list[dict[str, Any]] = []
    for w in words:
        if cur:
            gap = w["t0"] - cur[-1]["t1"]
            trial = _break_lines(cur + [w], face, size, spacing, max_w, slot)
            if (len(cur) >= max_words or gap > 0.7 or (_SENT_END.search(cur[-1]["text"]) and len(cur) >= 1)
                    or len(trial) > cs.max_lines):
                pages.append(cur)
                cur = []
        cur.append(w)
    if cur:
        pages.append(cur)
    safe = tl.canvas.safe_area
    line_px = size * cs.line_height
    out = []
    for pi, pg in enumerate(pages):
        lines = _break_lines(pg, face, size, spacing, max_w, slot)
        t0 = pg[0]["t0"]
        nxt = pages[pi + 1][0]["t0"] if pi + 1 < len(pages) else None
        t1 = pg[-1]["t1"] + 0.35
        if nxt is not None and (nxt - pg[-1]["t1"] < 0.8 or t1 > nxt):
            t1 = nxt
        t1 = max(t1, t0 + 0.25)
        block_h = len(lines) * line_px
        cy = cs.position_y * H
        top = cy - block_h / 2
        top = max(top, safe.get("top", 0.05) * H)
        top = min(top, (1 - safe.get("bottom", 0.1)) * H - block_h)
        sp = space_width(face, size)
        placed_lines = []
        for li, ln in enumerate(lines):
            lw = sum(w["w"] for w in ln) + sp * (len(ln) - 1)
            if cs.align == "left":
                x = cs.position_x * W
                x = max(x, safe.get("left", 0.05) * W)
            elif cs.align == "right":
                x = cs.position_x * W - lw
                x = min(x + lw, (1 - safe.get("right", 0.05)) * W) - lw
            else:
                x = cs.position_x * W - lw / 2
                lo = safe.get("left", 0.05) * W
                hi = (1 - safe.get("right", 0.05)) * W
                if lw <= hi - lo:
                    x = min(max(x, lo), hi - lw)
            yc = top + (li + 0.5) * line_px
            pw = []
            for w in ln:
                pw.append({**w, "x": round(x + w["w"] / 2, 2), "y": round(yc, 2)})
                x += w["w"] + sp
            placed_lines.append({"y": round(yc, 2), "width": round(lw, 2), "words": pw})
        out.append({"t0": round(t0, 3), "t1": round(t1, 3), "lines": placed_lines, "top": round(top, 2), "height": round(block_h, 2)})
    return out


def caption_ops(tl: Timeline) -> list[dict[str, Any]]:
    if not tl.captions.enabled:
        return []
    track = next((t for t in tl.tracks if t.kind == "captions"), None)
    if track and track.hidden:
        return []
    cs = tl.captions.style
    _W, H = tl.canvas.width, tl.canvas.height
    face = resolve(cs.font, cs.weight, cs.italic)
    size = cs.size * H
    spacing = cs.letter_spacing * face.em_for_size(size)
    sw = cs.outline * H
    shadow = cs.shadow * H
    glow = cs.glow * H
    in_dur = 0.18 / cs.animation_speed
    ops: list[dict[str, Any]] = []
    pages = caption_layout(tl)
    for pi, pg in enumerate(pages):
        nxt = pages[pi + 1]["t0"] if pi + 1 < len(pages) else None
        fade_out = 0.0 if (nxt is not None and nxt - pg["t1"] < 0.05) else 0.12
        if cs.background in ("box", "rounded") and pg["lines"]:
            pad_x = 0.35 * face.em_for_size(size)
            pad_y = 0.12 * size
            x0 = min(w["x"] - w["w"] / 2 for ln in pg["lines"] for w in ln["words"]) - pad_x
            x1 = max(w["x"] + w["w"] / 2 for ln in pg["lines"] for w in ln["words"]) + pad_x
            y0 = pg["top"] - pad_y
            y1 = pg["top"] + pg["height"] + pad_y
            ops.append({"k": "rect", "l": 0, "t0": pg["t0"], "t1": pg["t1"], "x": round(x0, 2), "y": round(y0, 2),
                        "w": round(x1 - x0, 2), "h": round(y1 - y0, 2), "r": round(0.22 * size if cs.background == "rounded" else 0, 2),
                        "fill": cs.background_color, "fa": _alpha(cs.background_opacity), "stroke": "#000000", "sw": 0, "sa": 0,
                        "anim": _with_fade_out(_anim_in("fade", in_dur, H), pg["t1"] - pg["t0"], fade_out)})
        words = [w for ln in pg["lines"] for w in ln["words"]]
        for wi, w in enumerate(words):
            base_col = w.get("color") or (cs.active_color if w["emphasis"] else cs.color)
            act_end = words[wi + 1]["t0"] if wi + 1 < len(words) else max(w["t1"], pg["t1"])
            act_start = max(pg["t0"], w["t0"])
            # State intervals: (t0, t1, colour, scale, is_active)
            if cs.mode == "highlight":
                states = [(pg["t0"], act_start, base_col, 1.0, False), (act_start, act_end, cs.active_color, cs.active_scale, True),
                          (act_end, pg["t1"], base_col, 1.0, False)]
            elif cs.mode == "karaoke":
                states = [(pg["t0"], act_start, base_col, 1.0, False), (act_start, pg["t1"], cs.active_color, 1.0, True)]
            else:  # phrase / word
                states = [(pg["t0"], pg["t1"], base_col, 1.0, False)]
            states = [s for s in states if s[1] - s[0] > 0.005]
            for _si, (a, b, col, scale, active) in enumerate(states):
                op = _text_base(face, size, col, cs.outline_color, sw, shadow, cs.shadow_color, spacing, 2)
                op.update(t0=round(a, 3), t1=round(b, 3), x=w["x"], y=w["y"], text=w["disp"])
                if cs.italic:
                    op["italic"] = True
                anim: dict[str, Any] = {}
                if a <= pg["t0"] + 1e-6:
                    anim = _anim_in(cs.animation, in_dur, H)
                elif active and cs.mode == "highlight" and cs.animation in ("pop", "bounce", "scale"):
                    anim = {"scale": [[0, scale * 1.12], [min(0.12, (b - a) * 0.5), scale]]}
                if scale != 1.0 and "scale" not in anim:
                    op["scale"] = scale
                if b >= pg["t1"] - 1e-6:
                    anim = _with_fade_out(anim, b - a, fade_out)
                if anim:
                    op["anim"] = anim
                if glow > 0:
                    g = dict(op)
                    g.update(l=1, fa=0.0, stroke=col if active else cs.active_color, sw=round(glow * 0.6, 2), sa=0.25 if not active else 0.6,
                             blur=round(glow, 2), shadow=0.0)
                    ops.append(g)
                ops.append(op)
                if active and cs.background == "word_box" and cs.mode == "highlight":
                    pad = 0.18 * face.em_for_size(size)
                    bw = w["w"] * scale + pad * 2
                    bh = size * 0.92
                    ops.append({"k": "rect", "l": 0, "t0": round(a, 3), "t1": round(b, 3), "x": round(w["x"] - bw / 2, 2),
                                "y": round(w["y"] - bh / 2, 2), "w": round(bw, 2), "h": round(bh, 2), "r": round(bh * 0.2, 2),
                                "fill": cs.background_color, "fa": _alpha(cs.background_opacity), "stroke": "#000000", "sw": 0, "sa": 0,
                                "anim": {"scale": [[0, 0.8], [0.08, 1.0]]}})
    return ops


# ----------------------------------------------------------------------------- text layers

def _wrap(text: str, face: FontFace, size: float, spacing: float, max_w: float) -> list[str]:
    out: list[str] = []
    for para in text.split("\n"):
        words = para.split()
        cur: list[str] = []
        for wd in words:
            trial = " ".join(cur + [wd])
            if cur and text_width(face, trial, size, spacing) > max_w:
                out.append(" ".join(cur))
                cur = [wd]
            else:
                cur.append(wd)
        out.append(" ".join(cur))
    return [ln for ln in out if ln.strip()] or [""]


def text_layer_ops(layer: TextLayer, W: int, H: int, base_layer: int = 4) -> list[dict[str, Any]]:
    st: TextStyle = layer.style
    face = resolve(st.font, st.weight, st.italic)
    size = st.size * H
    spacing = st.letter_spacing * face.em_for_size(size)
    txt = layer.text.upper() if st.uppercase else layer.text
    lines = _wrap(txt, face, size, spacing, layer.width * W)
    line_px = size * st.line_height
    sub_lines: list[str] = []
    sub_size = size * 0.62
    if layer.kind == "lower_third" and layer.subtitle:
        sub_lines = _wrap(layer.subtitle, face, sub_size, 0, layer.width * W)
    block_h = len(lines) * line_px + len(sub_lines) * sub_size * 1.15
    cx, cy = layer.x * W, layer.y * H
    top = cy - block_h / 2
    an = {"left": 4, "center": 5, "right": 6}[st.align]
    dur = layer.end - layer.start
    ain = _anim_in(layer.anim_in.type, layer.anim_in.duration, H)
    anim = _with_fade_out(ain, dur, layer.anim_out.duration if layer.anim_out.type != "none" else 0.0)
    ops: list[dict[str, Any]] = []
    widths = [text_width(face, ln, size, spacing) for ln in lines] + [text_width(face, ln, sub_size) for ln in sub_lines]
    maxw = max(widths) if widths else 0
    if st.background != "none" and st.background_opacity > 0 or layer.kind == "lower_third":
        pad_x = 0.4 * face.em_for_size(size)
        pad_y = 0.18 * size
        if an == 5:
            x0 = cx - maxw / 2 - pad_x
        elif an == 4:
            x0 = cx - pad_x
        else:
            x0 = cx - maxw - pad_x
        op_bg = {"k": "rect", "l": base_layer, "t0": layer.start, "t1": layer.end, "x": round(x0, 2), "y": round(top - pad_y, 2),
                 "w": round(maxw + pad_x * 2, 2), "h": round(block_h + pad_y * 2, 2),
                 "r": round(0.2 * size, 2) if st.background == "rounded" else 0.0,
                 "fill": st.background_color, "fa": _alpha(st.background_opacity if st.background != "none" else 0.75) * layer.opacity,
                 "stroke": "#000000", "sw": 0, "sa": 0, "anim": anim}
        ops.append(op_bg)
        if layer.kind == "lower_third":
            ops.append({"k": "rect", "l": base_layer + 1, "t0": layer.start, "t1": layer.end, "x": round(x0, 2), "y": round(top - pad_y, 2),
                        "w": round(size * 0.12, 2), "h": round(block_h + pad_y * 2, 2), "r": 0.0, "fill": st.color if st.background_color.lower() != st.color.lower() else "#5B8CFF",
                        "fa": layer.opacity, "stroke": "#000000", "sw": 0, "sa": 0, "anim": anim})
    reveal = layer.anim_in.type == "typewriter"
    y = top
    for li, ln in enumerate(lines + sub_lines):
        is_sub = li >= len(lines)
        sz = sub_size if is_sub else size
        lp = sub_size * 1.15 if is_sub else line_px
        yc = y + lp / 2
        y += lp
        op = _text_base(face, sz, st.color, st.outline_color, st.outline * H, st.shadow * H, st.shadow_color, 0 if is_sub else spacing, base_layer + 2)
        op.update(t0=layer.start, t1=layer.end, x=round(cx, 2), y=round(yc, 2), text=ln, an=an)
        op["fa"] = layer.opacity
        op["sa"] = layer.opacity
        if st.italic:
            op["italic"] = True
        if reveal and not is_sub:
            # Typewriter (word reveal): each word fades in at its final position.
            wds = ln.split()
            sp = space_width(face, sz)
            tw = text_width(face, ln, sz, spacing)
            x = cx - tw / 2 if an == 5 else (cx if an == 4 else cx - tw)
            step = max(0.04, layer.anim_in.duration / max(1, len(wds)))
            for k, wd in enumerate(wds):
                ww = text_width(face, wd, sz, spacing)
                o = dict(op)
                o.update(text=wd, x=round(x + ww / 2, 2), an=5, t0=round(layer.start + k * step, 3))
                o["anim"] = _with_fade_out({"alpha": [[0, 0.0], [0.08, 1.0]]}, layer.end - o["t0"], layer.anim_out.duration)
                ops.append(o)
                x += ww + sp
            continue
        if anim:
            op["anim"] = anim
        ops.append(op)
    return ops


# ----------------------------------------------------------------------------- graphics

def graphic_ops(g: GraphicLayer, W: int, H: int, layer: int = 3) -> list[dict[str, Any]]:
    dur = g.end - g.start
    anim = _with_fade_out(_anim_in(g.anim_in.type, g.anim_in.duration, H), dur, g.anim_out.duration if g.anim_out.type != "none" else 0)
    x, y, w, h = (g.x - g.w / 2) * W, (g.y - g.h / 2) * H, g.w * W, g.h * H
    base = {"l": layer, "t0": g.start, "t1": g.end, "x": round(x, 2), "y": round(y, 2), "w": round(w, 2), "h": round(h, 2),
            "fill": g.color, "fa": g.fill_opacity * g.opacity, "stroke": g.color, "sw": round(g.stroke * H, 2), "sa": g.opacity,
            "anim": anim}
    if g.kind in ("rect", "highlight_box"):
        return [{**base, "k": "rect", "r": round(g.radius * H, 2)}]
    if g.kind == "circle":
        return [{**base, "k": "ellipse"}]
    if g.kind == "arrow":
        return [{**base, "k": "arrow", "rot": g.rotation, "fa": g.opacity, "sw": 0}]
    if g.kind == "progress_bar":
        return [{**base, "k": "rect", "r": round(min(h / 2, g.radius * H), 2), "fa": g.opacity, "sw": 0, "grow": True, "anim": {}}]
    if g.kind in ("image", "logo"):
        return [{**base, "k": "img", "asset_id": g.asset_id, "fa": g.opacity}]
    return []


def timeline_ops(tl: Timeline) -> list[dict[str, Any]]:
    W, H = tl.canvas.width, tl.canvas.height
    hidden = {t.kind for t in tl.tracks if t.hidden}
    ops: list[dict[str, Any]] = []
    if "captions" not in hidden:
        ops += caption_ops(tl)
    if "graphics" not in hidden:
        for g in tl.graphics:
            ops += graphic_ops(g, W, H)
    if "text" not in hidden:
        for t in tl.texts:
            ops += text_layer_ops(t, W, H)
    dur = tl.duration
    ops = [o for o in ops if o["t0"] < dur and o["t1"] > o["t0"]]
    for o in ops:
        o["t1"] = min(o["t1"], dur)
    ops.sort(key=lambda o: (o["l"], o["t0"]))
    return ops


def caption_cues(tl: Timeline) -> list[dict[str, Any]]:
    """Plain-text cues (for SRT/VTT export) from the caption pages."""
    cues = []
    for pg in caption_layout(tl):
        text = "\n".join(" ".join(w["text"] for w in ln["words"]) for ln in pg["lines"])
        cues.append({"start": pg["t0"], "end": pg["t1"], "text": text})
    return cues
