"""Convert renderer-neutral draw ops into an Advanced SubStation Alpha script.

libass (inside FFmpeg's ``subtitles`` filter) rasterises captions, titles and
vector graphics directly at the output resolution, so edges stay crisp at 4K.
"""

from __future__ import annotations

from typing import Any

from ..edit.fonts import registry

K = 0.5523  # cubic Bézier circle constant


def ass_time(t: float) -> str:
    cs = int(round(max(0.0, t) * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def ass_color(hex_rgb: str) -> str:
    h = hex_rgb.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{b}{g}{r}&".upper()


def ass_alpha(opacity: float) -> str:
    a = int(round((1.0 - max(0.0, min(1.0, opacity))) * 255))
    return f"&H{a:02X}&"


def _escape(text: str) -> str:
    return text.replace("\\", "∖").replace("{", "(").replace("}", ")").replace("\n", "\\N")


def _f(x: float) -> str:
    return f"{x:.2f}".rstrip("0").rstrip(".") if isinstance(x, float) else str(x)


def rounded_rect_path(w: float, h: float, r: float) -> str:
    r = max(0.0, min(r, w / 2, h / 2))
    if r <= 0.5:
        return f"m 0 0 l {_f(w)} 0 {_f(w)} {_f(h)} 0 {_f(h)}"
    k = r * (1 - K)
    p = [
        f"m {_f(r)} 0", f"l {_f(w - r)} 0", f"b {_f(w - k)} 0 {_f(w)} {_f(k)} {_f(w)} {_f(r)}",
        f"l {_f(w)} {_f(h - r)}", f"b {_f(w)} {_f(h - k)} {_f(w - k)} {_f(h)} {_f(w - r)} {_f(h)}",
        f"l {_f(r)} {_f(h)}", f"b {_f(k)} {_f(h)} 0 {_f(h - k)} 0 {_f(h - r)}",
        f"l 0 {_f(r)}", f"b 0 {_f(k)} {_f(k)} 0 {_f(r)} 0",
    ]
    return " ".join(p)


def ellipse_path(w: float, h: float) -> str:
    rx, ry = w / 2, h / 2
    kx, ky = rx * K, ry * K
    return (f"m {_f(rx)} 0 b {_f(rx + kx)} 0 {_f(w)} {_f(ry - ky)} {_f(w)} {_f(ry)} "
            f"b {_f(w)} {_f(ry + ky)} {_f(rx + kx)} {_f(h)} {_f(rx)} {_f(h)} "
            f"b {_f(rx - kx)} {_f(h)} 0 {_f(ry + ky)} 0 {_f(ry)} "
            f"b 0 {_f(ry - ky)} {_f(rx - kx)} 0 {_f(rx)} 0")


def arrow_path(w: float, h: float) -> str:
    """Right-pointing arrow filling a w×h box."""
    sh = h * 0.36
    head = min(w * 0.42, h * 1.0)
    y0, y1 = (h - sh) / 2, (h + sh) / 2
    return (f"m 0 {_f(y0)} l {_f(w - head)} {_f(y0)} {_f(w - head)} 0 {_f(w)} {_f(h / 2)} "
            f"{_f(w - head)} {_f(h)} {_f(w - head)} {_f(y1)} 0 {_f(y1)}")


def _alpha_tags(fa: float, sa: float, sha: float, mult: float) -> str:
    return f"\\1a{ass_alpha(fa * mult)}\\3a{ass_alpha(sa * mult)}\\4a{ass_alpha(sha * mult)}"


def _anim_tags(op: dict[str, Any]) -> tuple[str, str]:
    """Return (initial tags, transform tags) for alpha/scale keyframes."""
    anim = op.get("anim") or {}
    fa, sa, sha = op.get("fa", 1.0), op.get("sa", 1.0), op.get("sha", 0.55)
    base_scale = op.get("scale", 1.0)
    init, tr = "", ""
    alpha = anim.get("alpha")
    if alpha:
        init += _alpha_tags(fa, sa, sha, alpha[0][1])
        for (ta, _va), (tb, vb) in zip(alpha, alpha[1:]):
            tr += f"\\t({int(ta * 1000)},{int(tb * 1000)},{_alpha_tags(fa, sa, sha, vb)})"
    else:
        init += _alpha_tags(fa, sa, sha, 1.0)
    scale = anim.get("scale")
    if scale:
        s0 = scale[0][1] * base_scale * 100
        init += f"\\fscx{s0:.1f}\\fscy{s0:.1f}"
        for (ta, _va), (tb, vb) in zip(scale, scale[1:]):
            s = vb * base_scale * 100
            tr += f"\\t({int(ta * 1000)},{int(tb * 1000)},\\fscx{s:.1f}\\fscy{s:.1f})"
    elif base_scale != 1.0:
        init += f"\\fscx{base_scale * 100:.1f}\\fscy{base_scale * 100:.1f}"
    return init, tr


def _pos_tag(op: dict[str, Any], x: float, y: float) -> str:
    mv = (op.get("anim") or {}).get("move")
    if mv:
        dx, dy, dur = mv
        return f"\\move({_f(x + dx)},{_f(y + dy)},{_f(x)},{_f(y)},0,{int(dur * 1000)})"
    return f"\\pos({_f(x)},{_f(y)})"


def op_to_event(op: dict[str, Any]) -> str | None:
    k = op["k"]
    if int(round(op["t1"] * 100)) <= int(round(op["t0"] * 100)):
        return None
    start, end = ass_time(op["t0"]), ass_time(op["t1"])
    init, tr = _anim_tags(op)
    if k == "text":
        face = registry().get(op["font"])
        if face is None:
            return None
        italic = op.get("italic", face.ass_italic)
        tags = (
            f"\\an{op.get('an', 5)}{_pos_tag(op, op['x'], op['y'])}\\fn{face.ass_name}\\b{1 if face.ass_bold else 0}"
            f"\\i{1 if italic else 0}\\fs{op['size']:.2f}\\fsp{op.get('spacing', 0):.2f}"
            f"\\1c{ass_color(op['fill'])}\\3c{ass_color(op.get('stroke', '#000000'))}\\4c{ass_color(op.get('shc', '#000000'))}"
            f"\\bord{op.get('sw', 0):.2f}\\shad{op.get('shadow', 0):.2f}\\blur{op.get('blur', 0):.2f}\\q2"
        )
        return f"Dialogue: {op['l']},{start},{end},Default,,0,0,0,,{{{tags}{init}{tr}}}{_escape(op['text'])}"
    w, h = op["w"], op["h"]
    if k == "rect":
        path = rounded_rect_path(w, h, op.get("r", 0))
    elif k == "ellipse":
        path = ellipse_path(w, h)
    elif k == "arrow":
        path = arrow_path(w, h)
    else:
        return None  # images are composited by the frame compositor
    sw = op.get("sw", 0)
    x, y = op["x"], op["y"]
    extra = ""
    if k == "arrow" and op.get("rot"):
        extra = f"\\org({_f(x + w / 2)},{_f(y + h / 2)})\\frz{-float(op['rot']):.1f}"
    if op.get("grow"):
        extra += f"\\fscx0\\t(0,{int((op['t1'] - op['t0']) * 1000)},\\fscx100)"
    tags = (
        f"\\an7{_pos_tag(op, x, y)}\\p1\\1c{ass_color(op['fill'])}\\3c{ass_color(op.get('stroke', '#000000'))}"
        f"\\bord{sw:.2f}\\shad0\\blur{op.get('blur', 0):.2f}{extra}"
    )
    return f"Dialogue: {op['l']},{start},{end},Default,,0,0,0,,{{{tags}{init}{tr}}}{path}{{\\p0}}"


def build_ass(ops: list[dict[str, Any]], width: int, height: int) -> str:
    head = [
        "[Script Info]",
        "; Generated by ClipForge Studio",
        "ScriptType: v4.00+",
        f"PlayResX: {width}",
        f"PlayResY: {height}",
        "ScaledBorderAndShadow: yes",
        "WrapStyle: 2",
        "YCbCr Matrix: TV.709",
        "Kerning: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, "
        "StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Default,Inter,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    events = [e for e in (op_to_event(o) for o in ops) if e]
    return "\n".join(head + events) + "\n"
