# PyInstaller spec for the VidBuddy Windows app. Build with desktop/build.ps1.
# -*- mode: python -*-
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

HERE = Path(SPECPATH)
BACKEND = HERE.parent
BUILD = HERE / "build"

datas = [
    (str(BACKEND.parent / "frontend" / "dist"), "web"),
    (str(BUILD / "vidbuddy.ico"), "."),
]
datas += collect_data_files("imageio_ffmpeg")       # the bundled ffmpeg.exe
datas += collect_data_files("webview")              # WebView2 interop DLLs and JS
datas += collect_data_files("certifi")
binaries = collect_dynamic_libs("curl_cffi")
if (BUILD / "deno" / "deno.exe").exists():
    binaries.append((str(BUILD / "deno" / "deno.exe"), "deno"))

hiddenimports = (
    collect_submodules("app")
    + collect_submodules("uvicorn")
    + ["webview.platforms.edgechromium", "webview.platforms.winforms", "clr_loader", "pythonnet"]
)

a = Analysis(
    [str(HERE / "launcher.py")],
    pathex=[str(BACKEND)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "pytest", "PyInstaller", "webview.platforms.android", "webview.platforms.cocoa",
              "webview.platforms.gtk", "webview.platforms.qt", "webview.platforms.cef"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="VidBuddy",
    console=False,
    icon=str(BUILD / "vidbuddy.ico"),
    version=str(BUILD / "version_info.txt"),
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="VidBuddy", upx=False)
