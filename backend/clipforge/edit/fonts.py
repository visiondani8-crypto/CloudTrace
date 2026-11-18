"""Bundled font registry and text metrics.

All caption/title fonts ship with the app (SIL OFL 1.1, see assets/fonts/licenses)
so the browser preview (FontFace) and the libass export use the *same files*.

Sizing follows libass: an ASS font size ``S`` makes ``usWinAscent +
usWinDescent`` equal ``S`` pixels; ``em = S * unitsPerEm / (winAsc + winDesc)``.
"""

from __future__ import annotations

import functools
from dataclasses import dataclass
from pathlib import Path

from fontTools.ttLib import TTFont

from ..config import FONTS_DIR


@dataclass(frozen=True)
class FontFace:
    key: str  # stable id, also used as CSS family alias "cf-<key>"
    family: str  # display family
    weight: int
    italic: bool
    file: str
    ass_name: str  # name libass matches (name ID 1)
    ass_bold: bool
    ass_italic: bool
    upm: int
    win_asc: int
    win_desc: int
    hhea_asc: int
    hhea_desc: int

    @property
    def path(self) -> Path:
        return FONTS_DIR / self.file

    def em_for_size(self, size_px: float) -> float:
        return size_px * self.upm / (self.win_asc + self.win_desc)

    def ascent_for_size(self, size_px: float) -> float:
        return size_px * self.win_asc / (self.win_asc + self.win_desc)


DISPLAY_FAMILIES = {
    "Inter": "Inter", "Montserrat": "Montserrat", "Poppins": "Poppins", "Anton": "Anton", "BebasNeue": "Bebas Neue",
    "SpaceGrotesk": "Space Grotesk", "PlayfairDisplay": "Playfair Display", "Bangers": "Bangers", "Oswald": "Oswald",
    "DMSerifDisplay": "DM Serif Display",
}


@functools.lru_cache(maxsize=1)
def registry() -> dict[str, FontFace]:
    out: dict[str, FontFace] = {}
    for p in sorted(FONTS_DIR.glob("*.ttf")):
        stem = p.stem  # e.g. Montserrat_900Black or PlayfairDisplay_500Medium_Italic
        parts = stem.split("_")
        fam_key = parts[0]
        weight = int("".join(ch for ch in parts[1] if ch.isdigit())[:3])
        italic = len(parts) > 2 and parts[2].lower() == "italic"
        f = TTFont(str(p), lazy=True)
        name = f["name"]
        sub = (name.getDebugName(2) or "Regular").lower()
        os2 = f["OS/2"]
        key = f"{fam_key}-{weight}{'i' if italic else ''}"
        out[key] = FontFace(
            key=key, family=DISPLAY_FAMILIES.get(fam_key, fam_key), weight=weight, italic=italic, file=p.name,
            ass_name=name.getDebugName(1) or fam_key, ass_bold="bold" in sub, ass_italic="italic" in sub,
            upm=f["head"].unitsPerEm, win_asc=os2.usWinAscent, win_desc=os2.usWinDescent,
            hhea_asc=f["hhea"].ascent, hhea_desc=f["hhea"].descent,
        )
        f.close()
    return out


def resolve(family: str, weight: int = 400, italic: bool = False) -> FontFace:
    """Closest bundled face for a family/weight; falls back to Inter."""
    reg = registry()
    fam_norm = family.replace(" ", "").lower()
    cands = [f for f in reg.values() if f.family.replace(" ", "").lower() == fam_norm or f.key.split("-")[0].lower() == fam_norm]
    if not cands:
        cands = [f for f in reg.values() if f.family == "Inter"]
    cands.sort(key=lambda f: (f.italic != italic, abs(f.weight - weight)))
    return cands[0]


@functools.lru_cache(maxsize=64)
def _advances(file: str) -> tuple[dict[int, int], int, int]:
    f = TTFont(str(FONTS_DIR / file), lazy=True)
    cmap = f.getBestCmap() or {}
    hmtx = f["hmtx"].metrics
    adv = {cp: hmtx[g][0] for cp, g in cmap.items() if g in hmtx}
    space = adv.get(32, f["head"].unitsPerEm // 4)
    upm = f["head"].unitsPerEm
    f.close()
    return adv, space, upm


def text_width(face: FontFace, text: str, size_px: float, letter_spacing_px: float = 0.0) -> float:
    adv, space, upm = _advances(face.file)
    em = face.em_for_size(size_px)
    units = sum(adv.get(ord(ch), space) for ch in text)
    return units * em / upm + letter_spacing_px * max(0, len(text))


def space_width(face: FontFace, size_px: float) -> float:
    _adv, space, upm = _advances(face.file)
    return space * face.em_for_size(size_px) / upm


def list_fonts() -> list[dict]:
    return [
        {"key": f.key, "family": f.family, "weight": f.weight, "italic": f.italic, "file": f.file,
         "css_family": f"cf-{f.key}", "upm": f.upm, "win_asc": f.win_asc, "win_desc": f.win_desc}
        for f in registry().values()
    ]
