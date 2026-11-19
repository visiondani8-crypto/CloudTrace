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


# ----------------------------------------------------------------------------- protocol stubs
class ProtocolStub:
    """A local HTTP server standing in for Ollama / the Anthropic API.

    Every request is recorded (method, path, lower-cased headers, JSON body). Replies come from
    ``queue`` (items are ``(status, body[, headers])`` tuples or callables taking the request),
    then from ``handler``, else 404.
    """

    def __init__(self):
        self.requests: list[dict] = []
        self.queue: list = []
        self.handler = None
        self.url = ""

    def reply(self, req: dict):
        item = self.queue.pop(0) if self.queue else self.handler
        if item is None:
            return 404, {"error": "no stub reply"}, {}
        if callable(item):
            item = item(req)
        status, body, *rest = item
        return status, body, (rest[0] if rest else {})


@pytest.fixture()
def protocol_stub():
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    stub = ProtocolStub()

    class Handler(BaseHTTPRequestHandler):
        def _serve(self):
            n = int(self.headers.get("content-length") or 0)
            raw = self.rfile.read(n) if n else b""
            req = {"method": self.command, "path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()},
                   "json": json.loads(raw) if raw else None}
            stub.requests.append(req)
            status, body, headers = stub.reply(req)
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            for k, v in headers.items():
                self.send_header(k, v)
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_POST = _serve

        def log_message(self, *_a):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    stub.url = f"http://127.0.0.1:{srv.server_address[1]}"
    yield stub
    srv.shutdown()
    srv.server_close()


def anthropic_message(text: str | None = None, *, model: str = "claude-opus-5-5", stop: str = "end_turn", inp: int = 1200,
                      out: int = 300, content: list | None = None, iterations: list | None = None, stop_details: dict | None = None) -> dict:
    """A Messages API response body as the real API returns it."""
    usage: dict = {"input_tokens": inp, "output_tokens": out}
    if iterations is not None:
        usage["iterations"] = iterations
    body = {"id": "msg_stub", "type": "message", "role": "assistant", "model": model,
            "content": content if content is not None else [{"type": "text", "text": text or ""}],
            "stop_reason": stop, "stop_sequence": None, "usage": usage}
    if stop_details is not None:
        body["stop_details"] = stop_details
    return body


@pytest.fixture()
def anthropic_stub(protocol_stub, monkeypatch):
    """Point the official SDK at the stub and give it a dummy key (never touches the real keychain)."""
    from clipforge.ai import providers

    monkeypatch.setenv("ANTHROPIC_BASE_URL", protocol_stub.url)
    monkeypatch.setattr(providers, "get_secret", lambda name: "sk-ant-test-0000" if name == "anthropic_api_key" else None)
    return protocol_stub
