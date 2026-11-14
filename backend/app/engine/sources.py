"""Source identification and per-source adapters.

The frontend never knows about extractors. Each URL is matched to a ``SourceAdapter``.
Adapters can tune yt-dlp options for their site (headers, JS runtime, impersonation)
without touching the rest of the engine. Adding a site-specific tweak means adding one
adapter class and registering it. Everything else falls through to the generic yt-dlp
adapter, which covers ~1,750 extractors plus direct media links.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Protocol
from urllib.parse import urlsplit

from .runtime import js_runtimes

DIRECT_MEDIA_EXT = re.compile(r"\.(mp4|m4v|webm|mkv|mov|avi|mp3|m4a|aac|ogg|oga|opus|wav|flac|m3u8|mpd)(\?|$)", re.I)


@dataclass(frozen=True)
class SourceInfo:
    key: str  # stable identifier, e.g. "youtube", "direct"
    name: str  # human readable, e.g. "YouTube"
    extractor: str | None  # yt-dlp ie_key
    domain: str

    def as_dict(self) -> dict[str, Any]:
        return {"key": self.key, "name": self.name, "extractor": self.extractor, "domain": self.domain}


class SourceAdapter(Protocol):
    key: str

    def matches(self, url: str, ie_key: str | None) -> bool: ...
    def tune_options(self, opts: dict[str, Any]) -> None: ...


class YouTubeAdapter:
    key = "youtube"

    def matches(self, url: str, ie_key: str | None) -> bool:
        return bool(ie_key and ie_key.lower().startswith("youtube"))

    def tune_options(self, opts: dict[str, Any]) -> None:
        rts = js_runtimes()
        if rts:
            opts["js_runtimes"] = rts


class DirectMediaAdapter:
    key = "direct"

    def matches(self, url: str, ie_key: str | None) -> bool:
        return ie_key in (None, "Generic") and bool(DIRECT_MEDIA_EXT.search(urlsplit(url).path + "?"))

    def tune_options(self, opts: dict[str, Any]) -> None:
        opts["force_generic_extractor"] = True


class DefaultAdapter:
    key = "default"

    def matches(self, url: str, ie_key: str | None) -> bool:
        return True

    def tune_options(self, opts: dict[str, Any]) -> None:
        rts = js_runtimes()
        if rts:  # harmless for non-YouTube, and some extractors use it
            opts.setdefault("js_runtimes", rts)


ADAPTERS: list[SourceAdapter] = [YouTubeAdapter(), DirectMediaAdapter(), DefaultAdapter()]

_PRETTY = {
    "youtube": "YouTube", "youtubetab": "YouTube", "dailymotion": "Dailymotion", "vimeo": "Vimeo",
    "twitter": "X / Twitter", "tiktok": "TikTok", "instagram": "Instagram", "facebook": "Facebook",
    "soundcloud": "SoundCloud", "bandcamp": "Bandcamp", "twitch": "Twitch", "reddit": "Reddit",
    "generic": "Web", "bilibili": "Bilibili", "archiveorg": "Internet Archive", "peertube": "PeerTube",
}


@lru_cache(maxsize=1)
def _extractors() -> list[Any]:
    from yt_dlp.extractor import gen_extractor_classes

    return [ie for ie in gen_extractor_classes() if ie.ie_key() != "Generic"]


def match_extractor(url: str) -> str | None:
    for ie in _extractors():
        try:
            if ie.suitable(url):
                return ie.ie_key()
        except Exception:
            continue
    return None


def adapter_for(url: str, ie_key: str | None) -> SourceAdapter:
    return next(a for a in ADAPTERS if a.matches(url, ie_key))


def identify(url: str) -> SourceInfo:
    domain = (urlsplit(url).hostname or "").lower().removeprefix("www.").removeprefix("m.")
    ie_key = match_extractor(url)
    adapter = adapter_for(url, ie_key)
    if adapter.key == "direct":
        return SourceInfo("direct", "Direct link", "Generic", domain)
    if ie_key is None:
        return SourceInfo("web", domain or "Web", "Generic", domain)
    base = re.sub(r"(Tab|Playlist|Shorts|Clip|Channel|User|Search|Music|Live|Video)$", "", ie_key) or ie_key
    key = base.lower().split(":")[0]
    return SourceInfo(key, _PRETTY.get(key, _PRETTY.get(ie_key.lower(), base)), ie_key, domain)


def tune_for(url: str, opts: dict[str, Any], ie_key: str | None = None) -> dict[str, Any]:
    adapter_for(url, ie_key if ie_key is not None else match_extractor(url)).tune_options(opts)
    return opts


@lru_cache(maxsize=1)
def supported_sites() -> list[str]:
    names = set()
    for ie in _extractors():
        if getattr(ie, "_WORKING", True) is False or getattr(ie, "IE_NAME", "").startswith(":"):
            continue
        name = (getattr(ie, "IE_NAME", None) or ie.ie_key()).split(":")[0]
        names.add(name)
    return sorted(names, key=str.lower)
