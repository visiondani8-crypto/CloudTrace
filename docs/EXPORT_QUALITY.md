# Export quality explained

## What happens to your pixels

1. **The original file is decoded once** per clip segment. The 540p preview proxy is only for interactive playback and is never used for output.
2. **Rotation, sample aspect ratio and colour matrix are honoured.** The display orientation is applied, YUV→RGB uses the source's tagged matrix (BT.709 is assumed for untagged HD), and full/limited range is respected.
3. **Crop and scale happen in one resampling step.** Each frame is warped straight from the source to the output canvas with a sub-pixel affine transform (cubic when magnifying). There is no crop-then-scale chain and no integer rounding jitter on moving crops. The decoder only pre-scales when the source has *more* pixels than the output needs.
4. **Captions, titles and vector graphics are drawn by libass at the output resolution,** so their edges are crisp at 720p and 4K alike.
5. **One encode.** Frames go straight into x264, x265, VideoToolbox or ProRes, tagged BT.709 limited range.
6. **Audio is cut from the original stream.** It is processed in 32-bit float, loudness-normalised in two passes (measure, then linear correction plus a true-peak limiter), and encoded to AAC once. Stereo stays stereo unless you choose mono.

## Presets

| Preset | Video | Audio | Use |
|---|---|---|---|
| Social Standard | H.264 High, CRF 21, preset medium | AAC 160 kb/s | Everyday posting; smaller files |
| Social High Quality *(default)* | H.264 High, CRF 17, preset slow | AAC 192 kb/s | Survives platform re-compression well |
| 4K High Quality | HEVC (hvc1), CRF 18, preset slow, 2160p | AAC 256 kb/s | Only when the source really has 4K detail |
| Archival Master | ProRes 422 HQ (10-bit 4:2:2 container) in .mov | PCM 24-bit | Mezzanine for further editing; very large files |
| Custom | H.264/HEVC/ProRes, CRF or bitrate, speed, fps, resolution | 128–320 kb/s | Full control |

The compositor processes 8-bit RGB. ProRes and 10-bit containers preserve that quality without further loss, but they do not restore precision the pipeline didn't carry. For HDR sources, ClipForge applies an **explicit HDR→SDR tone-map** (zimg/Hable) and records it in the render report. ClipForge does not export HDR.

## Resolution & upscaling: honest numbers

The Export Centre shows the **effective source detail**: how many source lines are inside the visible crop at the edit's base framing.

- A 9:16 crop of a 1080p landscape video contains a 607×1080 region. A 1080×1920 export of it is a **1.78× upscale**. This is normal for vertical social video and is labelled as such.
- Punch-in zooms magnify further for a moment; the report lists the peak (e.g. "briefly up to 2.1×").
- Above a **2× upscale** at the base framing (e.g. "4K" from a 1080p crop), the render is **blocked** unless you tick *Allow upscaling*. Upscaling never adds detail, and ClipForge never presents it as if it did.
- **Match Source** picks the output size at which one source pixel maps to one output pixel (capped at 2160 on the short side).
- A requested resolution is never silently reduced.

## Frame rate & sync

Output uses the timeline frame rate (source fps by default, rounded when it is within 0.02 of an integer, capped at 60) or the rate you choose. Variable-frame-rate sources are conformed to constant frame rate during decoding. Audio is rendered to the exact timeline duration, and validation checks that the audio and video stream durations agree within 100 ms.

## Validation (every render)

After encoding, ClipForge inspects the **actual output file**:

| Check | How |
|---|---|
| File, streams, codec | ffprobe |
| Resolution, square pixels, aspect | ffprobe vs. the requested size |
| Frame rate & duration | ffprobe vs. the timeline (±2 frames) |
| Decodes cleanly | full decode to null, scanning for decoder errors |
| A/V sync | audio vs. video durations and start times |
| Loudness / silence / clipping | EBU R128 integrated loudness and true peak |
| Captions & overlays present | encoded frames vs. the pre-overlay composite inside each overlay's box (captions, up to three text layers, one graphic) |

A render that fails an error-level check is marked **check failed** with the reasons. Warnings (such as intentionally silent audio) are shown but do not fail the render. The full report is saved next to the video as `<name>.render.json`.

## Hardware encoding

On Apple Silicon, choose *VideoToolbox* (or *Auto*) in the Export Centre. It is much faster at somewhat lower efficiency per bit, so ClipForge maps CRF to VideoToolbox's quality scale. CPU encoding (libx264/libx265) is the reference-quality fallback and works everywhere.
