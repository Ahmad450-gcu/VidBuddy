"""Media library: indexing completed downloads, querying, playlists, storage stats."""
from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

from ..db import Database
from ..engine.security import UnsafeInputError, safe_join, sanitize_filename

VIDEO_EXT = {"mp4", "m4v", "webm", "mkv", "mov", "avi"}
AUDIO_EXT = {"mp3", "m4a", "aac", "opus", "ogg", "oga", "wav", "flac"}
mimetypes.add_type("audio/opus", ".opus")
mimetypes.add_type("video/x-matroska", ".mkv")
mimetypes.add_type("audio/flac", ".flac")
mimetypes.add_type("audio/aac", ".aac")
mimetypes.add_type("text/vtt", ".vtt")
mimetypes.add_type("audio/mp4", ".m4a")

SORTS = {"created": "created_at", "title": "title COLLATE NOCASE", "size": "size", "duration": "duration",
         "played": "last_played_at"}


def quick_hash(path: Path) -> str:
    """Size + SHA-1 of the first/last MiB: fast, reliable enough for duplicate detection."""
    size = path.stat().st_size
    h = hashlib.sha1(str(size).encode())
    with path.open("rb") as f:
        h.update(f.read(1 << 20))
        if size > 2 << 20:
            f.seek(-(1 << 20), os.SEEK_END)
            h.update(f.read(1 << 20))
    return h.hexdigest()


class Library:
    def __init__(self, db: Database, media_root: Path, thumbs_root: Path):
        self.db = db
        self.media_root = media_root.resolve()
        self.thumbs_root = thumbs_root.resolve()

    # ------------------------------------------------------------------ paths
    def abs_path(self, rel: str) -> Path:
        return safe_join(self.media_root, rel)

    def rel_path(self, p: Path) -> str:
        return p.resolve().relative_to(self.media_root).as_posix()

    # ---------------------------------------------------------------- serialize
    def serialize(self, row: dict[str, Any] | None) -> dict[str, Any] | None:
        if row is None:
            return None
        row = dict(row)
        row["favorite"] = bool(row["favorite"])
        row["subtitles"] = json.loads(row.get("subtitles") or "[]")
        row["has_thumbnail"] = bool(row.get("thumbnail_path"))
        row["filename"] = Path(row["path"]).name
        row["folder"] = str(self.abs_path(row["path"]).parent)
        row.pop("thumbnail_path", None)
        return row

    # --------------------------------------------------------------- indexing
    def add_from_download(self, *, job: dict[str, Any], filepath: Path, info: dict[str, Any],
                          subtitles: list[Path], thumb: bytes | None, thumb_ext: str | None) -> dict[str, Any]:
        rel = self.rel_path(filepath)
        existing = self.db.one("SELECT * FROM media WHERE path = ?", (rel,))
        if existing:
            self.db.update("media", existing["id"], {"status": "ready", "job_id": job["id"],
                                                     "size": filepath.stat().st_size})
            return self.serialize(self.db.one("SELECT * FROM media WHERE id = ?", (existing["id"],)))  # type: ignore[return-value]
        media_id = uuid.uuid4().hex
        thumb_rel = None
        if thumb:
            name = f"{media_id}.{thumb_ext or 'jpg'}"
            (self.thumbs_root / name).write_bytes(thumb)
            thumb_rel = name
        ext = filepath.suffix.lstrip(".").lower()
        kind = "audio" if ext in AUDIO_EXT and job["kind"] == "audio" else job["kind"]
        if not thumb_rel and kind == "video":
            from ..engine.runtime import extract_frame

            name = f"{media_id}.jpg"
            if extract_frame(filepath, self.thumbs_root / name, info.get("duration")):
                thumb_rel = name
        subs = []
        for s in subtitles:
            lang = s.suffixes[-2].lstrip(".") if len(s.suffixes) >= 2 else "und"
            subs.append({"lang": lang, "path": self.rel_path(s)})
        from ..engine.sources import identify

        row = {
            "id": media_id,
            "job_id": job["id"],
            "title": info.get("title") or filepath.stem,
            "uploader": info.get("uploader") or info.get("channel") or info.get("artist"),
            "source": job.get("source") or identify(job["url"]).name,
            "source_url": info.get("webpage_url") or job["url"],
            "kind": kind,
            "path": rel,
            "size": filepath.stat().st_size,
            "duration": info.get("duration"),
            "mime": mimetypes.guess_type(filepath.name)[0] or "application/octet-stream",
            "ext": ext,
            "width": info.get("width") if kind == "video" else None,
            "height": info.get("height") if kind == "video" else None,
            "vcodec": None if kind == "audio" else info.get("vcodec"),
            "acodec": ({"m4a": "aac", "mp3": "mp3", "opus": "opus", "flac": "flac", "wav": "pcm", "aac": "aac"}.get(ext)
                       if kind == "audio" else info.get("acodec")),
            "thumbnail_path": thumb_rel,
            "subtitles": json.dumps(subs),
            "content_hash": quick_hash(filepath),
            "status": "ready",
            "created_at": time.time(),
        }
        self.db.insert("media", row)
        return self.serialize(self.get(media_id))  # type: ignore[return-value]

    def rescan(self) -> dict[str, int]:
        """Reconcile the index with the media folder: mark missing, import untracked."""
        missing = restored = imported = 0
        for row in self.db.all("SELECT id, path, status FROM media"):
            exists = self.abs_path(row["path"]).exists()
            if not exists and row["status"] != "missing":
                self.db.update("media", row["id"], {"status": "missing"})
                missing += 1
            elif exists and row["status"] == "missing":
                self.db.update("media", row["id"], {"status": "ready"})
                restored += 1
        known = {r["path"] for r in self.db.all("SELECT path FROM media")}
        for p in self.media_root.rglob("*"):
            if not p.is_file() or p.suffix.lower().lstrip(".") not in VIDEO_EXT | AUDIO_EXT:
                continue
            if p.name.endswith((".part", ".ytdl")) or ".temp." in p.name:
                continue
            rel = self.rel_path(p)
            if rel in known:
                continue
            ext = p.suffix.lstrip(".").lower()
            self.db.insert("media", {
                "id": uuid.uuid4().hex, "job_id": None, "title": p.stem, "uploader": None, "source": "Imported",
                "source_url": None, "kind": "audio" if ext in AUDIO_EXT else "video", "path": rel,
                "size": p.stat().st_size, "duration": None,
                "mime": mimetypes.guess_type(p.name)[0] or "application/octet-stream", "ext": ext,
                "width": None, "height": None, "vcodec": None, "acodec": None, "thumbnail_path": None,
                "subtitles": "[]", "content_hash": quick_hash(p), "status": "ready", "created_at": p.stat().st_mtime,
            })
            imported += 1
        return {"missing": missing, "restored": restored, "imported": imported}

    # ---------------------------------------------------------------- queries
    def list(self, *, kind: str | None = None, q: str | None = None, favorite: bool | None = None,
             sort: str = "created", order: str = "desc", status: str | None = None, source: str | None = None,
             limit: int = 100, offset: int = 0) -> dict[str, Any]:
        where, params = ["1=1"], []
        if kind in ("video", "audio"):
            where.append("kind = ?"); params.append(kind)
        if favorite:
            where.append("favorite = 1")
        if status in ("ready", "missing"):
            where.append("status = ?"); params.append(status)
        if source:
            where.append("source = ?"); params.append(source)
        if q:
            like = f"%{q.strip().replace('%', '').replace('_', '')}%"
            where.append("(title LIKE ? OR uploader LIKE ? OR source LIKE ?)"); params += [like, like, like]
        col = SORTS.get(sort, "created_at")
        direction = "ASC" if order == "asc" else "DESC"
        clause = " AND ".join(where)
        total = self.db.scalar(f"SELECT COUNT(*) FROM media WHERE {clause}", params)
        rows = self.db.all(
            f"SELECT * FROM media WHERE {clause} ORDER BY {col} {direction}, created_at DESC LIMIT ? OFFSET ?",
            [*params, max(1, min(limit, 500)), max(0, offset)],
        )
        return {"items": [self.serialize(r) for r in rows], "total": total}

    def get(self, media_id: str) -> dict[str, Any] | None:
        return self.db.one("SELECT * FROM media WHERE id = ?", (media_id,))

    def sources(self) -> list[str]:
        return [r["source"] for r in self.db.all("SELECT DISTINCT source FROM media WHERE source IS NOT NULL ORDER BY source")]

    # -------------------------------------------------------------- mutations
    def update(self, media_id: str, *, title: str | None = None, favorite: bool | None = None,
               play_position: float | None = None, rename_file: bool = False) -> dict[str, Any]:
        row = self.get(media_id)
        if not row:
            raise KeyError(media_id)
        changes: dict[str, Any] = {}
        if title is not None:
            title = title.strip()
            if not title or len(title) > 300:
                raise UnsafeInputError("Title must be 1–300 characters.")
            changes["title"] = title
            if rename_file:
                src = self.abs_path(row["path"])
                new_name = sanitize_filename(f"{title}.{row['ext']}")
                dst = src.with_name(new_name)
                if dst != src:
                    if dst.exists():
                        raise UnsafeInputError("A file with that name already exists.")
                    if src.exists():
                        src.rename(dst)
                    changes["path"] = self.rel_path(dst)
                    subs = json.loads(row["subtitles"] or "[]")
                    for s in subs:
                        sp = self.abs_path(s["path"])
                        if sp.exists():
                            nsp = dst.with_name(f"{dst.stem}.{s['lang']}.vtt")
                            sp.rename(nsp)
                            s["path"] = self.rel_path(nsp)
                    changes["subtitles"] = json.dumps(subs)
        if favorite is not None:
            changes["favorite"] = 1 if favorite else 0
        if play_position is not None:
            changes["play_position"] = max(0.0, float(play_position))
        self.db.update("media", media_id, changes)
        return self.serialize(self.get(media_id))  # type: ignore[return-value]

    def mark_played(self, media_id: str) -> None:
        self.db.execute("UPDATE media SET play_count = play_count + 1, last_played_at = ? WHERE id = ?",
                        (time.time(), media_id))

    def delete(self, media_id: str, *, delete_file: bool) -> bool:
        row = self.get(media_id)
        if not row:
            return False
        if delete_file:
            for rel in [row["path"], *(s["path"] for s in json.loads(row["subtitles"] or "[]"))]:
                try:
                    self.abs_path(rel).unlink(missing_ok=True)
                except OSError:
                    pass
        if row.get("thumbnail_path"):
            (self.thumbs_root / row["thumbnail_path"]).unlink(missing_ok=True)
        # extracted-audio cache lives at <data_dir>/audio-cache (thumbs_root is <data_dir>/thumbs)
        (self.thumbs_root.parent / "audio-cache" / f"{media_id}.mp3").unlink(missing_ok=True)
        self.db.execute("DELETE FROM media WHERE id = ?", (media_id,))
        # A finished download whose file is gone is just clutter in the Downloads list.
        self.db.execute("DELETE FROM jobs WHERE media_id = ? AND status = 'completed'", (media_id,))
        self.db.execute("UPDATE jobs SET media_id = NULL WHERE media_id = ?", (media_id,))
        return True

    def set_subtitles(self, media_id: str, files: list[Path]) -> dict[str, Any]:
        row = self.get(media_id)
        if not row:
            raise KeyError(media_id)
        subs = {s["lang"]: s for s in json.loads(row["subtitles"] or "[]")}
        for f in files:
            lang = f.suffixes[-2].lstrip(".") if len(f.suffixes) >= 2 else "und"
            subs[lang] = {"lang": lang, "path": self.rel_path(f)}
        self.db.update("media", media_id, {"subtitles": json.dumps(list(subs.values()))})
        return self.serialize(self.get(media_id))  # type: ignore[return-value]

    def thumbnail_file(self, row: dict[str, Any]) -> Path | None:
        if not row.get("thumbnail_path"):
            return None
        p = safe_join(self.thumbs_root, row["thumbnail_path"])
        return p if p.exists() else None

    # ------------------------------------------------------------ duplicates
    def duplicates(self) -> list[dict[str, Any]]:
        groups = self.db.all(
            "SELECT content_hash, COUNT(*) AS n FROM media WHERE content_hash IS NOT NULL "
            "GROUP BY content_hash HAVING n > 1"
        )
        by_url = self.db.all(
            "SELECT source_url, kind, COUNT(*) AS n FROM media WHERE source_url IS NOT NULL "
            "GROUP BY source_url, kind HAVING n > 1"
        )
        out, seen = [], set()
        for g in groups:
            items = [self.serialize(r) for r in self.db.all(
                "SELECT * FROM media WHERE content_hash = ? ORDER BY created_at", (g["content_hash"],))]
            seen.update(i["id"] for i in items)
            out.append({"reason": "identical file", "items": items})
        for g in by_url:
            items = [self.serialize(r) for r in self.db.all(
                "SELECT * FROM media WHERE source_url = ? AND kind = ? ORDER BY created_at", (g["source_url"], g["kind"]))]
            if all(i["id"] in seen for i in items):
                continue
            out.append({"reason": "same source", "items": items})
        return out

    def find_existing(self, url: str, kind: str) -> dict[str, Any] | None:
        return self.serialize(self.db.one(
            "SELECT * FROM media WHERE source_url = ? AND kind = ? AND status = 'ready' ORDER BY created_at DESC",
            (url, kind)))

    # ---------------------------------------------------------------- storage
    def storage(self) -> dict[str, Any]:
        by_kind = {r["kind"]: {"count": r["n"], "size": r["s"] or 0}
                   for r in self.db.all("SELECT kind, COUNT(*) n, SUM(size) s FROM media GROUP BY kind")}
        by_source = self.db.all(
            "SELECT source, COUNT(*) AS count, SUM(size) AS size FROM media GROUP BY source ORDER BY size DESC LIMIT 12")
        by_ext = self.db.all("SELECT ext, COUNT(*) AS count, SUM(size) AS size FROM media GROUP BY ext ORDER BY size DESC")
        largest = [self.serialize(r) for r in self.db.all("SELECT * FROM media ORDER BY size DESC LIMIT 10")]
        recent = [self.serialize(r) for r in self.db.all("SELECT * FROM media ORDER BY created_at DESC LIMIT 10")]
        total = sum(v["size"] for v in by_kind.values())
        try:
            du = shutil.disk_usage(self.media_root)
            disk = {"total": du.total, "used": du.used, "free": du.free}
        except OSError:
            disk = None
        dupes = self.duplicates()
        reclaimable = sum(sum(i["size"] for i in g["items"][1:]) for g in dupes if g["reason"] == "identical file")
        return {
            "total_size": total,
            "total_count": sum(v["count"] for v in by_kind.values()),
            "by_kind": by_kind,
            "by_source": by_source,
            "by_ext": by_ext,
            "largest": largest,
            "recent": recent,
            "disk": disk,
            "media_root": str(self.media_root),
            "duplicate_groups": len(dupes),
            "reclaimable": reclaimable,
            "missing": self.db.scalar("SELECT COUNT(*) FROM media WHERE status = 'missing'"),
        }

    # -------------------------------------------------------------- playlists
    def playlists(self) -> list[dict[str, Any]]:
        rows = self.db.all(
            "SELECT p.*, COUNT(pi.media_id) AS count, COALESCE(SUM(m.duration),0) AS duration, "
            "(SELECT pi2.media_id FROM playlist_items pi2 WHERE pi2.playlist_id = p.id ORDER BY pi2.position LIMIT 1) AS cover_id "
            "FROM playlists p LEFT JOIN playlist_items pi ON pi.playlist_id = p.id "
            "LEFT JOIN media m ON m.id = pi.media_id GROUP BY p.id ORDER BY p.updated_at DESC")
        return rows

    def playlist(self, pid: str) -> dict[str, Any] | None:
        p = self.db.one("SELECT * FROM playlists WHERE id = ?", (pid,))
        if not p:
            return None
        items = self.db.all(
            "SELECT m.* FROM playlist_items pi JOIN media m ON m.id = pi.media_id WHERE pi.playlist_id = ? ORDER BY pi.position",
            (pid,))
        p["items"] = [self.serialize(r) for r in items]
        return p

    def create_playlist(self, name: str, media_ids: list[str] | None = None) -> dict[str, Any]:
        name = (name or "").strip()
        if not name or len(name) > 120:
            raise UnsafeInputError("Playlist name must be 1–120 characters.")
        pid, now = uuid.uuid4().hex, time.time()
        self.db.insert("playlists", {"id": pid, "name": name, "created_at": now, "updated_at": now})
        if media_ids:
            self.add_to_playlist(pid, media_ids)
        return self.playlist(pid)  # type: ignore[return-value]

    def rename_playlist(self, pid: str, name: str) -> dict[str, Any]:
        name = (name or "").strip()
        if not name or len(name) > 120:
            raise UnsafeInputError("Playlist name must be 1–120 characters.")
        if not self.db.update("playlists", pid, {"name": name, "updated_at": time.time()}):
            raise KeyError(pid)
        return self.playlist(pid)  # type: ignore[return-value]

    def delete_playlist(self, pid: str) -> bool:
        return self.db.execute("DELETE FROM playlists WHERE id = ?", (pid,)) > 0

    def add_to_playlist(self, pid: str, media_ids: list[str]) -> dict[str, Any]:
        if not self.db.one("SELECT id FROM playlists WHERE id = ?", (pid,)):
            raise KeyError(pid)
        pos = self.db.scalar("SELECT COALESCE(MAX(position), -1) FROM playlist_items WHERE playlist_id = ?", (pid,))
        rows = []
        for mid in media_ids:
            if self.get(mid):
                pos += 1
                rows.append((pid, mid, pos))
        self.db.executemany("INSERT OR IGNORE INTO playlist_items(playlist_id, media_id, position) VALUES (?,?,?)", rows)
        self.db.update("playlists", pid, {"updated_at": time.time()})
        return self.playlist(pid)  # type: ignore[return-value]

    def remove_from_playlist(self, pid: str, media_id: str) -> dict[str, Any]:
        self.db.execute("DELETE FROM playlist_items WHERE playlist_id = ? AND media_id = ?", (pid, media_id))
        self.db.update("playlists", pid, {"updated_at": time.time()})
        return self.playlist(pid)  # type: ignore[return-value]

    def reorder_playlist(self, pid: str, media_ids: list[str]) -> dict[str, Any]:
        self.db.executemany("UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND media_id = ?",
                            [(i, pid, m) for i, m in enumerate(media_ids)])
        self.db.update("playlists", pid, {"updated_at": time.time()})
        return self.playlist(pid)  # type: ignore[return-value]
