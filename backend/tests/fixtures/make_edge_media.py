"""Generate edge-case media for the video test suite.

* vfr.mp4      – variable frame rate (first 2 s at 30 fps, then 15 fps) with audio
* hdr_pq.mp4   – 10-bit HEVC, BT.2020 / SMPTE-2084 (HDR10-style tags)
* hdr_hlg.mp4  – 10-bit HEVC, BT.2020 / ARIB STD-B67 (HLG)
* uhd.mp4      – 3840×2160 H.264 with audio
* hevc.mkv     – HEVC in Matroska with Opus audio (not browser-playable → proxy required)
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

SRC = "testsrc2=size={w}x{h}:rate={r}:duration={d}"


def ff(*args: str) -> None:
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", *args], check=True)


def build(out: Path) -> dict[str, Path]:
    out.mkdir(parents=True, exist_ok=True)
    files = {k: out / v for k, v in {"vfr": "vfr.mp4", "pq": "hdr_pq.mp4", "hlg": "hdr_hlg.mp4", "uhd": "uhd.mp4", "mkv": "hevc.mkv"}.items()}
    if not files["vfr"].exists():
        # 60 frames spaced 1/30 s, then frames spaced 1/15 s → 2 s + 2 s = 4 s
        ff("-f", "lavfi", "-i", SRC.format(w=1280, h=720, r=30, d=3),
           "-f", "lavfi", "-i", "sine=frequency=500:duration=4",
           "-vf", "setpts='if(lt(N,60),N/30,2+(N-60)/15)/TB'", "-fps_mode", "passthrough",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(files["vfr"]))
    hdr = "zscale=tin=bt709:min=bt709:pin=bt709:rin=tv:t={t}:m=bt2020nc:p=bt2020:r=tv:npl=100,format=yuv420p10le"
    for key, trc, x265 in (("pq", "smpte2084", "smpte2084"), ("hlg", "arib-std-b67", "arib-std-b67")):
        if not files[key].exists():
            ff("-f", "lavfi", "-i", SRC.format(w=1280, h=720, r=30, d=3), "-f", "lavfi", "-i", "sine=frequency=400:duration=3",
               "-vf", hdr.format(t=trc), "-c:v", "libx265", "-tag:v", "hvc1",
               "-x265-params", f"log-level=error:colorprim=bt2020:transfer={x265}:colormatrix=bt2020nc:hdr10=1",
               "-color_primaries", "bt2020", "-color_trc", trc, "-colorspace", "bt2020nc", "-c:a", "aac", "-shortest", str(files[key]))
    if not files["uhd"].exists():
        ff("-f", "lavfi", "-i", SRC.format(w=3840, h=2160, r=30, d=2), "-f", "lavfi", "-i", "sine=frequency=300:duration=2",
           "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(files["uhd"]))
    if not files["mkv"].exists():
        ff("-f", "lavfi", "-i", SRC.format(w=1920, h=1080, r=25, d=3), "-f", "lavfi", "-i", "sine=frequency=600:duration=3",
           "-c:v", "libx265", "-x265-params", "log-level=error", "-pix_fmt", "yuv420p", "-c:a", "libopus", "-shortest", str(files["mkv"]))
    return files


if __name__ == "__main__":
    for k, p in build(Path(sys.argv[1] if len(sys.argv) > 1 else ".")).items():
        print(k, p)
