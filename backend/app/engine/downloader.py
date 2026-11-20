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
from . import liverange
from .headers import apply_headers, clean_headers
from .security import UnsafeInputError, validate_template
from .sources import browser_fallbacks, remember_browser, tune_for, use_browser

log = logging.getLogger("haul.downloader")

_FORMAT_ID = re.compile(r"^[A-Za-z0-9_\-.+/]{1,80}$")
EMBED_THUMB_AUDIO = {"mp3", "m4a", "opus", "flac"}


# ------------------------------------------------------------- watch while downloading
# The files a running download is writing (in its temp folder), and which of them carry video
# and/or audio, so the preview stream can play what has arrived so far. Keyed by temp folder.
_live: dict[str, dict[str, dict[str, Any]]] = {}


def live_parts(temp: Path) -> list[dict[str, Any]]:
    return list((_live.get(str(temp.resolve())) or {}).values())


def _has(codec: Any) -> bool:
    return codec != "none"  # unknown (None) counts as present


_audio_first_installed = False


def install_audio_first() -> None:
    """Download the audio track before the video when both are fetched separately.

    yt-dlp fetches the parts of a "video+audio" download one after another, video first. Audio
    is small, so fetching it first means a preview of the half-downloaded video has sound
    almost immediately. Only download jobs ask for this (``_vb_audio_first``).
    """
    global _audio_first_installed
    if _audio_first_installed:
        return
    _audio_first_installed = True
    original = yt_dlp.YoutubeDL.process_info

    def process_info(self, info_dict):
        req = info_dict.get("requested_formats")
        if (self.params.get("_vb_audio_first") and isinstance(req, (list, tuple)) and len(req) == 2
                and req[0].get("acodec") == "none" and req[0].get("vcodec") != "none"
                and req[1].get("vcodec") == "none" and req[1].get("acodec") != "none"):
            info_dict["requested_formats"] = [req[1], req[0]]
        return original(self, info_dict)

    yt_dlp.YoutubeDL.process_info = process_info


install_audio_first()
liverange.install()


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
    headers: dict[str, str] = field(default_factory=dict)  # custom request headers (Referer, ...)
    # A specific audio track (format id) to merge with the video, e.g. one language of several.
    # None = the best audio. Falls back to the best audio if the site stops offering that track.
    audio_format_id: str | None = None
    # Position in a playlist/course ("01. Introduction") and the playlist's length (for padding).
    playlist_index: int | None = None
    playlist_size: int | None = None
    # Sub-folder (the playlist or course name) inside the download folder.
    folder: str | None = None
    # Only this part of the media, in seconds from the start (None = from the start / to the end).
    section_start: float | None = None
    section_end: float | None = None

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


def _audio_track(o: DownloadOptions) -> str | None:
    aid = (o.audio_format_id or "").strip()
    if not aid:
        return None
    if not _FORMAT_ID.match(aid) or "+" in aid or "/" in aid:
        raise UnsafeInputError("Invalid audio track.")
    return aid


def _clock(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600:02d}-{s % 3600 // 60:02d}-{s % 60:02d}"


def section(o: DownloadOptions) -> tuple[float, float | None] | None:
    """The requested time range, validated; None for the whole media."""
    start, end = o.section_start, o.section_end
    if start is None and end is None:
        return None
    try:
        start = float(start or 0)
        end = None if end is None else float(end)
    except (TypeError, ValueError):
        raise UnsafeInputError("Invalid time range.") from None
    if start < 0 or (end is not None and (end <= start or end > 10_000 * 3600)) or start > 10_000 * 3600:
        raise UnsafeInputError("The end time must be after the start time.")
    if start == 0 and end is None:
        return None
    return start, end


def folder_name(name: str | None) -> str | None:
    """A playlist/course title made safe to use as one folder name."""
    from .security import sanitize_filename

    name = (name or "").strip()
    if not name:
        return None
    clean = sanitize_filename(name, max_len=100, fallback="").strip(" .")
    return clean or None


def format_spec(o: DownloadOptions) -> tuple[str, list[str]]:
    """Return (format selector, format_sort) for the requested quality (and audio track)."""
    aid = _audio_track(o)
    if o.kind == "audio":
        return (f"{aid}/ba/b" if aid else "ba/b"), ["abr", "asr"]
    q = o.quality or "best"
    if q.startswith("fmt:"):
        fid = q[4:]
        if not _FORMAT_ID.match(fid):
            raise UnsafeInputError("Invalid format id.")
        if aid:  # exactly this video with exactly this audio, e.g. 600+aac-6._Hindi
            video = fid.split("+")[0].split("/")[0]
            return f"{video}+{aid}/{video}+ba/{video}", []
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
    if aid:  # a video-only stream first, so the chosen track is the file's only audio
        return f"bv+{aid}/bv*+{aid}/bv*+ba/b", sort
    return "bv*+ba/b", sort


def build_options(o: DownloadOptions, *, home: Path, temp: Path) -> dict[str, Any]:
    if o.kind not in ("video", "audio"):
        raise UnsafeInputError("Invalid download type.")
    if o.container not in ("mp4", "webm", "mkv"):
        raise UnsafeInputError("Unsupported container.")
    if o.audio_format not in ("mp3", "m4a", "aac", "opus", "flac", "wav", "best"):
        raise UnsafeInputError("Unsupported audio format.")
    template = validate_template(o.filename_template)
    aid = _audio_track(o)
    stem = template[: -len(".%(ext)s")]
    if aid:  # each language gets its own file instead of reusing the one already downloaded
        stem += f" [{aid}]"
    cut = section(o)
    if cut:  # each clip gets its own file too
        stem += f" [{_clock(cut[0])} to {_clock(cut[1]) if cut[1] is not None else 'end'}]"
    if o.playlist_index is not None:
        index = int(o.playlist_index)
        if not 0 < index < 100000:
            raise UnsafeInputError("Invalid playlist position.")
        width = max(2, len(str(int(o.playlist_size or 0))))
        stem = f"{index:0{width}d}. {stem}"  # files sort in course order: "01. Introduction"
    template = stem + ".%(ext)s"
    o.headers = clean_headers(o.headers)
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
    apply_headers(opts, o.headers)
    # A live stream is recorded from its beginning (YouTube keeps it), not from "now".
    opts["live_from_start"] = True
    if cut:
        start, end = cut
        opts["download_ranges"] = liverange.Ranges(start, end)
        opts[liverange.PARAM] = (start, end)  # live streams: only the segments in the range
    pps: list[dict[str, Any]] = opts["postprocessors"]
    if o.max_filesize_mb > 0:
        opts["max_filesize"] = o.max_filesize_mb * 1024 * 1024
    if o.rate_limit_kbps > 0:
        opts["ratelimit"] = o.rate_limit_kbps * 1024

    if o.kind == "video":
        opts["merge_output_format"] = o.container
        opts["_vb_audio_first"] = True
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
    live = _live.setdefault(str(temp.resolve()), {})
    live.clear()
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
        if status in ("downloading", "finished") and d.get("filename"):
            live[name] = {
                "path": d["filename"], "tmp": d.get("tmpfilename"), "done": status == "finished",
                "video": _has(info.get("vcodec")) and info.get("video_ext") != "none",
                "audio": _has(info.get("acodec")),
                "vcodec": info.get("vcodec"), "acodec": info.get("acodec"), "ext": info.get("ext"),
            }
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

    fallbacks: list[str] | None = None
    while True:
        try:
            result = _download_once(url, options, opts, logger, should_stop, on_progress)
            remember_browser(url, opts)
            return result
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
            err = classify(e)
            if fallbacks is None:
                fallbacks = browser_fallbacks(url, opts, err.code, err.detail)
            if fallbacks:
                client = fallbacks.pop(0)
                log.info("Site refused the download; retrying as %s", client or "Chrome")
                use_browser(opts, client)
                parts.clear()
                continue
            raise err from e
        except (EngineError, UnsafeInputError):
            raise
        except Exception as e:
            reason = should_stop()
            if reason:
                raise JobInterrupted(reason) from e
            log.exception("Unexpected download failure")
            raise classify(e) from e


def _download_once(url: str, options: DownloadOptions, opts: dict[str, Any], logger: _QuietLogger,
                   should_stop: Callable[[], str | None], on_progress: ProgressCb) -> DownloadResult:
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
        apply_headers(opts, o.headers)
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
