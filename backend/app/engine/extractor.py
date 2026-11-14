"""Metadata extraction and format discovery (yt-dlp, download=False)."""
from __future__ import annotations

import logging
from typing import Any

import yt_dlp

from .errors import EngineError, classify
from . import cookies, gdrive
from .runtime import ffmpeg_location
from .sources import browser_fallbacks, identify, install_browser_choice, remember_browser, tune_for, use_browser

log = logging.getLogger("haul.extractor")
gdrive.install()
install_browser_choice()

AUDIO_TARGETS = [
    {"id": "mp3", "label": "MP3", "lossy": True},
    {"id": "m4a", "label": "M4A (AAC)", "lossy": True},
    {"id": "aac", "label": "AAC", "lossy": True},
    {"id": "opus", "label": "Opus", "lossy": True},
    {"id": "flac", "label": "FLAC", "lossy": False},
    {"id": "wav", "label": "WAV", "lossy": False},
]
AUDIO_BITRATES = [96, 128, 192, 256, 320]
VIDEO_CONTAINERS = ["mp4", "webm", "mkv"]
VIDEO_EXTS = {"mp4", "m4v", "webm", "mkv", "mov", "avi", "flv", "ts", "3gp"}


class _QuietLogger:
    def __init__(self) -> None:
        self.warnings: list[str] = []

    def debug(self, msg: str) -> None:
        pass

    def info(self, msg: str) -> None:
        pass

    def warning(self, msg: str) -> None:
        self.warnings.append(msg)

    def error(self, msg: str) -> None:
        log.debug("yt-dlp error: %s", msg)


def base_options(timeout: int = 30) -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": False,
        "noprogress": True,
        "socket_timeout": timeout,
        "retries": 3,
        "extractor_retries": 2,
        "windowsfilenames": True,
        "noplaylist": True,
        "color": {"stdout": "never", "stderr": "never"},
    }
    ff = ffmpeg_location()
    if ff:
        opts["ffmpeg_location"] = ff
    cookie_file = cookies.snapshot()
    if cookie_file:
        opts["cookiefile"] = cookie_file
    return opts


def _size(f: dict[str, Any], duration: float | None) -> int | None:
    size = f.get("filesize") or f.get("filesize_approx")
    if size:
        return int(size)
    tbr = f.get("tbr")
    if tbr and duration:
        return int(tbr * 1000 / 8 * duration)
    return None


def normalize_format(f: dict[str, Any], duration: float | None) -> dict[str, Any]:
    # yt-dlp uses the string "none" for "definitely absent" and omits the key when unknown.
    raw_v, raw_a = f.get("vcodec"), f.get("acodec")
    vcodec = raw_v or "none"
    acodec = raw_a or "none"
    ext = (f.get("ext") or "").lower()
    if raw_v is None:  # unknown (direct links, generic HLS): infer from dimensions/extension
        has_video = bool(f.get("height") or f.get("width")) or ext in VIDEO_EXTS or f.get("video_ext") not in (None, "none")
    else:
        has_video = raw_v != "none"
    if raw_a is None:  # unknown: muxed media files almost always carry audio
        has_audio = True
    else:
        has_audio = raw_a != "none"
    return {
        "format_id": str(f.get("format_id")),
        "ext": f.get("ext"),
        "height": f.get("height"),
        "width": f.get("width"),
        "fps": f.get("fps"),
        "vcodec": None if vcodec == "none" else vcodec,
        "acodec": None if acodec == "none" else acodec,
        "abr": f.get("abr"),
        "tbr": f.get("tbr"),
        "filesize": _size(f, duration),
        "exact_size": bool(f.get("filesize")),
        "protocol": f.get("protocol"),
        "note": f.get("format_note"),
        "has_video": bool(has_video),
        "has_audio": bool(has_audio),
        "dynamic_range": f.get("dynamic_range"),
        "language": f.get("language"),
    }


def _codec_family(vcodec: str | None) -> str | None:
    if not vcodec:
        return None
    v = vcodec.lower()
    for prefix, fam in (("avc", "H.264"), ("h264", "H.264"), ("hev", "H.265"), ("hvc", "H.265"), ("vp09", "VP9"),
                        ("vp9", "VP9"), ("av01", "AV1"), ("vp8", "VP8")):
        if v.startswith(prefix):
            return fam
    return vcodec.split(".")[0].upper()


def build_presets(formats: list[dict[str, Any]], duration: float | None) -> dict[str, Any]:
    audio_only = [f for f in formats if f["has_audio"] and not f["has_video"]]
    best_audio = max(audio_only, key=lambda f: (f["abr"] or f["tbr"] or 0), default=None)
    audio_size = best_audio["filesize"] if best_audio else None

    by_height: dict[int, list[dict[str, Any]]] = {}
    for f in formats:
        if f["has_video"] and f["height"]:
            by_height.setdefault(int(f["height"]), []).append(f)

    video: list[dict[str, Any]] = []
    for h in sorted(by_height, reverse=True):
        group = by_height[h]
        top = max(group, key=lambda f: ((f["fps"] or 0), (f["tbr"] or 0)))
        size = top["filesize"]
        if size and not top["has_audio"] and audio_size:
            size += audio_size
        fps = int(top["fps"]) if top["fps"] else None
        video.append({
            "id": f"h{h}",
            "height": h,
            "label": f"{h}p" + (str(fps) if fps and fps > 30 else ""),
            "fps": fps,
            "codecs": sorted({c for c in (_codec_family(g["vcodec"]) for g in group) if c}),
            "hdr": any((g.get("dynamic_range") or "SDR") != "SDR" for g in group),
            "size_estimate": size,
        })

    if not video and any(f["has_video"] for f in formats):
        best = max((f for f in formats if f["has_video"]), key=lambda f: f["tbr"] or 0)
        video.append({"id": "best", "height": None, "label": "Original", "fps": best["fps"], "codecs": [],
                      "hdr": False, "size_estimate": best["filesize"]})

    return {
        "video": video,
        "audio": {
            "targets": AUDIO_TARGETS,
            "bitrates": AUDIO_BITRATES,
            "source_abr": best_audio["abr"] if best_audio else None,
            "source_codec": best_audio["acodec"] if best_audio else None,
            "size_estimate": audio_size,
        },
        "containers": VIDEO_CONTAINERS,
        "has_video": bool(video),
        "has_audio": bool(best_audio) or any(f["has_audio"] for f in formats),
    }


def _thumb(info: dict[str, Any]) -> str | None:
    if info.get("thumbnail"):
        return info["thumbnail"]
    thumbs = info.get("thumbnails") or []
    thumbs = [t for t in thumbs if t.get("url")]
    if not thumbs:
        return None
    return max(thumbs, key=lambda t: (t.get("preference") or 0, t.get("width") or 0))["url"]


def _subtitle_langs(info: dict[str, Any]) -> dict[str, list[str]]:
    return {
        "manual": sorted((info.get("subtitles") or {}).keys()),
        "automatic": sorted((info.get("automatic_captions") or {}).keys())[:60],
    }


def analyze(url: str, *, timeout: int = 30, max_playlist_items: int = 500) -> dict[str, Any]:
    """Return a normalized description of what can be downloaded from ``url``."""
    source = identify(url)
    logger = _QuietLogger()
    opts = base_options(timeout)
    opts.update({
        "logger": logger,
        "skip_download": True,
        "extract_flat": "in_playlist",
        "noplaylist": False,
        "playlistend": max_playlist_items,
        "lazy_playlist": False,
    })
    tune_for(url, opts, source.extractor if source.extractor != "Generic" else None)
    fallbacks: list[str] | None = None
    while True:
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
                info = ydl.sanitize_info(info)
            remember_browser(url, opts)
            break
        except EngineError:
            raise
        except Exception as e:  # DownloadError, or extractor bugs as arbitrary exceptions
            err = classify(e)
            if fallbacks is None:
                fallbacks = browser_fallbacks(url, opts, err.code, err.detail)
            if fallbacks:
                client = fallbacks.pop(0)
                log.info("%s refused the request; retrying as %s", source.domain, client or "Chrome")
                use_browser(opts, client)
                continue
            raise err from e
    if not info:
        raise EngineError("unavailable", "Nothing downloadable was found at this link.")

    if info.get("_type") in ("playlist", "multi_video") or info.get("entries") is not None:
        entries = []
        for i, e in enumerate(info.get("entries") or []):
            if not e:
                continue
            entry_url = e.get("url") or e.get("webpage_url")
            if entry_url and not entry_url.startswith("http"):
                entry_url = e.get("webpage_url") or None
            if not entry_url:
                continue
            entries.append({
                "index": i + 1,
                "id": e.get("id"),
                "url": entry_url,
                "title": e.get("title") or f"Item {i + 1}",
                "duration": e.get("duration"),
                "thumbnail": _thumb(e),
                "uploader": e.get("uploader") or e.get("channel"),
            })
        return {
            "type": "playlist",
            "url": url,
            "source": source.as_dict(),
            "id": info.get("id"),
            "title": info.get("title") or "Playlist",
            "uploader": info.get("uploader") or info.get("channel"),
            "thumbnail": _thumb(info) or next((e["thumbnail"] for e in entries if e["thumbnail"]), None),
            "entry_count": len(entries),
            "entries": entries,
            "warnings": logger.warnings[-5:],
        }

    if info.get("is_live"):
        raise EngineError("live", "Live streams that haven't finished can't be downloaded yet.")
    duration = info.get("duration")
    raw_formats = info.get("formats") or ([info] if info.get("url") else [])
    formats = [normalize_format(f, duration) for f in raw_formats
               if f.get("format_id") and f.get("ext") not in ("mhtml",) and "storyboard" not in (f.get("format_note") or "")]
    if not formats:
        raise EngineError("unavailable", "No downloadable formats were found for this media.")
    if any(f.get("has_drm") for f in raw_formats) and all(f.get("has_drm") for f in raw_formats):
        raise EngineError("drm", "This media is DRM-protected and can't be downloaded.")
    return {
        "type": "media",
        "url": info.get("webpage_url") or url,
        "source": source.as_dict(),
        "id": info.get("id"),
        "title": info.get("title") or info.get("id") or "Untitled",
        "uploader": info.get("uploader") or info.get("channel") or info.get("artist"),
        "thumbnail": _thumb(info),
        "duration": duration,
        "upload_date": info.get("upload_date"),
        "view_count": info.get("view_count"),
        "description": (info.get("description") or "")[:1200],
        "formats": formats,
        "presets": build_presets(formats, duration),
        "subtitles": _subtitle_langs(info),
        "warnings": logger.warnings[-5:],
    }
