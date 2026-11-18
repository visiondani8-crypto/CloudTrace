"""Audio rendering for a timeline.

Builds one FFmpeg filtergraph that cuts dialogue from the *original* source,
applies the voice chain, mixes music/SFX (with ducking), then measures and
applies loudness normalisation in a second pass. Intermediates are 32-bit
float WAV, so the only lossy step is the final AAC encode of the video file.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

from ..config import get_config
from ..edit.timemap import segments
from ..schemas import AudioSettings, Timeline
from ..util.proc import CancelToken, ffmpeg_progress_parser, run

SR = 48000


def _atempo_chain(speed: float) -> list[str]:
    out = []
    s = speed
    while s > 2.0:
        out.append("atempo=2.0")
        s /= 2.0
    while s < 0.5:
        out.append("atempo=0.5")
        s /= 0.5
    if abs(s - 1.0) > 1e-3:
        out.append(f"atempo={s:.5f}")
    return out


def _envelope_expr(points: list[tuple[float, float]], base_db: float) -> str:
    """Piecewise-linear gain (dB) as an FFmpeg expression in t."""
    if not points:
        return f"{10 ** (base_db / 20):.6f}"
    pts = sorted(points)
    expr = f"{pts[-1][1]}"
    for (ta, ga), (tb, gb) in reversed(list(zip(pts, pts[1:]))):
        seg = f"({ga}+({gb}-{ga})*(t-{ta})/{max(1e-3, tb - ta)})"
        expr = f"if(lt(t,{tb}),{seg},{expr})"
    expr = f"if(lt(t,{pts[0][0]}),{pts[0][1]},{expr})"
    return f"pow(10,({expr}+{base_db})/20)"


def voice_chain(a: AudioSettings) -> list[str]:
    f: list[str] = []
    if not a.enabled or a.preset == "off":
        return [f"volume={a.dialogue_gain_db}dB"] if a.dialogue_gain_db else []
    if a.highpass > 0:
        f.append(f"highpass=f={a.highpass:.0f}:poles=2")
    if a.denoise > 0:
        # Gentle FFT denoise; strength capped to avoid metallic artefacts.
        nr = 4 + 10 * min(1.0, a.denoise)
        f.append(f"afftdn=nr={nr:.1f}:nf=-45:tn=1")
    for b in a.eq:
        f.append(f"equalizer=f={b.f:.0f}:t=q:w={b.q:.2f}:g={b.g:.2f}")
    if a.compressor:
        f.append("acompressor=threshold=-20dB:ratio=3:attack=12:release=180:makeup=2dB:knee=4")
    if a.dialogue_gain_db:
        f.append(f"volume={a.dialogue_gain_db}dB")
    return f


def build_mix_graph(tl: Timeline, src: Path, has_audio: bool, asset_paths: dict[str, Path], duration: float) -> tuple[list[str], str]:
    """Return (input args, filter_complex) producing [out]."""
    inputs: list[str] = ["-i", str(src)]
    parts: list[str] = []
    a = tl.audio
    tracks = {t.id: t for t in tl.tracks}
    dlg_track = tracks.get("a1")
    solo_any = any(t.solo for t in tl.tracks if t.kind == "audio") or a.dialogue_solo
    dlg_muted = a.dialogue_mute or (dlg_track.muted if dlg_track else False) or (solo_any and not (a.dialogue_solo or (dlg_track and dlg_track.solo)))
    dlg_labels = []
    segs = segments(tl)
    if has_audio and not dlg_muted:
        for k, sg in enumerate(segs):
            c = sg.clip
            if c.muted:
                continue
            # Transition handles: crossfade-type transitions overlap audio too.
            tin = c.transition_in if k > 0 else None
            nxt = segs[k + 1].clip.transition_in if k + 1 < len(segs) else None
            pre = (tin.duration / 2) if tin and tin.type in ("crossfade", "slide", "zoom") else 0.0
            post = (nxt.duration / 2) if nxt and nxt.type in ("crossfade", "slide", "zoom") else 0.0
            s0 = max(0.0, sg.s0 - pre * c.speed)
            s1 = sg.s1 + post * c.speed
            real_pre = (sg.s0 - s0) / c.speed
            dur = (s1 - s0) / c.speed
            chain = [f"atrim=start={s0:.4f}:end={s1:.4f}", "asetpts=PTS-STARTPTS", *_atempo_chain(c.speed),
                     "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"]
            env = [(p.t, p.gain_db) for p in c.envelope]
            if env or c.volume_db:
                chain.append(f"volume='{_envelope_expr(env, c.volume_db)}':eval=frame")
            fi = max(0.008, pre * 2) if pre else 0.008
            fo = max(0.008, post * 2) if post else 0.008
            chain.append(f"afade=t=in:st=0:d={fi:.4f}")
            chain.append(f"afade=t=out:st={max(0.0, dur - fo):.4f}:d={fo:.4f}")
            delay_ms = int(round(max(0.0, sg.t0 - real_pre) * 1000))
            chain.append(f"adelay={delay_ms}:all=1")
            lbl = f"d{k}"
            parts.append(f"[0:a:0]{','.join(chain)}[{lbl}]")
            dlg_labels.append(f"[{lbl}]")
    if dlg_labels:
        parts.append(f"{''.join(dlg_labels)}amix=inputs={len(dlg_labels)}:normalize=0:duration=longest:dropout_transition=0[dmix]")
        vc = voice_chain(a)
        parts.append(f"[dmix]{','.join(vc) if vc else 'anull'}[dlg]")
    else:
        parts.append(f"anullsrc=r={SR}:cl=stereo,atrim=duration={duration:.4f}[dlg]")
    # Music & SFX
    music_labels, sfx_labels = [], []
    music_track = tracks.get("a2")
    sfx_track = tracks.get("a3")
    for k, ac in enumerate(tl.audio_clips):
        p = asset_paths.get(ac.asset_id)
        if p is None or not p.exists():
            continue
        is_music = ac.label.lower() != "sfx" and not ac.label.lower().startswith("sfx")
        trk = music_track if is_music else sfx_track
        if (trk and (trk.muted or (solo_any and not trk.solo))) or (is_music and a.music_mute):
            continue
        if ac.loop:
            inputs += ["-stream_loop", "-1"]
        inputs += ["-i", str(p)]
        idx = sum(1 for x in inputs if x == "-i") - 1
        clip_len = (ac.src_out - ac.src_in) if ac.src_out else max(0.1, duration - ac.start)
        clip_len = min(clip_len, max(0.1, duration - ac.start))
        chain = [f"atrim=start={ac.src_in:.4f}:duration={clip_len:.4f}", "asetpts=PTS-STARTPTS",
                 "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"]
        env = [(pt.t, pt.gain_db) for pt in ac.envelope]
        chain.append(f"volume='{_envelope_expr(env, ac.gain_db + (trk.gain_db if trk else 0))}':eval=frame")
        if ac.fade_in > 0:
            chain.append(f"afade=t=in:st=0:d={ac.fade_in:.3f}")
        if ac.fade_out > 0:
            chain.append(f"afade=t=out:st={max(0.0, clip_len - ac.fade_out):.3f}:d={ac.fade_out:.3f}")
        chain.append(f"adelay={int(ac.start * 1000)}:all=1")
        lbl = f"m{k}" if is_music else f"s{k}"
        parts.append(f"[{idx}:a:0]{','.join(chain)}[{lbl}]")
        (music_labels if is_music else sfx_labels).append((f"[{lbl}]", ac.duck))
    mix_inputs = []
    dlg_out = "[dlg]"
    if music_labels:
        parts.append(f"{''.join(l for l, _ in music_labels)}amix=inputs={len(music_labels)}:normalize=0:duration=longest[mus]")
        if any(d for _, d in music_labels) and dlg_labels:
            parts.append("[dlg]asplit=2[dlgA][dsc]")
            dlg_out = "[dlgA]"
            parts.append("[mus][dsc]sidechaincompress=threshold=0.02:ratio=8:attack=25:release=450:makeup=1[musd]")
            mix_inputs.append("[musd]")
        else:
            mix_inputs.append("[mus]")
    mix_inputs.insert(0, dlg_out)
    for l, _ in sfx_labels:
        mix_inputs.append(l)
    tail = [f"apad=whole_dur={duration:.4f}", f"atrim=0:{duration:.4f}"]
    if a.fade_in > 0:
        tail.append(f"afade=t=in:st=0:d={a.fade_in:.3f}")
    if a.fade_out > 0:
        tail.append(f"afade=t=out:st={max(0.0, duration - a.fade_out):.3f}:d={a.fade_out:.3f}")
    if a.mono:
        tail.append("pan=mono|c0=0.5*c0+0.5*c1,aformat=channel_layouts=stereo")
    if len(mix_inputs) > 1:
        parts.append(f"{''.join(mix_inputs)}amix=inputs={len(mix_inputs)}:normalize=0:duration=longest,{','.join(tail)}[out]")
    else:
        parts.append(f"{dlg_out}{','.join(tail)}[out]")
    return inputs, ";".join(parts)


def render_audio(tl: Timeline, src: Path, info: dict[str, Any], asset_paths: dict[str, Path], out_wav: Path,
                 token: CancelToken | None = None, progress=None) -> dict[str, Any]:
    cfg = get_config()
    duration = tl.duration
    pre = out_wav.with_name("mix_pre.wav")
    inputs, graph = build_mix_graph(tl, src, info.get("has_audio", False), asset_paths, duration)
    run([cfg.ffmpeg_bin, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *inputs,
         "-filter_complex", graph, "-map", "[out]", "-ar", str(SR), "-c:a", "pcm_f32le",
         "-progress", "pipe:2", "-nostats", str(pre)],
        token=token, on_stderr_line=ffmpeg_progress_parser(duration, lambda p: progress(p * 0.6)) if progress else None)
    report: dict[str, Any] = {"loudness_target": tl.audio.loudness_target, "normalized": False}
    a = tl.audio
    if a.normalize and a.enabled and a.preset != "off":
        _, _, err = run([cfg.ffmpeg_bin, "-nostdin", "-hide_banner", "-y", "-i", str(pre), "-af",
                         f"loudnorm=I={a.loudness_target}:TP={a.true_peak}:LRA=11:print_format=json", "-f", "null", "-"],
                        token=token, check=True)
        m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", err.replace("\n", " "))
        measured = json.loads(m.group(0)) if m else None
        if measured and measured.get("input_i") not in (None, "-inf") and math.isfinite(float(measured["input_i"])) and float(measured["input_i"]) > -70:
            lim = 10 ** ((a.true_peak - 0.3) / 20)
            af = (f"loudnorm=I={a.loudness_target}:TP={a.true_peak}:LRA=11:measured_I={measured['input_i']}:"
                  f"measured_TP={measured['input_tp']}:measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}:"
                  f"offset={measured['target_offset']}:linear=true:print_format=summary")
            if a.limiter:
                af += f",alimiter=limit={lim:.4f}:attack=5:release=50:level=false"
            af += f",aresample={SR}"
            run([cfg.ffmpeg_bin, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(pre), "-af", af,
                 "-ar", str(SR), "-c:a", "pcm_f32le", str(out_wav)], token=token)
            report.update(normalized=True, measured_input_lufs=float(measured["input_i"]), measured_input_tp=float(measured["input_tp"]))
        else:
            pre.replace(out_wav)
            report["note"] = "Audio is silent or too quiet to measure; normalisation skipped."
    else:
        if a.limiter and a.enabled:
            run([cfg.ffmpeg_bin, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(pre),
                 "-af", f"alimiter=limit={10 ** ((a.true_peak - 0.3) / 20):.4f}:level=false", "-c:a", "pcm_f32le", str(out_wav)], token=token)
        else:
            pre.replace(out_wav)
    if pre.exists() and pre != out_wav:
        pre.unlink(missing_ok=True)
    if progress:
        progress(1.0)
    return report
