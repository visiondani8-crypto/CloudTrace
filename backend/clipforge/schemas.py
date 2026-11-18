"""Shared, validated data contracts.

The ``Timeline`` model is the single source of truth for an edit: the browser
editor reads and writes it, and the renderer compiles it into the final video.
All spatial values are normalised (0..1 of the canvas or source) so a timeline
renders identically at 720p or 4K. Times are seconds on the output timeline
unless a field says ``src_*`` (seconds in the source media).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

AnalysisMode = Literal["fast", "balanced", "deep"]
ContentMode = Literal["podcast", "interview", "educational", "gaming", "sports", "entertainment", "business", "custom"]
Platform = Literal["tiktok", "reels", "shorts", "facebook", "linkedin", "x", "custom"]
Aspect = Literal["9:16", "16:9", "1:1", "4:5", "source"]
EditStyle = Literal["clean", "dynamic", "cinematic"]


class _M(BaseModel):
    model_config = ConfigDict(extra="ignore")


# ----------------------------------------------------------------- analysis settings

class AnalysisSettings(_M):
    analysis_mode: AnalysisMode = "balanced"
    content_mode: ContentMode = "podcast"
    platforms: list[Platform] = Field(default_factory=lambda: ["tiktok"])
    duration_preset: str = "auto"  # key of DURATION_PRESETS or "custom"
    min_duration: float | None = None
    max_duration: float | None = None
    count: int | None = Field(default=None, ge=1, le=50)
    min_score: float | None = Field(default=None, ge=0, le=100)
    language: str | None = None  # None = auto-detect
    custom_instructions: str = ""
    transcription_engine: Literal["auto", "faster-whisper", "pocketsphinx"] = "auto"
    whisper_model: str | None = None
    ai_provider: Literal["local", "ollama", "anthropic"] = "local"
    factor_weights: dict[str, float] | None = None
    diarize: bool = True

    @model_validator(mode="after")
    def _check(self) -> AnalysisSettings:
        if self.min_duration is not None and self.max_duration is not None and self.min_duration >= self.max_duration:
            raise ValueError("min_duration must be smaller than max_duration")
        if not self.platforms:
            self.platforms = ["tiktok"]
        return self


class BatchSettings(_M):
    analysis: AnalysisSettings = Field(default_factory=AnalysisSettings)
    auto_prepare: bool = True
    prepare_count: int | None = Field(default=None, ge=1, le=50)
    aspect: Aspect = "9:16"
    edit_style: EditStyle = "dynamic"
    caption_style: str = "bold_social"
    brand_kit_id: str | None = None
    auto_render: bool = False
    export: ExportSettings | None = None
    output_folder: str | None = None
    generate_social: bool = True


# ----------------------------------------------------------------- timeline model

Easing = Literal["linear", "ease_in", "ease_out", "ease_in_out", "hold"]


class CropKeyframe(_M):
    t: float = Field(ge=0)  # timeline seconds
    cx: float = Field(0.5, ge=0, le=1)  # centre in source (normalised)
    cy: float = Field(0.5, ge=0, le=1)
    zoom: float = Field(1.0, ge=0.2, le=6.0)  # 1 = largest crop of output aspect that fits the source
    ease: Easing = "ease_in_out"


class Panel(_M):
    """A region of the canvas showing a (cropped) view of the source."""

    id: str = "main"
    rect: tuple[float, float, float, float] = (0.0, 0.0, 1.0, 1.0)  # x, y, w, h on canvas
    keyframes: list[CropKeyframe] = Field(default_factory=lambda: [CropKeyframe(t=0)])


class Reframe(_M):
    mode: Literal["auto", "speaker", "split", "fill", "manual", "original"] = "auto"
    panels: list[Panel] = Field(default_factory=lambda: [Panel()])
    background: Literal["blur", "black", "color"] = "blur"
    background_color: str = "#000000"
    confidence: float = 1.0
    note: str = ""


class Effect(_M):
    id: str
    type: Literal["zoom", "pan", "blur", "vignette", "exposure", "contrast", "saturation", "sharpen",
                  "fade_in", "fade_out", "freeze", "mask", "grade"]
    start: float = 0.0  # relative to clip start (output seconds)
    end: float | None = None  # None = to clip end
    params: dict[str, float | str] = Field(default_factory=dict)
    enabled: bool = True


class Transition(_M):
    type: Literal["cut", "crossfade", "fade_black", "fade_white", "slide", "zoom", "blur"] = "cut"
    duration: float = Field(0.0, ge=0, le=3)


class VolumePoint(_M):
    t: float  # relative to clip start
    gain_db: float = Field(0.0, ge=-60, le=24)


class VideoClip(_M):
    id: str
    src_in: float = Field(ge=0)
    src_out: float
    speed: float = Field(1.0, ge=0.25, le=4.0)
    start: float = Field(0.0, ge=0)  # timeline position (main track: computed contiguously)
    effects: list[Effect] = Field(default_factory=list)
    transition_in: Transition = Field(default_factory=Transition)
    volume_db: float = Field(0.0, ge=-60, le=24)
    envelope: list[VolumePoint] = Field(default_factory=list)
    muted: bool = False
    label: str = ""
    source_id: str | None = None  # None = timeline's main source; else B-roll asset/source id
    transform: tuple[float, float, float, float] | None = None  # x, y, w, h on canvas for overlay tracks
    opacity: float = Field(1.0, ge=0, le=1)

    @field_validator("src_out")
    @classmethod
    def _order(cls, v: float, info) -> float:
        src_in = info.data.get("src_in", 0.0)
        if v <= src_in:
            raise ValueError("src_out must be greater than src_in")
        return v

    @property
    def duration(self) -> float:
        return (self.src_out - self.src_in) / self.speed


class AudioClip(_M):
    id: str
    asset_id: str
    start: float = Field(0.0, ge=0)
    src_in: float = Field(0.0, ge=0)
    src_out: float | None = None
    gain_db: float = Field(-12.0, ge=-60, le=24)
    fade_in: float = Field(0.0, ge=0)
    fade_out: float = Field(0.0, ge=0)
    duck: bool = True  # duck under dialogue
    loop: bool = False
    envelope: list[VolumePoint] = Field(default_factory=list)
    label: str = ""


class TextStyle(_M):
    font: str = "Inter"
    weight: int = 800
    size: float = 0.055  # fraction of canvas height (line box)
    color: str = "#FFFFFF"
    outline_color: str = "#000000"
    outline: float = 0.0  # fraction of canvas height
    shadow: float = 0.0
    shadow_color: str = "#000000"
    background: Literal["none", "box", "rounded"] = "none"
    background_color: str = "#000000"
    background_opacity: float = Field(0.0, ge=0, le=1)
    letter_spacing: float = 0.0  # em
    line_height: float = 1.15
    align: Literal["left", "center", "right"] = "center"
    uppercase: bool = False
    italic: bool = False


class Animation(_M):
    type: Literal["none", "fade", "pop", "slide_up", "slide_down", "bounce", "scale", "typewriter"] = "fade"
    duration: float = Field(0.25, ge=0, le=3)


class TextLayer(_M):
    id: str
    kind: Literal["title", "hook", "callout", "lower_third", "label"] = "title"
    text: str
    start: float = Field(ge=0)
    end: float
    x: float = 0.5  # anchor (centre) on canvas
    y: float = 0.15
    width: float = Field(0.84, gt=0, le=1)  # wrap width
    style: TextStyle = Field(default_factory=TextStyle)
    anim_in: Animation = Field(default_factory=Animation)
    anim_out: Animation = Field(default_factory=lambda: Animation(type="fade", duration=0.2))
    opacity: float = Field(1.0, ge=0, le=1)
    subtitle: str = ""  # second line for lower thirds


class GraphicLayer(_M):
    id: str
    kind: Literal["rect", "highlight_box", "arrow", "progress_bar", "image", "logo", "circle"]
    start: float = Field(ge=0)
    end: float
    x: float = 0.5
    y: float = 0.5
    w: float = 0.3
    h: float = 0.1
    rotation: float = 0.0
    color: str = "#5B8CFF"
    stroke: float = 0.006
    fill_opacity: float = Field(0.0, ge=0, le=1)
    opacity: float = Field(1.0, ge=0, le=1)
    radius: float = 0.02
    asset_id: str | None = None
    anim_in: Animation = Field(default_factory=lambda: Animation(type="fade", duration=0.2))
    anim_out: Animation = Field(default_factory=lambda: Animation(type="fade", duration=0.2))


class CaptionWord(_M):
    id: int
    src_s: float  # source seconds
    src_e: float
    text: str
    emphasis: bool = False
    color: str | None = None
    hidden: bool = False  # removed filler etc.


class ManualCue(_M):
    id: str
    start: float
    end: float
    text: str


class CaptionStyle(_M):
    preset: str = "bold_social"
    font: str = "Montserrat"
    weight: int = 800
    size: float = 0.05
    color: str = "#FFFFFF"
    active_color: str = "#FFE14D"
    outline_color: str = "#000000"
    outline: float = 0.006
    shadow: float = 0.0
    shadow_color: str = "#000000"
    background: Literal["none", "box", "rounded", "word_box"] = "none"
    background_color: str = "#000000"
    background_opacity: float = Field(0.0, ge=0, le=1)
    letter_spacing: float = 0.0
    line_height: float = 1.12
    align: Literal["left", "center", "right"] = "center"
    position_y: float = Field(0.68, ge=0, le=1)  # vertical centre of caption block
    position_x: float = Field(0.5, ge=0, le=1)
    max_width: float = Field(0.84, gt=0, le=1)
    uppercase: bool = True
    mode: Literal["phrase", "word", "karaoke", "highlight"] = "highlight"
    max_words: int = Field(4, ge=1, le=16)
    max_lines: int = Field(2, ge=1, le=3)
    animation: Literal["none", "fade", "pop", "slide", "bounce", "scale"] = "pop"
    animation_speed: float = Field(1.0, ge=0.25, le=4.0)
    glow: float = 0.0
    active_scale: float = 1.0
    italic: bool = False


class Captions(_M):
    enabled: bool = True
    style: CaptionStyle = Field(default_factory=CaptionStyle)
    words: list[CaptionWord] = Field(default_factory=list)
    manual_cues: list[ManualCue] = Field(default_factory=list)
    language: str = "en"


class EqBand(_M):
    f: float
    g: float
    q: float = 1.0


class AudioSettings(_M):
    preset: Literal["natural", "podcast_clean", "voice_forward", "cinematic", "gaming", "off"] = "natural"
    enabled: bool = True
    dialogue_gain_db: float = Field(0.0, ge=-24, le=24)
    normalize: bool = True
    loudness_target: float = Field(-14.0, ge=-31, le=-9)  # LUFS integrated
    true_peak: float = Field(-1.0, ge=-9, le=0)
    denoise: float = Field(0.0, ge=0, le=1)  # 0..1 strength (gentle)
    highpass: float = Field(0.0, ge=0, le=300)
    eq: list[EqBand] = Field(default_factory=list)
    compressor: bool = False
    limiter: bool = True
    fade_in: float = Field(0.0, ge=0, le=5)
    fade_out: float = Field(0.0, ge=0, le=5)
    dialogue_mute: bool = False
    dialogue_solo: bool = False
    music_mute: bool = False
    mono: bool = False


class ColorSettings(_M):
    exposure: float = Field(0.0, ge=-1, le=1)  # stops-ish (brightness multiplier 2**x)
    contrast: float = Field(1.0, ge=0.5, le=2.0)
    saturation: float = Field(1.0, ge=0.0, le=2.5)
    temperature: float = Field(0.0, ge=-1, le=1)  # -1 cool .. +1 warm
    vignette: float = Field(0.0, ge=0, le=1)
    sharpen: float = Field(0.0, ge=0, le=1)


class Marker(_M):
    id: str
    t: float
    label: str = ""
    color: str = "#E8AD52"


class Track(_M):
    id: str
    kind: Literal["video", "overlay", "audio", "text", "graphics", "captions"]
    name: str
    locked: bool = False
    hidden: bool = False
    muted: bool = False
    solo: bool = False
    gain_db: float = 0.0


class Canvas(_M):
    aspect: Aspect = "9:16"
    width: int = 1080  # composition reference size
    height: int = 1920
    fps: float = 30.0
    safe_area: dict[str, float] = Field(default_factory=lambda: {"top": 0.1, "bottom": 0.2, "left": 0.06, "right": 0.12})


class Timeline(_M):
    schema_version: int = 1
    source_id: str
    canvas: Canvas = Field(default_factory=Canvas)
    tracks: list[Track] = Field(default_factory=list)
    clips: list[VideoClip] = Field(default_factory=list)  # main video track (contiguous)
    overlays: list[VideoClip] = Field(default_factory=list)  # B-roll / picture-in-picture
    audio_clips: list[AudioClip] = Field(default_factory=list)
    texts: list[TextLayer] = Field(default_factory=list)
    graphics: list[GraphicLayer] = Field(default_factory=list)
    captions: Captions = Field(default_factory=Captions)
    reframe: Reframe = Field(default_factory=Reframe)
    audio: AudioSettings = Field(default_factory=AudioSettings)
    color: ColorSettings = Field(default_factory=ColorSettings)
    markers: list[Marker] = Field(default_factory=list)
    brand_kit_id: str | None = None
    watermark: dict | None = None
    notes: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _layout(self) -> Timeline:
        # Main track clips are laid out contiguously in list order.
        t = 0.0
        for c in self.clips:
            c.start = round(t, 6)
            t += c.duration
        if not self.tracks:
            self.tracks = default_tracks()
        return self

    @property
    def duration(self) -> float:
        """Output duration = main track length (overlays/text are clipped to it)."""
        return sum(c.duration for c in self.clips)


def default_tracks() -> list[Track]:
    return [
        Track(id="v1", kind="video", name="Video"),
        Track(id="v2", kind="overlay", name="Overlay / B-roll"),
        Track(id="cap", kind="captions", name="Captions"),
        Track(id="txt", kind="text", name="Text"),
        Track(id="gfx", kind="graphics", name="Graphics"),
        Track(id="a1", kind="audio", name="Dialogue"),
        Track(id="a2", kind="audio", name="Music"),
        Track(id="a3", kind="audio", name="Sound FX"),
    ]


# ----------------------------------------------------------------- export settings

class ExportSettings(_M):
    name: str = ""
    preset: Literal["social_standard", "social_hq", "4k_hq", "archival", "custom"] = "social_hq"
    resolution: Literal["720p", "1080p", "1440p", "2160p", "source"] | None = None  # None = preset default
    fps: float | None = None  # None = timeline/source fps
    codec: Literal["h264", "hevc", "prores"] = "h264"
    quality_mode: Literal["crf", "bitrate"] = "crf"
    crf: int = Field(18, ge=0, le=51)
    bitrate_kbps: int | None = Field(None, ge=500, le=200000)
    encoder_speed: Literal["fast", "medium", "slow"] = "medium"
    hardware: Literal["auto", "cpu", "videotoolbox"] = "cpu"
    audio_bitrate_kbps: int = Field(192, ge=64, le=512)
    platform: Platform | None = None
    output_folder: str | None = None
    allow_upscale: bool = False
    burn_captions: bool = True
    export_srt: bool = True


BatchSettings.model_rebuild()
