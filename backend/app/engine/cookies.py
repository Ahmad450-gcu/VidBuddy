"""Optional sign-in cookies (Netscape ``cookies.txt``) for age-restricted or private media.

The master file is never handed to yt-dlp directly: yt-dlp rewrites its cookie file when it
closes, so concurrent jobs sharing one file could read a half-written copy. Each call gets its
own snapshot instead. Cookie contents are never returned by the API.
"""
from __future__ import annotations

import os
import shutil
import threading
import time
import uuid
from pathlib import Path

MAX_BYTES = 1_000_000
_lock = threading.Lock()
_path: Path | None = None
_snap_dir: Path | None = None


class CookieError(ValueError):
    pass


def configure(data_dir: Path) -> None:
    global _path, _snap_dir
    _path = Path(data_dir).resolve() / "cookies.txt"
    _snap_dir = Path(data_dir).resolve() / "cookie-snapshots"
    if _snap_dir.exists():
        shutil.rmtree(_snap_dir, ignore_errors=True)


def _parse(text: str) -> list[str]:
    """Return the cookie domains in ``text`` or raise CookieError if it isn't a cookies.txt."""
    domains: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("#HttpOnly_"):
            line = line[len("#HttpOnly_"):]
        elif not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) != 7:
            raise CookieError("This isn't a cookies.txt file (Netscape format, tab-separated).")
        domains.append(parts[0].lstrip(".").lower())
    if not domains:
        raise CookieError("The file has no cookies in it.")
    return domains


def save(text: str) -> dict:
    if _path is None:
        raise RuntimeError("cookies not configured")
    if len(text.encode("utf-8", "ignore")) > MAX_BYTES:
        raise CookieError("Cookie file is too large (max 1 MB).")
    text = text.replace("\r\n", "\n")
    _parse(text)
    if not text.lstrip().startswith("# Netscape HTTP Cookie File"):
        text = "# Netscape HTTP Cookie File\n" + text  # yt-dlp requires the header
    with _lock:
        tmp = _path.with_suffix(".tmp")
        tmp.write_text(text, encoding="utf-8")
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, _path)
    return status()


def clear() -> dict:
    with _lock:
        if _path and _path.exists():
            _path.unlink()
    return status()


def status() -> dict:
    if not _path or not _path.exists():
        return {"present": False, "count": 0, "sites": [], "youtube": False, "updated_at": None}
    try:
        domains = _parse(_path.read_text(encoding="utf-8", errors="replace"))
    except CookieError:
        domains = []
    sites = sorted({".".join(d.split(".")[-2:]) for d in domains})
    return {
        "present": bool(domains),
        "count": len(domains),
        "sites": sites[:50],
        "youtube": any(s in ("youtube.com", "google.com") for s in sites),
        "updated_at": _path.stat().st_mtime,
    }


def snapshot() -> str | None:
    """A private copy of the cookie file for one yt-dlp instance, or None if none is set."""
    if not _path or not _snap_dir or not _path.exists():
        return None
    _snap_dir.mkdir(parents=True, exist_ok=True)
    now = time.time()
    for old in _snap_dir.glob("*.txt"):  # sweep copies from finished calls
        try:
            if now - old.stat().st_mtime > 6 * 3600:
                old.unlink()
        except OSError:
            pass
    dest = _snap_dir / f"{uuid.uuid4().hex}.txt"
    with _lock:
        shutil.copyfile(_path, dest)
    return str(dest)
