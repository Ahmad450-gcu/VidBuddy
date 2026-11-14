"""Download execution: format selection, progress reporting, post-processing.

Each job runs yt-dlp in a worker thread. Cancellation and pause are cooperative: the
progress hook raises ``JobInterrupted`` the next time yt-dlp reports bytes. Partial
``.part`` files stay in the job's temp folder so a resumed job continues with
``continuedl`` rather than starting over.
"""
from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import yt_dlp

from .errors import EngineError, classify
from .extractor import _QuietLogger, base_options
from .security import UnsafeInputError, validate_template
from .sources import tune_for

log = logging.getLogger("haul.downloader")

_FORMAT_ID = re.compile(r"^[A-Za-z0-9_\-.+/]{1,80}$")
EMBED_THUMB_AUDIO = {"mp3", "m4a", "opus", "flac"}


class JobInterrupted(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason  # "pause" | "cancel"


@dataclass
class DownloadOptions:
    kind: str = "video"  # video | audio
    quality: str = "best"  # best | h<height> | fmt:<format_id>
    container: str = "mp4"
    audio_format: str = "mp3"
    audio_bitrate: int = 0  # 0 = best/VBR
    subtitles: bool = False
    subtitle_langs: list[str] = field(default_factory=lambda: ["en"])
    auto_subtitles: bool = False
    embed_metadata: bool = True
    embed_thumbnail: bool = True
    filename_template: str | None = None
    max_filesize_mb: int = 0
    rate_limit_kbps: int = 0

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "DownloadOptions":
        known = {k: v for k, v in (d or {}).items() if k in cls.__dataclass_fields__}
        return cls(**known)


@dataclass
class Progress:
    downloaded: int = 0
    total: int | None = None
    speed: float | None = None
    eta: int | None = None
    stage: str = "downloading"
    fraction: float = 0.0


@dataclass
class DownloadResult:
    filepath: Path
    info: dict[str, Any]
    subtitles: list[Path]
    thumbnail_bytes: bytes | None
    thumbnail_ext: str | None


def format_spec(o: DownloadOptions) -> tuple[str, list[str]]:
    """Return (format selector, format_sort) for the requested quality."""
    if o.kind == "audio":
        return "ba/b", ["abr", "asr"]
    q = o.quality or "best"
    if q.startswith("fmt:"):
        fid = q[4:]
        if not _FORMAT_ID.match(fid):
            raise UnsafeInputError("Invalid format id.")
        return (fid if "+" in fid else f"{fid}+ba/{fid}"), []
    sort: list[str] = []
    if q.startswith("h") and q[1:].isdigit():
        sort.append(f"res:{int(q[1:])}")
    elif q != "best":
        raise UnsafeInputError("Invalid quality option.")
    if o.container == "mp4":
        sort += ["vcodec:h264", "acodec:aac"]  # broadest playback (incl. iOS Safari)
    elif o.container == "webm":
        sort += ["vcodec:vp9", "acodec:opus"]
    return "bv*+ba/b", sort


def build_options(o: DownloadOptions, *, home: Path, temp: Path) -> dict[str, Any]:
    if o.kind not in ("video", "audio"):
        raise UnsafeInputError("Invalid download type.")
    if o.container not in ("mp4", "webm", "mkv"):
        raise UnsafeInputError("Unsupported container.")
    if o.audio_format not in ("mp3", "m4a", "aac", "opus", "flac", "wav", "best"):
        raise UnsafeInputError("Unsupported audio format.")
    template = validate_template(o.filename_template)
    fmt, sort = format_spec(o)
    opts = base_options(30)
    opts.update({
        "format": fmt,
        "format_sort": sort,
        "paths": {"home": str(home.resolve()), "temp": str(temp.resolve())},
        "outtmpl": {"default": template, "thumbnail": "", "pl_thumbnail": ""},
        "continuedl": True,
        "nopart": False,
        "overwrites": False,
        "retries": 5,
        "fragment_retries": 8,
        "concurrent_fragment_downloads": 4,
        "writethumbnail": False,
        "postprocessors": [],
        "trim_file_name": 200,
    })
    pps: list[dict[str, Any]] = opts["postprocessors"]
    if o.max_filesize_mb > 0:
        opts["max_filesize"] = o.max_filesize_mb * 1024 * 1024
    if o.rate_limit_kbps > 0:
        opts["ratelimit"] = o.rate_limit_kbps * 1024

    if o.kind == "video":
        opts["merge_output_format"] = o.container
        if o.embed_metadata:
            pps.append({"key": "FFmpegMetadata", "add_metadata": True, "add_chapters": True})
    else:
        pps.append({
            "key": "FFmpegExtractAudio",
            "preferredcodec": o.audio_format,
            "preferredquality": str(o.audio_bitrate) if o.audio_bitrate else "0",
        })
        if o.embed_metadata:
            pps.append({"key": "FFmpegMetadata", "add_metadata": True})
        if o.embed_thumbnail and o.audio_format in EMBED_THUMB_AUDIO:
            opts["writethumbnail"] = True
            pps.insert(0, {"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"})
            pps.append({"key": "EmbedThumbnail", "already_have_thumbnail": False})
    return opts


ProgressCb = Callable[[Progress], None]


def run_download(
    url: str,
    options: DownloadOptions,
    *,
    home: Path,
    temp: Path,
    on_progress: ProgressCb,
    should_stop: Callable[[], str | None],
) -> DownloadResult:
    home.mkdir(parents=True, exist_ok=True)
    temp.mkdir(parents=True, exist_ok=True)
    opts = build_options(options, home=home, temp=temp)
    logger = _QuietLogger()
    opts["logger"] = logger
    tune_for(url, opts)

    parts: dict[str, tuple[int, int | None]] = {}
    expected_parts = [1]
    last_emit = [0.0]

    def hook(d: dict[str, Any]) -> None:
        reason = should_stop()
        if reason:
            raise JobInterrupted(reason)
        status = d.get("status")
        info = d.get("info_dict") or {}
        req = info.get("requested_formats")
        if req:
            expected_parts[0] = len(req)
        name = d.get("filename") or d.get("tmpfilename") or "f"
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            parts[name] = (int(d.get("downloaded_bytes") or 0), int(total) if total else None)
        elif status == "finished":
            done = int(d.get("total_bytes") or d.get("downloaded_bytes") or 0)
            parts[name] = (done, done)
        now = time.monotonic()
        if status == "downloading" and now - last_emit[0] < 0.4:
            return
        last_emit[0] = now
        downloaded = sum(p[0] for p in parts.values())
        totals = [p[1] for p in parts.values()]
        total = sum(t for t in totals if t) if all(totals) else None
        frac = 0.0
        if total:
            # parts not started yet count as unknown; scale by how many parts we have seen
            frac = (downloaded / total) * (len(parts) / max(expected_parts[0], len(parts)))
        elif d.get("fragment_count"):
            frac = (d.get("fragment_index") or 0) / d["fragment_count"]
        if total and len(parts) < expected_parts[0]:
            total = None  # still unknown overall
        on_progress(Progress(
            downloaded=downloaded, total=total, speed=d.get("speed"), eta=d.get("eta"),
            stage="downloading", fraction=min(frac, 0.999),
        ))

    def pp_hook(d: dict[str, Any]) -> None:
        if d.get("status") != "started":
            return
        name = d.get("postprocessor") or ""
        stage = {
            "Merger": "merging", "ExtractAudio": "converting", "FFmpegExtractAudio": "converting",
            "EmbedThumbnail": "embedding", "FFmpegMetadata": "tagging", "Metadata": "tagging",
            "MoveFiles": "finalizing", "MoveFilesAfterDownload": "finalizing",
        }.get(name, "processing")
        on_progress(Progress(stage=stage, fraction=0.999))

    opts["progress_hooks"] = [hook]
    opts["postprocessor_hooks"] = [pp_hook]

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            if not info:
                raise EngineError("unavailable", "Nothing was downloaded.")
            if info.get("_type") == "playlist":
                raise EngineError("unsupported", "Playlists must be queued per item.")
            reason = should_stop()
            if reason:
                raise JobInterrupted(reason)
            downloads = info.get("requested_downloads") or []
            fp = downloads[0].get("filepath") if downloads else info.get("filepath")
            if not fp or not Path(fp).exists():
                raise EngineError("processing", "The download finished but the output file is missing.",
                                  "; ".join(logger.warnings[-3:]))
            filepath = Path(fp)
            thumb_bytes, thumb_ext = _fetch_thumbnail(ydl, info)
            subs: list[Path] = []
            if options.subtitles and options.kind == "video":
                on_progress(Progress(stage="subtitles", fraction=0.999))
                subs = fetch_subtitles(url, options, filepath, should_stop)
            return DownloadResult(filepath, ydl.sanitize_info(info), subs, thumb_bytes, thumb_ext)
    except JobInterrupted:
        raise
    except yt_dlp.utils.DownloadCancelled as e:
        raise classify(e) from e
    except yt_dlp.utils.DownloadError as e:
        # a JobInterrupted raised inside a hook can be wrapped by yt-dlp
        if isinstance(getattr(e, "exc_info", (None, None))[1], JobInterrupted):
            raise e.exc_info[1]  # type: ignore[misc]
        reason = should_stop()
        if reason:
            raise JobInterrupted(reason) from e
        raise classify(e) from e
    except (EngineError, UnsafeInputError):
        raise
    except Exception as e:
        reason = should_stop()
        if reason:
            raise JobInterrupted(reason) from e
        log.exception("Unexpected download failure")
        raise classify(e) from e


def glob_escape(s: str) -> str:
    return re.sub(r"([\[\]*?])", r"[\1]", s)


def _fetch_thumbnail(ydl: yt_dlp.YoutubeDL, info: dict[str, Any]) -> tuple[bytes | None, str | None]:
    url = info.get("thumbnail")
    if not url:
        return None, None
    try:
        with ydl.urlopen(url) as resp:
            data = resp.read(5 * 1024 * 1024 + 1)
            if len(data) > 5 * 1024 * 1024:
                return None, None
            ctype = (resp.headers.get("Content-Type") or "").lower()
        ext = "webp" if "webp" in ctype else "png" if "png" in ctype else "jpg"
        return data, ext
    except Exception as e:  # thumbnails are best-effort
        log.info("Thumbnail fetch failed: %s", e)
        return None, None


def fetch_subtitles(url: str, o: DownloadOptions, media: Path, should_stop: Callable[[], str | None],
                    errors: list[str] | None = None) -> list[Path]:
    """Best-effort sidecar subtitles (WebVTT) next to the media file.

    Runs as a separate pass so a flaky subtitle host can never fail or stall the media itself.
    """
    if should_stop():
        return []
    langs = [l for l in o.subtitle_langs if re.fullmatch(r"[A-Za-z0-9\-_.*]{1,20}", l)] or ["en"]
    pattern = glob_escape(media.stem) + ".*.vtt"
    # Manual first, then automatic captions as a fallback: if someone asked for subtitles they
    # would rather get auto captions than nothing. (When the picked track is automatic only,
    # skip the manual pass entirely.)
    manual = {"writesubtitles": True, "writeautomaticsub": False}
    auto = {"writesubtitles": False, "writeautomaticsub": True}
    passes = [auto] if o.auto_subtitles else [manual, auto]
    for p in passes:
        if should_stop():
            break
        opts = base_options(30)
        opts.update(p)
        opts.update({
            "logger": _QuietLogger(),
            "skip_download": True,
            "subtitleslangs": langs,
            "retries": 3,
            "fragment_retries": 3,
            "outtmpl": {"default": str(media.with_suffix("")) + ".%(ext)s"},
            "postprocessors": [{"key": "FFmpegSubtitlesConvertor", "format": "vtt", "when": "before_dl"}],
        })
        tune_for(url, opts)
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.extract_info(url, download=True)
        except Exception as e:
            log.info("Subtitle pass failed for %s: %s", url, str(e)[:200])
            if errors is not None:
                errors.append(str(e))
        if any(media.parent.glob(pattern)):
            break
    return sorted(media.parent.glob(pattern))
