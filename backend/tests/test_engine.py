from pathlib import Path

import pytest

from app.engine.downloader import DownloadOptions, build_options, format_spec
from app.engine.errors import classify
from app.engine.extractor import build_presets, normalize_format
from app.engine.security import UnsafeInputError
from app.engine.sources import identify


@pytest.mark.parametrize("msg,code", [
    ("ERROR: Unsupported URL: https://example.com", "unsupported"),
    ("ERROR: [youtube] x: Private video. Sign in if you've been granted access", "auth"),
    ("ERROR: The uploader has not made this video available in your country", "geo"),
    ("ERROR: unable to download video data: HTTP Error 429: Too Many Requests", "rate_limited"),
    ("ERROR: Connection timed out after 20000 ms", "network"),
    ("ERROR: This video is DRM protected", "drm"),
    ("ERROR: [youtube] x: Video unavailable", "unavailable"),
    ("weird", "unknown"),
])
def test_error_classification(msg, code):
    assert classify(msg).code == code


def test_identify_sources():
    assert identify("https://www.youtube.com/watch?v=jNQXAC9IVRw").key == "youtube"
    assert identify("https://youtu.be/jNQXAC9IVRw").name == "YouTube"
    assert identify("https://www.dailymotion.com/video/x8j8yqk").name == "Dailymotion"
    assert identify("https://vimeo.com/76979871").name == "Vimeo"
    assert identify("https://cdn.example.com/files/clip.mp4?sig=1").key == "direct"
    assert identify("https://example.com/article").key == "web"


def _fmt(**kw):
    base = {"format_id": "x", "ext": "mp4", "vcodec": "none", "acodec": "none"}
    base.update(kw)
    return normalize_format(base, 100)


def test_presets_group_by_height_and_add_audio_size():
    formats = [
        _fmt(format_id="137", height=1080, width=1920, vcodec="avc1.640028", fps=30, filesize=50_000_000),
        _fmt(format_id="248", height=1080, width=1920, vcodec="vp9", fps=60, filesize=40_000_000),
        _fmt(format_id="136", height=720, vcodec="avc1.4d401f", fps=30, tbr=1500),
        _fmt(format_id="140", acodec="mp4a.40.2", abr=128, filesize=1_600_000),
        _fmt(format_id="251", acodec="opus", abr=160, filesize=2_000_000),
    ]
    p = build_presets(formats, 100)
    assert [v["id"] for v in p["video"]] == ["h1080", "h720"]
    hd = p["video"][0]
    assert hd["label"] == "1080p60" and set(hd["codecs"]) == {"H.264", "VP9"}
    assert hd["size_estimate"] == 40_000_000 + 2_000_000  # 60fps VP9 + best audio
    assert p["video"][1]["size_estimate"] == int(1500 * 1000 / 8 * 100) + 2_000_000
    assert p["audio"]["source_abr"] == 160
    assert p["has_audio"] and p["has_video"]


def test_audio_only_source():
    p = build_presets([_fmt(format_id="mp3", ext="mp3", acodec="mp3", abr=320)], 60)
    assert p["video"] == [] and p["has_audio"] and not p["has_video"]


def test_format_spec_variants():
    assert format_spec(DownloadOptions(kind="audio")) == ("ba/b", ["abr", "asr"])
    fmt, sort = format_spec(DownloadOptions(quality="h720", container="mp4"))
    assert fmt == "bv*+ba/b" and sort[:2] == ["res:720", "vcodec:h264"]
    assert format_spec(DownloadOptions(quality="fmt:137"))[0] == "137+ba/137"
    assert format_spec(DownloadOptions(quality="fmt:137+140"))[0] == "137+140"
    with pytest.raises(UnsafeInputError):
        format_spec(DownloadOptions(quality="fmt:137; rm -rf /"))
    with pytest.raises(UnsafeInputError):
        format_spec(DownloadOptions(quality="ultra"))


def test_audio_options_include_extract_and_thumbnail(tmp_path: Path):
    opts = build_options(DownloadOptions(kind="audio", audio_format="mp3", audio_bitrate=192), home=tmp_path, temp=tmp_path)
    keys = [p["key"] for p in opts["postprocessors"]]
    assert keys == ["FFmpegThumbnailsConvertor", "FFmpegExtractAudio", "FFmpegMetadata", "EmbedThumbnail"]
    assert opts["postprocessors"][1]["preferredquality"] == "192"
    wav = build_options(DownloadOptions(kind="audio", audio_format="wav"), home=tmp_path, temp=tmp_path)
    assert "EmbedThumbnail" not in [p["key"] for p in wav["postprocessors"]]


def test_video_options(tmp_path: Path):
    opts = build_options(DownloadOptions(kind="video", container="mkv", max_filesize_mb=10), home=tmp_path, temp=tmp_path)
    assert opts["merge_output_format"] == "mkv"
    assert opts["max_filesize"] == 10 * 1024 * 1024
    assert opts["paths"]["home"] == str(tmp_path.resolve())
    with pytest.raises(UnsafeInputError):
        build_options(DownloadOptions(container="avi"), home=tmp_path, temp=tmp_path)


def test_unknown_codecs_assume_muxed_media():
    # Direct links: yt-dlp omits codec keys entirely
    f = normalize_format({"format_id": "0", "ext": "mp4"}, 10)
    assert f["has_video"] and f["has_audio"]
    a = normalize_format({"format_id": "0", "ext": "mp3", "vcodec": "none"}, 10)
    assert a["has_audio"] and not a["has_video"]
    v = normalize_format({"format_id": "1", "ext": "mp4", "vcodec": "avc1", "acodec": "none", "height": 720}, 10)
    assert v["has_video"] and not v["has_audio"]
