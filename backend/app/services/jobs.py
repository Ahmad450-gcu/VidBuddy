"""Download job manager: persistent queue, concurrency, priorities, pause/resume/retry, recovery."""
from __future__ import annotations

import asyncio
import json
import logging
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from ..db import Database
from ..engine.downloader import (DownloadOptions, JobInterrupted, Progress, build_options, folder_name,
                                 run_download)
from ..engine.errors import RETRYABLE, EngineError, classify
from ..engine.security import UnsafeInputError
from ..engine.sources import identify
from .events import EventBus
from .library import Library

log = logging.getLogger("haul.jobs")

ACTIVE = ("downloading", "processing")
FINISHED = ("completed", "failed", "cancelled")
STAGE_PROCESSING = {"merging", "converting", "embedding", "tagging", "finalizing", "processing", "subtitles"}


class JobManager:
    def __init__(self, db: Database, library: Library, bus: EventBus, *, temp_root: Path,
                 default_concurrency: int = 3, max_auto_retries: int = 2):
        self.db = db
        self.library = library
        self.bus = bus
        self.temp_root = temp_root
        self.max_auto_retries = max_auto_retries
        self._default_concurrency = default_concurrency
        self._stop_flags: dict[str, str | None] = {}
        self._flags_lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=16, thread_name_prefix="haul-dl")
        self._wake: asyncio.Event | None = None
        self._task: asyncio.Task | None = None
        self._running = False

    # ------------------------------------------------------------ lifecycle
    @property
    def concurrency(self) -> int:
        return int(self.db.get_setting("max_concurrent", self._default_concurrency))

    def recover(self) -> int:
        """Jobs interrupted by a crash/restart go back to the queue (partial data is kept)."""
        return self.db.execute(
            "UPDATE jobs SET status = 'queued', speed = NULL, eta = NULL, stage = NULL, updated_at = ? "
            "WHERE status IN ('downloading', 'processing')", (time.time(),))

    async def start(self) -> None:
        self._wake = asyncio.Event()
        self._running = True
        recovered = self.recover()
        if recovered:
            log.info("Re-queued %d interrupted job(s)", recovered)
        self._task = asyncio.create_task(self._scheduler(), name="haul-scheduler")

    async def stop(self) -> None:
        self._running = False
        with self._flags_lock:
            for k in self._stop_flags:
                self._stop_flags[k] = "shutdown"
        if self._task:
            self.wake()
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
        await asyncio.to_thread(self._pool.shutdown, True, cancel_futures=True)

    def wake(self) -> None:
        if self._wake is not None:
            loop = self.bus._loop
            if loop and loop.is_running():
                loop.call_soon_threadsafe(self._wake.set)
            else:
                self._wake.set()

    async def _scheduler(self) -> None:
        assert self._wake is not None
        while self._running:
            try:
                self._dispatch_ready()
            except Exception:
                log.exception("Scheduler tick failed")
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=1.0)
            except asyncio.TimeoutError:
                pass
            self._wake.clear()

    def _dispatch_ready(self) -> None:
        with self._flags_lock:
            # A job that was paused or cancelled gives its slot back at once, even if its worker
            # is still finishing a request (reading the page can take a while on some sites).
            active = sum(1 for reason in self._stop_flags.values() if reason is None)
        slots = self.concurrency - active
        if slots <= 0:
            return
        now = time.time()
        rows = self.db.all(
            "SELECT * FROM jobs WHERE status = 'queued' AND (scheduled_at IS NULL OR scheduled_at <= ?) "
            "ORDER BY priority DESC, created_at ASC LIMIT ?", (now, slots))
        for job in rows:
            with self._flags_lock:
                if job["id"] in self._stop_flags:
                    continue
                self._stop_flags[job["id"]] = None
            self._set(job["id"], status="downloading", stage="starting", started_at=now, error=None, error_code=None,
                      attempts=job["attempts"] + 1)
            loop = asyncio.get_running_loop()
            loop.run_in_executor(self._pool, self._run, job["id"])

    # -------------------------------------------------------------- worker
    def is_running(self, job_id: str) -> bool:
        """True while the job's worker is actively downloading (not stopping)."""
        with self._flags_lock:
            return job_id in self._stop_flags and self._stop_flags[job_id] is None

    def download_home(self, options: DownloadOptions) -> Path:
        """Where a job's file goes: the chosen download folder (or the library's video/audio
        folder), plus a folder named after the playlist or course it came from."""
        chosen = (self.db.get_setting("download_dir", "") or "").strip()
        home = Path(chosen) if chosen else self.library.media_root / options.kind
        sub = folder_name(options.folder)
        return home / sub if sub else home

    def _stop_reason(self, job_id: str) -> str | None:
        with self._flags_lock:
            return self._stop_flags.get(job_id)

    def _run(self, job_id: str) -> None:
        job = self.get(job_id)
        if not job:
            return
        temp = self.temp_root / job_id
        options = DownloadOptions.from_dict(job["options"])
        home = self.download_home(options)
        last_db = [0.0]

        def on_progress(p: Progress) -> None:
            status = "processing" if p.stage in STAGE_PROCESSING else "downloading"
            fields: dict[str, Any] = {"status": status, "stage": p.stage}
            if p.stage == "downloading":
                fields.update(progress=round(p.fraction, 4), downloaded_bytes=p.downloaded, total_bytes=p.total,
                              speed=p.speed, eta=p.eta)
            else:
                fields.update(progress=0.999, speed=None, eta=None)
            now = time.monotonic()
            persist = status == "processing" or now - last_db[0] > 2.0
            if persist:
                last_db[0] = now
            self._set(job_id, persist=persist, **fields)

        try:
            result = run_download(job["url"], options, home=home, temp=temp, on_progress=on_progress,
                                  should_stop=lambda: self._stop_reason(job_id))
            media = self.library.add_from_download(job=job, filepath=result.filepath, info=result.info,
                                                   subtitles=result.subtitles, thumb=result.thumbnail_bytes,
                                                   thumb_ext=result.thumbnail_ext)
            total = media["size"]
            self._set(job_id, status="completed", stage=None, progress=1.0, media_id=media["id"], speed=None, eta=None,
                      downloaded_bytes=total, total_bytes=total, finished_at=time.time(),
                      title=media["title"] if not job.get("title") else job["title"])
            self.bus.publish("media", {"action": "added", "media": media})
            shutil.rmtree(temp, ignore_errors=True)
        except JobInterrupted as e:
            if e.reason == "cancel":
                self._set(job_id, status="cancelled", stage=None, speed=None, eta=None, finished_at=time.time())
                shutil.rmtree(temp, ignore_errors=True)
            elif e.reason == "shutdown":
                self._set(job_id, status="queued", stage=None, speed=None, eta=None)
            else:
                self._set(job_id, status="paused", stage=None, speed=None, eta=None)
        except (EngineError, UnsafeInputError, Exception) as exc:
            err = exc if isinstance(exc, EngineError) else (
                EngineError("invalid", str(exc)) if isinstance(exc, UnsafeInputError) else classify(exc))
            if not isinstance(exc, (EngineError, UnsafeInputError)):
                log.exception("Job %s crashed", job_id)
            fresh = self.get(job_id) or job
            if err.code in RETRYABLE and fresh["attempts"] <= self.max_auto_retries:
                delay = 5 * (2 ** (fresh["attempts"] - 1))
                self._set(job_id, status="queued", stage=None, speed=None, eta=None, error=err.message,
                          error_code=err.code, scheduled_at=time.time() + delay)
                log.info("Job %s: %s, auto-retry in %ss", job_id, err.code, delay)
            else:
                self._set(job_id, status="failed", stage=None, speed=None, eta=None, error=err.message,
                          error_code=err.code, finished_at=time.time())
                log.warning("Job %s failed (%s): %s", job_id, err.code, err.detail[:300])
        finally:
            with self._flags_lock:
                self._stop_flags.pop(job_id, None)
            self.wake()

    # ------------------------------------------------------------ persistence
    def _set(self, job_id: str, *, persist: bool = True, **fields: Any) -> None:
        fields["updated_at"] = time.time()
        if persist:
            self.db.update("jobs", job_id, fields)
        self.bus.publish("job", {"id": job_id, **fields})

    @staticmethod
    def serialize(row: dict[str, Any]) -> dict[str, Any]:
        row = dict(row)
        row["options"] = json.loads(row.get("options") or "{}")
        return row

    def get(self, job_id: str) -> dict[str, Any] | None:
        row = self.db.one("SELECT * FROM jobs WHERE id = ?", (job_id,))
        return self.serialize(row) if row else None

    def list(self, status: str | None = None, limit: int = 300) -> list[dict[str, Any]]:
        groups = {
            "active": ("downloading", "processing"),
            "queued": ("queued", "paused"),
            "completed": ("completed",),
            "failed": ("failed", "cancelled"),
        }
        if status in groups:
            marks = ",".join("?" for _ in groups[status])
            rows = self.db.all(
                f"SELECT * FROM jobs WHERE status IN ({marks}) ORDER BY priority DESC, created_at DESC LIMIT ?",
                [*groups[status], limit])
        else:
            rows = self.db.all("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,))
        return [self.serialize(r) for r in rows]

    def counts(self) -> dict[str, int]:
        rows = self.db.all("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status")
        return {r["status"]: r["n"] for r in rows}

    # ------------------------------------------------------------- commands
    def create(self, *, url: str, kind: str, options: dict[str, Any], title: str | None = None,
               thumbnail: str | None = None, priority: int = 0, scheduled_at: float | None = None,
               playlist_title: str | None = None) -> dict[str, Any]:
        opts = DownloadOptions.from_dict({**options, "kind": kind})
        opts.folder = folder_name(opts.folder)
        build_options(opts, home=self.library.media_root, temp=self.temp_root)  # validates eagerly
        options_json = json.dumps(opts.__dict__, sort_keys=True)
        # Identical request already in flight (double tap, re-shared link): reuse it.
        dup = self.db.one(
            "SELECT id FROM jobs WHERE url = ? AND kind = ? AND options = ? "
            "AND status IN ('queued','downloading','processing','paused')", (url, kind, options_json))
        if dup:
            return self.get(dup["id"])  # type: ignore[return-value]
        now = time.time()
        job = {
            "id": uuid.uuid4().hex,
            "url": url,
            "source": identify(url).name,
            "title": (title or "")[:300] or None,
            "thumbnail": thumbnail if thumbnail and thumbnail.startswith(("http://", "https://")) else None,
            "kind": kind,
            "options": options_json,
            "status": "queued",
            "priority": max(-10, min(10, int(priority))),
            "created_at": now,
            "updated_at": now,
            "scheduled_at": scheduled_at if scheduled_at and scheduled_at > now else None,
            "playlist_title": playlist_title,
        }
        self.db.insert("jobs", job)
        out = self.get(job["id"])
        self.bus.publish("job_created", out)
        self.wake()
        return out  # type: ignore[return-value]

    def pause(self, job_id: str) -> dict[str, Any]:
        job = self._require(job_id)
        if job["status"] in ACTIVE:
            with self._flags_lock:
                if job_id in self._stop_flags:
                    self._stop_flags[job_id] = "pause"
                    return {**job, "status": "pausing"}
        if job["status"] in ("queued", *ACTIVE):
            self._set(job_id, status="paused", speed=None, eta=None, stage=None)
        return self.get(job_id)  # type: ignore[return-value]

    def resume(self, job_id: str, *, reset_attempts: bool = False) -> dict[str, Any]:
        job = self._require(job_id)
        if job["status"] in ("paused", "failed", "cancelled"):
            fields: dict[str, Any] = {"status": "queued", "error": None, "error_code": None, "scheduled_at": None,
                                      "finished_at": None}
            if reset_attempts:
                fields["attempts"] = 0
            if job["status"] == "cancelled":
                fields.update(progress=0, downloaded_bytes=0)
            self._set(job_id, **fields)
            self.wake()
        return self.get(job_id)  # type: ignore[return-value]

    def retry(self, job_id: str) -> dict[str, Any]:
        return self.resume(job_id, reset_attempts=True)

    def cancel(self, job_id: str) -> dict[str, Any]:
        job = self._require(job_id)
        with self._flags_lock:
            if job_id in self._stop_flags:
                self._stop_flags[job_id] = "cancel"
                return {**job, "status": "cancelling"}
        if job["status"] not in FINISHED:
            self._set(job_id, status="cancelled", speed=None, eta=None, stage=None, finished_at=time.time())
            shutil.rmtree(self.temp_root / job_id, ignore_errors=True)
        return self.get(job_id)  # type: ignore[return-value]

    def set_priority(self, job_id: str, priority: int) -> dict[str, Any]:
        self._require(job_id)
        self._set(job_id, priority=max(-10, min(10, int(priority))))
        self.wake()
        return self.get(job_id)  # type: ignore[return-value]

    def set_schedule(self, job_id: str, scheduled_at: float | None) -> dict[str, Any]:
        self._require(job_id)
        self._set(job_id, scheduled_at=scheduled_at)
        self.wake()
        return self.get(job_id)  # type: ignore[return-value]

    def delete(self, job_id: str) -> bool:
        job = self.get(job_id)
        if not job:
            return False
        with self._flags_lock:
            if job_id in self._stop_flags:
                self._stop_flags[job_id] = "cancel"
        self.db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        shutil.rmtree(self.temp_root / job_id, ignore_errors=True)
        self.bus.publish("job_deleted", {"id": job_id})
        return True

    def clear(self, statuses: tuple[str, ...]) -> int:
        ids = [r["id"] for r in self.db.all(
            f"SELECT id FROM jobs WHERE status IN ({','.join('?' for _ in statuses)})", statuses)]
        for i in ids:
            self.delete(i)
        return len(ids)

    def pause_all(self) -> int:
        n = 0
        for j in self.db.all("SELECT id FROM jobs WHERE status IN ('queued','downloading','processing')"):
            self.pause(j["id"]); n += 1
        return n

    def resume_all(self) -> int:
        n = 0
        for j in self.db.all("SELECT id FROM jobs WHERE status = 'paused'"):
            self.resume(j["id"]); n += 1
        return n

    def cleanup_orphan_temp(self) -> int:
        """Remove temp folders that belong to no resumable job."""
        keep = {r["id"] for r in self.db.all("SELECT id FROM jobs WHERE status IN ('queued','paused','downloading','processing','failed')")}
        removed = 0
        if self.temp_root.exists():
            for d in self.temp_root.iterdir():
                if d.is_dir() and d.name not in keep:
                    shutil.rmtree(d, ignore_errors=True); removed += 1
        return removed

    def _require(self, job_id: str) -> dict[str, Any]:
        job = self.get(job_id)
        if not job:
            raise KeyError(job_id)
        return job
