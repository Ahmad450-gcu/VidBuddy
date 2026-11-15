"""Watch (or listen to) a download while it is still downloading.

A running download writes its parts into the job's temp folder: one file for a single-file
download, or separate video and audio files that are merged at the end. The preview stream
plays whatever has arrived so far:

* Each part file is read with a "follower" that keeps reading as the file grows, the same way
  ``tail -f`` does, and ends once that part is complete or the download stops.
* FFmpeg remuxes the parts (no re-encoding, so it's light) into one fragmented MP4 (or WebM)
  that a browser can play while it is still being produced.

Part files are only ever held open for a single read, with sharing flags that let the downloader
rename, replace and delete them at any moment (on Windows an open file would make yt-dlp's
renames fail and break the download).

FFmpeg reads the parts over HTTP from a tiny server bound to 127.0.0.1 on a random port with a
random path, which lives only as long as the preview: it's the simplest way to give FFmpeg two
"growing" inputs at once on every OS.
"""
from __future__ import annotations

import http.server
import logging
import os
import secrets
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, BinaryIO, Callable, Iterator

log = logging.getLogger("haul.preview")

CHUNK = 256 * 1024
IDLE_LIMIT = 90.0  # stop following a file that hasn't grown for this long
WEBM_CODECS = ("vp8", "vp9", "vp09", "av01", "opus", "vorbis")


class PreviewUnavailable(Exception):
    """Nothing playable yet (or this download can't be previewed)."""


def open_shared(path: str | Path) -> BinaryIO:
    """Open for reading without stopping other processes from renaming or deleting the file."""
    if sys.platform != "win32":
        return open(path, "rb")
    import ctypes
    import msvcrt
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create = kernel32.CreateFileW
    create.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                       wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    create.restype = wintypes.HANDLE
    generic_read, share_all, open_existing, normal = 0x80000000, 0x1 | 0x2 | 0x4, 3, 0x80
    handle = create(str(path), generic_read, share_all, None, open_existing, normal, None)
    if handle in (None, wintypes.HANDLE(-1).value):
        raise FileNotFoundError(ctypes.get_last_error(), "Couldn't open", str(path))
    fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
    return os.fdopen(fd, "rb")


def _read_at(part: dict[str, Any], offset: int, ident: int | None) -> tuple[bytes, int | None, bool]:
    """Read up to CHUNK bytes at ``offset`` -> (data, file identity, replaced or gone?).

    The file is opened for each read and closed straight away, so the downloader is never
    blocked (on Windows an open file can't be overwritten, and yt-dlp replaces the finished
    file when it adds metadata). If the name now points at a different file (a post-processed
    copy), the bytes no longer line up and the caller stops.
    """
    for candidate in (part.get("tmp"), part.get("path")):
        if not candidate:
            continue
        try:
            fh = open_shared(candidate)
        except OSError:
            continue
        with fh:
            current = os.fstat(fh.fileno()).st_ino or None
            if ident is not None and current is not None and current != ident:
                return b"", current, True
            fh.seek(offset)
            return fh.read(CHUNK), current, False
    return b"", ident, offset > 0  # gone: renamed away and cleaned up after finishing


def follow(part: Callable[[], dict[str, Any]], still_downloading: Callable[[], bool], *,
           stopped: threading.Event | None = None, poll: float = 0.4,
           idle_limit: float = IDLE_LIMIT) -> Iterator[bytes]:
    """Yield a growing part file's bytes until it is complete (or the download stops)."""
    offset, ident = 0, None
    idle_since: float | None = None
    first = True
    while not (stopped and stopped.is_set()):
        current = part()
        data, ident, ended = _read_at(current, offset, ident)
        if first and not data and ident is None:
            raise PreviewUnavailable("That part of the download isn't on disk any more.")
        first = False
        if ended:
            return
        if data:
            offset += len(data)
            idle_since = None
            yield data
            continue
        if current.get("done") or not still_downloading():
            return
        now = time.monotonic()
        idle_since = idle_since or now
        if now - idle_since > idle_limit:
            return
        time.sleep(poll)


class _PartServer(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, parts: list[dict[str, Any]], refresh: Callable[[dict[str, Any]], dict[str, Any]],
                 still_downloading: Callable[[], bool]):
        self.parts = parts
        self.refresh = refresh
        self.still_downloading = still_downloading
        self.stopped = threading.Event()
        self.secret = secrets.token_urlsafe(16)
        super().__init__(("127.0.0.1", 0), _PartHandler)

    def url(self, index: int) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}/{self.secret}/{index}"


class _PartHandler(http.server.BaseHTTPRequestHandler):
    server: _PartServer
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # keep logs quiet
        pass

    def do_GET(self):  # noqa: N802
        bits = self.path.strip("/").split("/")
        if len(bits) != 2 or bits[0] != self.server.secret or not bits[1].isdigit() \
                or int(bits[1]) >= len(self.server.parts):
            self.send_error(404)
            return
        initial = self.server.parts[int(bits[1])]
        stream = follow(lambda: self.server.refresh(initial), self.server.still_downloading,
                        stopped=self.server.stopped)
        try:
            data = next(stream, b"")
        except PreviewUnavailable:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        try:
            while data:
                self.wfile.write(b"%x\r\n%s\r\n" % (len(data), data))
                data = next(stream, b"")
            self.wfile.write(b"0\r\n\r\n")
        except OSError:  # FFmpeg went away (preview closed)
            pass
        finally:
            stream.close()


class PreviewUnplayable(PreviewUnavailable):
    """This file's layout needs the whole file before anything can play."""


def index_at_end(part: dict[str, Any]) -> bool:
    """True for a regular MP4/MOV whose index ("moov") comes after the media data.

    Such files (common for direct links) can't be played until the very end has arrived.
    Fragmented MP4 (DASH, most streaming sites), WebM and MPEG-TS all play as they arrive.
    """
    offset, ident = 0, None
    for _ in range(16):  # top-level boxes: ftyp, free, moov/mdat, ...
        head, ident, ended = _read_at(part, offset, ident)
        if ended or len(head) < 8:
            return False
        size = int.from_bytes(head[:4], "big")
        kind = head[4:8]
        if offset == 0 and kind != b"ftyp":
            return False  # not an MP4 at all
        if kind == b"moov":
            return False
        if kind == b"mdat":
            return True
        if size == 1 and len(head) >= 16:
            size = int.from_bytes(head[8:16], "big")
        if size < 8:
            return False
        offset += size
    return False


def choose_parts(parts: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    """The newest file carrying video and the newest carrying audio (one file may do both)."""
    video = next((p for p in reversed(parts) if p.get("video")), None)
    audio = next((p for p in reversed(parts) if p.get("audio")), None)
    if kind == "audio":
        if not audio:
            raise PreviewUnavailable("The audio hasn't started downloading yet.")
        return [audio]
    if not video:
        raise PreviewUnavailable("The video hasn't started downloading yet. Try again in a moment.")
    if not audio or audio is video:
        return [video]
    return [video, audio]


def output_format(chosen: list[dict[str, Any]]) -> tuple[str, str]:
    """(FFmpeg muxer, MIME type). WebM keeps VP8/Vorbis playable; everything else goes in MP4."""
    codecs = [str(p.get(k) or "").lower() for p in chosen for k in ("vcodec", "acodec")
              if p.get(k) not in (None, "none")]
    if codecs and all(c.startswith(WEBM_CODECS) for c in codecs) \
            and any(c.startswith(("vp8", "vorbis")) for c in codecs):
        return "webm", "video/webm"
    video = any(p.get("video") for p in chosen)
    return "mp4", "video/mp4" if video else "audio/mp4"


def ffmpeg_command(ffmpeg: str, inputs: list[str], chosen: list[dict[str, Any]], muxer: str) -> list[str]:
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin"]
    for url in inputs:
        cmd += ["-i", url]
    separate_audio = len(chosen) == 2  # [video, audio]: take sound only from the audio file
    for i, part in enumerate(chosen):
        if part.get("video"):
            cmd += ["-map", f"{i}:v:0?"]
        if part.get("audio") and not (separate_audio and i == 0):
            cmd += ["-map", f"{i}:a:0?"]
    cmd += ["-c", "copy"]
    if muxer == "mp4":
        cmd += ["-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "2000000", "-f", "mp4"]
    else:
        cmd += ["-f", "webm", "-live", "1"]
    return cmd + ["pipe:1"]


class PreviewStream:
    """One running preview: the part server plus the FFmpeg remux reading from it."""

    def __init__(self, ffmpeg: str, parts: list[dict[str, Any]], kind: str,
                 still_downloading: Callable[[], bool],
                 refresh: Callable[[dict[str, Any]], dict[str, Any]] = lambda p: p):
        self.chosen = choose_parts(parts, kind)
        if any(index_at_end(p) for p in self.chosen):
            raise PreviewUnplayable("This download can't be played until it finishes: "
                                    "its file format keeps the index at the end.")
        self.muxer, self.media_type = output_format(self.chosen)
        self.server = _PartServer(self.chosen, refresh, still_downloading)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        cmd = ffmpeg_command(ffmpeg, [self.server.url(i) for i in range(len(self.chosen))], self.chosen, self.muxer)
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=flags)

    def read(self) -> bytes:
        assert self.proc.stdout is not None
        return self.proc.stdout.read1(CHUNK)

    def error(self) -> str:
        try:
            return (self.proc.stderr.read() or b"").decode("utf-8", "replace")[-400:] if self.proc.stderr else ""
        except Exception:
            return ""

    def close(self) -> None:
        self.server.stopped.set()
        if self.proc.poll() is None:
            self.proc.kill()
        try:
            self.proc.wait(timeout=5)
        except Exception:
            pass
        for pipe in (self.proc.stdout, self.proc.stderr):
            try:
                if pipe:
                    pipe.close()
            except Exception:
                pass
        self.server.shutdown()
        self.server.server_close()
