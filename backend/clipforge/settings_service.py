"""User-editable application settings (stored in SQLite)."""

from __future__ import annotations

import copy
from typing import Any

from .config import get_config
from .db import session_scope
from .models import Setting, utcnow

DEFAULTS: dict[str, Any] = {
    "storage": {"exports_dir": "", "copy_imports": False},
    "cache": {"max_gb": 50, "keep_proxies": True},
    "transcription": {"engine": "auto", "model": "", "language": "", "compute_type": "auto", "speaker_model": "auto"},
    "ai": {"provider": "local", "cloud_consent": False, "ollama_url": "http://127.0.0.1:11434", "ollama_model": "qwen2.5:7b-instruct",
           "anthropic_model": "claude-opus-5-5", "anthropic_effort": "medium"},
    "defaults": {"platform": "tiktok", "caption_style": "bold_social", "edit_style": "dynamic", "aspect": "9:16",
                 "content_mode": "podcast", "analysis_mode": "balanced", "max_hashtags": 5},
    "export_defaults": {"preset": "social_hq", "resolution": "1080p", "codec": "h264", "crf": 17, "encoder_speed": "medium",
                        "hardware": "cpu", "audio_bitrate_kbps": 192, "burn_captions": True, "export_srt": True},
    "performance": {"mode": "balanced", "render_workers": 0},
    "privacy": {"telemetry": False, "local_only": True},
    "shortcuts": {"play_pause": "Space", "split": "S", "delete": "Delete", "ripple_delete": "Shift+Delete", "undo": "Mod+Z",
                  "redo": "Mod+Shift+Z", "frame_back": "ArrowLeft", "frame_forward": "ArrowRight", "save": "Mod+S", "marker": "M",
                  "zoom_in": "=", "zoom_out": "-"},
}


def _merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def get_settings() -> dict[str, Any]:
    with session_scope() as s:
        row = s.get(Setting, "app")
        stored = row.value if row else {}
    st = _merge(DEFAULTS, stored or {})
    if not st["transcription"]["model"]:
        st["transcription"]["model"] = get_config().whisper_model
    if not st["storage"]["exports_dir"]:
        st["storage"]["exports_dir"] = str(get_config().exports_dir)
    st["privacy"]["telemetry"] = False  # ClipForge has no telemetry
    return st


def update_settings(patch: dict[str, Any]) -> dict[str, Any]:
    patch = {k: v for k, v in (patch or {}).items() if k in DEFAULTS}
    with session_scope() as s:
        row = s.get(Setting, "app")
        cur = row.value if row else {}
        new = _merge(cur or {}, patch)
        if row is None:
            row = Setting(key="app", value=new)
        else:
            row.value = new
            row.updated_at = utcnow()
        s.add(row)
        s.commit()
    return get_settings()
