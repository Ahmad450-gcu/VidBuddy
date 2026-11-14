"""Keep yt-dlp current inside an installed (frozen) app.

Sites change often, and an old yt-dlp slowly stops working. A server install can simply
``pip install -U``, but the desktop build is a frozen bundle, so instead we:

1. check PyPI in the background for a newer yt-dlp (and the yt-dlp-ejs it pins),
2. download the pure-Python wheels, verify their SHA-256 against PyPI, unpack them into
   ``<engine_dir>/<version>/``,
3. self-test the unpacked copy in a separate process, and only then mark it current.

On the next start, :func:`activate` puts that copy in front of the bundled one. If it
fails to import for any reason we fall back to the bundled version and remember the bad
version so it is never tried again.
"""
from __future__ import annotations

import hashlib
import importlib.abc
import importlib.machinery
import json
import logging
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

log = logging.getLogger("haul.updater")

PACKAGES = ("yt_dlp", "yt_dlp_ejs")
PYPI = "https://pypi.org/pypi/{name}/json"
ALLOWED_HOSTS = ("https://files.pythonhosted.org/",)
TIMEOUT = 30
_active: dict[str, str | None] = {"version": None, "dir": None}


def version_tuple(v: str) -> tuple[int, ...]:
    return tuple(int(p) for p in re.findall(r"\d+", v))


class _OverrideFinder(importlib.abc.MetaPathFinder):
    """Resolve the yt-dlp packages from the updated folder before the bundled copy."""

    def __init__(self, root: Path) -> None:
        self.root = str(root)

    def find_spec(self, name, path=None, target=None):
        top = name.partition(".")[0]
        if top not in PACKAGES:
            return None
        search = [self.root] if "." not in name else path
        return importlib.machinery.PathFinder.find_spec(name, search, target)


def _state_file(engine_dir: Path) -> Path:
    return engine_dir / "state.json"


def _read_state(engine_dir: Path) -> dict:
    try:
        return json.loads(_state_file(engine_dir).read_text("utf-8"))
    except Exception:
        return {}


def _write_state(engine_dir: Path, state: dict) -> None:
    tmp = _state_file(engine_dir).with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2), "utf-8")
    tmp.replace(_state_file(engine_dir))


def _install_finder(root: Path) -> _OverrideFinder:
    finder = _OverrideFinder(root)
    sys.meta_path.insert(0, finder)
    return finder


def _purge_modules() -> None:
    for mod in list(sys.modules):
        if mod.partition(".")[0] in PACKAGES:
            del sys.modules[mod]


def _remove_stale(engine_dir: Path, keep: str | None) -> None:
    if not engine_dir.is_dir():
        return
    for p in engine_dir.iterdir():
        if p.is_dir() and p.name != keep:
            shutil.rmtree(p, ignore_errors=True)


def activate(engine_dir: Path) -> str | None:
    """Use the newest verified yt-dlp from ``engine_dir`` if it's newer than the bundled one.

    Must run before anything imports yt_dlp. Returns the active override version, or None.
    """
    state = _read_state(engine_dir)
    current = state.get("current")
    _remove_stale(engine_dir, keep=current)
    if not current:
        return None
    root = engine_dir / current
    if not (root / ".ok").exists() or current in state.get("bad", []):
        return None
    try:
        from importlib.metadata import version as dist_version

        bundled = dist_version("yt-dlp")
        if version_tuple(bundled) >= version_tuple(current):
            return None  # the app itself was updated past it
    except Exception:
        pass
    finder = _install_finder(root)
    try:
        import yt_dlp.version  # noqa: F401

        _active.update(version=current, dir=str(root))
        log.info("Using updated yt-dlp %s", current)
        return current
    except Exception:
        log.exception("Updated yt-dlp %s failed to load; using the bundled one", current)
        sys.meta_path.remove(finder)
        _purge_modules()
        state.setdefault("bad", []).append(current)
        state["current"] = None
        _write_state(engine_dir, state)
        return None


def active_version() -> str | None:
    return _active["version"]


def selftest(root: Path) -> str:
    """Import the unpacked copy in isolation and return its version (raises on failure)."""
    _install_finder(root)
    import yt_dlp
    from yt_dlp.version import __version__

    assert Path(yt_dlp.__file__).resolve().is_relative_to(root.resolve()), "loaded the wrong copy"
    yt_dlp.YoutubeDL({"quiet": True})  # extractors and networking initialise
    return __version__


def _get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "VidBuddy-updater"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read())


def _wheel(meta: dict) -> dict:
    for f in meta["urls"]:
        if f["packagetype"] == "bdist_wheel" and f["filename"].endswith("-py3-none-any.whl"):
            if not f["url"].startswith(ALLOWED_HOSTS):
                raise ValueError(f"unexpected download host: {f['url']}")
            return f
    raise ValueError("no pure-Python wheel published")


def _download(f: dict, dest: Path) -> None:
    sha = hashlib.sha256()
    req = urllib.request.Request(f["url"], headers={"User-Agent": "VidBuddy-updater"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r, dest.open("wb") as out:
        while chunk := r.read(1 << 16):
            sha.update(chunk)
            out.write(chunk)
    if sha.hexdigest() != f["digests"]["sha256"]:
        raise ValueError(f"checksum mismatch for {f['filename']}")


def _unpack(wheel: Path, dest: Path) -> None:
    with zipfile.ZipFile(wheel) as z:
        members = [m for m in z.namelist() if m.partition("/")[0] in PACKAGES]
        z.extractall(dest, members)  # extractall strips absolute and ".." paths


def _pinned_ejs(meta: dict) -> str | None:
    for req in meta["info"].get("requires_dist") or []:
        m = re.match(r"yt-dlp-ejs\s*==\s*([\w.]+)", req)
        if m:
            return m.group(1)
    return None


def _selftest_command(root: Path, out: Path) -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, "--engine-selftest", str(root), str(out)]
    code = ("import sys; from pathlib import Path; from app.engine import updater; "
            "Path(sys.argv[2]).write_text(updater.selftest(Path(sys.argv[1])))")
    return [sys.executable, "-c", code, str(root), str(out)]


def check_and_update(engine_dir: Path) -> str | None:
    """Download a newer yt-dlp if one exists. Returns the new version, or None. Never raises."""
    try:
        return _check_and_update(engine_dir)
    except Exception as e:
        log.warning("yt-dlp update check failed: %s", e)
        return None


def _check_and_update(engine_dir: Path) -> str | None:
    import yt_dlp.version

    engine_dir.mkdir(parents=True, exist_ok=True)
    state = _read_state(engine_dir)
    running = yt_dlp.version.__version__
    meta = _get_json(PYPI.format(name="yt-dlp"))
    latest = meta["info"]["version"]
    known = state.get("current") or running
    if version_tuple(latest) <= version_tuple(max(running, known, key=version_tuple)):
        return None
    if latest in state.get("bad", []):
        return None

    log.info("Downloading yt-dlp %s (running %s)", latest, running)
    staging = Path(tempfile.mkdtemp(prefix="update-", dir=engine_dir))
    try:
        files = [_wheel(meta)]
        ejs = _pinned_ejs(meta)
        if ejs:
            files.append(_wheel(_get_json(f"https://pypi.org/pypi/yt-dlp-ejs/{ejs}/json")))
        root = staging / "pkg"
        root.mkdir()
        for f in files:
            whl = staging / f["filename"]
            _download(f, whl)
            _unpack(whl, root)
            whl.unlink()

        out = staging / "selftest.txt"
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        subprocess.run(_selftest_command(root, out), check=True, timeout=120,
                       capture_output=True, creationflags=flags)
        tested = out.read_text().strip()
        if tested != latest:
            raise ValueError(f"self-test reported {tested!r}, expected {latest!r}")
        (root / ".ok").write_text(latest)

        final = engine_dir / latest
        if final.exists():
            shutil.rmtree(final, ignore_errors=True)
        root.replace(final)
        state["current"] = latest
        _write_state(engine_dir, state)  # older copies are removed at the next start
        log.info("yt-dlp %s is ready and will be used from the next start", latest)
        return latest
    finally:
        shutil.rmtree(staging, ignore_errors=True)
