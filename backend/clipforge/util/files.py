"""Filesystem helpers: atomic writes, safe paths, fingerprints."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import unicodedata
import uuid
from pathlib import Path
from typing import Any

_FILENAME_SAFE = re.compile(r"[^A-Za-z0-9._ -]+")


def new_id(prefix: str = "") -> str:
    """Short, URL-safe unique id."""
    return f"{prefix}{uuid.uuid4().hex[:12]}"


def sanitize_filename(name: str, max_len: int = 120, default: str = "file") -> str:
    """Return a filesystem-safe file name (no directories, no traversal)."""
    name = unicodedata.normalize("NFKD", name or "")
    name = name.replace("/", "_").replace("\\", "_").replace("\x00", "")
    name = _FILENAME_SAFE.sub("_", name)
    name = re.sub(r"\.{2,}", "", name)  # no ".." anywhere
    name = re.sub(r"_+", "_", name).strip(" ._")
    if not name or name in {".", ".."}:
        name = default
    if len(name) > max_len:
        stem, dot, ext = name.rpartition(".")
        if dot and len(ext) <= 8:
            name = stem[: max_len - len(ext) - 1] + "." + ext
        else:
            name = name[:max_len]
    return name


def safe_join(base: Path, *parts: str) -> Path:
    """Join paths and guarantee the result stays inside ``base``."""
    base = base.resolve()
    target = base.joinpath(*parts).resolve()
    if target != base and base not in target.parents:
        raise ValueError("Path escapes the allowed directory")
    return target


def is_within(path: Path, base: Path) -> bool:
    try:
        path.resolve().relative_to(base.resolve())
        return True
    except ValueError:
        return False


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def atomic_write_text(path: Path, text: str) -> None:
    atomic_write_bytes(path, text.encode("utf-8"))


def atomic_write_json(path: Path, obj: Any) -> None:
    atomic_write_text(path, json.dumps(obj, ensure_ascii=False, indent=1, default=_json_default))


def _json_default(o: Any) -> Any:
    if hasattr(o, "model_dump"):
        return o.model_dump(mode="json")
    if isinstance(o, Path):
        return str(o)
    raise TypeError(f"Not JSON serialisable: {type(o)!r}")


def read_json(path: Path, default: Any = None) -> Any:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default


def file_fingerprint(path: Path, chunk: int = 4 * 1024 * 1024) -> str:
    """Fast content fingerprint for large media.

    Hashes the size plus samples from the start, middle and end. This lets us
    recognise the same source (even if renamed or moved) without reading tens
    of gigabytes, so transcripts and analysis are re-used from cache.
    """
    st = path.stat()
    h = hashlib.sha256()
    h.update(str(st.st_size).encode())
    with open(path, "rb") as fh:
        offsets = [0]
        if st.st_size > chunk * 4:
            offsets += [st.st_size // 3, (2 * st.st_size) // 3, max(0, st.st_size - chunk)]
        for off in offsets:
            fh.seek(off)
            h.update(fh.read(chunk))
    return h.hexdigest()[:32]


def dir_size(path: Path) -> int:
    total = 0
    if not path.exists():
        return 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += (Path(root) / f).stat().st_size
            except OSError:
                pass
    return total


def free_disk_bytes(path: Path) -> int:
    p = path
    while not p.exists() and p.parent != p:
        p = p.parent
    return shutil.disk_usage(p).free


def human_bytes(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} TB"
