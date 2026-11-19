# Installation & setup

## Requirements

| | Minimum | Recommended |
|---|---|---|
| OS | macOS 13+, Linux (x86-64/arm64); Windows via WSL2 | macOS on Apple Silicon (M1 or newer) |
| CPU | 4 cores | 8+ cores |
| RAM | 8 GB | 16 GB+ (one 1080p render ≈ 1–1.5 GB peak; 4K ≈ 4 GB) |
| Disk | 5 GB + your media | SSD. Proxies are ~10% of source size; exports depend on settings |
| FFmpeg | 5.1+ built with **libass**, **libx264** (and ideally libx265, zimg) | Homebrew `ffmpeg` |
| Python | 3.11+ | managed automatically by `uv` |
| Node.js | 20+ (only to build the UI) | 22 LTS |

There is no GPU requirement. On Apple Silicon, transcription runs on the CPU (CTranslate2 int8), and video encoding can use **VideoToolbox** (Export Centre → Encoder). CUDA is never assumed.

## macOS (Homebrew)

```bash
brew install ffmpeg node uv
./clipforge.sh doctor     # verifies FFmpeg/libass/libx264, Python and Node
./clipforge.sh            # first run: installs Python deps (uv sync), builds the UI, starts the app
```

The app opens at **http://127.0.0.1:8765**. Your library lives in `~/ClipForge` (override with `CLIPFORGE_DATA_DIR=/Volumes/Media/ClipForge ./clipforge.sh`).

Without `uv`, the script creates `backend/.venv` with `python3 -m venv` and installs with pip.

## Linux

```bash
sudo apt install ffmpeg nodejs npm python3 python3-venv   # or your distro's equivalents
curl -LsSf https://astral.sh/uv/install.sh | sh             # optional but recommended
./clipforge.sh
```

## Manual / development setup

```bash
cd backend && uv sync                 # Python deps from uv.lock
cd ../frontend && npm ci              # JS deps from package-lock.json
cd .. && ./clipforge.sh dev           # backend :8765 (auto-reload) + Vite :5173 (proxying /api)
```

Run tests: `./clipforge.sh test` (backend unit + real-media video tests, frontend type-check + tests) and `./clipforge.sh e2e` (browser workflow; needs Playwright with Chromium: `npx playwright install chromium`).

## FFmpeg setup

ClipForge calls `ffmpeg`/`ffprobe` from `PATH` (override with `CLIPFORGE_FFMPEG_BIN` / `CLIPFORGE_FFPROBE_BIN`). It needs:

- **libass** for the `subtitles` filter that burns captions/titles/graphics. Without it, captions cannot be exported.
- **libx264**: the default H.264 encoder. **libx265** for HEVC, **prores_ks** for Archival Master.
- **zimg** (`zscale`): HDR → SDR tone-mapping for HDR sources.
- **videotoolbox** (macOS, optional): hardware H.264/HEVC encoding.

Settings → Diagnostics shows exactly what was detected.

## Speech recognition models

| Engine | Languages | Quality | Setup |
|---|---|---|---|
| **faster-whisper** (default) | ~99 languages, auto-detect | Excellent, with punctuation and word timestamps | Model downloads once from Hugging Face on first use |
| **pocketsphinx** (fallback) | English only | Usable, no punctuation | Bundled in the Python wheel, no download |

Choose the model in **Settings → Transcription**: `tiny`, `base`, `small` (default, good balance), `medium`, `large-v3`, `turbo` (≈large quality, faster), or a **path to a local CTranslate2 model folder**. The folder must contain `model.bin`, `config.json` and `tokenizer.json`. Downloads are cached in `~/ClipForge/Models/whisper`. After that, everything is offline.

Engine `auto` uses faster-whisper. If the model can't be loaded (offline, first run), it falls back to pocketsphinx and shows a warning on the job.

### Optional neural speaker model

Speaker detection uses a spectral heuristic out of the box. For better voice separation, install the Resemblyzer voice encoder (Apache-2.0, 15.7 MB, checksum-verified, no PyTorch needed):

- **Settings → Transcription → Speaker detection → Install**, or
- `cd backend && uv run python -m clipforge.devtools.voice_model install`. For offline use, add `--wheel /path/to/Resemblyzer-0.1.4-py3-none-any.whl`.

It is stored in `~/ClipForge/Models/`. Remove it with `... voice_model remove`. See [TUNING.md](TUNING.md) for how it works and what it was tested on.

## Optional AI providers

Everything works without a language model: ranking is deterministic and social copy is extractive. Optionally:

**Ollama (local, private).** Install from ollama.com, run `ollama pull qwen2.5:7b-instruct` (or another instruction model), and set the URL/model in Settings → AI providers. Choose “Ollama” in an analysis to have it rate hooks, payoffs and novelty and suggest titles. Every response is schema-validated. Boundary changes are limited to ±2 whole sentences, and anything invalid is discarded.

**Anthropic Claude (cloud).** This needs a separately purchased **API key** from console.anthropic.com. A Claude.ai or Claude Code subscription does not include API access for this app.

1. Settings → AI providers → paste the key → **Verify**. Keys are stored in the OS keychain (macOS Keychain) or a `0600` file, and are never sent to the web page.
2. Settings → Privacy → enable “Allow sending transcript text … to the cloud AI provider”.
3. Pick “Anthropic” per analysis or as the default for social copy.

Only transcript text of candidate clips is sent; video and audio never leave the machine. The default model is `claude-opus-5-5` (configurable). Requests use structured JSON output plus server-side refusal fallback. Token usage and estimated cost appear in Settings → AI providers.

## Configuration reference (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `CLIPFORGE_DATA_DIR` | `~/ClipForge` | Library location (database, projects, cache, exports) |
| `CLIPFORGE_PORT` | `8765` | Port (always bound to 127.0.0.1) |
| `CLIPFORGE_WHISPER_MODEL` | `small` | Default model name or local model folder |
| `CLIPFORGE_RENDER_WORKERS` | auto | Concurrent renders (auto from RAM/CPU) |
| `CLIPFORGE_ANALYSIS_WORKERS` | 1 | Concurrent analyses |
| `CLIPFORGE_FFMPEG_BIN` / `CLIPFORGE_FFPROBE_BIN` | `ffmpeg` / `ffprobe` | Binaries |
| `CLIPFORGE_LOG_LEVEL` | `INFO` | Logging (file log at `<data>/Logs/clipforge.log`) |
| `CLIPFORGE_KEEP_RENDER_TEMP` | unset | Keep render work folders for debugging |

## Library layout

```
~/ClipForge/
  clipforge.db                 SQLite (projects, sources, jobs, highlights, edits/versions, renders, social, brand kits)
  Projects/<project-id>/
    source/                    uploaded or copied media (linked files stay where they are)
    transcripts/<source>.json  editable transcript used by this project
    analysis/<analysis>.json   sentences, topics, scored candidates, settings, summary
    thumbs/                    highlight thumbnails
  Cache/<file-fingerprint>/    analysis audio, waveform, proxy, sprite, transcripts, visual analysis (shared across projects)
  Exports/<project>/           rendered clips + .srt/.vtt + .render.json reports
  Assets/                      logos, images, music, SFX, B-roll you upload
  Models/whisper/              downloaded speech models
  Logs/  Temp/
```

Linked (referenced) videos are never copied or deleted. If you move one, the project shows **Missing** and offers **Relink**. Relinking verifies that the content fingerprint matches. Database migrations run automatically and back up the database first (`clipforge.v<N>.bak`).
