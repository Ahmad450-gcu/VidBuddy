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


def test_netcompat_demotes_profiles_the_network_drops(monkeypatch):
    """Newest Chrome profiles time out (middlebox drops big ClientHello) -> an older Chrome wins."""
    pytest.importorskip("curl_cffi")
    from yt_dlp.networking import _curlcffi
    from yt_dlp.networking.impersonate import ImpersonateTarget

    from app.engine import errors, netcompat

    original = dict(_curlcffi.CurlCFFIRH._SUPPORTED_IMPERSONATE_TARGET_MAP)
    chromes = [n for t, n in original.items() if t.client == "chrome" and t.os not in ("ios", "android")]
    broken = set(chromes[:3])  # pretend the three newest Chrome profiles can't connect
    monkeypatch.setattr(netcompat, "_probe", lambda _req, name: name not in broken)
    try:
        result = netcompat.tune_impersonation()
        assert set(result["blocked"]) == {str(b) for b in broken}
        handler = _curlcffi.CurlCFFIRH(logger=None, verbose=False)
        resolved = handler._resolve_target(ImpersonateTarget("chrome"))
        assert original[resolved] == chromes[3]
    finally:
        _curlcffi.CurlCFFIRH._SUPPORTED_IMPERSONATE_TARGET_MAP = original

    assert errors.classify("ERROR: [dailymotion] x: No video formats found!").code == "no_formats"


def test_updater_helpers(tmp_path):
    import io
    import zipfile

    import pytest

    from app.engine import updater

    assert updater.version_tuple("2026.10.26.1") > updater.version_tuple("2026.10.26")
    assert updater.version_tuple("2026.11.2") > updater.version_tuple("2026.10.26")

    meta = {"info": {"requires_dist": ["yt-dlp-ejs==0.9.1; extra == \"default\"", "brotli; extra == \"default\""]},
            "urls": [{"packagetype": "sdist", "filename": "yt_dlp-1.tar.gz", "url": "https://files.pythonhosted.org/a"},
                     {"packagetype": "bdist_wheel", "filename": "yt_dlp-1-py3-none-any.whl",
                      "url": "https://files.pythonhosted.org/b", "digests": {"sha256": "x"}}]}
    assert updater._pinned_ejs(meta) == "0.9.1"
    assert updater._wheel(meta)["url"].endswith("/b")
    meta["urls"][1]["url"] = "https://evil.example/b"
    with pytest.raises(ValueError):
        updater._wheel(meta)

    # only the two packages are unpacked; anything else in the wheel (or a path escape) is ignored
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("yt_dlp/__init__.py", "")
        z.writestr("yt_dlp_ejs/x.js", "")
        z.writestr("other/evil.py", "")
        z.writestr("yt_dlp-1.dist-info/METADATA", "")
    whl = tmp_path / "w.whl"
    whl.write_bytes(buf.getvalue())
    dest = tmp_path / "out"
    updater._unpack(whl, dest)
    assert sorted(p.name for p in dest.iterdir()) == ["yt_dlp", "yt_dlp_ejs"]

    # no state yet: nothing activated, and stale folders are cleaned up
    engine = tmp_path / "engine"
    (engine / "2020.1.1").mkdir(parents=True)
    assert updater.activate(engine) is None
    assert not (engine / "2020.1.1").exists()
