"""Custom HTTP request headers for a link (Referer, Origin, Authorization, ...).

Some streams, typically raw ``.m3u8`` playlists from video players, only answer when the request
carries the same headers the site's own player sends (most often ``Referer`` and ``Origin``).
Users can paste them in any of the forms browsers hand out:

* ``Key: Value`` lines (DevTools "Request Headers" or a hand-written list)
* a whole "Copy as cURL" command (bash or Windows cmd flavour): its ``-H``, ``-A``, ``-e``
  and ``-b`` arguments are used, everything else is ignored
* a JSON object ``{"Referer": "..."}``
* a bare URL on its own line, which is taken as the Referer

The result is a plain ``{name: value}`` dict that is passed to yt-dlp as ``http_headers`` (it is
applied to the page, the playlist, every fragment and FFmpeg) and stored with the download job.
"""
from __future__ import annotations

import json
import re
import shlex
from typing import Any

from .security import UnsafeInputError

MAX_HEADERS = 40
MAX_VALUE = 8192
_NAME = re.compile(r"^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$")
_URL = re.compile(r"^https?://\S+$", re.I)
# Headers that describe the connection or the byte range rather than who is asking. yt-dlp sets
# them itself per request; a copied value would break resume (Range), decompression
# (Accept-Encoding) or the connection. ``Youtubedl-*`` are yt-dlp's internal switches.
_DROP = {
    "host", "content-length", "transfer-encoding", "connection", "keep-alive", "upgrade", "te",
    "trailer", "accept-encoding", "range", "if-range", "if-modified-since", "if-none-match",
    "if-match", "if-unmodified-since", "expect", "http2-settings",
}
_DROP_PREFIX = ("proxy-", "youtubedl-", "ytdl-")


def _canonical(name: str) -> str:
    return "-".join(p[:1].upper() + p[1:].lower() for p in name.split("-"))


def _from_curl(text: str) -> list[tuple[str, str]]:
    # Windows "Copy as cURL (cmd)" escapes with ^ and wraps in ^"...^"; bash uses \ continuations.
    text = re.sub(r"\^\s*\r?\n", " ", text)
    text = re.sub(r"\\\s*\r?\n", " ", text)
    if "^" in text and not re.search(r"(?<!\^)'", text):
        text = re.sub(r"\^(.)", r"\1", text)
    try:
        args = shlex.split(text, posix=True)
    except ValueError as e:
        raise UnsafeInputError(f"Couldn't read the cURL command ({e}).")
    pairs: list[tuple[str, str]] = []
    i = 1
    while i < len(args):
        a = args[i]
        val = args[i + 1] if i + 1 < len(args) else ""
        if a in ("-H", "--header"):
            if ":" in val:
                k, v = val.split(":", 1)
                pairs.append((k, v))
            i += 2
        elif a in ("-A", "--user-agent"):
            pairs.append(("User-Agent", val))
            i += 2
        elif a in ("-e", "--referer"):
            pairs.append(("Referer", val))
            i += 2
        elif a in ("-b", "--cookie"):
            if "=" in val:  # a cookie string, not a cookie file name
                pairs.append(("Cookie", val))
            i += 2
        elif a.startswith("-H") and len(a) > 2 and ":" in a:  # -H'Key: Value'
            k, v = a[2:].split(":", 1)
            pairs.append((k, v))
            i += 1
        elif a in ("-X", "--request", "-d", "--data", "--data-raw", "--data-binary", "-u", "--user",
                   "-o", "--output", "-x", "--proxy", "--url"):
            i += 2
        else:
            i += 1
    return pairs


def _pairs(raw: str) -> list[tuple[str, str]]:
    text = raw.strip()
    if not text:
        return []
    if text.startswith("{"):
        try:
            data = json.loads(text)
        except ValueError:
            raise UnsafeInputError("The headers look like JSON but couldn't be read.")
        if not isinstance(data, dict):
            raise UnsafeInputError("Headers JSON must be an object of name/value pairs.")
        return [(str(k), "" if v is None else str(v)) for k, v in data.items()]
    if re.match(r"^curl(\.exe)?\s", text, re.I):
        return _from_curl(text)
    pairs: list[tuple[str, str]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if _URL.match(line):
            pairs.append(("Referer", line))
            continue
        if line.startswith(":"):  # HTTP/2 pseudo-headers (:authority, :path, ...) from DevTools
            continue
        if ":" not in line:
            raise UnsafeInputError(f'Couldn\'t read the header line "{line[:60]}". Use the form Name: value.')
        k, v = line.split(":", 1)
        pairs.append((k, v))
    return pairs


def clean_headers(headers: dict[str, Any] | None) -> dict[str, str]:
    """Validate an already-parsed header dict (e.g. one loaded back from a stored job)."""
    out: dict[str, str] = {}
    for name, value in (headers or {}).items():
        name = str(name).strip()
        value = "" if value is None else str(value).strip()
        if not _NAME.match(name):
            raise UnsafeInputError(f'"{name[:60]}" isn\'t a valid header name.')
        if any(c in value for c in "\r\n\0"):
            raise UnsafeInputError(f"The {name} header contains a line break.")
        if len(value) > MAX_VALUE:
            raise UnsafeInputError(f"The {name} header is too long.")
        low = name.lower()
        if low in _DROP or low.startswith(_DROP_PREFIX) or not value:
            continue
        out[_canonical(name)] = value
    if len(out) > MAX_HEADERS:
        raise UnsafeInputError(f"Too many headers (at most {MAX_HEADERS}).")
    return out


def parse_headers(raw: str | None) -> dict[str, str]:
    """Raw text from the UI -> validated ``{name: value}`` (later lines win)."""
    if not raw or not raw.strip():
        return {}
    return clean_headers(dict(_pairs(raw)))


def apply_headers(opts: dict[str, Any], headers: dict[str, str] | None) -> dict[str, Any]:
    """Send ``headers`` with every request yt-dlp makes for this link (page, playlist, fragments, FFmpeg)."""
    if headers:
        opts["http_headers"] = {**(opts.get("http_headers") or {}), **headers}
    return opts


def cache_key(url: str, headers: dict[str, str] | None) -> str:
    """Analysis results depend on the headers (a stream may only answer with the right Referer)."""
    if not headers:
        return url
    import hashlib

    digest = hashlib.sha256(json.dumps(headers, sort_keys=True).encode()).hexdigest()[:16]
    return f"{url}#headers={digest}"
