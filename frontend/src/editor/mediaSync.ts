// Timing & volume rules for the live preview, mirroring backend/clipforge/render/audio_mix.py
// (solo/mute, track gain, envelopes, fades, ducking) and the compositor's transition windows.
import type { AudioClip, Timeline, TransitionType, VolumePoint } from "@/lib/types";
import { type Seg, sourceToTimeline } from "./geometry";

export const HANDLE_TRANSITIONS = new Set<TransitionType>(["crossfade", "slide", "zoom"]);

/** Piecewise-linear envelope gain (dB) at clip-relative time r — same as the FFmpeg expression. */
export function envelopeGain(points: VolumePoint[], r: number): number {
  if (!points.length) return 0;
  const p = [...points].sort((a, b) => a.t - b.t);
  if (r <= p[0].t) return p[0].gain_db;
  for (let i = 0; i < p.length - 1; i++) {
    if (r < p[i + 1].t) return p[i].gain_db + ((p[i + 1].gain_db - p[i].gain_db) * (r - p[i].t)) / Math.max(1e-3, p[i + 1].t - p[i].t);
  }
  return p[p.length - 1].gain_db;
}

export interface ActiveTransition { type: TransitionType; T: number; d: number; a: Seg; b: Seg; u: number }

/** The transition window (centred on the cut) containing timeline time t, if any. */
export function activeTransition(segs: Seg[], t: number): ActiveTransition | null {
  for (let k = 1; k < segs.length; k++) {
    const tr = segs[k].clip.transition_in;
    if (tr.type === "cut" || tr.duration <= 0) continue;
    const T = segs[k].t0;
    const half = tr.duration / 2;
    if (t >= T - half && t < T + half) return { type: tr.type, T, d: tr.duration, a: segs[k - 1], b: segs[k], u: (t - (T - half)) / tr.duration };
  }
  return null;
}

/** The next handle transition whose window starts within (t, t + lookahead]. */
export function upcomingTransition(segs: Seg[], t: number, lookahead: number): ActiveTransition | null {
  for (let k = 1; k < segs.length; k++) {
    const tr = segs[k].clip.transition_in;
    if (!HANDLE_TRANSITIONS.has(tr.type) || tr.duration <= 0) continue;
    const start = segs[k].t0 - tr.duration / 2;
    if (start > t && start <= t + lookahead) return { type: tr.type, T: segs[k].t0, d: tr.duration, a: segs[k - 1], b: segs[k], u: 0 };
  }
  return null;
}

export const smooth = (u: number) => u * u * (3 - 2 * u);

/** For handle transitions: the segment not under the playhead and its source time (uses handles past the cut). */
export function otherSource(tr: ActiveTransition, t: number): { seg: Seg; src: number } {
  if (t < tr.T) return { seg: tr.b, src: Math.max(0, tr.b.s0 - (tr.T - t) * tr.b.speed) };
  return { seg: tr.a, src: tr.a.s1 + (t - tr.T) * tr.a.speed };
}

function trackFlags(tl: Timeline) {
  const audio = tl.tracks.filter((x) => x.kind === "audio");
  const soloAny = audio.some((x) => x.solo) || tl.audio.dialogue_solo;
  return { audio, soloAny };
}

const dbToVol = (db: number) => Math.max(0, Math.min(1, 10 ** (db / 20)));

/** Dialogue volume (0..1) for the main video element at timeline time t. */
export function dialogueVolume(tl: Timeline, seg: Seg, t: number): number {
  const { audio, soloAny } = trackFlags(tl);
  const a1 = audio.find((x) => x.id === "a1");
  const muted = tl.audio.dialogue_mute || seg.clip.muted || !!a1?.muted || (soloAny && !(tl.audio.dialogue_solo || a1?.solo));
  if (muted) return 0;
  const db = seg.clip.volume_db + envelopeGain(seg.clip.envelope, t - seg.t0) + (a1?.gain_db ?? 0) + tl.audio.dialogue_gain_db;
  return dbToVol(db) * masterFade(tl, t);
}

/** Programme-level fade in/out (applied to the whole mix on export). */
function masterFade(tl: Timeline, t: number): number {
  const dur = timelineEnd(tl);
  let v = 1;
  if (tl.audio.fade_in > 0) v *= Math.min(1, Math.max(0, t / tl.audio.fade_in));
  if (tl.audio.fade_out > 0) v *= Math.min(1, Math.max(0, (dur - t) / tl.audio.fade_out));
  return v;
}

/** Dialogue weight of the outgoing (a) / incoming (b) side inside a handle transition — mirrors the export's afade overlap. */
export function transitionAudioWeights(tr: ActiveTransition): { a: number; b: number } {
  const u = Math.max(0, Math.min(1, tr.u));
  return { a: 1 - u, b: u };
}

function timelineEnd(tl: Timeline) {
  return tl.clips.reduce((a, c) => a + (c.src_out - c.src_in) / c.speed, 0);
}

export const clipLength = (a: AudioClip, assetDuration?: number) =>
  (a.src_out ?? (assetDuration ?? a.src_in + 10)) - a.src_in;

/** Speech intervals on the timeline (from caption word timings) for ducking. */
export function speechIntervals(tl: Timeline, segs: Seg[]): [number, number][] {
  const out: [number, number][] = [];
  for (const w of tl.captions.words) {
    const m = sourceToTimeline(segs, w.src_s, w.src_e);
    if (m) out.push(m);
  }
  out.sort((x, y) => x[0] - y[0]);
  return out;
}

export function isSpeech(iv: [number, number][], t: number, pad = 0.2): boolean {
  let lo = 0;
  let hi = iv.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (iv[mid][1] + pad < t) lo = mid + 1;
    else if (iv[mid][0] - pad > t) hi = mid - 1;
    else return true;
  }
  return false;
}

/** Timeline span [start, end) during which an audio clip sounds (clamped to the programme end). */
export function audioClipSpan(tl: Timeline, a: AudioClip, assetDuration?: number): [number, number] {
  const len = a.loop && a.src_out == null ? Math.max(0, timelineEnd(tl) - a.start) : clipLength(a, assetDuration);
  return [a.start, Math.min(a.start + len, timelineEnd(tl))];
}

/** Music/SFX volume (0..1) at timeline time t, or 0 when inactive/muted. */
export function audioClipVolume(tl: Timeline, a: AudioClip, t: number, speech: boolean, assetDuration?: number): number {
  const [s0, s1] = audioClipSpan(tl, a, assetDuration);
  const len = s1 - s0;
  const r = t - a.start;
  if (r < 0 || r >= len) return 0;
  const isMusic = a.label !== "sfx";
  const { audio, soloAny } = trackFlags(tl);
  const trk = audio.find((x) => x.id === (isMusic ? "a2" : "a3"));
  if (trk?.muted || (soloAny && !trk?.solo) || (isMusic && tl.audio.music_mute)) return 0;
  let db = a.gain_db + (trk?.gain_db ?? 0) + envelopeGain(a.envelope, r);
  if (a.duck && isMusic && speech) db -= 10; // approximates the export's sidechain compression
  let v = dbToVol(db);
  if (a.fade_in > 0) v *= Math.min(1, r / a.fade_in);
  if (a.fade_out > 0) v *= Math.min(1, Math.max(0, (len - r) / a.fade_out));
  return v * masterFade(tl, t);
}

/** Media time inside an audio asset for timeline time t (loops when requested). */
export function audioMediaTime(a: AudioClip, t: number, assetDuration?: number): number {
  const r = Math.max(0, t - a.start);
  if (a.loop && assetDuration && assetDuration > a.src_in + 0.1) return a.src_in + (r % (assetDuration - a.src_in));
  return a.src_in + r;
}
