"""Udemy lectures and courses for enrolled learners.

yt-dlp's Udemy extractor predates Udemy's current links (``/course/<slug>/learn/lecture/<id>``):
such a link falls through to its course extractor, which reads "course" as the course name and
fails. It also scrapes the course id from HTML that no longer carries it. Udemy's web player
reads everything from ``/api-2.0``, which answers with the learner's sign-in cookies:

* the course id from its slug: ``/api-2.0/courses/<slug>/``
* a lecture's streams: ``/api-2.0/users/me/subscribed-courses/<course>/lectures/<lecture>/``
* the outline: ``/api-2.0/courses/<course>/subscriber-curriculum-items/``

Courses Udemy encrypts (DRM) only offer licence-protected streams; those are reported as DRM,
not downloaded. Business accounts (``<company>.udemy.com``) use the same API on their own host.
"""
from __future__ import annotations

import json
import logging
from urllib.parse import urlsplit

from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.networking.exceptions import HTTPError
import threading
import time

from yt_dlp.utils import ExtractorError, float_or_none, int_or_none, traverse_obj, url_or_none

NEEDS_SIGN_IN = ("Udemy: this lecture needs a signed-in, enrolled account. Add sign-in cookies "
                 "from udemy.com in Settings (signed in to the account that owns the course).")
NOT_ENROLLED = "Udemy: the signed-in account isn't enrolled in this course."
DRM = ("Udemy: this course is DRM-protected (Udemy encrypts its videos), so it can't be downloaded. "
       "Udemy's mobile app can save it for offline viewing.")

_HOST = r"https?://(?P<host>(?:[\w-]+\.)?udemy\.com)"
_LECTURE = _HOST + r"/(?:course/)?(?P<slug>[\w-]+)/learn/(?:v4/t/)?lecture/(?P<id>\d+)"


# A course download asks about every lecture; the course id and outline are the same each time.
_CACHE_SECONDS = 600
_cache: dict[str, tuple[float, object]] = {}
_cache_lock = threading.Lock()


def _cached(key: str, load):
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < _CACHE_SECONDS:
            return hit[1]
    value = load()
    with _cache_lock:
        _cache[key] = (now, value)
    return value


log = logging.getLogger("haul.udemy")


def _origin(url: str) -> str:
    """Where the API lives: the link's own host (www.udemy.com, or a business subdomain)."""
    parts = urlsplit(url)
    return f"{parts.scheme or 'https'}://{parts.hostname}"


class _UdemyBase(InfoExtractor):
    _NETRC_MACHINE = "udemy"

    def _call_api(self, origin: str, path: str, video_id: str, note: str, query: dict | None = None) -> dict:
        headers = {"Accept": "application/json, text/plain, */*", "X-Requested-With": "XMLHttpRequest",
                   "Referer": f"{origin}/"}
        for cookie in self.cookiejar:
            if cookie.name == "access_token" and cookie.domain.lstrip(".").endswith("udemy.com"):
                headers["Authorization"] = f"Bearer {cookie.value}"
                headers["X-Udemy-Authorization"] = f"Bearer {cookie.value}"
            elif cookie.name == "client_id" and cookie.domain.lstrip(".").endswith("udemy.com"):
                headers["X-Udemy-Client-Id"] = cookie.value
        try:
            return self._download_json(f"{origin}/api-2.0/{path}", video_id, note, query=query or {},
                                       headers=headers)
        except ExtractorError as e:
            if isinstance(e.cause, HTTPError) and e.cause.status in (401, 403, 404):
                body = b""
                try:
                    body = e.cause.response.read()
                except Exception:
                    pass
                if not self._is_api_answer(body):
                    raise  # an anti-bot page, not Udemy saying no: let the browser retry handle it
                log.info("Udemy API %s answered %s: %s (signed in: %s)", path.split("?")[0], e.cause.status,
                         body[:300].decode("utf-8", "replace"), "Authorization" in headers)
                if e.cause.status == 404 and "subscribed-courses" not in path:
                    raise ExtractorError("Udemy: this course or lecture wasn't found.",
                                         expected=True, video_id=video_id) from e
                # signed in but refused: this account can't open the course
                signed_in = "Authorization" in headers
                raise ExtractorError(NOT_ENROLLED if signed_in or e.cause.status == 404 else NEEDS_SIGN_IN,
                                     expected=True, video_id=video_id) from e
            raise

    @staticmethod
    def _is_api_answer(body: bytes) -> bool:
        try:
            return isinstance(json.loads(body or b"null"), dict)
        except ValueError:
            return False

    def _course(self, origin: str, slug: str) -> dict:
        return _cached(f"{origin}/course/{slug}", lambda: self._load_course(origin, slug))

    def _load_course(self, origin: str, slug: str) -> dict:
        course = self._call_api(origin, f"courses/{slug}/", slug, "Reading course",
                                {"fields[course]": "id,title"})
        if not course.get("id"):
            raise ExtractorError("Udemy: this course wasn't found.", expected=True)
        return course

    def _curriculum(self, origin: str, course_id) -> list[dict]:
        return _cached(f"{origin}/outline/{course_id}", lambda: self._load_curriculum(origin, course_id))

    # The learner's outline first; some accounts (subscription plans, some enrolments) are refused it,
    # and then the public outline, which lists the same lectures to anyone, is used instead.
    _OUTLINES = ("subscriber-curriculum-items", "cached-subscriber-curriculum-items", "public-curriculum-items")

    def _load_curriculum(self, origin: str, course_id) -> list[dict]:
        query = {"page_size": "200", "fields[lecture]": "title,object_index,asset",
                 "fields[chapter]": "title,object_index", "fields[asset]": "asset_type"}
        for i, endpoint in enumerate(self._OUTLINES):
            items, page = [], 1
            try:
                while page <= 50:
                    data = self._call_api(origin, f"courses/{course_id}/{endpoint}/", str(course_id),
                                          f"Reading course outline (page {page})", {**query, "page": str(page)})
                    items.extend(data.get("results") or [])
                    if not data.get("next"):
                        break
                    page += 1
            except ExtractorError as e:
                if i == len(self._OUTLINES) - 1 or not e.expected:
                    raise
                continue
            if items:
                return items
        return []


class UdemyLectureIE(_UdemyBase):
    IE_NAME = "udemy"
    _VALID_URL = _LECTURE

    def _real_extract(self, url):
        slug, lecture_id = self._match_valid_url(url).group("slug", "id")
        origin = _origin(url)
        course = self._course(origin, slug)
        lecture = self._call_api(
            origin, f"users/me/subscribed-courses/{course['id']}/lectures/{lecture_id}/", lecture_id,
            "Reading lecture", {
                "fields[lecture]": "title,description,object_index,asset",
                "fields[asset]": "asset_type,length,media_sources,captions,course_is_drmed,"
                                 "media_license_token,thumbnail_url,stream_urls,download_urls",
            })
        asset = lecture.get("asset") or {}
        if (asset.get("asset_type") or "").lower() not in ("video", "videomashup"):
            raise ExtractorError(f"Udemy: lecture {lecture_id} isn't a video.", expected=True)

        formats = self._formats(asset, lecture_id)
        if not formats:
            if asset.get("course_is_drmed") or asset.get("media_license_token"):
                raise ExtractorError(DRM, expected=True, video_id=lecture_id)
            raise ExtractorError("Udemy: no downloadable video was offered for this lecture.", expected=True)

        subtitles, captions = {}, {}
        for cap in asset.get("captions") or []:
            src = url_or_none(cap.get("url"))
            if not src:
                continue
            lang = (cap.get("locale_id") or cap.get("video_label") or "und").replace("_", "-")
            target = captions if cap.get("source") == "auto" else subtitles
            target.setdefault(lang, []).append({"url": src, "ext": "vtt", "name": cap.get("title")})

        chapter = None
        for item in self._outline_cache(origin, course["id"]):
            if item.get("_class") == "chapter":
                chapter = item.get("title")
            elif item.get("_class") == "lecture" and str(item.get("id")) == lecture_id:
                break
        else:
            chapter = None
        return {
            "id": lecture_id,
            "title": lecture.get("title") or lecture_id,
            "description": lecture.get("description"),
            "series": course.get("title"),
            "chapter": chapter,
            "episode_number": int_or_none(lecture.get("object_index")),
            "uploader": "Udemy",
            "duration": float_or_none(asset.get("length")),
            "thumbnail": url_or_none(asset.get("thumbnail_url")),
            "formats": formats,
            "subtitles": subtitles,
            "automatic_captions": captions,
        }

    def _outline_cache(self, origin, course_id):
        try:
            return self._curriculum(origin, course_id)
        except ExtractorError:
            return []  # the chapter name is a nicety; the lecture itself already worked

    def _formats(self, asset: dict, lecture_id: str) -> list[dict]:
        formats = []
        for src in asset.get("media_sources") or []:
            url = url_or_none(src.get("src"))
            kind = (src.get("type") or "").lower()
            if not url:
                continue
            if "mpegurl" in kind:
                formats.extend(self._extract_m3u8_formats(url, lecture_id, "mp4", m3u8_id="hls", fatal=False))
            elif kind.startswith("video/"):
                height = int_or_none(src.get("label"))
                formats.append({"url": url, "ext": kind.split("/")[1] or "mp4",
                                "format_id": f"mp4-{height}p" if height else "mp4", "height": height})
            # application/dash+xml with a licence token is the DRM stream: not usable
        # older courses: stream_urls / download_urls {"Video": [{"type", "label", "file"}]}
        for group in ("download_urls", "stream_urls"):
            for src in traverse_obj(asset, (group, "Video", lambda _, v: url_or_none(v["file"]))) or []:
                height = int_or_none(src.get("label"))
                if any(f.get("url") == src["file"] for f in formats):
                    continue
                if "mpegurl" in (src.get("type") or "").lower():
                    formats.extend(self._extract_m3u8_formats(src["file"], lecture_id, "mp4",
                                                              m3u8_id="hls", fatal=False))
                else:
                    formats.append({"url": src["file"], "ext": "mp4", "height": height,
                                    "format_id": f"{group.split('_')[0]}-{height or 'mp4'}"})
        return formats


class UdemyCourseIE(_UdemyBase):
    IE_NAME = "udemy:course"
    _VALID_URL = _HOST + r"/course/(?P<slug>[\w-]+)/?(?:$|[?#]|/(?!learn/(?:v4/t/)?lecture/))"

    def _real_extract(self, url):
        slug = self._match_valid_url(url).group("slug")
        origin = _origin(url)
        course = self._course(origin, slug)
        entries, chapter, chapter_no = [], None, None
        for item in self._curriculum(origin, course["id"]):
            if item.get("_class") == "chapter":
                chapter, chapter_no = item.get("title"), int_or_none(item.get("object_index"))
            elif item.get("_class") == "lecture" and item.get("id"):
                if (traverse_obj(item, ("asset", "asset_type")) or "Video").lower() not in ("video", "videomashup"):
                    continue
                entries.append({
                    "_type": "url", "ie_key": UdemyLectureIE.ie_key(), "id": str(item["id"]),
                    "url": f"{origin}/course/{slug}/learn/lecture/{item['id']}",
                    "title": item.get("title"), "chapter": chapter, "chapter_number": chapter_no,
                })
        if not entries:
            raise ExtractorError("Udemy: no video lectures were found in this course.", expected=True)
        return self.playlist_result(entries, str(course["id"]), course.get("title"))


_registered = False


def register() -> None:
    """Put these extractors in front of yt-dlp's outdated Udemy ones."""
    global _registered
    if _registered:
        return
    _registered = True
    from yt_dlp.extractor import import_extractors
    from yt_dlp.globals import extractors

    import_extractors()
    ours = {"UdemyLectureIE": UdemyLectureIE, "UdemyCourseIE": UdemyCourseIE}
    # yt-dlp's own Udemy extractors (same class names) are dropped: ours replace them
    extractors.value = {**ours, **{k: v for k, v in extractors.value.items()
                                   if k not in ours and k != "UdemyIE"}}
