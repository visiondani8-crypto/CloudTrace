// Typed contracts mirroring backend/clipforge/schemas.py and API responses.

export type Aspect = "9:16" | "16:9" | "1:1" | "4:5" | "source";
export type EditStyle = "clean" | "dynamic" | "cinematic";
export type Platform = "tiktok" | "reels" | "shorts" | "facebook" | "linkedin" | "x" | "custom";
export type ContentMode = "podcast" | "interview" | "educational" | "gaming" | "sports" | "entertainment" | "business" | "custom";
export type AnalysisMode = "fast" | "balanced" | "deep";
export type Easing = "linear" | "ease_in" | "ease_out" | "ease_in_out" | "hold";

export interface AnalysisSettings {
  analysis_mode: AnalysisMode;
  content_mode: ContentMode;
  platforms: Platform[];
  duration_preset: string;
  min_duration?: number | null;
  max_duration?: number | null;
  count?: number | null;
  min_score?: number | null;
  language?: string | null;
  custom_instructions: string;
  transcription_engine: "auto" | "faster-whisper" | "pocketsphinx";
  whisper_model?: string | null;
  ai_provider: "local" | "ollama" | "anthropic";
  diarize: boolean;
}

export interface CropKeyframe { t: number; cx: number; cy: number; zoom: number; ease: Easing }
export interface Panel { id: string; rect: [number, number, number, number]; keyframes: CropKeyframe[] }
export interface Reframe {
  mode: "auto" | "speaker" | "split" | "fill" | "manual" | "original";
  panels: Panel[];
  background: "blur" | "black" | "color";
  background_color: string;
  confidence: number;
  note: string;
}

export type EffectType = "zoom" | "pan" | "blur" | "vignette" | "exposure" | "contrast" | "saturation" | "sharpen" | "fade_in" | "fade_out" | "freeze" | "mask" | "grade";
export interface Effect { id: string; type: EffectType; start: number; end: number | null; params: Record<string, number | string>; enabled: boolean }
export type TransitionType = "cut" | "crossfade" | "fade_black" | "fade_white" | "slide" | "zoom" | "blur";
export interface Transition { type: TransitionType; duration: number }
export interface VolumePoint { t: number; gain_db: number }

export interface VideoClip {
  id: string;
  src_in: number;
  src_out: number;
  speed: number;
  start: number;
  effects: Effect[];
  transition_in: Transition;
  volume_db: number;
  envelope: VolumePoint[];
  muted: boolean;
  label: string;
  source_id?: string | null;
  transform?: [number, number, number, number] | null;
  opacity: number;
}

export interface AudioClip {
  id: string;
  asset_id: string;
  start: number;
  src_in: number;
  src_out?: number | null;
  gain_db: number;
  fade_in: number;
  fade_out: number;
  duck: boolean;
  loop: boolean;
  envelope: VolumePoint[];
  label: string;
}

export interface TextStyle {
  font: string;
  weight: number;
  size: number;
  color: string;
  outline_color: string;
  outline: number;
  shadow: number;
  shadow_color: string;
  background: "none" | "box" | "rounded";
  background_color: string;
  background_opacity: number;
  letter_spacing: number;
  line_height: number;
  align: "left" | "center" | "right";
  uppercase: boolean;
  italic: boolean;
}

export type AnimType = "none" | "fade" | "pop" | "slide_up" | "slide_down" | "bounce" | "scale" | "typewriter";
export interface Animation { type: AnimType; duration: number }

export interface TextLayer {
  id: string;
  kind: "title" | "hook" | "callout" | "lower_third" | "label";
  text: string;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  style: TextStyle;
  anim_in: Animation;
  anim_out: Animation;
  opacity: number;
  subtitle: string;
}

export interface GraphicLayer {
  id: string;
  kind: "rect" | "highlight_box" | "arrow" | "progress_bar" | "image" | "logo" | "circle";
  start: number;
  end: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  color: string;
  stroke: number;
  fill_opacity: number;
  opacity: number;
  radius: number;
  asset_id?: string | null;
  anim_in: Animation;
  anim_out: Animation;
}

export interface CaptionWord { id: number; src_s: number; src_e: number; text: string; emphasis: boolean; color?: string | null; hidden: boolean }
export interface ManualCue { id: string; start: number; end: number; text: string }

export interface CaptionStyle {
  preset: string;
  font: string;
  weight: number;
  size: number;
  color: string;
  active_color: string;
  outline_color: string;
  outline: number;
  shadow: number;
  shadow_color: string;
  background: "none" | "box" | "rounded" | "word_box";
  background_color: string;
  background_opacity: number;
  letter_spacing: number;
  line_height: number;
  align: "left" | "center" | "right";
  position_y: number;
  position_x: number;
  max_width: number;
  uppercase: boolean;
  mode: "phrase" | "word" | "karaoke" | "highlight";
  max_words: number;
  max_lines: number;
  animation: "none" | "fade" | "pop" | "slide" | "bounce" | "scale";
  animation_speed: number;
  glow: number;
  active_scale: number;
  italic: boolean;
}

export interface Captions { enabled: boolean; style: CaptionStyle; words: CaptionWord[]; manual_cues: ManualCue[]; language: string }
export interface EqBand { f: number; g: number; q: number }
export interface AudioSettings {
  preset: "natural" | "podcast_clean" | "voice_forward" | "cinematic" | "gaming" | "off";
  enabled: boolean;
  dialogue_gain_db: number;
  normalize: boolean;
  loudness_target: number;
  true_peak: number;
  denoise: number;
  highpass: number;
  eq: EqBand[];
  compressor: boolean;
  limiter: boolean;
  fade_in: number;
  fade_out: number;
  dialogue_mute: boolean;
  dialogue_solo: boolean;
  music_mute: boolean;
  mono: boolean;
}
export interface ColorSettings { exposure: number; contrast: number; saturation: number; temperature: number; vignette: number; sharpen: number }
export interface Marker { id: string; t: number; label: string; color: string }
export interface Track {
  id: string;
  kind: "video" | "overlay" | "audio" | "text" | "graphics" | "captions";
  name: string;
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  solo: boolean;
  gain_db: number;
}
export interface Canvas { aspect: Aspect; width: number; height: number; fps: number; safe_area: Record<string, number> }

export interface Timeline {
  schema_version: number;
  source_id: string;
  canvas: Canvas;
  tracks: Track[];
  clips: VideoClip[];
  overlays: VideoClip[];
  audio_clips: AudioClip[];
  texts: TextLayer[];
  graphics: GraphicLayer[];
  captions: Captions;
  reframe: Reframe;
  audio: AudioSettings;
  color: ColorSettings;
  markers: Marker[];
  brand_kit_id?: string | null;
  watermark?: unknown;
  notes: string[];
}

export interface ExportSettings {
  name?: string;
  preset: "social_standard" | "social_hq" | "4k_hq" | "archival" | "custom";
  resolution?: "720p" | "1080p" | "1440p" | "2160p" | "source" | null;
  fps?: number | null;
  codec: "h264" | "hevc" | "prores";
  quality_mode: "crf" | "bitrate";
  crf: number;
  bitrate_kbps?: number | null;
  encoder_speed: "fast" | "medium" | "slow";
  hardware: "auto" | "cpu" | "videotoolbox";
  audio_bitrate_kbps: number;
  platform?: Platform | null;
  output_folder?: string | null;
  allow_upscale: boolean;
  burn_captions: boolean;
  export_srt: boolean;
}

// ----------------------------------------------------------------------------- API rows

export interface Probe {
  duration: number;
  size_bytes: number;
  container: string;
  bit_rate: number;
  width: number;
  height: number;
  display_width: number;
  display_height: number;
  rotation: number;
  display_aspect_ratio: string;
  fps: number;
  variable_frame_rate: boolean;
  video_codec: string;
  video_profile?: string;
  pix_fmt: string;
  bit_depth: number;
  color_space?: string | null;
  color_transfer?: string | null;
  hdr: boolean;
  hdr_format?: string | null;
  has_audio: boolean;
  audio_codec?: string | null;
  audio_channels: number;
  audio_channel_layout?: string | null;
  audio_sample_rate: number;
  audio_bit_rate: number;
  browser_playable: boolean;
  warnings: string[];
}

export interface MediaSource {
  id: string;
  project_id: string;
  kind: "reference" | "copy" | "url";
  path: string;
  original_name: string;
  origin_url?: string | null;
  size_bytes: number;
  fingerprint: string;
  probe: Probe | null;
  proxy_path?: string | null;
  status: string;
  created_at: string;
  missing: boolean;
  has_proxy: boolean;
  referenced: boolean;
}

export interface Project {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  archived: boolean;
  status: string;
  settings: Partial<AnalysisSettings> & Record<string, unknown>;
  summary: Record<string, any>;
  sources?: MediaSource[];
  jobs?: Job[];
  highlight_count?: number;
  render_count?: number;
  thumb_url?: string | null;
}

export interface Stage { name: string; label: string; weight: number; status: "pending" | "running" | "done" | "skipped"; progress: number }
export interface Job {
  id: string;
  kind: string;
  queue: string;
  project_id?: string | null;
  parent_id?: string | null;
  title: string;
  payload: Record<string, any>;
  status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
  stage: string;
  progress: number;
  stages: Stage[];
  error?: string | null;
  error_hint?: string | null;
  result: Record<string, any> & { log?: { t: number; level: string; msg: string }[] };
  attempts: number;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface FactorScore { label: string; points: number; max: number; raw: number; evidence: string[] }
export interface Highlight {
  id: string;
  project_id: string;
  source_id: string;
  rank: number;
  start: number;
  end: number;
  duration: number;
  score: number;
  breakdown: Record<string, FactorScore>;
  title: string;
  topic: string;
  hook: string;
  reason: string;
  audience: string;
  issues: string[];
  evidence: { adjustments?: { label: string; points: number }[]; metrics?: Record<string, number>; keywords?: string[]; llm?: boolean; speakers?: number[] };
  transcript: string;
  thumb_url?: string | null;
  selected: boolean;
  rating?: number;
  edits?: { id: string; style: string; version: number; aspect: string }[];
}

export interface Edit {
  id: string;
  project_id: string;
  highlight_id?: string | null;
  group_id: string;
  version: number;
  name: string;
  style: EditStyle;
  seed: number;
  timeline: Timeline;
  is_current: boolean;
  created_at: string;
  updated_at: string;
  highlight?: Highlight | null;
  source?: { id: string; probe: Probe; has_proxy: boolean; original_name: string } | null;
  aspect?: string;
  duration?: number;
}

export interface Render {
  id: string;
  project_id: string;
  edit_id: string;
  job_id?: string | null;
  name: string;
  settings: Record<string, any>;
  output_path?: string | null;
  status: string;
  validation?: { ok: boolean; checks: { name: string; ok: boolean; detail: string; severity: string }[]; loudness?: Record<string, number> } | null;
  file_size: number;
  duration: number;
  width: number;
  height: number;
  created_at: string;
  finished_at?: string | null;
  exists: boolean;
  file_url?: string | null;
}

export interface SocialContent {
  titles: { style: string; text: string }[];
  descriptions: { short: string; medium: string; long: string };
  hashtags: string[];
  hook_text: string;
  thumbnail_title: string;
  keywords: string[];
  suggestions: string[];
  grounding: Record<string, any>;
  warnings?: string[];
}
export interface SocialPackage {
  id: string;
  project_id: string;
  edit_id: string;
  render_id?: string | null;
  platform: Platform;
  provider: string;
  content: SocialContent;
  chosen: { title?: string; description?: string; hashtags?: string[] };
  usage: Record<string, any>;
  updated_at: string;
}

export interface BrandKit { id: string; name: string; data: Record<string, any>; created_at: string; updated_at: string }
export interface Asset { id: string; kind: string; name: string; path: string; size_bytes: number; meta: Record<string, any>; url: string; license_note: string }
export interface FontInfo { key: string; family: string; weight: number; italic: boolean; file: string; css_family: string }

export interface DrawOp {
  k: "text" | "rect" | "ellipse" | "arrow" | "img";
  l: number;
  t0: number;
  t1: number;
  x: number;
  y: number;
  text?: string;
  font?: string;
  size?: number;
  em?: number;
  asc?: number;
  fill: string;
  fa: number;
  stroke?: string;
  sw?: number;
  sa?: number;
  shadow?: number;
  shc?: string;
  sha?: number;
  blur?: number;
  spacing?: number;
  an?: number;
  italic?: boolean;
  scale?: number;
  w?: number;
  h?: number;
  r?: number;
  rot?: number;
  grow?: boolean;
  asset_id?: string;
  anim?: { alpha?: [number, number][]; scale?: [number, number][]; move?: [number, number, number] };
}

export interface TuningResult {
  content_mode: string;
  weights: Record<string, number>;
  defaults: Record<string, number>;
  ratings: { good: number; bad: number };
  train_accuracy: { default: number | null; learned: number | null };
  cv_accuracy: { default: number | null; learned: number | null; folds: number; held_out: number };
  recommended: boolean;
  learned_at: number;
  changes?: string[];
}

export interface TuningMode {
  label: string;
  ratings: { good: number; bad: number };
  can_learn: boolean;
  defaults: Record<string, number>;
  learned: TuningResult | null;
  enabled: boolean;
}

export interface TuningStatus { modes: Record<string, TuningMode>; min_ratings: number; min_per_class: number }
