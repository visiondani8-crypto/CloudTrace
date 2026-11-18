# Features & implementation status

Status legend:

- **✅ Implemented and tested**: covered by automated tests, or verified by a recorded end-to-end run on real media (evidence column).
- **🟡 Implemented, not fully tested**: code is complete and wired into the UI and API, but this environment couldn't exercise it fully (e.g. no network, no macOS, no API key), or only partial checks exist.
- **🟠 Partially implemented**: works in a reduced form, with the gap stated.
- **⬜ Not yet implemented.**

Test evidence (latest run, Linux container, 4 vCPU, FFmpeg 6.1):

- **Backend:** `pytest`: 40 tests (28 unit/API/job-queue + 12 real-media video tests) pass with faster-whisper. The video suite also passes with the offline pocketsphinx engine.
- **Frontend:** `tsc` clean; `vitest`: 18 tests (geometry parity with Python, editor store, UI interactions).
- **End to end:** `e2e/workflow.e2e.mjs` drives a real browser against the real backend: import → analyse → highlights → preview → editor → subtitle edit → text overlay → save → exact frame → render → ffprobe/browser playback → social package → ZIP → reload. Ten steps, no console errors.
- **Additional recorded verifications:** a batch job (analyse → 3 branded edits → 3 validated renders); Regenerate Edit and versions; hook apply; SRT import; split/fill/speaker reframing; HEVC split-screen with music ducking; ProRes archival; all 10 caption presets through the exporter; job pause and resume.

The test media is a generated two-voice "podcast" (FFmpeg flite TTS) with known sentence timecodes, two real face photos and scene changes (`backend/tests/fixtures/make_test_video.py`). Real-world footage will be harder than this synthetic content, so the heuristics are tuned for it but not validated on a large real corpus.

## Import & media

| Feature | Status | Evidence / notes |
|---|---|---|
| Drag-and-drop / file-picker upload (streaming, constant memory) | ✅ | E2E step 1; component test |
| Multi-file batch import (one project per file) | 🟡 | Same code path as single upload; only single-file runs are tested |
| Link local file by path (no copy), copy option | ✅ | API test |
| Relink missing media (fingerprint-verified) | ✅ | API test (rejects a different file) |
| URL import via yt-dlp (no DRM/paywall bypass, rights confirmation) | 🟡 | Implemented; the sandbox blocks external sites, so it is untested |
| MP4/MOV/MKV/WebM/AVI; H.264/HEVC/etc. via FFmpeg | 🟡 | MP4/H.264 tested; other containers rely on FFmpeg |
| Metadata: duration, resolution, fps, codecs, bitrate, DAR, channels, size, missing audio, rotation | ✅ | `test_probe_metadata` (incl. 90° rotation, no-audio) |
| VFR detection and conforming | 🟡 | Detection by packet timing + `fps` conforming; no VFR sample tested |
| HDR detection + explicit tone-map | 🟡 | Implemented (zscale/tonemap); no HDR sample tested |
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
| Speaker diarisation (spectral clustering) | 🟠 | **Experimental.** Recovered both synthetic voices exactly (2 speakers, confidence 0.92); real-world accuracy unknown. No neural diariser |
| Candidate generation on sentence boundaries with padding & cut-snapping | ✅ | Unit + video tests (no clip starts mid-sentence) |
| 7-factor explainable, reproducible, configurable scoring | ✅ | Unit tests (breakdown sums to score, bounded, reproducible) |
| Overlap/similarity/topic-diversity selection; fewer clips when quality is low | ✅ | Unit tests |
| Grounded titles, hooks, reasons, audiences, issues | ✅ | Unit tests |
| Content modes (8) | 🟡 | Podcast fully exercised; other modes are weight/cue presets with no dedicated tests |
| Custom natural-language instructions (duration, themes, focus/avoid terms, pauses, profanity, intros) | ✅ | Unit tests (incl. a fixed bug where "nothing about X" boosted X) |
| No-speech handling (no invented clips) | ✅ | `test_no_audio_source_does_not_invent_highlights` |
| LLM refinement: Ollama / Anthropic adapters with JSON-schema validation | 🟡 | Validation logic tested with a fake provider (rejects hallucinated boundaries). **No live calls** — no Ollama server or API key in this environment |
| Token usage & cost tracking | 🟡 | Recorded per call; untested without a provider |

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
| Drag captions directly on the canvas | 🟠 | Position via sliders; **text/graphic layers** are draggable on canvas, the caption block is not |
| Text layers (title, hook, callout, lower third, label) with animations | ✅ | Rendered and pixel-validated |
| Graphics (highlight box, shape, circle, arrow, progress bar, logo/image) | ✅ | Rendered and visually verified |
| Effects (zoom, pan, blur, vignette, exposure, contrast, saturation, grade, fades, freeze, mask, sharpen) | 🟡 | Zoom/fade/grade/vignette exercised by recipes; the others are implemented in the renderer and preview with no dedicated render tests |
| Transitions (cut, crossfade, fade to black/white, slide, zoom, blur) | ✅ / 🟡 | Crossfade and slide rendered and visually verified; the others implemented but not verified |
| Speed changes | 🟡 | Renderer (setpts/atempo) and UI implemented; untested |
| Keyframe editing | 🟠 | Crop keyframes via the inspector at the playhead; no keyframe lane/graph UI |
| Volume envelopes | 🟠 | Supported by schema and audio renderer; no UI to draw envelope points (clip gain only) |
| Exact Frame (export-engine still) | ✅ | E2E step 7 |
| Live preview fidelity | 🟠 | Same layout, fonts and maths; crossfade/slide/zoom transitions, B-roll and music are previewed only via Exact Frame and export |

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
| Mute/solo, per-track gain, dialogue gain, stereo preserved | 🟡 | Implemented in mix graph; partially exercised |
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

1. **Run on a Mac:** `./clipforge.sh test` and `./clipforge.sh e2e`; render once with VideoToolbox; confirm the Keychain secret storage and faster-whisper `small` model download.
2. **Real-footage tuning:** analyse 5–10 real podcasts/interviews and compare picks against your own choices. Adjust `analysis/modes.py` weights and cues (all scoring is centralised there and in `analysis/highlights.py`).
3. **Live LLM verification:** test Ollama (`qwen2.5:7b-instruct`) and Anthropic refinement and social copy end to end; check cost tracking.
4. **Preview fidelity:** live crossfade/slide previews (second `<video>` for the incoming clip), B-roll playback, and Web Audio for music preview.
5. **Editor depth:** keyframe lane UI, volume-envelope drawing, drag-to-position captions, track gain UI, dedicated render tests for each effect and transition.
6. **Neural diarisation (optional):** pyannote or similar behind a setting, to improve Speaker Focus on multi-camera podcasts.
7. **Packaging:** a macOS `.app` wrapper (e.g. a small launcher plus a bundled Python runtime) and auto-start.
8. **Test media:** add VFR, HDR (HLG/PQ), 4K and MKV/HEVC samples to the video suite.
