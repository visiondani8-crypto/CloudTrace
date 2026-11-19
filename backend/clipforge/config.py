"""Application configuration.

All settings can be overridden with environment variables prefixed ``CLIPFORGE_``
(for example ``CLIPFORGE_DATA_DIR=/Volumes/Media/ClipForge``). Runtime-editable
preferences (export defaults, providers, caption defaults…) live in the database
``settings`` table and are managed through the Settings screen; this module only
holds process-level configuration.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PACKAGE_DIR = Path(__file__).resolve().parent
ASSETS_DIR = PACKAGE_DIR / "assets"
FONTS_DIR = ASSETS_DIR / "fonts"


def _default_data_dir() -> Path:
    return Path(os.path.expanduser("~")) / "ClipForge"


class AppConfig(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CLIPFORGE_", env_file=None, extra="ignore")

    data_dir: Path = Field(default_factory=_default_data_dir)
    # Security: bind to loopback by default. Changing this exposes your media.
    host: str = "127.0.0.1"
    port: int = 8765
    # Allowed browser origins for the local UI (Vite dev server + built UI).
    cors_origins: list[str] = [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8765",
        "http://localhost:8765",
    ]
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"
    # Transcription defaults (overridable in Settings).
    whisper_model: str = "small"  # model size name or a local CTranslate2 model directory
    whisper_compute_type: str = "auto"
    # Worker concurrency (0 = auto from hardware).
    analysis_workers: int = 1
    render_workers: int = 0
    # Max upload size (bytes). Large local files should be *referenced* instead of uploaded.
    max_upload_bytes: int = 200 * 1024**3
    log_level: str = "INFO"
    # Serve the built frontend from the backend (single-process launch).
    serve_frontend: bool = True
    frontend_dist: Path = PACKAGE_DIR.parent.parent / "frontend" / "dist"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "clipforge.db"

    @property
    def projects_dir(self) -> Path:
        return self.data_dir / "Projects"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "Cache"

    @property
    def assets_dir(self) -> Path:
        return self.data_dir / "Assets"

    @property
    def exports_dir(self) -> Path:
        return self.data_dir / "Exports"

    @property
    def tmp_dir(self) -> Path:
        return self.data_dir / "Temp"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "Logs"

    @property
    def models_dir(self) -> Path:
        return self.data_dir / "Models"

    @property
    def secrets_path(self) -> Path:
        return self.data_dir / ".secrets.json"

    def ensure_dirs(self) -> None:
        for p in (
            self.data_dir,
            self.projects_dir,
            self.cache_dir,
            self.assets_dir,
            self.exports_dir,
            self.tmp_dir,
            self.logs_dir,
        ):
            p.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_config() -> AppConfig:
    cfg = AppConfig()
    cfg.data_dir = cfg.data_dir.expanduser().resolve()
    cfg.ensure_dirs()
    return cfg


def reset_config_cache() -> None:
    """Used by tests that change CLIPFORGE_DATA_DIR between runs."""
    get_config.cache_clear()
