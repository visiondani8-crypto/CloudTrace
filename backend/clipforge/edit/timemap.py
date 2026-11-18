"""Mapping between source time and output-timeline time for a main track."""

from __future__ import annotations

from dataclasses import dataclass

from ..schemas import Timeline, VideoClip


@dataclass
class Seg:
    clip: VideoClip
    t0: float  # timeline start
    t1: float  # timeline end
    s0: float  # source in
    s1: float  # source out
    speed: float

    def to_timeline(self, src_t: float) -> float:
        return self.t0 + (src_t - self.s0) / self.speed

    def to_source(self, t: float) -> float:
        return self.s0 + (t - self.t0) * self.speed


def segments(tl: Timeline) -> list[Seg]:
    out = []
    t = 0.0
    for c in tl.clips:
        d = c.duration
        out.append(Seg(c, t, t + d, c.src_in, c.src_out, c.speed))
        t += d
    return out


def source_to_timeline(segs: list[Seg], src_s: float, src_e: float) -> tuple[float, float] | None:
    """Map a source interval (e.g. a word) to the timeline, if its midpoint survives the edit."""
    mid = (src_s + src_e) / 2
    for sg in segs:
        if sg.s0 <= mid < sg.s1:
            a = max(src_s, sg.s0)
            b = min(src_e, sg.s1)
            return sg.to_timeline(a), sg.to_timeline(b)
    return None


def timeline_to_source(segs: list[Seg], t: float) -> tuple[Seg, float] | None:
    for sg in segs:
        if sg.t0 <= t < sg.t1:
            return sg, sg.to_source(t)
    if segs and abs(t - segs[-1].t1) < 1e-6:
        return segs[-1], segs[-1].s1
    return None
