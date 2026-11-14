"""Translate raw extractor/downloader errors into stable, user-facing categories."""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class EngineError(Exception):
    code: str
    message: str
    detail: str = ""

    def __str__(self) -> str:  # pragma: no cover - convenience
        return self.message


_RULES: list[tuple[str, str, str]] = [
    (r"google drive: the signed-in account can't open", "auth",
     "The Google account in your sign-in cookies can't open this Drive file. Upload cookies from the account that has access."),
    (r"coursera: this lecture needs a signed-in", "auth",
     "This Coursera lecture needs your sign-in. Add cookies from coursera.org (signed in, enrolled in the course) in Settings."),
    (r"google drive: this file isn't public", "auth",
     "This Drive file isn't public. If your Google account can play it, add sign-in cookies from drive.google.com in Settings."),
    (r"unsupported url|no suitable (info)?extractor", "unsupported", "This site or link isn't supported."),
    (r"drm|widevine|playready", "drm", "This media is DRM-protected and can't be downloaded."),
    (r"not a bot", "blocked", "The site temporarily blocked automated access. Try again later."),
    (r"confirm your age|age[- ]restricted|inappropriate for some users",
     "auth", "This video is age-restricted. Add sign-in cookies from an account that can watch it (Settings › Sign-in cookies)."),
    (r"private video|this video is private|login required|members[- ]only|requires? (an )?(account|authentication|login)|cookies",
     "auth", "This media needs a sign-in or is private. If your account can watch it, add sign-in cookies in Settings."),
    (r"available in your country|geo.?restrict|blocked it in your country|not available in your region", "geo", "This media isn't available in your region."),
    (r"no video formats found", "no_formats",
     "The site didn't offer a downloadable stream for this media. Try again in a minute; if it keeps happening the site may have changed."),
    (r"video unavailable|has been removed|does not exist|404|not found", "unavailable",
     "This media is unavailable or was removed."),
    (r"live event will begin|premieres in|is_live|live stream", "live", "Live streams that haven't finished can't be downloaded yet."),
    (r"requested format (is )?not available", "format", "That quality isn't available. Try another option."),
    (r"file is larger than max-filesize|max_filesize", "too_large", "The file is larger than the configured size limit."),
    (r"ffmpeg|ffprobe|postprocess", "processing", "Processing the media failed."),
    (r"no space left|disk full|errno 28", "disk_full", "The server is out of disk space."),
    (r"timed out|timeout|connection|network|temporary failure|reset by peer|http error 5\d\d|ssl|getaddrinfo|unreachable|incomplete",
     "network", "A network error interrupted the download."),
    (r"http error 429|too many requests", "rate_limited", "The site is rate limiting requests. Try again shortly."),
    (r"http error 403|forbidden", "forbidden", "The site refused the request (403)."),
]

RETRYABLE = {"no_formats", "network", "rate_limited", "blocked", "forbidden", "processing"}
_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def classify(exc: BaseException | str) -> EngineError:
    if isinstance(exc, EngineError):
        return exc
    raw = _ANSI.sub("", str(exc)).strip()
    text = raw.lower()
    # 429 must win over generic network/http rules
    if "429" in text or "too many requests" in text:
        return EngineError("rate_limited", "The site is rate limiting requests. Try again shortly.", raw)
    for pattern, code, message in _RULES:
        if re.search(pattern, text):
            return EngineError(code, message, raw)
    return EngineError("unknown", "Something went wrong while processing this link.", raw)
