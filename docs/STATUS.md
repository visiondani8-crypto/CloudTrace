# Features & implementation status

Status legend:

- **✅ Implemented and tested**: covered by automated tests, or verified by a recorded end-to-end run on real media (evidence column).
- **🟡 Implemented, not fully tested**: code is complete and wired into the UI and API, but this environment couldn't exercise it fully (e.g. no network, no macOS, no API key), or only partial checks exist.
- **🟠 Partially implemented**: works in a reduced form, with the gap stated.
- **⬜ Not yet implemented.**

Test evidence (latest run, Linux container, 4 vCPU, FFmpeg 6.1):

- **Backend:** `pytest`: **86 tests pass** with faster-whisper and the optional speaker model provided:
  - 16 analysis unit tests
  - 14 core/API/job-queue tests
  - 8 tuning/evaluation tests
  - 11 LLM-provider protocol-stub tests
  - 6 voice-encoder tests (one needs the Resemblyzer wheel locally and is skipped without it)
  - 14 real-media pipeline tests
  - 17 per-effect/transition/edge-media render tests

  The video suite also passes with the offline pocketsphinx engine.
- **Frontend:** `tsc` clean; `vitest`: 26 tests (geometry parity with Python, editor store incl. keyframes/envelopes, preview media-sync rules, UI interactions incl. ratings and tuning).
- **End to end:** `e2e/workflow.e2e.mjs` drives a real browser against the real backend in 11 steps: import → analyse → highlights → preview → editor → subtitle edit → text overlay → save → exact frame → render → ffprobe/browser playback → social package → ZIP → reload, then (step 11) live preview vs exporter. Step 11 compares a mid-crossfade frame and a B-roll region with exporter stills, plays across the cut (one decoder swap, monotonic playhead) and checks music volume. No console errors. Passed twice in a row after the decoder-swap fix below.
- **Additional recorded verifications:** a batch job (analyse → 3 branded edits → 3 validated renders); Regenerate Edit and versions; hook apply; SRT import; split/fill/speaker reframing; HEVC split-screen with music ducking; ProRes archival; all 10 caption presets through the exporter; job pause and resume.
- **Bugs found and fixed by the new tests:**
  - The structured-output schema dropped any field named `title`, so Claude-based refinement could never validate.
  - Dialogue envelopes were shifted on clips with an incoming crossfade.
  - The preview playhead could step back across a cut and make the decoders swap repeatedly.
  - VFR output used the average frame rate.
  - Hable HDR tone-mapping came out too dark.

The test media is a generated two-voice "podcast" (FFmpeg flite TTS) with known sentence timecodes, two real face photos and scene changes (`backend/tests/fixtures/make_test_video.py`). Real-world footage will be harder than this synthetic content, so the heuristics are tuned for it but not validated on a large real corpus.

## Import & media

| Feature | Status | Evidence / notes |
|---|---|---|
| Drag-and-drop / file-picker upload (streaming, constant memory) | ✅ | E2E step 1; component test |
| Multi-file batch import (one project per file) | 🟡 | Same code path as single upload; only single-file runs are tested |
| Link local file by path (no copy), copy option | ✅ | API test |
| Relink missing media (fingerprint-verified) | ✅ | API test (rejects a different file) |
| URL import via yt-dlp (no DRM/paywall bypass, rights confirmation) | 🟡 | Implemented; the sandbox blocks external sites, so it is untested |
| MP4/MOV/MKV/WebM/AVI; H.264/HEVC/etc. via FFmpeg | ✅ / 🟡 | MP4/H.264 and MKV/HEVC tested (`test_mkv_hevc_source_gets_browser_proxy_and_renders`); 4K source tested at source detail; MOV/WebM/AVI rely on FFmpeg |
| Metadata: duration, resolution, fps, codecs, bitrate, DAR, channels, size, missing audio, rotation | ✅ | `test_probe_metadata` (incl. 90° rotation, no-audio) |
| VFR detection and conforming | ✅ | `test_vfr_source_is_conformed`: a generated VFR clip renders at the nominal rate, snapped to 24/25/30/50/60 (the average-rate bug that produced 23.08 fps is fixed) |
| HDR detection + explicit tone-map | ✅ | `test_hdr_source_is_tonemapped_to_sdr` for PQ and HLG: within 20% of the SDR reference brightness and ≥85% of its saturation (Mobius; Hable was ~35% too dark) |
| Corrupted file handling | ✅ | `test_corrupted_file_is_reported` |
| Fast / Balanced / Deep modes | ✅ / 🟡 | Balanced tested everywhere, Fast used by the batch run; Deep only differs by parameters and is untested |
| Preview proxy, waveform, thumbnail sprite | ✅ | E2E (preview playback), screenshots |

## Analysis & highlights

| Feature | Status | Evidence / notes |
|---|---|---|
| Local transcription, faster-whisper, word timestamps, VAD, language detection | ✅ | Video tests with a local CTranslate2 model. **The Hugging Face auto-download path is untested here** (network blocked) |
| Offline fallback transcription (pocketsphinx, English) | ✅ | Full video suite passes with it |
| Chunked, resumable, cached transcription | ✅ | Cache hits observed on re-analysis; chunk cache used by tests |
| Transcript correction, SRT/VTT import & export | ✅ | API + E2E (corrected word appears in the exported SRT) |
| Scene detection (PySceneDetect), motion, faces, mouth activity, saliency | ✅ | Video tests (face presence > 90%, scene cuts) |
| Sentence & topic segmentation (lexical + pause + scene evidence) | ✅ | Unit tests; recovers the scripted topic boundaries |
| Speaker diarisation | ✅ / 🟡 | Spectral heuristic by default; **optional neural voice encoder** (Resemblyzer GE2E, run in numpy, opt-in install, see TUNING.md). Both get 100% on the clean two-voice podcast. On a harsher 3-voice, random-channel stress test (held-out seeds): neural 56–83%, spectral 42–64%. Tested on synthetic TTS voices only, so real-world accuracy is not established |
| Candidate generation on sentence boundaries with padding & cut-snapping | ✅ | Unit + video tests (no clip starts mid-sentence) |
| 7-factor explainable, reproducible, configurable scoring | ✅ | Unit tests (breakdown sums to score, bounded, reproducible) |
| Overlap/similarity/topic-diversity selection; fewer clips when quality is low | ✅ | Unit tests |
| Grounded titles, hooks, reasons, audiences, issues | ✅ | Unit tests |
| Content modes (8) | 🟡 | Podcast fully exercised; other modes are weight/cue presets with no dedicated tests |
| Clip ratings (👍/👎) and learned per-mode weights | ✅ | `test_tuning.py`: learner direction, regularisation, refusal on too few or one-sided ratings, noise not recommended, migration v3, API + pipeline hook; component tests for the buttons and Settings panel. Learned weights are only switched on when cross-validated ranking accuracy does not drop |
| Evaluation harness vs hand-picked clips (`python -m clipforge.devtools.evaluate`) | ✅ | Exact-metric unit tests; CLI run on the generated podcast (topic segments as golden: P = R = 100%, IoU 0.95). See TUNING.md |
| Custom natural-language instructions (duration, themes, focus/avoid terms, pauses, profanity, intros) | ✅ | Unit tests (incl. a fixed bug where "nothing about X" boosted X) |
| No-speech handling (no invented clips) | ✅ | `test_no_audio_source_does_not_invent_highlights` |
| LLM refinement: Ollama / Anthropic adapters with JSON-schema validation | ✅ / 🟡 | Exercised end to end against **local protocol stubs**: the real analysis pipeline over the Ollama API, and the official Anthropic SDK against a Messages-API stub (request shape, structured-output schema, validation retry, refusal/truncation/auth/rate-limit handling, server-side refusal fallback, consent gating; only transcript text is sent). This found and fixed a schema bug that broke Claude refinement. **Not run against a real Ollama model or the live API** (no server/key here) |
| Token usage & cost tracking | ✅ | Recorded and priced per call (both validation attempts; fallback-served turns priced at the serving model). Tested against the stubs |

## Editing

| Feature | Status | Evidence / notes |
|---|---|---|
| Persisted timeline model, autosave, manual save, survives reload | ✅ | E2E steps 7 & 10; API tests |
| Edit recipes: Clean Professional / Social Dynamic / Cinematic | ✅ | All three rendered; different clip counts, zooms, grades and audio |
| Silence & filler removal | ✅ | Pauses removed in renders (notes report counts) |
| Regenerate Edit with preserved versions | ✅ | Recorded verification |
| Split, delete, ripple delete, trim, undo/redo, markers, effects | ✅ | Store tests |
| Multi-track timeline UI (drag/trim, snapping, zoom, lock/hide/mute/solo, thumbnails, waveform) | 🟡 | Built and visually verified; drag interactions not automated |
| Captions: 10 presets, full styling, word-level timing, animations, safe areas | ✅ | All 10 rendered through the exporter; Bold Social, Karaoke, Creator, Clean White and Neon visually checked |
| Caption editor (select/correct/emphasise/hide words, SRT/VTT import & export) | ✅ | Component test + E2E |
| Drag captions directly on the canvas | ✅ | The caption block, text and graphic layers are draggable on the preview canvas (undoable as one step) |
| Text layers (title, hook, callout, lower third, label) with animations | ✅ | Rendered and pixel-validated |
| Graphics (highlight box, shape, circle, arrow, progress bar, logo/image) | ✅ | Rendered and visually verified |
| Effects (zoom, pan, blur, vignette, exposure, contrast, saturation, grade, fades, freeze, mask, sharpen) | ✅ | Each has a render test in `test_render_effects.py` that measures the pixels it changes |
| Transitions (cut, crossfade, fade to black/white, slide, zoom, blur) | ✅ | Parametrised render test per transition, each checking its own signature: crossfade ≈ average of both clips, fades reach black/white at the cut, slide shows A left and B right, zoom differs from both, blur drops sharpness |
| Speed changes | ✅ | `test_speed_change_and_sync`: duration and A/V sync after setpts/atempo |
| Keyframe editing | ✅ / 🟡 | Keyframe diamonds on the video lane (drag in time with snapping; select to edit position, zoom and easing; delete). Store tests; drag gestures not browser-automated |
| Volume envelopes | ✅ / 🟡 | Drawn on dialogue, music and SFX clips (double-click adds a point, drag to move, inspector to edit). `test_volume_envelope_is_audible` measures the level change in the render. Fixed a bug where envelopes on clips with an incoming crossfade were shifted by the handle length |
| Exact Frame (export-engine still) | ✅ | E2E step 7 |
| Live preview fidelity | ✅ / 🟡 | Same layout, fonts and maths as the exporter. Crossfade/slide/zoom use a second decoder that takes over at the cut. B-roll plays in place; music/SFX play with gain, envelopes, fades, ducking, mute/solo. E2E step 11: live crossfade frame vs exporter still differ by 2.8/255 mean (≈23 to either side alone), B-roll region by 8.4 (126 without it). Not live: sharpen (Exact Frame shows it), dialogue boost above 0 dB (browser volume caps at 1.0), and B-roll codecs the browser cannot decode (labelled) |

## Framing

| Feature | Status | Evidence / notes |
|---|---|---|
| Auto focus (face tracking, dead-zone camera, scene-cut snaps) | ✅ | Renders track the face |
| Split screen | ✅ | HEVC split-screen render verified |
| Smart fill (full frame + blurred background) | ✅ | ProRes render verified |
| Original frame | ✅ | Trim-accuracy test |
| Manual crop keyframes | 🟡 | Inspector-driven; untested |
| Speaker focus | 🟠 | Needs mouth movement linked to diarised voices. Falls back to auto focus with a note when unreliable (as on the static test faces) |
| 9:16, 16:9, 1:1, 4:5, source aspect | ✅ | `test_aspect_ratio_conversion`, rotation test |

## Audio

| Feature | Status | Evidence / notes |
|---|---|---|
| Two-pass loudness normalisation (−14 LUFS default), true-peak limiter | ✅ | Measured −14.0 ± 0.1 LUFS, TP ≤ −1.2 dBFS |
| Voice presets (Natural, Podcast Clean, Voice Forward, Cinematic, Gaming), EQ, HPF, gentle denoise, compressor | 🟡 | Applied in all renders; no listening tests |
| Background music with ducking, SFX, fades, loop | ✅ / 🟡 | Music + ducking rendered and validated; SFX/loop untested |
| Mute/solo, per-track gain, dialogue gain, stereo preserved | ✅ / 🟡 | Mix-graph unit tests for track gain, envelopes, mute and solo; per-track gain UI in the timeline headers. Stereo preservation not separately tested |
| Missing-audio sources (silent AAC track) | ✅ | `test_render_without_audio_and_rotated_source` |

## Rendering & export

| Feature | Status | Evidence / notes |
|---|---|---|
| Single-pass render from the original media | ✅ | All render tests |
| H.264 (x264) | ✅ | Tests + E2E |
| HEVC (x265, hvc1) | ✅ | Recorded verification |
| ProRes 422 HQ archival (.mov, PCM) | ✅ | Recorded verification |
| VideoToolbox hardware encoding | 🟡 | Implemented and auto-detected; **untested** (Linux container) |
| 720p / 1080p / 1440p / 2160p / Match Source, honest upscale reporting & blocking | ✅ / 🟡 | 720p/1080p rendered; 1440p/2160p share the code; upscale maths unit-tested |
| Output validation (streams, size, fps, duration, decode, A/V sync, loudness, overlay presence) | ✅ | All renders |
| Frame-accurate trims | ✅ | `test_trim_boundaries_are_frame_accurate` (compares against source frames) |
| SRT/VTT sidecars, render report JSON | ✅ | E2E |
| Disk-space check before render | 🟡 | Implemented; untested |
| Open output folder | 🟡 | `open -R` / Explorer / xdg-open; untested here (headless) |

## Social, batch, library, settings

| Feature | Status | Evidence / notes |
|---|---|---|
| Titles ×3, descriptions ×3, hashtags, hook text, thumbnail title, keywords, posting notes | ✅ | Video test + E2E (local extractive generation) |
| Platform profiles (TikTok, Reels, Shorts, Facebook, LinkedIn, X, Custom) | ✅ | Used in copy and scoring |
| LLM copy with grounding check (removes unsupported figures/quotes) | 🟡 | Grounding unit-tested; no live LLM call |
| Copy buttons, editing, saving choices, TXT/JSON/CSV, ZIP (video + captions + metadata) | ✅ | E2E step 10 |
| Batch: analyse → select top N → prepare edits → optional auto-render | ✅ | Recorded batch run (3 validated renders) |
| Persistent job queue: progress, cancel, retry, pause/resume, crash recovery | ✅ | `test_job_queue_cancel_retry_and_recovery` + recorded pause/resume |
| Concurrency limits from RAM/CPU | 🟡 | Implemented; not load-tested |
| Brand kits: create/duplicate/edit/delete/apply (fonts, colours, logo, audio, transitions) | ✅ | Unit test + batch run |
| Brand kit intro/outro clips | ⬜ | Not applied automatically (add them as B-roll manually) |
| B-roll library & transcript-based suggestions | 🟡 | Upload, suggestions and overlay compositing implemented; untested |
| AI hook suggestions (compare/preview/apply as new version) | ✅ | Recorded verification |
| Media library with search/filters/archive | 🟡 | Built and screenshot-verified; no automated test |
| Settings: storage, cache cleanup, export defaults, models, providers, defaults, performance, privacy, shortcuts, diagnostics | 🟡 | Built and screenshot-verified; diagnostics endpoint exercised |

## Platform & packaging

| Item | Status | Notes |
|---|---|---|
| Single launch command `./clipforge.sh` (start/dev/test/e2e/doctor) | ✅ | Verified on Linux |
| macOS (Apple Silicon) | 🟡 | Designed for it (Homebrew deps, Keychain, VideoToolbox, `open`) but **not run on a Mac in this session** |
| Windows | 🟡 | Python/Node/FFmpeg are portable; the launcher is bash (use WSL2 or run the two commands manually) |
| Desktop app bundle (.app) | ⬜ | Browser UI served by the local backend |
| Remotion | ⬜ | Intentionally not used: the FFmpeg/OpenCV/libass engine gives deterministic, frame-accurate renders without a headless browser (see ARCHITECTURE.md) |

## Continuation checklist

Done since the first build: edge-case media (VFR, HDR PQ/HLG, 4K, MKV/HEVC), a render test per effect and transition, the keyframe lane, volume envelopes, canvas caption dragging, track gain, live preview of transitions/B-roll/music, LLM protocol-stub integration tests, clip ratings with learned weights, the evaluation harness, and optional neural speaker embeddings.

Still open:

1. **Run on a Mac (blocked here).** No computer was connected to this cloud session. On a Mac, run `./clipforge.sh test` and `./clipforge.sh e2e`, render once with VideoToolbox, and confirm Keychain secret storage and the faster-whisper `small` model download. To let a cloud session do this, share a folder via the Claude desktop app (Settings → Claude Code → Remote Control).
2. **Real footage.** Rate clips on 5–10 of your own podcasts, learn weights, and measure with `python -m clipforge.devtools.evaluate` against clips you would have cut (TUNING.md). Nothing here has been validated on real recordings.
3. **Live LLM check.** One real run each with Ollama (`qwen2.5:7b-instruct`) and an Anthropic key. The protocol is covered by the stubs; model quality is not.
4. **Packaging (not started).** A macOS `.app` wrapper (small launcher plus a bundled Python runtime) and auto-start.
5. **Smaller gaps.** Brand-kit intro/outro clips; a browser-automated drag test for timeline gestures; dialogue boost above 0 dB in the live preview (needs Web Audio).
