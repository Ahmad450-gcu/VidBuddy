"""SQLite persistence layer.

SQLite in WAL mode is the right fit for a single-instance self-hosted server: zero ops,
durable, and every query here is an indexed lookup that completes in well under a
millisecond. Access is serialized through a lock so worker threads and the event loop
can share one connection safely.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    source TEXT,
    title TEXT,
    thumbnail TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('video','audio')),
    options TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    progress REAL NOT NULL DEFAULT 0,
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER,
    speed REAL,
    eta INTEGER,
    stage TEXT,
    error TEXT,
    error_code TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    playlist_title TEXT,
    media_id TEXT,
    scheduled_at REAL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    started_at REAL,
    finished_at REAL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, priority DESC, created_at);

CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    job_id TEXT,
    title TEXT NOT NULL,
    uploader TEXT,
    source TEXT,
    source_url TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('video','audio')),
    path TEXT NOT NULL UNIQUE,
    size INTEGER NOT NULL DEFAULT 0,
    duration REAL,
    mime TEXT,
    ext TEXT,
    width INTEGER,
    height INTEGER,
    vcodec TEXT,
    acodec TEXT,
    thumbnail_path TEXT,
    subtitles TEXT NOT NULL DEFAULT '[]',
    favorite INTEGER NOT NULL DEFAULT 0,
    play_position REAL NOT NULL DEFAULT 0,
    play_count INTEGER NOT NULL DEFAULT 0,
    last_played_at REAL,
    content_hash TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_kind ON media(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_hash ON media(content_hash);
CREATE INDEX IF NOT EXISTS idx_media_source_url ON media(source_url);

CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS playlist_items (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, media_id)
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS info_cache (
    url TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at REAL NOT NULL
);
"""


class Database:
    def __init__(self, path: Path | str):
        self.path = str(path)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._conn.executescript(SCHEMA)
            self._conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def execute(self, sql: str, params: Iterable[Any] = ()) -> int:
        with self._lock:
            cur = self._conn.execute(sql, tuple(params))
            return cur.rowcount

    def executemany(self, sql: str, seq: Iterable[Iterable[Any]]) -> None:
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                self._conn.executemany(sql, [tuple(p) for p in seq])
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    def one(self, sql: str, params: Iterable[Any] = ()) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(sql, tuple(params)).fetchone()
            return dict(row) if row else None

    def all(self, sql: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, tuple(params)).fetchall()]

    def scalar(self, sql: str, params: Iterable[Any] = ()) -> Any:
        with self._lock:
            row = self._conn.execute(sql, tuple(params)).fetchone()
            return row[0] if row else None

    # --- helpers -------------------------------------------------------
    def insert(self, table: str, values: dict[str, Any]) -> None:
        cols = ", ".join(values)
        marks = ", ".join("?" for _ in values)
        self.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", values.values())

    def update(self, table: str, row_id: str, values: dict[str, Any]) -> int:
        if not values:
            return 0
        sets = ", ".join(f"{k} = ?" for k in values)
        return self.execute(f"UPDATE {table} SET {sets} WHERE id = ?", [*values.values(), row_id])

    def get_setting(self, key: str, default: Any = None) -> Any:
        v = self.scalar("SELECT value FROM settings WHERE key = ?", (key,))
        return json.loads(v) if v is not None else default

    def set_setting(self, key: str, value: Any) -> None:
        self.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, json.dumps(value)),
        )
