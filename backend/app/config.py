"""Application configuration loaded from environment variables (prefix ``HAUL_``)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="HAUL_", env_file=".env", extra="ignore")

    # Storage
    data_dir: Path = Path("./data")
    media_dir: Path | None = None  # defaults to <data_dir>/media
    temp_dir: Path | None = None  # defaults to <data_dir>/tmp

    # Security
    api_token: str | None = Field(default=None, description="If set, all /api calls require it.")
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    allow_private_networks: bool = False  # SSRF guard for analyzed URLs
    rate_limit_per_minute: int = 60  # for analyze / create-download endpoints

    # Engine
    max_concurrent_downloads: int = 3
    max_auto_retries: int = 2
    extract_timeout: int = 90
    info_cache_ttl: int = 1800
    max_filesize_mb: int = 0  # 0 = unlimited
    ffmpeg_path: str | None = None
    js_runtime: str | None = None  # "node" | "deno" | path; auto-detected when unset
    max_playlist_items: int = 500

    # Frontend
    frontend_dist: Path | None = None  # serve built SPA from here when set

    def resolved_media_dir(self) -> Path:
        return (self.media_dir or self.data_dir / "media").resolve()

    def resolved_temp_dir(self) -> Path:
        return (self.temp_dir or self.data_dir / "tmp").resolve()

    def thumbs_dir(self) -> Path:
        return (self.data_dir / "thumbs").resolve()

    def db_path(self) -> Path:
        return (self.data_dir / "haul.db").resolve()

    def ensure_dirs(self) -> None:
        for p in (self.data_dir, self.resolved_media_dir(), self.resolved_temp_dir(), self.thumbs_dir()):
            Path(p).mkdir(parents=True, exist_ok=True)
        for sub in ("video", "audio"):
            (self.resolved_media_dir() / sub).mkdir(exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
