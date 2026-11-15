"""Shared fixtures: an isolated app instance and a local media server.

The local server serves real media files (generated with FFmpeg) with HTTP Range support
and optional throttling. That lets the suite exercise genuine download, pause/resume,
failure and retry paths deterministically, without depending on third-party sites.
"""
from __future__ import annotations

import http.server
import os
import subprocess
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.engine.runtime import ffmpeg_location

ASSETS = Path(__file__).parent / "_assets"


def _make_media() -> dict[str, Path]:
    ASSETS.mkdir(exist_ok=True)
    ff = ffmpeg_location()
    assert ff, "FFmpeg is required for the test suite"
    out = {
        "small": ASSETS / "small.mp4",
        "large": ASSETS / "large.mp4",
        "page": ASSETS / "page.html",
    }
    if not out["small"].exists():
        subprocess.run([ff, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=15",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-shortest", str(out["small"])], check=True)
    if not out["large"].exists():
        # ~6 MB of high-entropy video so throttled transfers take several seconds
        subprocess.run([ff, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=duration=20:size=640x360:rate=25",
                        "-f", "lavfi", "-i", "anoisesrc=duration=20", "-c:v", "libx264", "-preset", "ultrafast",
                        "-b:v", "2400k", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(out["large"])], check=True)
    # Same video as a fragmented MP4 (index first), the layout streaming sites and DASH use.
    out["large_frag"] = ASSETS / "large_frag.mp4"
    if not out["large_frag"].exists():
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(out["large"]), "-c", "copy",
                        "-movflags", "frag_keyframe+empty_moov+default_base_moof", str(out["large_frag"])], check=True)
    hls = ASSETS / "hls"
    if not (hls / "index.m3u8").exists():
        hls.mkdir(exist_ok=True)
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(out["small"]), "-c", "copy", "-f", "hls",
                        "-hls_time", "1", "-hls_list_size", "0", "-hls_segment_filename", str(hls / "seg%d.ts"),
                        str(hls / "index.m3u8")], check=True)
    out["hls"] = hls / "index.m3u8"
    # Audio in its own rendition and no CODECS in the master playlist, as many web players do.
    split = ASSETS / "hls_split"
    if not (split / "master.m3u8").exists():
        split.mkdir(exist_ok=True)
        subprocess.run([ff, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=4:size=320x240:rate=15",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", "-f", "hls", "-hls_list_size", "0",
                        "-hls_segment_filename", str(split / "v%d.ts"), str(split / "video.m3u8")], check=True)
        subprocess.run([ff, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
                        "-c:a", "aac", "-vn", "-f", "hls", "-hls_list_size", "0",
                        "-hls_segment_filename", str(split / "a%d.aac"), str(split / "audio.m3u8")], check=True)
        (split / "master.m3u8").write_text(
            "#EXTM3U\n"
            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",LANGUAGE="eng",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"\n'
            '#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=320x240,AUDIO="aud"\n'
            "video.m3u8\n")
    out["hls_split"] = split / "master.m3u8"
    # One video, two audio languages. Hindi is 22.05 kHz, English 44.1 kHz, so a test can tell
    # from the finished file which language was merged in.
    multi = ASSETS / "hls_multi"
    if not (multi / "master.m3u8").exists():
        multi.mkdir(exist_ok=True)
        subprocess.run([ff, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=4:size=320x240:rate=15",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", "-f", "hls", "-hls_list_size", "0",
                        "-hls_segment_filename", str(multi / "v%d.ts"), str(multi / "video.m3u8")], check=True)
        for lang, rate in (("en", "44100"), ("hi", "22050")):
            subprocess.run([ff, "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"sine=frequency=440:duration=4:sample_rate={rate}",
                            "-c:a", "aac", "-vn", "-f", "hls", "-hls_list_size", "0",
                            "-hls_segment_filename", str(multi / f"{lang}%d.aac"), str(multi / f"audio_{lang}.m3u8")],
                           check=True)
        (multi / "master.m3u8").write_text(
            "#EXTM3U\n"
            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",LANGUAGE="en",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="audio_en.m3u8"\n'
            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",LANGUAGE="hi",NAME="Hindi",DEFAULT=NO,AUTOSELECT=YES,URI="audio_hi.m3u8"\n'
            '#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=320x240,AUDIO="aac"\n'
            "video.m3u8\n")
    out["hls_multi"] = multi / "master.m3u8"
    out["page"].write_text("<html><head><title>No media here</title></head><body><p>Just text.</p></body></html>")
    return out


GUARD_REFERER = "https://player.example/watch"


class _Handler(http.server.SimpleHTTPRequestHandler):
    throttle_bps: int = 0
    fail_paths: set[str] = set()
    seen_headers: list[dict[str, str]] = []

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ASSETS), **kw)

    def log_message(self, *a):  # keep test output clean
        pass

    def do_GET(self):  # noqa: N802
        path = self.path.split("?")[0]
        if path in self.fail_paths:
            self.send_error(404, "Not Found")
            return
        # /guarded/... behaves like a player's CDN: it only answers requests with the right Referer.
        if path.startswith("/guarded/"):
            _Handler.seen_headers.append(dict(self.headers))
            if self.headers.get("Referer") != GUARD_REFERER or self.headers.get("X-Token") != "abc123":
                self.send_error(403, "Forbidden")
                return
        f = Path(ASSETS / path.lstrip("/").replace("guarded/", "").replace("slow/", ""))
        if not f.is_file():
            self.send_error(404)
            return
        data_len = f.stat().st_size
        start, end = 0, data_len - 1
        rng = self.headers.get("Range")
        if rng and rng.startswith("bytes="):
            s, _, e = rng[6:].partition("-")
            start = int(s) if s else 0
            end = int(e) if e else data_len - 1
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{data_len}")
        else:
            self.send_response(200)
        ctype = {".html": "text/html", ".m3u8": "application/vnd.apple.mpegurl",
                 ".ts": "video/mp2t", ".aac": "audio/aac"}.get(f.suffix, "video/mp4")
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        slow = "/slow/" in path
        with f.open("rb") as fh:
            fh.seek(start)
            remaining = end - start + 1
            chunk = 64 * 1024
            while remaining > 0:
                buf = fh.read(min(chunk, remaining))
                if not buf:
                    break
                try:
                    self.wfile.write(buf)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    return
                remaining -= len(buf)
                if slow:
                    time.sleep(len(buf) / (1024 * 1024))  # ~1 MiB/s


@pytest.fixture(scope="session")
def media_server():
    files = _make_media()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    yield {"base": base, "files": files, "handler": _Handler}
    srv.shutdown()


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(data_dir=tmp_path / "data", allow_private_networks=True, max_auto_retries=0,
                    rate_limit_per_minute=0, max_concurrent_downloads=2, api_token=None)


@pytest.fixture
def client(settings):
    from app.engine import runtime
    runtime.ffmpeg_location.cache_clear()
    from app.main import create_app

    app = create_app(settings)
    with TestClient(app) as c:
        yield c


def wait_for(client: TestClient, job_id: str, statuses: set[str], timeout: float = 60.0) -> dict:
    deadline = time.time() + timeout
    job = {}
    while time.time() < deadline:
        job = client.get(f"/api/downloads/{job_id}").json()
        if job["status"] in statuses:
            return job
        time.sleep(0.25)
    raise AssertionError(f"Job {job_id} stuck in {job.get('status')} (stage={job.get('stage')}, err={job.get('error')})")


network = pytest.mark.skipif(os.environ.get("HAUL_NETWORK_TESTS") != "1",
                             reason="set HAUL_NETWORK_TESTS=1 to run tests against live sites")
