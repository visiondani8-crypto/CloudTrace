import { makeTimeline } from "@/test/fixtures";
import type { AudioClip, Timeline } from "@/lib/types";
import { segments } from "./geometry";
import {
  activeTransition, audioClipSpan, audioClipVolume, audioMediaTime, dialogueVolume, envelopeGain, isSpeech, otherSource,
  speechIntervals, transitionAudioWeights, upcomingTransition,
} from "./mediaSync";

const music = (over: Partial<AudioClip> = {}): AudioClip => ({
  id: "m1", asset_id: "as_x", start: 1, src_in: 2, src_out: 6, gain_db: -6, fade_in: 0, fade_out: 0, duck: false, loop: false, envelope: [], label: "music", ...over,
});

function withCrossfade(): Timeline {
  const tl = makeTimeline();
  tl.clips[1].transition_in = { type: "crossfade", duration: 1 };
  return tl;
}

describe("preview media sync (mirrors the exporter's timing and mix rules)", () => {
  it("interpolates envelopes linearly and holds the end values", () => {
    const pts = [{ t: 1, gain_db: 0 }, { t: 3, gain_db: -12 }];
    expect(envelopeGain([], 2)).toBe(0);
    expect(envelopeGain(pts, 0)).toBe(0);
    expect(envelopeGain(pts, 2)).toBeCloseTo(-6);
    expect(envelopeGain(pts, 10)).toBe(-12);
  });

  it("centres transition windows on the cut and finds the far-side source in the handles", () => {
    const segs = segments(withCrossfade()); // cut at T = 4 (clip 1 = src 10..14, clip 2 = src 15..20)
    expect(activeTransition(segs, 3.4)).toBeNull();
    const tr = activeTransition(segs, 4)!;
    expect(tr.type).toBe("crossfade");
    expect(tr.u).toBeCloseTo(0.5);
    expect(otherSource(activeTransition(segs, 3.75)!, 3.75)).toMatchObject({ seg: { index: 1 }, src: 14.75 });
    expect(otherSource(activeTransition(segs, 4.25)!, 4.25)).toMatchObject({ seg: { index: 0 }, src: 14.25 });
    expect(upcomingTransition(segs, 2.8, 1)?.T).toBe(4);
    expect(upcomingTransition(segs, 1, 1)).toBeNull();
    const w = transitionAudioWeights(tr);
    expect(w.a + w.b).toBeCloseTo(1);
  });

  it("applies dialogue gain, track gain, envelope, mute and solo like the audio mix", () => {
    const tl = makeTimeline();
    const sg = segments(tl)[0];
    expect(dialogueVolume(tl, sg, 1)).toBeCloseTo(1);
    tl.clips[0].volume_db = -6;
    expect(dialogueVolume(tl, sg, 1)).toBeCloseTo(10 ** (-6 / 20));
    tl.tracks.find((x) => x.id === "a1")!.gain_db = -6;
    expect(dialogueVolume(tl, sg, 1)).toBeCloseTo(10 ** (-12 / 20));
    tl.clips[0].envelope = [{ t: 0, gain_db: -6 }];
    expect(dialogueVolume(tl, sg, 1)).toBeCloseTo(10 ** (-18 / 20));
    tl.tracks.push({ id: "a2", kind: "audio", name: "Music", locked: false, hidden: false, muted: false, solo: true, gain_db: 0 });
    expect(dialogueVolume(tl, sg, 1)).toBe(0); // another track soloed → dialogue silent
    tl.tracks.pop();
    tl.audio.dialogue_mute = true;
    expect(dialogueVolume(tl, sg, 1)).toBe(0);
  });

  it("plays music only inside its span, with fades, ducking and loop wrap-around", () => {
    const tl = makeTimeline(); // 9 s programme
    const a = music({ fade_in: 1, fade_out: 1 });
    expect(audioClipSpan(tl, a)).toEqual([1, 5]);
    expect(audioClipVolume(tl, a, 0.5, false)).toBe(0);
    expect(audioClipVolume(tl, a, 1.5, false)).toBeCloseTo(0.5 * 10 ** (-6 / 20));
    expect(audioClipVolume(tl, a, 3, false)).toBeCloseTo(10 ** (-6 / 20));
    expect(audioClipVolume(tl, a, 3, false)).toBeGreaterThan(audioClipVolume(tl, { ...a, duck: true }, 3, true));
    expect(audioClipVolume(tl, a, 4.5, false)).toBeCloseTo(0.5 * 10 ** (-6 / 20));
    expect(audioClipVolume(tl, a, 5.2, false)).toBe(0);
    tl.audio.music_mute = true;
    expect(audioClipVolume(tl, a, 3, false)).toBe(0);
    const loop = music({ src_in: 0, src_out: null, loop: true });
    expect(audioClipSpan(tl, loop, 3)).toEqual([1, 9]);
    expect(audioMediaTime(loop, 5.5, 3)).toBeCloseTo(1.5);
  });

  it("derives speech intervals from caption timing for ducking", () => {
    const tl = makeTimeline();
    const iv = speechIntervals(tl, segments(tl));
    expect(iv[0][0]).toBeCloseTo(0.5);
    expect(iv[1][0]).toBeCloseTo(4.2);
    expect(isSpeech(iv, 0.7)).toBe(true);
    expect(isSpeech(iv, 2.5)).toBe(false);
  });
});
