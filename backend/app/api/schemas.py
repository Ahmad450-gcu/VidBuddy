"""Request/response models for the HTTP API."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    url: str = Field(min_length=4, max_length=4096)
    refresh: bool = False
    headers: str = Field(default="", max_length=65536)  # optional request headers, raw text


class DownloadOptionsIn(BaseModel):
    quality: str = Field(default="best", max_length=100)
    container: Literal["mp4", "webm", "mkv"] = "mp4"
    audio_format: Literal["mp3", "m4a", "aac", "opus", "flac", "wav", "best"] = "mp3"
    audio_bitrate: int = Field(default=0, ge=0, le=320)
    subtitles: bool = False
    subtitle_langs: list[str] = Field(default_factory=lambda: ["en"], max_length=10)
    auto_subtitles: bool = False
    embed_metadata: bool = True
    embed_thumbnail: bool = True
    filename_template: str | None = Field(default=None, max_length=200)
    max_filesize_mb: int = Field(default=0, ge=0, le=1_000_000)
    rate_limit_kbps: int = Field(default=0, ge=0, le=10_000_000)


class EntryIn(BaseModel):
    url: str = Field(max_length=4096)
    title: str | None = Field(default=None, max_length=500)
    thumbnail: str | None = Field(default=None, max_length=4096)


class CreateDownloadRequest(BaseModel):
    url: str | None = Field(default=None, max_length=4096)
    title: str | None = Field(default=None, max_length=500)
    thumbnail: str | None = Field(default=None, max_length=4096)
    kind: Literal["video", "audio"] = "video"
    options: DownloadOptionsIn = Field(default_factory=DownloadOptionsIn)
    priority: int = Field(default=0, ge=-10, le=10)
    scheduled_at: float | None = None
    entries: list[EntryIn] | None = Field(default=None, max_length=1000)
    playlist_title: str | None = Field(default=None, max_length=500)
    headers: str = Field(default="", max_length=65536)  # optional request headers, raw text


class JobPatch(BaseModel):
    priority: int | None = Field(default=None, ge=-10, le=10)
    scheduled_at: float | None = None
    clear_schedule: bool = False


class MediaPatch(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    favorite: bool | None = None
    play_position: float | None = Field(default=None, ge=0)
    rename_file: bool = False


class SubtitleRequest(BaseModel):
    lang: str = Field(default="en", pattern=r"^[A-Za-z0-9\-_]{1,20}$")


class BulkDelete(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=1000)
    delete_file: bool = True


class PlaylistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    media_ids: list[str] = Field(default_factory=list, max_length=1000)


class PlaylistPatch(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    order: list[str] | None = Field(default=None, max_length=5000)


class PlaylistItems(BaseModel):
    media_ids: list[str] = Field(min_length=1, max_length=1000)


class SettingsPatch(BaseModel):
    max_concurrent: int | None = Field(default=None, ge=1, le=10)
    default_kind: Literal["video", "audio"] | None = None
    default_quality: str | None = Field(default=None, max_length=20)
    default_container: Literal["mp4", "webm", "mkv"] | None = None
    default_audio_format: Literal["mp3", "m4a", "aac", "opus", "flac", "wav"] | None = None
    default_audio_bitrate: int | None = Field(default=None, ge=0, le=320)
    filename_template: str | None = Field(default=None, max_length=200)
    subtitles: bool | None = None
    subtitle_langs: list[str] | None = Field(default=None, max_length=10)
    embed_metadata: bool | None = None
    embed_thumbnail: bool | None = None
    skip_duplicates: bool | None = None


class CookiesUpload(BaseModel):
    content: str = Field(min_length=1, max_length=1_000_000)
