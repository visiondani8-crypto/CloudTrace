# Architecture

```
 Browser (React, 127.0.0.1)                         Backend (FastAPI, 127.0.0.1 only)
┌─────────────────────────────┐   REST + SSE   ┌──────────────────────────────────────────────────┐
│ Dashboard · Import · Project │◄─────────────►│ api/          localhost guards, routes            │
│ Highlights · Editor · Export │               │ jobs/         persistent queue → worker threads   │
│ Social · Library · Brand ·   │               │   analysis(1) · render(auto) · light(2)            │
│ Settings                     │               │ analysis/     pipeline (below)                    │
│ editor/                      │               │ edit/         recipes · reframing · draw-ops       │
│   canvas compositor (proxy)  │   draw ops    │ render/       compositor → libass → encoder        │
│   same geometry/colour maths │◄──────────────│ social/       posting packages, ZIP bundles        │
│   same fonts (FontFace)      │               │ ai/           local / Ollama / Anthropic adapters  │
└─────────────────────────────┘               │ SQLite (metadata) + files (media, caches, JSON)    │
                                               └──────────────┬───────────────────────────────────┘
                                                              │ subprocess (argument lists, never shell)
                                                  FFmpeg/ffprobe · faster-whisper · OpenCV · PySceneDetect
```

## Services (backend/clipforge)

| Service | Module | Responsibility |
|---|---|---|
| Ingestion | `api/routes_projects.py`, `jobs/handlers.py` | Streaming upload (constant memory), link-by-path, yt-dlp URL import (no DRM bypass), relink with fingerprint check |
| Media metadata | `media/ffprobe.py` | Duration, display size after rotation/SAR, fps, VFR detection (packet timing), HDR (transfer/side data), codecs, audio layout, warnings |
| Transcription | `transcribe/` | faster-whisper (VAD, word timestamps, chunked at silences, resumable chunk cache) and pocketsphinx fallback. Cached per fingerprint + engine + model + language |
| Scene & audio analysis | `media/audio.py`, `media/visual.py` | 20 Hz energy envelope, spectral features, silences, waveform peaks. Low-res frames are piped from FFmpeg and analysed one at a time: PySceneDetect ContentDetector, motion, Haar faces + mouth activity, saliency centroid |
| Highlight engine | `analysis/` | Sentences → topics (TextTiling + pause/scene evidence) → speaker turns (spectral clustering, experimental) → per-sentence features → candidates → 7-factor scoring → optional LLM refinement → diverse selection → grounded explanations |
| Framing | `edit/reframe.py` | Crop geometry, face tracking with nearest-neighbour association, dead-zone virtual camera with speed limit, scene-cut snaps, RDP keyframe simplification, split screen, smart fill |
| Editing | `edit/recipes.py`, `edit/ops.py` | Style recipes, silence/filler removal, captions/titles/graphics layout as renderer-neutral draw ops, hook suggestions, brand kits, B-roll suggestions |
| Rendering | `render/` | Decoders per clip (with transition handles), sub-pixel affine panel warps, effects, transitions, grade, logos → libass (`subtitles` filter) → encoder. Separate lossless audio mix with two-pass loudnorm. Output validation |
| Social | `social/` | Extractive copy (local) or LLM copy with grounding checks; TXT/JSON/CSV/ZIP |
| Jobs | `jobs/queue.py` | SQLite-backed queue, stage progress, SSE events, cancel/pause/resume/retry, crash recovery |
| Settings & secrets | `settings_service.py`, `ai/secrets.py` | Preferences in SQLite, API keys in OS keychain (or 0600 file) |

## Analysis pipeline (one job, every stage cached)

```
probe → extract 16 kHz audio → energy/spectral features + waveform → 540p proxy + thumbnail sprite
     → transcription (chunk cache) → visual sampling (2/4/6 fps by mode) → sentences → topics → speakers
     → candidate windows (whole sentences, padding, cut-snapping) → score each → [LLM refine top-K]
     → select (NMS 25 %, TF-IDF similarity < 0.6, topic diversity, adaptive threshold) → thumbnails → persist
```

Re-running an analysis with different settings reuses audio, proxy, transcript and visual caches, so only scoring re-runs. Changing caption colours never touches analysis at all.

### Scoring (configurable heuristics, not predictions)

| Factor | Default max | Evidence used |
|---|---|---|
| Narrative coherence | 25 | natural entry pause, topic boundary, dependent/pronoun openers, completed ending, continuation of the next sentence, missing question context, lexical cohesion, topic changes, Q→A structure, speaker exchanges, outro |
| Opening hook | 20 | question / how-to / warning / bold claim / surprise / story / opinion / humour / emotion cues, line length, energetic delivery, greeting & filler penalties |
| Payoff | 15 | conclusion cues in the last sentences, explanation, resolution of the opening question or story, humour landing, late energy peak, complete ending |
| Audio & speech clarity | 10 | ASR confidence, speech ratio, long pauses, filler ratio, SNR, clipping |
| Visual engagement | 10 | face presence, relative motion (weighted by mode), shot changes, exposure |
| Novelty / insight | 10 | IDF distinctiveness vs. the whole video, specifics (numbers), insight/opinion markers, focus-term matches, repetition |
| Platform fit | 10 | duration vs. the platform's typical range and limit, speech pacing |

Content modes reweight the factors (normalised to 100) and the cue families. Custom instructions are parsed into duration limits, cue boosts, focus/avoid terms, pause penalties and profanity/intro avoidance, and these appear as explicit adjustments in each breakdown.

## Preview / export consistency

1. **One layout engine.** `edit/ops.py` turns captions (paging, line breaking with real font metrics, word positions, per-word state intervals, animation keyframes), text layers and graphics into *draw ops*.
2. **Two renderers, same ops.** `render/ass.py` writes each op as an ASS event (positioned per word, `\an5`, `\t` transforms, `\p1` vector drawings) for libass. `frontend/src/editor/drawOps.ts` draws the identical ops on canvas.
3. **Same fonts.** OFL fonts ship in `backend/clipforge/assets/fonts`. libass loads them via `fontsdir`, and the browser via `FontFace`. Sizes follow libass's model (`fontsize = winAscent + winDescent`).
4. **Same maths.** Crop geometry, keyframe easing, effect zoom/pan and the colour matrix (exposure → temperature → saturation → contrast), plus the vignette, are mirrored in `frontend/src/editor/geometry.ts`. `shared/geometry_fixtures.json` is asserted by both test suites.
5. **Exact Frame.** The editor can render the current frame through the real compositor + libass (`/api/edits/{id}/frame`) to check pixel accuracy.

Known differences: live preview uses the proxy, plays source audio without the mix, approximates glow/blur, and shows crossfade/slide/zoom transitions and B-roll as cuts/placeholders. Exact Frame and the export are authoritative.

## Render engine

```
per clip: ffmpeg -ss <in − handle> -i ORIGINAL  → [HDR tonemap] → setpts/speed → fps → scale(+colour matrix) → BGR pipe
compositor (Python/OpenCV, per output frame):
   background (blur-cover / solid, only where needed) → panel warps (crop+scale in one cubic/linear resample)
   → clip effects → transitions (two decoders across the cut) → B-roll → global grade → vignette → sharpen → logos
→ BGR pipe → ffmpeg: subtitles(ASS, libass at output res) → bt709 conversion → x264/x265/VideoToolbox/ProRes
audio: atrim per clip (+handles, 8 ms de-click fades) → amix → voice chain → music ducking (sidechain) → loudnorm measure
       → loudnorm linear apply + true-peak limiter → float WAV → single AAC encode at mux
validate: ffprobe streams/size/fps/duration · full decode · ebur128 loudness/peak · A/V duration · overlay pixel checks
```

The decoder pre-scales only when the crop has more pixels than the output needs, so there are never fewer than one source pixel per output pixel. The encoder runs once, and the original file is never modified.

## Job system

Jobs are rows in SQLite. Workers claim jobs atomically per queue: analysis (1), render (auto: min(3, RAM/6 GB, CPUs/4)), light (2). Handlers report stages and progress through a context that throttles database writes and broadcasts SSE events. Cancel terminates registered subprocesses, and pause sends SIGSTOP plus cooperative checkpoints. On start-up, `running` jobs are re-queued and resume from cached stage outputs (transcript chunks, audio, proxy, visual analysis).

## Security model

- Bound to `127.0.0.1`. The Host header must be loopback, which blocks DNS rebinding.
- State-changing requests need the `X-ClipForge-Client` header, and CORS only allows the local UI origins. Cross-site pages therefore cannot drive the API.
- Files are served only from database records or whitelisted directories. Filenames are sanitised, and `safe_join` blocks traversal.
- Subprocesses always use argument lists. User text in the FFmpeg filter graph is avoided by running the encoder in a work directory with relative paths.
- API keys stay in the OS keychain and are never returned to the UI or logged. Cloud AI requires explicit consent.
