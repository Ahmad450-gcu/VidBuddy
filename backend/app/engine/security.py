"""Input hardening: URL validation (incl. SSRF guard), filename and path safety."""
from __future__ import annotations

import ipaddress
import re
import socket
import unicodedata
from pathlib import Path
from urllib.parse import urlsplit

MAX_URL_LENGTH = 2048
_WIN_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
_BAD_CHARS = re.compile(r'[\x00-\x1f\x7f<>:"/\\|?*]')


class UnsafeInputError(ValueError):
    """Raised when user input fails validation. Message is safe to show to the user."""


def extract_url(text: str) -> str:
    """Pull the first http(s) URL out of free text (e.g. a share-sheet payload)."""
    text = (text or "").strip()
    m = re.search(r"https?://[^\s<>\"']+", text)
    return m.group(0).rstrip(").,;!") if m else text


def validate_url(url: str, *, allow_private: bool = False, resolve: bool = True) -> str:
    url = extract_url(url)
    if not url:
        raise UnsafeInputError("Please enter a link.")
    if len(url) > MAX_URL_LENGTH:
        raise UnsafeInputError("That link is too long.")
    parts = urlsplit(url)
    if parts.scheme.lower() not in ("http", "https"):
        raise UnsafeInputError("Only http and https links are supported.")
    host = parts.hostname
    if not host:
        raise UnsafeInputError("That doesn't look like a valid link.")
    if not allow_private:
        _assert_public_host(host, resolve=resolve)
    return url


def _assert_public_host(host: str, *, resolve: bool) -> None:
    if host.lower() in ("localhost",) or host.lower().endswith((".localhost", ".local", ".internal")):
        raise UnsafeInputError("Links to local or private network addresses are not allowed.")
    addrs: list[str] = []
    try:
        ipaddress.ip_address(host)
        addrs = [host]
    except ValueError:
        if resolve:
            try:
                addrs = list({ai[4][0] for ai in socket.getaddrinfo(host, None)})
            except socket.gaierror as e:
                raise UnsafeInputError(f"Couldn't resolve {host}. Check the link or your connection.") from e
    for a in addrs:
        ip = ipaddress.ip_address(a.split("%")[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            raise UnsafeInputError("Links to local or private network addresses are not allowed.")


def sanitize_filename(name: str, *, max_len: int = 180, fallback: str = "untitled") -> str:
    """Return a filename safe on Windows, macOS, Linux and Android storage."""
    name = unicodedata.normalize("NFC", name or "")
    name = _BAD_CHARS.sub("_", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    stem, dot, ext = name.rpartition(".")
    if stem and len(ext) <= 5:
        base, suffix = stem, f".{ext}"
    else:
        base, suffix = name, ""
    if base.upper() in _WIN_RESERVED:
        base = f"_{base}"
    budget = max_len - len(suffix.encode("utf-8"))
    encoded = base.encode("utf-8")[:budget]
    base = encoded.decode("utf-8", errors="ignore").strip(" .")
    return (base or fallback) + suffix


def safe_join(root: Path, relative: str | Path) -> Path:
    """Join ``relative`` onto ``root`` and guarantee the result stays inside root."""
    root = root.resolve()
    target = (root / relative).resolve()
    if target != root and root not in target.parents:
        raise UnsafeInputError("Invalid file path.")
    return target


# Filename templates: users may combine these yt-dlp fields with literal text only.
TEMPLATE_FIELDS = {
    "title", "id", "uploader", "channel", "upload_date", "extractor", "resolution",
    "height", "fps", "playlist_title", "playlist_index", "ext", "duration_string", "artist", "album",
}
DEFAULT_TEMPLATE = "%(title)s [%(id)s].%(ext)s"


def validate_template(template: str | None) -> str:
    template = (template or "").strip() or DEFAULT_TEMPLATE
    if len(template) > 200:
        raise UnsafeInputError("Filename template is too long.")
    if "/" in template or "\\" in template or ".." in template:
        raise UnsafeInputError("Filename templates can't contain folders.")
    fields = re.findall(r"%\(([^)]*)\)", template)
    if not fields:
        raise UnsafeInputError("Template needs at least one field such as %(title)s.")
    for f in fields:
        if f not in TEMPLATE_FIELDS:
            raise UnsafeInputError(f"Unknown template field '{f}'.")
    # only plain %(field)s / %(field)d / %(field)03d conversions
    if re.search(r"%\([^)]*\)(?![0-9]*[sd])", template):
        raise UnsafeInputError("Use %(field)s style placeholders only.")
    if not template.endswith(".%(ext)s"):
        template += ".%(ext)s"
    return template
