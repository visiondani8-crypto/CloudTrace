from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent
ARTIFACTS = ROOT / "_artifacts"
sys.path.insert(0, str(ROOT / "fixtures"))


@pytest.fixture()
def data_dir(tmp_path, monkeypatch):
    """Isolated ClipForge data directory + fresh DB/config for each test."""
    from clipforge import config, db
    from clipforge.jobs import queue

    monkeypatch.setenv("CLIPFORGE_DATA_DIR", str(tmp_path / "data"))
    model = os.environ.get("CLIPFORGE_TEST_WHISPER_MODEL")
    if model:
        monkeypatch.setenv("CLIPFORGE_WHISPER_MODEL", model)
    config.reset_config_cache()
    db.reset_engine()
    queue.reset_manager()
    yield tmp_path / "data"
    queue.reset_manager()
    db.reset_engine()
    config.reset_config_cache()


@pytest.fixture(scope="session")
def podcast_video() -> dict:
    """Generated once per session: 94 s two-voice podcast with known timecodes."""
    ARTIFACTS.mkdir(exist_ok=True)
    mp4 = ARTIFACTS / "test_podcast.mp4"
    man = ARTIFACTS / "test_podcast.json"
    if not (mp4.exists() and man.exists()):
        from make_test_video import build

        build(ARTIFACTS)
    return json.loads(man.read_text())


@pytest.fixture(scope="session")
def silent_video() -> Path:
    """5 s 1280×720 test pattern with NO audio track."""
    ARTIFACTS.mkdir(exist_ok=True)
    p = ARTIFACTS / "no_audio.mp4"
    if not p.exists():
        subprocess.run(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25:duration=5",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", str(p)], check=True)
    return p


@pytest.fixture(scope="session")
def portrait_rotated_video() -> Path:
    """Landscape-coded video with 90° rotation metadata (phone footage)."""
    ARTIFACTS.mkdir(exist_ok=True)
    p = ARTIFACTS / "rotated.mp4"
    if not p.exists():
        tmp = ARTIFACTS / "rot_src.mp4"
        subprocess.run(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(tmp)], check=True)
        subprocess.run(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-display_rotation", "90", "-i", str(tmp), "-c", "copy", str(p)], check=True)
    return p


def make_project(path: Path, name: str = "Test") -> tuple[str, str]:
    from clipforge.db import session_scope
    from clipforge.media.ffprobe import probe
    from clipforge.models import MediaSource, Project
    from clipforge.util.files import file_fingerprint, new_id

    pid, sid = new_id("pr_"), new_id("src_")
    with session_scope() as s:
        s.add(Project(id=pid, name=name))
        s.commit()
        s.add(MediaSource(id=sid, project_id=pid, path=str(path), original_name=path.name, size_bytes=path.stat().st_size,
                          fingerprint=file_fingerprint(path), probe=probe(path)))
        s.commit()
    return pid, sid


class Ctx:
    """Minimal job context for calling pipelines directly in tests."""

    def __init__(self):
        from clipforge.util.proc import CancelToken

        self.token = CancelToken()
        self.stages: list[str] = []
        self.warnings: list[str] = []

    def stage(self, n):
        self.stages.append(n)

    def progress(self, p):
        pass

    def warn(self, m):
        self.warnings.append(m)

    def info(self, m):
        pass
