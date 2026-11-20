"""Record only part of a YouTube live stream (e.g. 1:00:00 to 2:00:00 of a 10-hour stream).

yt-dlp can record a live stream from its beginning (``live_from_start``), but refuses a time
range for it ("This format cannot be partially downloaded"). A from-start live recording is a
numbered list of equal-length segments (``sq=0, 1, 2, ...``, each ``target_duration`` seconds),
so a range is simply the segments from ``start // d`` to ``end // d``. We wrap yt-dlp's segment
generator to skip the ones before the range and stop after it. If the end is still in the
future, the generator keeps waiting for new segments as usual and stops once it gets there.

Finished videos keep using yt-dlp's own ``download_ranges`` (cut with FFmpeg).
"""
from __future__ import annotations

import logging
import math
import re

log = logging.getLogger("haul.liverange")

PARAM = "_vb_live_range"  # (start_seconds, end_seconds | None), set by build_options


class Ranges:
    """``download_ranges`` for yt-dlp: the range for normal videos, nothing for live streams
    (those are cut by segment instead, see ``install``)."""

    def __init__(self, start: float, end: float | None):
        self.start, self.end = start, end

    def __call__(self, info: dict, ydl) -> list[dict]:
        if info.get("is_live") or info.get("live_status") in ("is_live", "post_live"):
            return [{}]
        return [{"start_time": self.start, "end_time": self.end if self.end is not None else math.inf}]


_SQ = re.compile(r"[?&]sq=(\d+)")


def _seq(url: str) -> int | None:
    # called for every segment of up to 120 hours, so no full URL parsing
    m = _SQ.search(url, max(0, url.rfind("sq=") - 1))
    return int(m.group(1)) if m else None


def clip(fragments, start: float, end: float | None, duration: float):
    """Keep only the segments inside [start, end); stop as soon as the range is complete."""
    first = int(start // duration)
    last = math.ceil(end / duration) if end is not None else None  # exclusive
    total = (last - first) if last is not None else None
    warned = False
    for frag in fragments:
        idx = _seq(frag.get("url") or "")
        if idx is None:
            yield frag
            continue
        if last is not None and idx >= last:
            return
        if idx < first:
            continue
        if not warned and idx > first + max(3, 60 / duration):  # a few segments off is just rounding
            warned = True
            log.warning("The live stream's early part isn't available any more; recording from segment %s", idx)
        if total:
            frag = {**frag, "fragment_count": total}
        yield frag


def _speed_up_segment_urls() -> None:
    """Build segment links ("...&sq=123") without re-parsing the long base link each time.

    A from-start recording lists every segment YouTube still has (up to 120 hours: ~86,000 per
    track) before the first one is fetched. yt-dlp builds each link with ``update_url_query``,
    which parses and re-encodes the whole URL: about a minute and a half of CPU before a
    long stream starts downloading. Appending ``sq`` gives the same link.
    """
    from yt_dlp.extractor.youtube import _video

    original = _video.update_url_query

    def update_url_query(url, query):
        if (isinstance(url, str) and isinstance(query, dict) and list(query) == ["sq"]
                and "?" in url and "sq=" not in url and "#" not in url):
            return f"{url}&sq={query['sq']}"
        return original(url, query)

    _video.update_url_query = update_url_query


_installed = False


def install() -> None:
    global _installed
    if _installed:
        return
    _installed = True
    try:
        from yt_dlp.extractor.youtube._video import YoutubeIE
    except Exception:  # pragma: no cover - layout changed; ranges then just don't apply to lives
        log.warning("Couldn't hook YouTube live segments; live time ranges are unavailable")
        return
    original = YoutubeIE._live_adaptive_fragments
    _speed_up_segment_urls()

    def _live_adaptive_fragments(self, video_id, itag, client_name, live_start_time, url_feed, base_url,
                                 fragment_duration, last_seq_cache, ctx):
        frags = original(self, video_id, itag, client_name, live_start_time, url_feed, base_url,
                         fragment_duration, last_seq_cache, ctx)
        wanted = self.get_param(PARAM)
        if not wanted or not fragment_duration:
            yield from frags
            return
        yield from clip(frags, wanted[0], wanted[1], float(fragment_duration))

    YoutubeIE._live_adaptive_fragments = _live_adaptive_fragments
