"""VidBuddy for Windows: runs the API on localhost and shows the app in a native window.

The window is Edge WebView2 (built into Windows 10/11) via pywebview, the server is the
same FastAPI app the web version uses, started in-process on 127.0.0.1 only. Everything a
user keeps lives in two places:

* %LOCALAPPDATA%\\VidBuddy   database, thumbnails, logs, browser storage, engine updates
* <Videos>\\VidBuddy          the downloaded media itself
"""
from __future__ import annotations

import ctypes
import logging
import logging.handlers
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

APP_NAME = "VidBuddy"
PREFERRED_PORT = 47811  # fixed so the window's origin (and its saved settings) stays the same
FROZEN = getattr(sys, "frozen", False)
BUNDLE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


# ------------------------------------------------------------------ locations
def known_folder(guid: str, fallback: Path) -> Path:
    """Resolve a Windows known folder (honours OneDrive/redirected folders)."""
    if sys.platform != "win32":
        return fallback
    try:
        from ctypes import wintypes

        class GUID(ctypes.Structure):
            _fields_ = [("d1", wintypes.DWORD), ("d2", wintypes.WORD), ("d3", wintypes.WORD), ("d4", ctypes.c_ubyte * 8)]

        import uuid

        u = uuid.UUID(guid)
        g = GUID(u.fields[0], u.fields[1], u.fields[2], (ctypes.c_ubyte * 8)(*u.bytes[8:]))
        out = ctypes.c_wchar_p()
        if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(g), 0, None, ctypes.byref(out)) == 0:
            path = Path(out.value)
            ctypes.windll.ole32.CoTaskMemFree(out)
            return path
    except Exception:
        pass
    return fallback


def data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(base) / APP_NAME


def media_dir() -> Path:
    videos = known_folder("18989B1D-99B5-455B-841C-AB7C74E4DDFC", Path.home() / "Videos")
    return videos / APP_NAME


# ------------------------------------------------------------------ process setup
def setup_logging(data: Path) -> None:
    logs = data / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(logs / "vidbuddy.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    if FROZEN and (sys.stdout is None or sys.stderr is None):
        # windowed build: there is no console, so send stray prints to the log as well
        stream = open(logs / "console.log", "a", encoding="utf-8", buffering=1)  # noqa: SIM115
        sys.stdout = sys.stdout or stream
        sys.stderr = sys.stderr or stream


def hide_child_consoles() -> None:
    """A GUI app that starts ffmpeg/deno would flash a console window for each one."""
    if sys.platform != "win32":
        return
    original = subprocess.Popen.__init__
    no_window = subprocess.CREATE_NO_WINDOW

    def init(self, *args, **kwargs):
        kwargs["creationflags"] = kwargs.get("creationflags", 0) | no_window
        original(self, *args, **kwargs)

    subprocess.Popen.__init__ = init  # type: ignore[method-assign]


_mutex = None


def already_running() -> bool:
    """Single instance: if VidBuddy is open already, bring it to the front instead."""
    global _mutex
    if sys.platform != "win32":
        return False
    kernel32 = ctypes.windll.kernel32
    _mutex = kernel32.CreateMutexW(None, False, "Local\\VidBuddyDesktop")
    if kernel32.GetLastError() != 183:  # ERROR_ALREADY_EXISTS
        return False
    user32 = ctypes.windll.user32
    hwnd = user32.FindWindowW(None, APP_NAME)
    if hwnd:
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        user32.SetForegroundWindow(hwnd)
    return True


def load_token(data: Path) -> str:
    """A per-install secret so other programs and web pages can't drive the local API."""
    f = data / "desktop-token"
    try:
        token = f.read_text("utf-8").strip()
        if len(token) >= 32:
            return token
    except OSError:
        pass
    token = secrets.token_urlsafe(32)
    f.write_text(token, "utf-8")
    return token


def pick_port() -> int:
    for port in (PREFERRED_PORT, 0):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("no free port")


def wait_until_up(url: str, timeout: float = 60) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2):
                return True
        except Exception:
            time.sleep(0.15)
    return False


def message_box(text: str) -> None:
    if sys.platform == "win32":
        ctypes.windll.user32.MessageBoxW(None, text, APP_NAME, 0x10)


# ------------------------------------------------------------------ main
def main() -> int:
    if len(sys.argv) >= 4 and sys.argv[1] == "--engine-selftest":
        from app.engine import updater

        Path(sys.argv[3]).write_text(updater.selftest(Path(sys.argv[2])))
        return 0

    if already_running():
        return 0

    data = data_dir()
    data.mkdir(parents=True, exist_ok=True)
    setup_logging(data)
    log = logging.getLogger("vidbuddy.desktop")
    hide_child_consoles()

    from app.engine import updater

    updater.activate(data / "engine")  # before anything imports yt_dlp

    token = load_token(data)
    port = pick_port()
    os.environ.update({
        "HAUL_DATA_DIR": str(data),
        "HAUL_MEDIA_DIR": str(media_dir()),
        "HAUL_API_TOKEN": token,
        "HAUL_DESKTOP": "true",
        "HAUL_CORS_ORIGINS": "[]",
    })
    web = BUNDLE / "web"
    if web.is_dir():
        os.environ["HAUL_FRONTEND_DIST"] = str(web)
    deno = BUNDLE / "deno" / "deno.exe"
    if deno.is_file():
        os.environ["HAUL_JS_RUNTIME"] = str(deno)

    import uvicorn

    from app.main import app

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_config=None,
                                           access_log=False, timeout_graceful_shutdown=5))
    threading.Thread(target=server.run, name="api", daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    if not wait_until_up(f"{base}/api/health?token={token}"):
        log.error("API did not start")
        message_box("VidBuddy couldn't start. Details are in %LOCALAPPDATA%\\VidBuddy\\logs.")
        return 1
    log.info("VidBuddy desktop ready on %s", base)

    if FROZEN:
        def keep_engine_fresh() -> None:
            while True:  # at startup, then daily for people who leave the app open
                updater.check_and_update(data / "engine")
                time.sleep(24 * 3600)

        threading.Thread(target=keep_engine_fresh, name="engine-update", daemon=True).start()

    import webview

    class Bridge:
        """Called from the page as window.pywebview.api.* (pywebview runs these off the UI thread)."""

        def __init__(self) -> None:
            self._full = False

        def fullscreen(self, on: bool) -> None:
            # HTML fullscreen only fills the WebView; take the whole window along with it
            if bool(on) != self._full:
                self._full = bool(on)
                window.toggle_fullscreen()

        def pick_folder(self, start: str = "") -> str | None:
            """Windows' own folder picker, for choosing where downloads are saved."""
            start_dir = start if start and Path(start).is_dir() else str(media_dir())
            picked = window.create_file_dialog(webview.FOLDER_DIALOG, directory=start_dir)
            if not picked:
                return None
            return str(picked[0] if isinstance(picked, (list, tuple)) else picked)

    window = webview.create_window(
        APP_NAME,
        f"{base}/?desktop_token={token}",
        width=1280,
        height=820,
        min_size=(400, 600),
        background_color="#0B0B0F",
        text_select=True,
        js_api=Bridge(),
    )

    def on_closing() -> bool:
        try:
            counts = app.state.services.jobs.counts()
        except Exception:
            return True
        running = sum(counts.get(s, 0) for s in ("downloading", "processing", "queued"))
        if not running:
            return True
        noun = "download is" if running == 1 else "downloads are"
        return window.create_confirmation_dialog(
            "Quit VidBuddy?", f"{running} {noun} still in progress. They'll pick up again next time you open VidBuddy.")

    window.events.closing += on_closing
    webview.start(private_mode=False, storage_path=str(data / "webview"), icon=str(BUNDLE / "vidbuddy.ico"))

    server.should_exit = True
    time.sleep(0.5)
    return 0


if __name__ == "__main__":
    sys.exit(main())
