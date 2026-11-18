"""Persistent project metadata (SQLite via SQLModel).

Large artefacts (transcripts, analysis features, timelines' caches, media) are
stored as files inside the project/cache directories; the database stores
metadata, relationships, and small JSON documents such as timelines.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(UTC)


def JSONField(default: Any = None, **kw: Any) -> Any:  # noqa: N802 - factory
    if default is None:
        return Field(default=None, sa_column=Column(JSON), **kw)
    if callable(default):
        return Field(default_factory=default, sa_column=Column(JSON), **kw)
    return Field(default=default, sa_column=Column(JSON), **kw)


class Project(SQLModel, table=True):
    __tablename__ = "projects"
    id: str = Field(primary_key=True)
    name: str
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    archived: bool = False
    status: str = "new"  # new | analysing | ready | error
    # Last-used analysis settings for this project (AnalysisSettings JSON).
    settings: dict | None = JSONField(dict)
    # Content understanding summary (topics, keywords) from last analysis.
    summary: dict | None = JSONField(dict)


class MediaSource(SQLModel, table=True):
    __tablename__ = "media_sources"
    id: str = Field(primary_key=True)
    project_id: str = Field(index=True, foreign_key="projects.id")
    kind: str = "reference"  # reference | copy | url
    path: str
    original_name: str
    origin_url: str | None = None
    size_bytes: int = 0
    mtime: float = 0.0
    fingerprint: str = Field(default="", index=True)
    probe: dict | None = JSONField(dict)
    proxy_path: str | None = None
    status: str = "imported"  # imported | analysing | analysed | missing | error
    created_at: datetime = Field(default_factory=utcnow)


class Job(SQLModel, table=True):
    __tablename__ = "jobs"
    id: str = Field(primary_key=True)
    kind: str = Field(index=True)  # analyze | prepare_edits | render | batch | url_import
    queue: str = "analysis"  # analysis | render | light
    project_id: str | None = Field(default=None, index=True)
    parent_id: str | None = Field(default=None, index=True)
    title: str = ""
    payload: dict | None = JSONField(dict)
    status: str = Field(default="queued", index=True)
    # queued | running | paused | completed | failed | cancelled
    stage: str = ""
    progress: float = 0.0
    stages: list | None = JSONField(list)
    error: str | None = None
    error_hint: str | None = None
    result: dict | None = JSONField(dict)
    attempts: int = 0
    created_at: datetime = Field(default_factory=utcnow)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    updated_at: datetime = Field(default_factory=utcnow)


class Highlight(SQLModel, table=True):
    __tablename__ = "highlights"
    id: str = Field(primary_key=True)
    project_id: str = Field(index=True, foreign_key="projects.id")
    source_id: str = Field(index=True, foreign_key="media_sources.id")
    analysis_id: str = Field(default="", index=True)
    rank: int = 0
    start: float
    end: float
    score: float
    breakdown: dict | None = JSONField(dict)
    title: str = ""
    topic: str = ""
    hook: str = ""
    reason: str = ""
    audience: str = ""
    issues: list | None = JSONField(list)
    evidence: dict | None = JSONField(dict)
    transcript: str = ""
    thumb_path: str | None = None
    selected: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class Edit(SQLModel, table=True):
    __tablename__ = "edits"
    id: str = Field(primary_key=True)
    project_id: str = Field(index=True, foreign_key="projects.id")
    highlight_id: str | None = Field(default=None, index=True)
    group_id: str = Field(index=True)  # versions of the same clip share a group
    version: int = 1
    name: str = ""
    style: str = "clean"
    seed: int = 0
    timeline: dict | None = JSONField(dict)
    is_current: bool = True
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Render(SQLModel, table=True):
    __tablename__ = "renders"
    id: str = Field(primary_key=True)
    project_id: str = Field(index=True)
    edit_id: str = Field(index=True)
    job_id: str | None = None
    name: str = ""
    settings: dict | None = JSONField(dict)
    output_path: str | None = None
    status: str = "queued"
    validation: dict | None = JSONField(dict)
    file_size: int = 0
    duration: float = 0.0
    width: int = 0
    height: int = 0
    created_at: datetime = Field(default_factory=utcnow)
    finished_at: datetime | None = None


class SocialPackage(SQLModel, table=True):
    __tablename__ = "social_packages"
    id: str = Field(primary_key=True)
    project_id: str = Field(index=True)
    edit_id: str = Field(index=True)
    render_id: str | None = Field(default=None, index=True)
    platform: str = "tiktok"
    provider: str = "local"
    content: dict | None = JSONField(dict)
    chosen: dict | None = JSONField(dict)
    usage: dict | None = JSONField(dict)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class BrandKit(SQLModel, table=True):
    __tablename__ = "brand_kits"
    id: str = Field(primary_key=True)
    name: str
    data: dict | None = JSONField(dict)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Asset(SQLModel, table=True):
    __tablename__ = "assets"
    id: str = Field(primary_key=True)
    kind: str = Field(index=True)  # logo | image | music | sfx | broll | font
    name: str
    path: str
    size_bytes: int = 0
    meta: dict | None = JSONField(dict)
    license_note: str = ""
    created_at: datetime = Field(default_factory=utcnow)


class Setting(SQLModel, table=True):
    __tablename__ = "settings"
    key: str = Field(primary_key=True)
    value: Any = JSONField(None)
    updated_at: datetime = Field(default_factory=utcnow)


class UsageRecord(SQLModel, table=True):
    """Token usage / estimated cost for paid AI providers."""

    __tablename__ = "usage_records"
    id: int | None = Field(default=None, primary_key=True)
    provider: str
    model: str
    purpose: str
    input_tokens: int = 0
    output_tokens: int = 0
    estimated_cost_usd: float = 0.0
    created_at: datetime = Field(default_factory=utcnow)
