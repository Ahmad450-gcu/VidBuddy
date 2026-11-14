"""Discovery of external tools the engine depends on (FFmpeg, JS runtime)."""
from __future__ import annotations

import shutil
from pathlib import Path
from functools import lru_cache

from ..config import get_settings


@lru_cache
def ffmpeg_location() -> str | None:
    s = get_settings()
    if s.ffmpeg_path:
        return s.ffmpeg_path
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:  # bundled static build as a fallback (ffmpeg only, no ffprobe)
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


@lru_cache
def has_ffprobe() -> bool:
    loc = ffmpeg_location()
    if not loc:
        return False
    if shutil.which("ffprobe"):
        return True
    from pathlib import Path

    p = Path(loc)
    return any((p.parent / n).exists() for n in ("ffprobe", "ffprobe.exe"))


@lru_cache
def js_runtimes() -> dict[str, dict]:
    """yt-dlp needs a JS runtime for full YouTube support. Prefer deno, then node, bun."""
    s = get_settings()
    if s.js_runtime:
        name = s.js_runtime
        for rt in ("deno", "node", "bun", "quickjs"):
            if rt in name.lower():
                return {rt: {"path": name} if ("/" in name or "\\" in name) else {}}
    for rt in ("deno", "node", "bun"):
        path = shutil.which(rt)
        if path:
            return {rt: {"path": path}}
    return {}


def engine_versions() -> dict[str, str | None]:
    import yt_dlp.version

    try:
        import yt_dlp_ejs  # noqa: F401
        from importlib.metadata import version

        ejs = version("yt-dlp-ejs")
    except Exception:
        ejs = None
    try:
        from importlib.metadata import version

        cffi = version("curl_cffi")
    except Exception:
        cffi = None
    return {
        "yt_dlp": yt_dlp.version.__version__,
        "yt_dlp_ejs": ejs,
        "curl_cffi": cffi,
        "ffmpeg": ffmpeg_location(),
        "ffprobe": "available" if has_ffprobe() else None,
        "js_runtime": next(iter(js_runtimes()), None),
    }


def extract_frame(video: "Path", dest: "Path", at: float | None) -> bool:
    """Grab a single poster frame with FFmpeg (argument list, never a shell string)."""
    import subprocess

    ff = ffmpeg_location()
    if not ff:
        return False
    ts = max(0.0, (at or 10) * 0.1) if at else 1.0
    cmd = [ff, "-nostdin", "-loglevel", "error", "-y", "-ss", f"{ts:.2f}", "-i", str(video),
           "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", str(dest)]
    try:
        subprocess.run(cmd, check=True, timeout=30, capture_output=True)
        return dest.exists() and dest.stat().st_size > 0
    except (subprocess.SubprocessError, OSError):
        return False


def reveal_in_explorer(path: "Path", select: bool = True) -> None:
    """Open a folder (or select a file in it) in the system file manager."""
    import os
    import subprocess
    import sys

    path = Path(path)
    if sys.platform == "win32":
        if select and path.is_file():
            subprocess.Popen(["explorer", f"/select,{path}"])
        else:
            os.startfile(str(path))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(path)] if select else ["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path.parent if select else path)])
