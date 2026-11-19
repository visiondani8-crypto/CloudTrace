"""HDR → SDR tone-mapping, shared by proxies, analysis and final renders.

Mobius keeps in-gamut tones nearly linear and only compresses highlights, so
HDR footage keeps SDR-like brightness and saturation (Hable darkened mid-tones
by ~35 % in our tests). Peak luminance comes from the stream's mastering/CLL
metadata when present (FFmpeg's tonemap filter reads it from frame side data).
"""

from __future__ import annotations

from typing import Any

TONEMAP = "mobius:param=0.3:desat=0"


def tonemap_filters(info: dict[str, Any], out_format: str = "yuv420p") -> list[str]:
    """Filter chain converting an HDR (PQ/HLG, BT.2020) stream to SDR BT.709. Empty for SDR."""
    if not info.get("hdr"):
        return []
    return [
        "zscale=t=linear:npl=100",
        "format=gbrpf32le",
        "zscale=p=bt709",
        f"tonemap={TONEMAP}",
        "zscale=t=bt709:m=bt709:r=tv",
        f"format={out_format}",
    ]
