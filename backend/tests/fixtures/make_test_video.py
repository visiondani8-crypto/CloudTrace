"""Generate a reproducible test "podcast" video with known speech and timecodes.

* Speech: FFmpeg's built-in flite TTS, two voices (host = slt, guest = rms).
* Picture: 1920×1080 @ 30 fps; a coloured set that changes per topic (scene
  cuts), with two real face photos (scikit-image's public-domain NASA
  astronaut portrait) on the left (host) and right (guest).
* Output: MP4 (H.264/AAC) + a JSON manifest with every sentence's exact
  start/end time, speaker and topic.

Usage: python make_test_video.py OUT_DIR [--short]
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

FPS = 30
W, H = 1920, 1080
SR = 48000

SCRIPT: list[tuple[str, str, list[tuple[str, str]]]] = [
    ("intro", "#1d2433", [
        ("host", "Hey guys, welcome back to the show."),
        ("host", "Today we're going to talk about money, sleep, and a very strange cat."),
    ]),
    ("money", "#16324f", [
        ("host", "What is the biggest money mistake most beginners make?"),
        ("guest", "Honestly, the biggest mistake is waiting too long to start investing."),
        ("guest", "Compound interest needs time to work."),
        ("guest", "If you invest one hundred dollars a month from age twenty five, you end up with far more than someone who starts at thirty five."),
        ("guest", "So the lesson is simple. Start early, even if the amount is small."),
    ]),
    ("filler", "#2a2a2a", [
        ("host", "Um, yeah. Okay."),
        ("guest", "And then, you know, we kind of went to the place and it was fine I guess."),
    ]),
    ("sleep", "#3b2440", [
        ("guest", "Let me tell you a story."),
        ("guest", "When I was twenty, I worked night shifts at a bakery and slept four hours a day."),
        ("guest", "I thought I was fine. Then one morning I fell asleep at the wheel for a second."),
        ("guest", "That moment changed everything for me."),
        ("guest", "That's why I never compromise on sleep now."),
    ]),
    ("cat", "#40361e", [
        ("host", "Wait, I have to tell you about my cat."),
        ("host", "She learned to open the fridge, and now she steals cheese every single night."),
        ("guest", "That is hilarious."),
        ("host", "Honestly, she has a better diet plan than I do."),
    ]),
    ("passwords", "#173d35", [
        ("guest", "Here's how a password manager actually works."),
        ("guest", "It stores every password in an encrypted vault."),
        ("guest", "You only remember one master password."),
        ("guest", "That means one strong password protects all the others, which is the whole point."),
    ]),
    ("outro", "#1d2433", [
        ("host", "Thanks for watching, and don't forget to subscribe."),
    ]),
]

VOICES = {"host": "slt", "guest": "rms"}


def run(args: list[str]) -> None:
    subprocess.run(args, check=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def tts(text: str, voice: str, out: Path, tmp: Path) -> np.ndarray:
    tf = tmp / "t.txt"
    tf.write_text(text)
    run(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"flite=textfile={tf}:voice={voice}",
         "-ar", str(SR), "-ac", "1", "-c:a", "pcm_s16le", str(out)])
    with wave.open(str(out)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def trim_silence(a: np.ndarray) -> np.ndarray:
    idx = np.where(np.abs(a) > 0.01)[0]
    if idx.size == 0:
        return a
    return a[max(0, idx[0] - 240) : idx[-1] + 480]


def face_images(tmp: Path) -> tuple[Path, Path]:
    from skimage import data
    import cv2

    img = data.astronaut()  # RGB 512x512, NASA public domain
    face = img[0:300, 120:400]  # head and shoulders crop
    face = cv2.resize(face, (420, 450), interpolation=cv2.INTER_CUBIC)
    host = tmp / "host.png"
    guest = tmp / "guest.png"
    cv2.imwrite(str(host), cv2.cvtColor(face, cv2.COLOR_RGB2BGR))
    # Guest: mirrored and warmer so the two "people" differ.
    g = cv2.flip(face, 1).astype(np.float32)
    g[..., 0] = np.clip(g[..., 0] * 1.12, 0, 255)
    cv2.imwrite(str(guest), cv2.cvtColor(g.astype(np.uint8), cv2.COLOR_RGB2BGR))
    return host, guest


def build(out_dir: Path, short: bool = False) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    script = SCRIPT[:4] if short else SCRIPT
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        pieces: list[np.ndarray] = [np.zeros(int(SR * 0.8), dtype=np.float32)]
        t = 0.8
        sentences = []
        topics = []
        for ti, (topic, colour, lines) in enumerate(script):
            t_topic = t
            for li, (spk, text) in enumerate(lines):
                a = trim_silence(tts(text, VOICES[spk], tmp / f"s{ti}_{li}.wav", tmp))
                sentences.append({"topic": topic, "speaker": spk, "text": text, "start": round(t, 3), "end": round(t + a.size / SR, 3)})
                pieces.append(a)
                t += a.size / SR
                gap = 0.45 if li < len(lines) - 1 else 1.3
                pieces.append(np.zeros(int(SR * gap), dtype=np.float32))
                t += gap
            topics.append({"topic": topic, "colour": colour, "start": round(t_topic - (0.8 if ti == 0 else 0.65), 3), "end": round(t - 0.65, 3)})
        topics[0]["start"] = 0.0
        topics[-1]["end"] = round(t, 3)
        for a, b in zip(topics, topics[1:]):
            b["start"] = a["end"]
        audio = np.concatenate(pieces)
        duration = audio.size / SR
        wav = tmp / "speech.wav"
        with wave.open(str(wav), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
        host, guest = face_images(tmp)
        # Background: one colour segment per topic → real scene cuts.
        bg_inputs = []
        filters = []
        for tp in topics:
            d = tp["end"] - tp["start"]
            bg_inputs += ["-f", "lavfi", "-i", f"color=c={tp['colour']}:s={W}x{H}:r={FPS}:d={d:.3f}"]
        n = len(topics)
        filters.append("".join(f"[{k}:v]" for k in range(n)) + f"concat=n={n}:v=1:a=0,format=yuv420p[bg]")
        # Subtle drift of both faces so tracking has something to follow; host on the left, guest on the right.
        filters.append(f"[bg][{n}:v]overlay=x='300+40*sin(t/3)':y='(H-h)/2+20*sin(t/2)'[t1]")
        filters.append(f"[t1][{n + 1}:v]overlay=x='W-w-300+40*sin(t/4)':y='(H-h)/2'[t2]")
        filters.append("[t2]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='%{pts\\:hms}':x=40:y=40:fontsize=36:fontcolor=white@0.6[v]")
        out = out_dir / ("test_podcast_short.mp4" if short else "test_podcast.mp4")
        run(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", *bg_inputs,
             "-loop", "1", "-i", str(host), "-loop", "1", "-i", str(guest), "-i", str(wav),
             "-filter_complex", ";".join(filters), "-map", "[v]", "-map", f"{n + 2}:a",
             "-t", f"{duration:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-movflags", "+faststart", str(out)])
    manifest = {"video": str(out), "duration": round(duration, 3), "fps": FPS, "width": W, "height": H,
                "sentences": sentences, "topics": topics}
    (out.with_suffix(".json")).write_text(json.dumps(manifest, indent=1))
    return manifest


if __name__ == "__main__":
    od = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    m = build(od, short="--short" in sys.argv)
    print(json.dumps({"video": m["video"], "duration": m["duration"], "sentences": len(m["sentences"])}))
