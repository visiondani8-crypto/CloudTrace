# Troubleshooting

Start with **Settings → Diagnostics**. It lists every dependency, the hardware, worker counts, missing sources and failed jobs, plus the log file path (`~/ClipForge/Logs/clipforge.log`). Failed jobs show a readable error and a recovery hint in the processing queue, and **Retry** re-runs them from their cached stages.

| Symptom | Cause | Fix |
|---|---|---|
| “The ClipForge backend is not reachable” | Backend not running | Run `./clipforge.sh` (or `./clipforge.sh dev`) |
| “FFmpeg is not installed” | `ffmpeg`/`ffprobe` not on PATH | `brew install ffmpeg`; or set `CLIPFORGE_FFMPEG_BIN` |
| Captions missing from exports / doctor says “without libass” | FFmpeg built without libass | Install a full FFmpeg build (Homebrew's includes libass) |
| “Transcription model 'small' is unavailable” | First use while offline, or a wrong model path | Connect once so the model downloads, choose another model, or point Settings → Transcription at a local CTranslate2 folder. ClipForge falls back to the English pocketsphinx engine meanwhile and warns you |
| Poor captions, no punctuation | The pocketsphinx fallback was used | Install/download a faster-whisper model and re-analyse (other stages come from cache) |
| “Little or no speech detected”, no highlights | Music, silence, or non-speech content | No clips are invented. Import subtitles (SRT/VTT) on the project, or edit manually |
| Source shows **Missing** | Linked file moved/renamed or drive unmounted | Mount the drive, or use **Relink** on the project page. The content fingerprint must match |
| “Only X GB free; this render needs about Y” | Low disk space | Free space, change the exports folder, or use Settings → Storage → Clear temporary files / proxies |
| Render “check failed” | A validation check failed (see the report) | Open **Report** in the Export Centre. Re-render; if decoding fails, check the source plays in another player |
| “Requested 2160p would upscale … ×” | Source lacks the detail for that resolution | Pick a lower resolution, or enable *Allow upscaling* if you really want it |
| Preview looks slightly different from the export | The live preview uses the proxy and canvas text | Click **Exact Frame**, which renders with the export engine. The export is authoritative |
| Transitions/B-roll show as cuts in live preview | Live preview limitation | Use Exact Frame or export to see them |
| Ollama option disabled | Ollama not running or the model is not pulled | `ollama serve` and `ollama pull <model>`; check Settings → AI providers |
| “Cloud processing is not enabled” | Anthropic selected without consent | Settings → Privacy → allow sending transcript text, and add an API key |
| “The Anthropic API key was rejected” | Invalid/revoked key, or a subscription instead of API credits | Create an API key at console.anthropic.com. Claude subscriptions don't include API access |
| URL import fails | Unsupported site, private/DRM content, network | ClipForge never bypasses DRM or logins. Download the file yourself if you have the rights, then import it |
| Renders are slow | CPU encode at the “slow” preset, 4K, many concurrent jobs | Use VideoToolbox, the Social Standard preset or 1080p. Render workers are auto-limited by RAM/CPU (Settings → Performance) |
| App was closed during a job | — | Jobs are re-queued automatically on the next start and resume from cached stages |
| Database upgrade concerns | — | Migrations back up `clipforge.db` to `clipforge.v<N>.bak` before changing anything |
