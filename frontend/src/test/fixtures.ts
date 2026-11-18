import type { Timeline } from "@/lib/types";

export function makeTimeline(): Timeline {
  const style = {
    preset: "bold_social", font: "Montserrat", weight: 800, size: 0.05, color: "#FFFFFF", active_color: "#FFE14D", outline_color: "#000000",
    outline: 0.006, shadow: 0, shadow_color: "#000000", background: "none", background_color: "#000000", background_opacity: 0, letter_spacing: 0,
    line_height: 1.12, align: "center", position_y: 0.68, position_x: 0.5, max_width: 0.84, uppercase: true, mode: "highlight", max_words: 4,
    max_lines: 2, animation: "pop", animation_speed: 1, glow: 0, active_scale: 1, italic: false,
  } as const;
  return {
    schema_version: 1, source_id: "src_1",
    canvas: { aspect: "9:16", width: 1080, height: 1920, fps: 30, safe_area: { top: 0.1, bottom: 0.2, left: 0.06, right: 0.12 } },
    tracks: [
      { id: "v1", kind: "video", name: "Video", locked: false, hidden: false, muted: false, solo: false, gain_db: 0 },
      { id: "cap", kind: "captions", name: "Captions", locked: false, hidden: false, muted: false, solo: false, gain_db: 0 },
      { id: "txt", kind: "text", name: "Text", locked: false, hidden: false, muted: false, solo: false, gain_db: 0 },
      { id: "a1", kind: "audio", name: "Dialogue", locked: false, hidden: false, muted: false, solo: false, gain_db: 0 },
    ],
    clips: [
      { id: "c1", src_in: 10, src_out: 14, speed: 1, start: 0, effects: [], transition_in: { type: "cut", duration: 0 }, volume_db: 0, envelope: [], muted: false, label: "Part 1", opacity: 1 },
      { id: "c2", src_in: 15, src_out: 20, speed: 1, start: 4, effects: [{ id: "fx1", type: "zoom", start: 0, end: null, params: { from: 1.1, to: 1.1 }, enabled: true }], transition_in: { type: "cut", duration: 0 }, volume_db: 0, envelope: [], muted: false, label: "Part 2", opacity: 1 },
    ],
    overlays: [], audio_clips: [], texts: [], graphics: [],
    captions: { enabled: true, style: style as any, words: [{ id: 1, src_s: 10.5, src_e: 10.9, text: "Hello", emphasis: false, hidden: false }, { id: 2, src_s: 15.2, src_e: 15.6, text: "wrold", emphasis: false, hidden: false }], manual_cues: [], language: "en" },
    reframe: { mode: "auto", panels: [{ id: "main", rect: [0, 0, 1, 1], keyframes: [{ t: 0, cx: 0.5, cy: 0.5, zoom: 1, ease: "ease_in_out" }] }], background: "blur", background_color: "#000000", confidence: 1, note: "" },
    audio: { preset: "natural", enabled: true, dialogue_gain_db: 0, normalize: true, loudness_target: -14, true_peak: -1, denoise: 0, highpass: 0, eq: [], compressor: false, limiter: true, fade_in: 0, fade_out: 0, dialogue_mute: false, dialogue_solo: false, music_mute: false, mono: false },
    color: { exposure: 0, contrast: 1, saturation: 1, temperature: 0, vignette: 0, sharpen: 0 },
    markers: [], notes: [],
  };
}
