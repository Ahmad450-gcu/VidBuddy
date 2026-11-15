"""Separate HLS audio tracks: make sure they get merged in.

Many HLS players keep the audio in its own rendition (``#EXT-X-MEDIA:TYPE=AUDIO,...,URI=...``)
and point the video variants at it with ``AUDIO="group"``. When the master playlist doesn't list
``CODECS``, yt-dlp can't tell that the variants are video-only: it treats their audio as
"unknown, probably present", so ``bestvideo*+bestaudio`` picks the variant alone and the file
comes out silent.

Fix: when a playlist offers audio-only renditions, its variants whose audio is unknown are marked
video-only, so the best audio rendition is merged in. If a variant did carry its own audio after
all, the merge simply uses the rendition's audio track instead, so the file still has sound.
"""
from __future__ import annotations

from typing import Any

_installed = False


def _is_hls(f: dict[str, Any]) -> bool:
    return str(f.get("protocol") or "").startswith("m3u8")


def mark_video_only_variants(formats: list[dict[str, Any]]) -> int:
    """Mark HLS variants with unknown audio as video-only where the same playlist has audio renditions."""
    audio_manifests = {
        f.get("manifest_url") for f in formats
        if _is_hls(f) and f.get("vcodec") == "none" and f.get("acodec") != "none" and f.get("url")
    }
    audio_manifests.discard(None)
    if not audio_manifests:
        return 0
    changed = 0
    for f in formats:
        if (_is_hls(f) and f.get("manifest_url") in audio_manifests and f.get("vcodec") != "none"
                and f.get("acodec") is None):
            f["acodec"] = "none"
            changed += 1
    return changed


def install() -> None:
    global _installed
    if _installed:
        return
    _installed = True
    from yt_dlp import YoutubeDL

    original = YoutubeDL.process_video_result

    def process_video_result(self, info_dict, download=True):
        formats = info_dict.get("formats")
        if isinstance(formats, list):
            mark_video_only_variants(formats)
        return original(self, info_dict, download)

    YoutubeDL.process_video_result = process_video_result
