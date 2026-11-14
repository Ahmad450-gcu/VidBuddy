"""Signed-in Google Drive playback.

yt-dlp's Google Drive extractor asks Drive's playback API for the video streams with only a
public API key, so any file that isn't shared "Anyone with the link" comes back as 404 "media
item not found", even when the user uploaded cookies for an account that can watch it.

The Drive web player makes the same call on ``workspacevideo-pa.clients6.google.com`` with the
account's cookies and a SAPISIDHASH ``Authorization`` header. When sign-in cookies are present we
do the same, so files shared with a specific account (a university's lecture folder, say) play
for that account here exactly as they do in the browser. Files whose owner turned off
downloading still offer their streaming copies (up to 1080p), which is what the player uses.

Applied as a small patch on the extractor class so it keeps working when yt-dlp self-updates;
if Google or yt-dlp change shape, it silently does nothing and yt-dlp's own logic runs.
"""
from __future__ import annotations

import hashlib
import logging
import re
import time
import urllib.parse

log = logging.getLogger("haul.gdrive")

ORIGIN = "https://drive.google.com"
API_HOST = "workspacevideo-pa.clients6.google.com"
_PLAYBACK = re.compile(r"^https://[\w.-]+/v1/drive/media/(?P<id>[\w-]+)/playback")
_installed = False


def sid_authorization(cookies: dict[str, str], origin: str = ORIGIN, now: float | None = None) -> str | None:
    """The SAPISIDHASH header Google's web clients send, or None if not signed in."""
    ts = str(round(time.time() if now is None else now))
    sapisid = cookies.get("SAPISID") or cookies.get("__Secure-3PAPISID")
    parts = []
    for scheme, sid in (("SAPISIDHASH", sapisid),
                        ("SAPISID1PHASH", cookies.get("__Secure-1PAPISID")),
                        ("SAPISID3PHASH", cookies.get("__Secure-3PAPISID"))):
        if sid:
            digest = hashlib.sha1(f"{ts} {sid} {origin}".encode()).hexdigest()
            parts.append(f"{scheme} {ts}_{digest}")
    return " ".join(parts) or None


def auth_user(url: str) -> str:
    """Which signed-in account the link points at (``/u/1/`` or ``?authuser=1``), default 0."""
    m = re.search(r"/u/(\d+)/", url)
    if m:
        return m.group(1)
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    return (q.get("authuser") or ["0"])[0]


def resource_key(url: str) -> str | None:
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    return (q.get("resourcekey") or [None])[0]


def install() -> None:
    """Patch yt-dlp's GoogleDriveIE once per process. Safe to call repeatedly."""
    global _installed
    if _installed:
        return
    _installed = True
    try:
        from yt_dlp.extractor.googledrive import GoogleDriveIE
        from yt_dlp.networking.exceptions import HTTPError
        from yt_dlp.utils import ExtractorError
    except Exception:  # pragma: no cover - yt-dlp reorganised; leave it alone
        log.warning("Google Drive sign-in support unavailable in this yt-dlp")
        return

    original_extract = GoogleDriveIE._real_extract
    original_json = GoogleDriveIE._download_json

    def _real_extract(self, url):
        self._haul_url = url
        return original_extract(self, url)

    def _download_json(self, url_or_request, video_id, *args, **kwargs):
        url = url_or_request if isinstance(url_or_request, str) else getattr(url_or_request, "url", "")
        m = _PLAYBACK.match(url or "")
        if not m:
            return original_json(self, url_or_request, video_id, *args, **kwargs)

        jar = {k: v.value for k, v in self._get_cookies(ORIGIN).items()}
        auth = sid_authorization(jar)
        page_url = getattr(self, "_haul_url", "")
        if auth:
            url_or_request = url.replace(urllib.parse.urlparse(url).netloc, API_HOST, 1)
            headers = {**(kwargs.get("headers") or {}), "Authorization": auth, "Origin": ORIGIN,
                       "X-Goog-AuthUser": auth_user(page_url), "Referer": f"{ORIGIN}/"}
            key = resource_key(page_url)
            if key:
                headers["X-Goog-Drive-Resource-Keys"] = f"{m.group('id')}/{key}"
            kwargs["headers"] = headers
        try:
            return original_json(self, url_or_request, video_id, *args, **kwargs)
        except ExtractorError as e:
            cause = e.cause
            if isinstance(cause, HTTPError) and cause.status in (401, 403, 404):
                if auth:
                    msg = ("Google Drive: the signed-in account can't open this file. Upload cookies from "
                           "the Google account that has access (sign in to only that account).")
                else:
                    msg = ("Google Drive: this file isn't public. If your Google account can play it, "
                           "add sign-in cookies from drive.google.com in Settings.")
                raise ExtractorError(msg, expected=True, video_id=video_id) from e
            raise

    GoogleDriveIE._real_extract = _real_extract
    GoogleDriveIE._download_json = _download_json

    try:
        from yt_dlp.extractor.googledrive import GoogleDriveFolderIE
    except Exception:  # pragma: no cover
        return

    def _folder_extract(self, url):
        folder_id = self._match_id(url)
        visited: set[str] = set()

        def walk(fid: str, depth: int):
            if fid in visited or depth > 4:
                return
            visited.add(fid)
            try:
                page = self._download_webpage(f"{ORIGIN}/drive/folders/{fid}", fid,
                                              note="Reading folder", query={"authuser": auth_user(url)})
            except ExtractorError as e:
                if not isinstance(e.cause, HTTPError) or e.cause.status not in (401, 403, 404):
                    raise
                page = ""
            title, items = parse_folder_page(page)
            if items is None:
                if fid == folder_id:
                    raise ExtractorError(
                        "Google Drive: this file isn't public, or the folder couldn't be read. If your Google "
                        "account can open it, add sign-in cookies from drive.google.com in Settings.",
                        expected=True, video_id=fid)
                return
            if fid == folder_id:
                titles[0] = title
            for item in items:
                if item["mime"] == "application/vnd.google-apps.folder":
                    yield from walk(item["id"], depth + 1)
                elif item["mime"].startswith(("video/", "audio/")):
                    yield self.url_result(f"{ORIGIN}/file/d/{item['id']}/view", GoogleDriveIE,
                                          item["id"], item["title"])

        titles = [None]
        entries = list(walk(folder_id, 0))
        if not entries:
            raise ExtractorError("Google Drive: this folder has no videos or audio files.", expected=True)
        return self.playlist_result(entries, folder_id, titles[0])

    GoogleDriveFolderIE._real_extract = _folder_extract


def parse_folder_page(html: str) -> tuple[str | None, list[dict] | None]:
    """Title and files from a Drive folder page (the list the page embeds), or (None, None)."""
    import json

    m = re.search(r"window\['_DRIVE_ivd'\]\s*=\s*'(.*?)';", html, re.S)
    if not m:
        return None, None
    try:
        raw = m.group(1).encode("latin-1", "backslashreplace").decode("unicode_escape")
        data = json.loads(raw)
    except Exception:
        return None, None
    items = []
    for row in (data[0] if data and isinstance(data[0], list) else []):
        if isinstance(row, list) and len(row) > 3 and isinstance(row[0], str) and isinstance(row[3], str):
            items.append({"id": row[0], "title": row[2] if isinstance(row[2], str) else row[0], "mime": row[3]})
    t = re.search(r"<title>(.*?)(?:\s*[-–]\s*Google Drive)?</title>", html, re.S)
    title = t.group(1).strip() if t else None
    return title, items
