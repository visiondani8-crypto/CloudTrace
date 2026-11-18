"""API credential storage.

Preference order: the OS keychain via ``keyring`` (macOS Keychain, Windows
Credential Locker, Secret Service on Linux); otherwise a ``0600`` JSON file in
the data directory. Keys are never returned to the frontend or logged.
"""

from __future__ import annotations

import json
import logging
import os
import stat

from ..config import get_config
from ..util.files import atomic_write_text

log = logging.getLogger(__name__)
SERVICE = "ClipForge Studio"


def _keyring():
    try:
        import keyring
        from keyring.backends import fail

        kr = keyring.get_keyring()
        name = type(kr).__name__.lower()
        if isinstance(kr, fail.Keyring) or "null" in name or "fail" in name:
            return None
        if "chainer" in name and not getattr(kr, "backends", None):
            return None
        return keyring
    except Exception:
        return None


def _file_load() -> dict:
    p = get_config().secrets_path
    try:
        return json.loads(p.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _file_save(d: dict) -> None:
    p = get_config().secrets_path
    atomic_write_text(p, json.dumps(d))
    os.chmod(p, stat.S_IRUSR | stat.S_IWUSR)


def set_secret(name: str, value: str | None) -> str:
    kr = _keyring()
    if kr is not None:
        try:
            if value:
                kr.set_password(SERVICE, name, value)
            else:
                try:
                    kr.delete_password(SERVICE, name)
                except Exception:
                    pass
            d = _file_load()
            d.pop(name, None)
            _file_save(d)
            return "keychain"
        except Exception as e:  # pragma: no cover - platform specific
            log.warning("Keychain unavailable (%s); using protected file", type(e).__name__)
    d = _file_load()
    if value:
        d[name] = value
    else:
        d.pop(name, None)
    _file_save(d)
    return "file"


def get_secret(name: str) -> str | None:
    kr = _keyring()
    if kr is not None:
        try:
            v = kr.get_password(SERVICE, name)
            if v:
                return v
        except Exception:
            pass
    return _file_load().get(name)


def masked(name: str) -> str | None:
    v = get_secret(name)
    if not v:
        return None
    return f"{v[:7]}…{v[-4:]}" if len(v) > 14 else "••••"


def storage_backend() -> str:
    return "keychain" if _keyring() is not None else "file (0600)"
