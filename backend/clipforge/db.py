"""Database engine, sessions and safe schema migrations.

Migrations are ordered, versioned with ``PRAGMA user_version`` and the
database file is backed up before any migration runs, so an interrupted
upgrade can never destroy project data.
"""

from __future__ import annotations

import logging
import shutil
import sqlite3
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

from . import models  # noqa: F401 - register tables
from .config import get_config

log = logging.getLogger(__name__)

_engine: Engine | None = None
_engine_lock = threading.Lock()


def _migration_1(conn: sqlite3.Connection) -> None:
    """Initial schema — created via SQLModel metadata."""
    # Tables are created by SQLModel.metadata.create_all before this runs.


def _migration_2(conn: sqlite3.Connection) -> None:
    """Indexes for library search and highlight ordering."""
    conn.execute("CREATE INDEX IF NOT EXISTS ix_highlights_score ON highlights (project_id, score DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_renders_status ON renders (status)")


MIGRATIONS: list[tuple[int, Callable[[sqlite3.Connection], None]]] = [
    (1, _migration_1),
    (2, _migration_2),
]
SCHEMA_VERSION = MIGRATIONS[-1][0]


def _set_sqlite_pragmas(dbapi_conn, _record) -> None:  # pragma: no cover - trivial
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA busy_timeout=10000")
    cur.close()


def get_engine() -> Engine:
    global _engine
    with _engine_lock:
        if _engine is None:
            cfg = get_config()
            _engine = create_engine(
                f"sqlite:///{cfg.db_path}",
                connect_args={"check_same_thread": False, "timeout": 30},
            )
            event.listen(_engine, "connect", _set_sqlite_pragmas)
            migrate(cfg.db_path, _engine)
        return _engine


def reset_engine() -> None:
    global _engine
    with _engine_lock:
        if _engine is not None:
            _engine.dispose()
        _engine = None


def migrate(db_path: Path, engine: Engine) -> None:
    existed = db_path.exists() and db_path.stat().st_size > 0
    raw = sqlite3.connect(db_path)
    try:
        current = raw.execute("PRAGMA user_version").fetchone()[0]
    finally:
        raw.close()
    if current > SCHEMA_VERSION:
        raise RuntimeError(
            f"Database schema v{current} is newer than this application (v{SCHEMA_VERSION}). "
            "Update ClipForge Studio before opening this library."
        )
    if existed and current < SCHEMA_VERSION:
        backup = db_path.with_suffix(f".v{current}.bak")
        shutil.copy2(db_path, backup)
        log.info("Backed up database to %s before migrating", backup)
    SQLModel.metadata.create_all(engine)
    raw = sqlite3.connect(db_path)
    try:
        for version, fn in MIGRATIONS:
            if version > current:
                log.info("Applying database migration %s", version)
                with raw:  # transaction
                    fn(raw)
                    raw.execute(f"PRAGMA user_version = {int(version)}")
    finally:
        raw.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    with Session(get_engine(), expire_on_commit=False) as s:
        yield s


def get_session() -> Iterator[Session]:
    """FastAPI dependency."""
    with Session(get_engine(), expire_on_commit=False) as s:
        yield s
