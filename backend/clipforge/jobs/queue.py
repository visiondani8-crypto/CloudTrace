"""Persistent background job queue.

* Jobs live in SQLite; workers claim them atomically, so state survives
  restarts. Jobs interrupted by a shutdown are re-queued on start-up and their
  handlers resume from cached stage outputs.
* Separate queues: ``analysis`` (heavy CPU, 1 worker by default), ``render``
  (sized from RAM/CPU), ``light`` (imports, social copy).
* Cancel, pause/resume (cooperative checkpoints + SIGSTOP on subprocesses) and
  retry are supported. Progress is pushed to the UI via server-sent events.
"""

from __future__ import annotations

import asyncio
import errno
import logging
import os
import threading
import time
import traceback
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import psutil
from sqlmodel import select

from ..config import get_config
from ..db import session_scope
from ..models import Job, utcnow
from ..util.files import new_id
from ..util.proc import CancelledError, CancelToken, ProcessError

log = logging.getLogger(__name__)

STAGE_LABELS = {
    "probe": "Inspecting media",
    "audio": "Extracting audio",
    "proxy": "Building preview proxy",
    "transcription": "Transcribing speech",
    "scene_detection": "Scene & visual analysis",
    "understanding": "Understanding content",
    "candidate_ranking": "Ranking candidates",
    "finalising": "Finalising highlights",
    "download": "Downloading",
    "edits": "Preparing edits",
    "compose": "Rendering video",
    "audio_mix": "Mixing audio",
    "encode": "Encoding",
    "validate": "Validating output",
    "social": "Writing social copy",
    "render_queue": "Queueing renders",
}

KIND_STAGES: dict[str, list[tuple[str, float]]] = {
    "analyze": [("probe", 1), ("audio", 4), ("proxy", 10), ("transcription", 45), ("scene_detection", 25),
                ("understanding", 3), ("candidate_ranking", 8), ("finalising", 4)],
    "url_import": [("download", 90), ("probe", 10)],
    "prepare_edits": [("edits", 100)],
    "render": [("audio_mix", 10), ("compose", 80), ("validate", 5), ("social", 5)],
    "batch": [("probe", 1), ("audio", 3), ("proxy", 8), ("transcription", 40), ("scene_detection", 22),
              ("understanding", 3), ("candidate_ranking", 8), ("finalising", 3), ("edits", 7), ("render_queue", 5)],
}


@dataclass
class _Running:
    token: CancelToken
    thread: threading.Thread | None = None


@dataclass
class JobContext:
    job_id: str
    kind: str
    token: CancelToken
    manager: JobManager
    _stage: str = ""
    _stages: list[dict[str, Any]] = field(default_factory=list)
    _last_push: float = 0.0
    _logs: list[dict[str, Any]] = field(default_factory=list)
    _stage_progress: float = 0.0

    def stage(self, name: str) -> None:
        self.token.check()
        now = time.time()
        for st in self._stages:
            if st["status"] == "running":
                st["status"] = "done"
                st["progress"] = 1.0
                st["finished"] = now
        found = next((st for st in self._stages if st["name"] == name), None)
        if found is None:
            found = {"name": name, "label": STAGE_LABELS.get(name, name), "weight": 1.0, "status": "pending", "progress": 0.0}
            self._stages.append(found)
        found.update(status="running", progress=0.0, started=now)
        self._stage = name
        self._stage_progress = 0.0
        self._push(force=True)

    def progress(self, p: float) -> None:
        self._stage_progress = max(0.0, min(1.0, p))
        for st in self._stages:
            if st["name"] == self._stage:
                st["progress"] = self._stage_progress
        self._push()

    def overall(self) -> float:
        total = sum(st["weight"] for st in self._stages) or 1.0
        done = sum(st["weight"] * (1.0 if st["status"] in ("done", "skipped") else st.get("progress", 0.0)) for st in self._stages)
        return done / total

    def info(self, msg: str) -> None:
        self._logs.append({"t": time.time(), "level": "info", "msg": msg})
        self._push(force=True)

    def warn(self, msg: str) -> None:
        log.warning("[%s] %s", self.job_id, msg)
        self._logs.append({"t": time.time(), "level": "warning", "msg": msg})
        self._push(force=True)

    def _push(self, force: bool = False) -> None:
        now = time.time()
        if not force and now - self._last_push < 0.5:
            return
        self._last_push = now
        with session_scope() as s:
            job = s.get(Job, self.job_id)
            if job is None:
                return
            job.stage = self._stage
            job.progress = round(self.overall(), 4)
            job.stages = [dict(x) for x in self._stages]
            job.result = {**(job.result or {}), "log": self._logs[-200:]}
            job.updated_at = utcnow()
            s.add(job)
            s.commit()
            self.manager.publish(job)

    def finish_stages(self) -> None:
        for st in self._stages:
            if st["status"] == "running":
                st["status"] = "done"
                st["progress"] = 1.0
            elif st["status"] == "pending":
                st["status"] = "skipped"


Handler = Callable[[JobContext, dict[str, Any]], dict[str, Any]]


def humanize_error(e: BaseException) -> tuple[str, str | None]:
    """Map exceptions to a readable message and a recovery hint."""
    from ..ai.providers import ProviderError
    from ..media.ffprobe import ProbeError
    from ..transcribe.engines import TranscriptionUnavailable

    if isinstance(e, (ProbeError, TranscriptionUnavailable, ProviderError)):
        return str(e), getattr(e, "hint", None)
    if isinstance(e, FileNotFoundError):
        if "ffmpeg" in str(e).lower() or "ffprobe" in str(e).lower():
            return "FFmpeg is not installed.", "Install FFmpeg (macOS: brew install ffmpeg) and restart ClipForge."
        return str(e), "The file may have been moved or deleted. Use Relink on the source to locate it."
    if isinstance(e, MemoryError):
        return "Ran out of memory.", "Close other applications, lower the render resolution, or reduce render concurrency in Settings → Performance."
    if isinstance(e, OSError) and e.errno == errno.ENOSPC:
        return "The disk is full.", "Free up space or change the storage location in Settings → Storage."
    if isinstance(e, ProcessError):
        tail = (e.stderr_tail or "").strip().splitlines()[-3:]
        return f"{e}: {' | '.join(tail)[:300]}", "Check that the source file plays correctly. Retry the job; if it fails again, see Settings → Diagnostics."
    if isinstance(e, ValueError):
        return str(e), None
    return f"{type(e).__name__}: {e}", "Retry the job. If it keeps failing, export diagnostics from Settings."


class JobManager:
    def __init__(self) -> None:
        self.handlers: dict[str, Handler] = {}
        self._running: dict[str, _Running] = {}
        self._lock = threading.Lock()
        self._cv = threading.Condition()
        self._threads: list[threading.Thread] = []
        self._stop = threading.Event()
        self._subscribers: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = set()
        self._queue_sizes: dict[str, int] = {}

    # ------------------------------------------------------------ lifecycle
    def register(self, kind: str, fn: Handler) -> None:
        self.handlers[kind] = fn

    def start(self, analysis_workers: int | None = None, render_workers: int | None = None) -> None:
        cfg = get_config()
        self._recover()
        aw = analysis_workers or cfg.analysis_workers or 1
        rw = render_workers or cfg.render_workers or auto_render_workers()
        self._queue_sizes = {"analysis": aw, "render": rw, "light": 2}
        for q, n in self._queue_sizes.items():
            for k in range(n):
                t = threading.Thread(target=self._worker, args=(q,), name=f"worker-{q}-{k}", daemon=True)
                t.start()
                self._threads.append(t)
        log.info("Job workers started: %s", self._queue_sizes)

    def stop(self) -> None:
        self._stop.set()
        with self._lock:
            running = list(self._running.values())
        for r in running:
            r.token.cancel()
        with self._cv:
            self._cv.notify_all()

    def _recover(self) -> None:
        with session_scope() as s:
            jobs = list(s.exec(select(Job).where(Job.status.in_(["running"]))))
            for j in jobs:
                j.status = "queued"
                j.result = {**(j.result or {}), "log": (j.result or {}).get("log", []) + [
                    {"t": time.time(), "level": "info", "msg": "Resumed after the application restarted."}]}
                s.add(j)
            s.commit()
            if jobs:
                log.info("Re-queued %d interrupted job(s)", len(jobs))

    # ------------------------------------------------------------ submit & control
    def submit(self, kind: str, payload: dict[str, Any], *, title: str = "", project_id: str | None = None,
               queue: str | None = None, parent_id: str | None = None) -> Job:
        if kind not in self.handlers:
            raise ValueError(f"Unknown job kind {kind}")
        q = queue or {"render": "render", "url_import": "light", "prepare_edits": "light"}.get(kind, "analysis")
        stages = [{"name": n, "label": STAGE_LABELS.get(n, n), "weight": w, "status": "pending", "progress": 0.0}
                  for n, w in KIND_STAGES.get(kind, [])]
        job = Job(id=new_id("job_"), kind=kind, queue=q, project_id=project_id, parent_id=parent_id, title=title or kind,
                  payload=payload, stages=stages, result={"log": []})
        with session_scope() as s:
            s.add(job)
            s.commit()
            s.refresh(job)
        self.publish(job)
        with self._cv:
            self._cv.notify_all()
        return job

    def cancel(self, job_id: str) -> Job | None:
        with session_scope() as s:
            job = s.get(Job, job_id)
            if job is None:
                return None
            if job.status in ("queued", "paused") and job_id not in self._running:
                job.status = "cancelled"
                job.finished_at = utcnow()
                s.add(job)
                s.commit()
                self.publish(job)
                return job
        with self._lock:
            r = self._running.get(job_id)
        if r:
            r.token.cancel()
        return job

    def pause(self, job_id: str) -> Job | None:
        with self._lock:
            r = self._running.get(job_id)
        with session_scope() as s:
            job = s.get(Job, job_id)
            if job is None:
                return None
            if r:
                r.token.pause()
            if job.status in ("queued", "running"):
                job.status = "paused"
                s.add(job)
                s.commit()
            self.publish(job)
            return job

    def resume(self, job_id: str) -> Job | None:
        with self._lock:
            r = self._running.get(job_id)
        with session_scope() as s:
            job = s.get(Job, job_id)
            if job is None:
                return None
            if job.status == "paused":
                job.status = "running" if r else "queued"
                s.add(job)
                s.commit()
            if r:
                r.token.resume()
            self.publish(job)
        with self._cv:
            self._cv.notify_all()
        return job

    def retry(self, job_id: str) -> Job | None:
        with session_scope() as s:
            job = s.get(Job, job_id)
            if job is None or job.status not in ("failed", "cancelled"):
                return job
            job.status = "queued"
            job.error = None
            job.error_hint = None
            job.progress = 0.0
            job.finished_at = None
            job.stages = [{**st, "status": "pending", "progress": 0.0} for st in (job.stages or [])]
            s.add(job)
            s.commit()
            self.publish(job)
        with self._cv:
            self._cv.notify_all()
        return job

    # ------------------------------------------------------------ worker
    def _claim(self, queue: str) -> Job | None:
        with self._lock, session_scope() as s:
            job = s.exec(select(Job).where(Job.queue == queue, Job.status == "queued").order_by(Job.created_at)).first()
            if job is None:
                return None
            job.status = "running"
            job.started_at = job.started_at or utcnow()
            job.attempts += 1
            s.add(job)
            s.commit()
            s.refresh(job)
            self._running[job.id] = _Running(CancelToken(), threading.current_thread())
            return job

    def _worker(self, queue: str) -> None:
        while not self._stop.is_set():
            job = self._claim(queue)
            if job is None:
                with self._cv:
                    self._cv.wait(timeout=2.0)
                continue
            self._execute(job)

    def _execute(self, job: Job) -> None:
        with self._lock:
            token = self._running[job.id].token
        ctx = JobContext(job.id, job.kind, token, self, _stages=[dict(x) for x in (job.stages or [])],
                         _logs=list((job.result or {}).get("log", [])))
        status, error, hint, result = "completed", None, None, {}
        try:
            fn = self.handlers[job.kind]
            result = fn(ctx, job.payload or {}) or {}
            ctx.finish_stages()
        except CancelledError:
            status = "cancelled"
        except Exception as e:  # noqa: BLE001 - every failure must be reported
            if token.cancelled:
                status = "cancelled"
            else:
                status = "failed"
                error, hint = humanize_error(e)
                log.error("Job %s (%s) failed: %s\n%s", job.id, job.kind, e, traceback.format_exc())
        finally:
            with self._lock:
                self._running.pop(job.id, None)
        with session_scope() as s:
            row = s.get(Job, job.id)
            if row is None:
                return
            row.status = status
            row.error = error
            row.error_hint = hint
            row.finished_at = utcnow()
            row.updated_at = utcnow()
            row.stages = [dict(x) for x in ctx._stages]
            row.progress = 1.0 if status == "completed" else round(ctx.overall(), 4)
            row.result = {**result, "log": ctx._logs[-200:]}
            s.add(row)
            s.commit()
            self.publish(row)

    # ------------------------------------------------------------ events
    def subscribe(self) -> asyncio.Queue:
        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        self._subscribers.add((loop, q))
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers = {(lp, x) for lp, x in self._subscribers if x is not q}

    def publish(self, job: Job) -> None:
        data = job_to_dict(job)
        for loop, q in list(self._subscribers):
            try:
                loop.call_soon_threadsafe(_offer, q, data)
            except RuntimeError:
                self._subscribers.discard((loop, q))

    def running_ids(self) -> list[str]:
        with self._lock:
            return list(self._running)

    @property
    def queue_sizes(self) -> dict[str, int]:
        return dict(self._queue_sizes)


def _offer(q: asyncio.Queue, data: dict[str, Any]) -> None:
    if q.full():
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            pass
    q.put_nowait(data)


def job_to_dict(job: Job) -> dict[str, Any]:
    d = job.model_dump(mode="json")
    return d


def auto_render_workers() -> int:
    """Concurrent renders the machine can sustain (each 1080p render ≈ 1.5 GB peak)."""
    try:
        mem_gb = psutil.virtual_memory().total / 1024**3
    except Exception:
        mem_gb = 8
    cpus = os.cpu_count() or 4
    by_mem = max(1, int(mem_gb // 6))
    by_cpu = max(1, cpus // 4)
    return max(1, min(3, by_mem, by_cpu))


_manager: JobManager | None = None


def get_manager() -> JobManager:
    global _manager
    if _manager is None:
        _manager = JobManager()
    return _manager


def reset_manager() -> None:
    global _manager
    if _manager is not None:
        _manager.stop()
    _manager = None
