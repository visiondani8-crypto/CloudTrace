"""Safe subprocess execution.

Commands are always passed as argument lists (never through a shell), can be
cancelled cooperatively, and FFmpeg progress output is parsed into callbacks.
"""

from __future__ import annotations

import logging
import os
import signal
import subprocess
import threading
from collections import deque
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

log = logging.getLogger(__name__)


class CancelledError(Exception):
    """Raised when a job is cancelled while a subprocess is running."""


class ProcessError(Exception):
    def __init__(self, message: str, returncode: int | None = None, stderr_tail: str = ""):
        super().__init__(message)
        self.returncode = returncode
        self.stderr_tail = stderr_tail


@dataclass
class CancelToken:
    """Cooperative cancellation + pause shared between a job and its subprocesses."""

    _cancelled: threading.Event = field(default_factory=threading.Event)
    _resume: threading.Event = field(default_factory=threading.Event)
    _procs: set[subprocess.Popen] = field(default_factory=set)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def __post_init__(self) -> None:
        self._resume.set()

    @property
    def cancelled(self) -> bool:
        return self._cancelled.is_set()

    @property
    def paused(self) -> bool:
        return not self._resume.is_set()

    def cancel(self) -> None:
        self._cancelled.set()
        self._resume.set()
        with self._lock:
            procs = list(self._procs)
        for p in procs:
            _terminate(p)

    def pause(self) -> None:
        """Pause: cooperative checkpoints block, and running subprocesses are
        suspended with SIGSTOP where the platform supports it."""
        self._resume.clear()
        if hasattr(signal, "SIGSTOP"):
            with self._lock:
                for p in list(self._procs):
                    try:
                        os.kill(p.pid, signal.SIGSTOP)
                    except (ProcessLookupError, PermissionError):
                        pass

    def resume(self) -> None:
        if hasattr(signal, "SIGCONT"):
            with self._lock:
                for p in list(self._procs):
                    try:
                        os.kill(p.pid, signal.SIGCONT)
                    except (ProcessLookupError, PermissionError):
                        pass
        self._resume.set()

    def check(self) -> None:
        """Checkpoint: raise if cancelled, block while paused."""
        while not self._resume.wait(timeout=0.5):
            if self.cancelled:
                break
        if self.cancelled:
            raise CancelledError("Operation cancelled")

    def register(self, p: subprocess.Popen) -> None:
        with self._lock:
            self._procs.add(p)
        if self.paused and hasattr(signal, "SIGSTOP"):
            try:
                os.kill(p.pid, signal.SIGSTOP)
            except ProcessLookupError:
                pass

    def unregister(self, p: subprocess.Popen) -> None:
        with self._lock:
            self._procs.discard(p)


def _terminate(p: subprocess.Popen) -> None:
    try:
        if hasattr(signal, "SIGCONT"):
            os.kill(p.pid, signal.SIGCONT)
        p.terminate()
        try:
            p.wait(timeout=3)
        except subprocess.TimeoutExpired:
            p.kill()
    except ProcessLookupError:
        pass
    except Exception:  # pragma: no cover - best effort
        log.exception("Failed to terminate process %s", p.pid)


def run(
    args: Sequence[str],
    *,
    token: CancelToken | None = None,
    on_stderr_line: Callable[[str], None] | None = None,
    timeout: float | None = None,
    stdout_to: int | None = subprocess.PIPE,
    check: bool = True,
) -> tuple[int, bytes, str]:
    """Run a command (list form only). Returns (returncode, stdout, stderr_tail)."""
    if isinstance(args, str):  # defensive: never allow shell strings
        raise TypeError("Command must be a sequence of arguments, not a string")
    args = [str(a) for a in args]
    log.debug("exec: %s", " ".join(args[:12]) + (" …" if len(args) > 12 else ""))
    p = subprocess.Popen(
        args,
        stdin=subprocess.DEVNULL,
        stdout=stdout_to,
        stderr=subprocess.PIPE,
        bufsize=0,
    )
    if token:
        token.register(p)
    tail: deque[str] = deque(maxlen=60)
    out_chunks: list[bytes] = []

    def _read_out() -> None:
        if p.stdout is None:
            return
        for chunk in iter(lambda: p.stdout.read(65536), b""):
            out_chunks.append(chunk)

    reader = threading.Thread(target=_read_out, daemon=True)
    reader.start()
    try:
        assert p.stderr is not None
        buf = b""
        while True:
            chunk = p.stderr.read(4096)
            if not chunk:
                break
            buf += chunk
            # ffmpeg progress uses \r for status lines; treat both as separators.
            parts = buf.replace(b"\r", b"\n").split(b"\n")
            buf = parts.pop()
            for raw in parts:
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                tail.append(line)
                if on_stderr_line:
                    on_stderr_line(line)
            if token and token.cancelled:
                _terminate(p)
                break
        p.wait(timeout=timeout)
        reader.join(timeout=5)
    finally:
        if token:
            token.unregister(p)
        if p.poll() is None:
            _terminate(p)
    if token and token.cancelled:
        raise CancelledError("Operation cancelled")
    stderr_tail = "\n".join(tail)
    if check and p.returncode != 0:
        raise ProcessError(
            f"{os.path.basename(args[0])} exited with code {p.returncode}",
            p.returncode,
            stderr_tail,
        )
    return p.returncode, b"".join(out_chunks), stderr_tail


def ffmpeg_progress_parser(total_seconds: float, cb: Callable[[float], None]) -> Callable[[str], None]:
    """Build a stderr-line callback translating ``-progress pipe:2`` output to 0..1."""

    def _on_line(line: str) -> None:
        if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
            try:
                us = int(line.split("=", 1)[1])
            except ValueError:
                return
            if total_seconds > 0:
                cb(max(0.0, min(1.0, us / 1e6 / total_seconds)))

    return _on_line
