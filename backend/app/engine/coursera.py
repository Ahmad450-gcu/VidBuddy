"""Coursera lectures for enrolled learners.

yt-dlp dropped its Coursera extractor years ago. Coursera's own web player reads each lecture
from ``/api/onDemandLectureVideos.v1``, which returns plain MP4/WebM files (and MP3 audio and
subtitles), the same files the "Download" menu under a lecture offers. With the learner's
sign-in cookies the API answers for every lecture they're enrolled in.

Supported links:
* a lecture: ``coursera.org/learn/<course>/lecture/<id>`` (also ``/item/<id>``)
* a whole course: ``coursera.org/learn/<course>`` (any page of it): every lecture, in order
"""
from __future__ import annotations

import threading
import time

from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.networking.exceptions import HTTPError
from yt_dlp.utils import ExtractorError, int_or_none, traverse_obj, url_or_none

API = "https://www.coursera.org/api"
NEEDS_SIGN_IN = ("Coursera: this lecture needs a signed-in, enrolled account. Add sign-in cookies "
                 "from coursera.org in Settings (sign in to Coursera in a private window, then export).")


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


class _CourseraBase(InfoExtractor):
    def _api(self, path: str, video_id: str, note: str, query: dict | None = None) -> dict:
        try:
            return self._download_json(f"{API}/{path}", video_id, note, query=query or {})
        except ExtractorError as e:
            if isinstance(e.cause, HTTPError) and e.cause.status in (401, 403):
                raise ExtractorError(NEEDS_SIGN_IN, expected=True, video_id=video_id) from e
            raise

    def _course(self, slug: str) -> dict:
        return _cached(f"course/{slug}", lambda: self._load_course(slug))

    def _items(self, slug: str) -> list[dict]:
        return _cached(f"items/{slug}", lambda: self._load_items(slug))

    def _load_course(self, slug: str) -> dict:
        data = self._api("onDemandCourses.v1", slug, "Reading course",
                         {"q": "slug", "slug": slug, "fields": "id,name"})
        course = traverse_obj(data, ("elements", 0, {dict}))
        if not course:
            raise ExtractorError("Coursera: this course wasn't found.", expected=True)
        return course

    def _load_items(self, slug: str) -> list[dict]:
        data = self._api("onDemandCourseMaterials.v2/", slug, "Reading course outline", {
            "q": "slug", "slug": slug, "includes": "modules,lessons,items",
            "fields": "onDemandCourseMaterialItems.v2(name,slug,contentSummary,lessonId,moduleId),"
                      "onDemandCourseMaterialLessons.v1(name,itemIds),"
                      "onDemandCourseMaterialModules.v1(name,lessonIds)",
        })
        linked = data.get("linked") or {}
        items = {i["id"]: i for i in linked.get("onDemandCourseMaterialItems.v2") or []}
        lessons = {lesson["id"]: lesson for lesson in linked.get("onDemandCourseMaterialLessons.v1") or []}
        ordered = []
        for module in linked.get("onDemandCourseMaterialModules.v1") or []:
            for lesson_id in module.get("lessonIds") or []:
                for item_id in (lessons.get(lesson_id) or {}).get("itemIds") or []:
                    if item_id in items:
                        ordered.append({**items[item_id], "module": module.get("name")})
        return ordered or list(items.values())


class CourseraLectureIE(_CourseraBase):
    IE_NAME = "coursera"
    _VALID_URL = r"https?://(?:www\.)?coursera\.org/learn/(?P<slug>[\w-]+)/(?:lecture|item)/(?P<id>[\w-]+)"

    def _real_extract(self, url):
        slug, item_id = self._match_valid_url(url).group("slug", "id")
        course = self._course(slug)
        data = self._api(f"onDemandLectureVideos.v1/{course['id']}~{item_id}", item_id, "Reading lecture", {
            "includes": "video", "fields": "onDemandVideos.v1(sources,subtitlesVtt)"})
        video = traverse_obj(data, ("linked", "onDemandVideos.v1", 0, {dict}))
        if not video:
            raise ExtractorError(NEEDS_SIGN_IN if not data.get("elements") else
                                 "Coursera: this item isn't a video lecture.", expected=True)
        sources = video.get("sources") or {}

        formats = []
        for res, files in (sources.get("byResolution") or {}).items():
            height = int_or_none(res.rstrip("p"))
            for key, ext, pref in (("mp4VideoUrl", "mp4", 1), ("webMVideoUrl", "webm", 0)):
                if url_or_none(files.get(key)):
                    formats.append({"url": files[key], "ext": ext, "format_id": f"{ext}-{res}",
                                    "height": height, "quality": pref,
                                    "vcodec": None, "acodec": None})
        for audio in sources.get("audio") or []:
            if url_or_none(audio.get("url")):
                kbps = (int_or_none(audio.get("bitrate")) or 0) // 1000 or None
                formats.append({"url": audio["url"], "ext": "mp3", "format_id": f"mp3-{kbps or 'audio'}",
                                "vcodec": "none", "acodec": "mp3", "abr": kbps})
        hls = traverse_obj(sources, ("playlists", "hls", {url_or_none}))
        if hls:
            formats.extend(self._extract_m3u8_formats(hls, item_id, "mp4", m3u8_id="hls", fatal=False))
        if not formats:
            raise ExtractorError("Coursera: no downloadable video was offered for this lecture.", expected=True)

        subtitles = {
            lang: [{"url": f"https://www.coursera.org{path}", "ext": "vtt"}]
            for lang, path in (video.get("subtitlesVtt") or {}).items() if isinstance(path, str)
        }
        item = next((i for i in self._items(slug) if i.get("id") == item_id), {})
        return {
            "id": item_id,
            "title": item.get("name") or item_id,
            "series": course.get("name"),
            "uploader": "Coursera",
            "album": item.get("module"),
            "formats": formats,
            "subtitles": subtitles,
        }


class CourseraCourseIE(_CourseraBase):
    IE_NAME = "coursera:course"
    _VALID_URL = r"https?://(?:www\.)?coursera\.org/learn/(?P<slug>[\w-]+)/?(?:$|[?#]|/(?!lecture/|item/))"

    def _real_extract(self, url):
        slug = self._match_valid_url(url).group("slug")
        course = self._course(slug)
        entries = [
            self.url_result(f"https://www.coursera.org/learn/{slug}/lecture/{i['id']}", CourseraLectureIE,
                            i["id"], i.get("name"))
            for i in self._items(slug)
            if traverse_obj(i, ("contentSummary", "typeName")) == "lecture"
        ]
        if not entries:
            raise ExtractorError("Coursera: no video lectures were found in this course.", expected=True)
        return self.playlist_result(entries, course["id"], course.get("name"))


_registered = False


def register() -> None:
    """Put these extractors in front of yt-dlp's own (it has none for Coursera)."""
    global _registered
    if _registered:
        return
    _registered = True
    from yt_dlp.extractor import import_extractors
    from yt_dlp.globals import extractors

    import_extractors()
    extractors.value = {"CourseraLectureIE": CourseraLectureIE, "CourseraCourseIE": CourseraCourseIE,
                        **extractors.value}
