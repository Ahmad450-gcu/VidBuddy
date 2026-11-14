from pathlib import Path

import pytest

from app.engine.security import (
    UnsafeInputError, extract_url, safe_join, sanitize_filename, validate_template, validate_url,
)


@pytest.mark.parametrize("url", [
    "file:///etc/passwd", "javascript:alert(1)", "ftp://example.com/a.mp4", "", "http://", "x" * 3000,
])
def test_rejects_bad_urls(url):
    with pytest.raises(UnsafeInputError):
        validate_url(url, resolve=False)


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/a.mp4", "http://10.0.0.5/", "http://192.168.1.1/x", "http://localhost:8000/",
    "http://[::1]/", "http://169.254.169.254/latest/meta-data", "http://router.local/",
])
def test_ssrf_guard_blocks_private_targets(url):
    with pytest.raises(UnsafeInputError):
        validate_url(url, resolve=False)


def test_private_allowed_when_configured():
    assert validate_url("http://127.0.0.1/a.mp4", allow_private=True) == "http://127.0.0.1/a.mp4"


def test_extracts_url_from_share_text():
    text = "Check this out! https://youtu.be/abc123?t=5 via the app"
    assert extract_url(text) == "https://youtu.be/abc123?t=5"
    assert validate_url(text, resolve=False) == "https://youtu.be/abc123?t=5"


@pytest.mark.parametrize("raw,expected", [
    ("a/b\\c:d*e?.mp4", "a_b_c_d_e_.mp4"),
    ("CON.mp3", "_CON.mp3"),
    ("   ...hidden.mp4", "hidden.mp4"),
    ("", "untitled"),
    ("../../etc/passwd", "_.._etc_passwd"),
])
def test_sanitize_filename(raw, expected):
    assert sanitize_filename(raw) == expected


def test_sanitize_respects_byte_length():
    name = sanitize_filename("é" * 300 + ".mp4", max_len=100)
    assert len(name.encode()) <= 100 and name.endswith(".mp4")


def test_safe_join_blocks_traversal(tmp_path: Path):
    assert safe_join(tmp_path, "video/a.mp4") == (tmp_path / "video/a.mp4").resolve()
    for bad in ("../x", "video/../../x", str(Path("/") / "etc" / "passwd")):
        with pytest.raises(UnsafeInputError):
            safe_join(tmp_path, bad)


def test_templates():
    assert validate_template(None) == "%(title)s [%(id)s].%(ext)s"
    assert validate_template("%(uploader)s - %(title)s") == "%(uploader)s - %(title)s.%(ext)s"
    for bad in ("%(title)s/../x", "%(__import__)s", "plain", "%(title)r", "a\\b %(id)s"):
        with pytest.raises(UnsafeInputError):
            validate_template(bad)
