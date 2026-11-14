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
    ie_key = ie_key if ie_key is not None else match_extractor(url)
    adapter = adapter_for(url, ie_key)
    adapter.tune_options(opts)
    tune_browser(url, opts)
    return opts


# ------------------------------------------------------------------ anti-bot fallback
# Many sites sit behind Cloudflare or similar and answer plain requests with 403. Sending
# requests with a real browser's TLS/HTTP fingerprint (curl_cffi impersonation) gets through.
# It is slower, so it's only used for sites that refused a normal request, and remembered
# for that site for the rest of the session.
# Sites differ in which browsers they let through (Pexels blocks Chrome's fingerprint but not
# Firefox's), so a few families are tried in turn. "" = the newest working Chrome/Edge profile.
BROWSERS = ("", "firefox", "safari")
_browser_hosts: dict[str, str] = {}


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().removeprefix("www.")


def needs_browser(url: str) -> bool:
    return _host(url) in _browser_hosts


def use_browser(opts: dict[str, Any], client: str = "") -> dict[str, Any]:
    from yt_dlp.networking.impersonate import ImpersonateTarget

    opts["impersonate"] = ImpersonateTarget(client or None)  # every request, including the media download
    opts.setdefault("extractor_args", {}).setdefault("generic", {})["impersonate"] = [client]
    opts["_vb_browser"] = client
    return opts


def browser_fallbacks(url: str, opts: dict[str, Any], code: str, detail: str) -> list[str]:
    """Browser profiles still worth trying after this failure ([] if it isn't an anti-bot block)."""
    if not _host(url):
        return []
    text = (detail or "").lower()
    if not (code in ("forbidden", "blocked") or "cloudflare" in text or "challenge" in text
            or "impersonat" in text):
        return []
    try:
        import curl_cffi  # noqa: F401
    except Exception:
        return []
    current = opts.get("_vb_browser")
    return [b for b in BROWSERS if b != current]


def remember_browser(url: str, opts: dict[str, Any]) -> None:
    """After a success: keep using the browser profile that got through for this site."""
    if "_vb_browser" in opts and _host(url):
        _browser_hosts[_host(url)] = opts["_vb_browser"]


_choice_installed = False


def install_browser_choice() -> None:
    """Make extractors that ask for "any browser" (Vimeo, Bandcamp, ...) use the profile we're trying.

    Without this, a per-request ``impersonate=True`` always resolves to the first Chrome profile,
    so falling back to Firefox or Safari would only affect the generic extractor.
    """
    global _choice_installed
    if _choice_installed:
        return
    _choice_installed = True
    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.networking.impersonate import ImpersonateTarget
    except Exception:  # pragma: no cover
        return
    original = YoutubeDL._parse_impersonate_targets

    def _parse(self, impersonate):
        client = self.params.get("_vb_browser")
        if client and (impersonate in (True, "") or impersonate == ImpersonateTarget()):
            impersonate = ImpersonateTarget(client)
        return original(self, impersonate)

    YoutubeDL._parse_impersonate_targets = _parse


def tune_browser(url: str, opts: dict[str, Any]) -> None:
    if needs_browser(url):
        use_browser(opts, _browser_hosts[_host(url)])


@lru_cache(maxsize=1)
def supported_sites() -> list[str]:
    names = set()
    for ie in _extractors():
        if getattr(ie, "_WORKING", True) is False or getattr(ie, "IE_NAME", "").startswith(":"):
            continue
        name = (getattr(ie, "IE_NAME", None) or ie.ie_key()).split(":")[0]
        names.add(name)
    return sorted(names, key=str.lower)
