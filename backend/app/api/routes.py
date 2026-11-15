"""HTTP API routes (mounted under /api)."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse

from ..engine import cookies, extractor
from ..engine.errors import EngineError, classify
from ..engine.headers import cache_key, parse_headers
from ..engine.downloader import live_parts
from ..engine.preview import PreviewStream, PreviewUnavailable, PreviewUnplayable
from ..engine.runtime import ffmpeg_location
from ..engine.runtime import engine_versions
from ..engine.security import UnsafeInputError, validate_template, validate_url
from ..engine.sources import identify, supported_sites
from . import schemas as S
from .deps import Services, rate_limited, require_auth, services

log = logging.getLogger("haul.api")
router = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])

DEFAULT_PREFS: dict[str, Any] = {
    "max_concurrent": 3,
    "default_kind": "video",
    "default_quality": "h1080",
    "default_container": "mp4",
    "default_audio_format": "mp3",
    "default_audio_bitrate": 192,
    "filename_template": "%(title)s [%(id)s].%(ext)s",
    "subtitles": False,
    "subtitle_langs": ["en"],
    "embed_metadata": True,
    "embed_thumbnail": True,
    "skip_duplicates": False,
}


def _bad(e: Exception, code: int = 400) -> HTTPException:
    return HTTPException(code, str(e))


# --------------------------------------------------------------------- system
@router.get("/health")
def health(svc: Services = Depends(services)) -> dict[str, Any]:
    return {"ok": True, "time": time.time(), "subscribers": svc.bus.subscriber_count}


@router.get("/system")
def system(svc: Services = Depends(services)) -> dict[str, Any]:
    return {
        "engine": engine_versions(),
        "media_root": str(svc.library.media_root),
        "auth": bool(svc.settings.api_token),
        "supported_site_count": len(supported_sites()),
        "desktop": svc.settings.desktop,
    }


# ------------------------------------------------------------ desktop only
def _desktop_only(svc: Services) -> None:
    # These open windows on the machine running the server, so they only make
    # sense (and are only allowed) in the single-user desktop app.
    if not svc.settings.desktop:
        raise HTTPException(404, "Not found.")


@router.post("/media/{media_id}/reveal", status_code=204)
def reveal_media(media_id: str, svc: Services = Depends(services)) -> None:
    _desktop_only(svc)
    row = _media_or_404(svc, media_id)
    path = svc.library.abs_path(row["path"])
    if not path.exists():
        raise HTTPException(410, "The file is no longer on disk.")
    from ..engine.runtime import reveal_in_explorer

    reveal_in_explorer(path)


@router.post("/system/open-media-folder", status_code=204)
def open_media_folder(svc: Services = Depends(services)) -> None:
    _desktop_only(svc)
    from ..engine.runtime import reveal_in_explorer

    reveal_in_explorer(svc.library.media_root, select=False)


@router.get("/sources")
def sources(q: str = Query("", max_length=60)) -> dict[str, Any]:
    sites = supported_sites()
    if q:
        sites = [s for s in sites if q.lower() in s.lower()]
    return {"count": len(supported_sites()), "items": sites[:300]}


# ------------------------------------------------------------------- analyze
@router.post("/analyze", dependencies=[Depends(rate_limited)])
async def analyze(body: S.AnalyzeRequest, svc: Services = Depends(services)) -> dict[str, Any]:
    try:
        url = await asyncio.to_thread(validate_url, body.url, allow_private=svc.settings.allow_private_networks)
        headers = parse_headers(body.headers)
    except UnsafeInputError as e:
        raise _bad(e, 422)
    key = cache_key(url, headers)
    cached = None if body.refresh else svc.db.one("SELECT data, created_at FROM info_cache WHERE url = ?", (key,))
    if cached and time.time() - cached["created_at"] < svc.settings.info_cache_ttl:
        data = json.loads(cached["data"])
        data["cached"] = True
    else:
        try:
            data = await asyncio.wait_for(
                asyncio.to_thread(extractor.analyze, url, max_playlist_items=svc.settings.max_playlist_items,
                                  headers=headers),
                timeout=svc.settings.extract_timeout)
        except asyncio.TimeoutError:
            raise HTTPException(504, {"code": "timeout", "message": "The site took too long to respond. Try again."})
        except EngineError as e:
            raise HTTPException(422, {"code": e.code, "message": e.message, "detail": e.detail[:500]})
        svc.db.execute("INSERT OR REPLACE INTO info_cache(url, data, created_at) VALUES (?,?,?)",
                       (key, json.dumps(data), time.time()))
        svc.db.execute("DELETE FROM info_cache WHERE created_at < ?", (time.time() - svc.settings.info_cache_ttl,))
        data["cached"] = False
    if data.get("type") == "media":
        data["existing"] = {k: svc.library.find_existing(data["url"], k) for k in ("video", "audio")}
    return data


# ----------------------------------------------------------------- downloads
@router.get("/downloads")
def list_downloads(status: str | None = None, svc: Services = Depends(services)) -> dict[str, Any]:
    return {"items": svc.jobs.list(status), "counts": svc.jobs.counts(), "concurrency": svc.jobs.concurrency}


@router.post("/downloads", status_code=201, dependencies=[Depends(rate_limited)])
async def create_download(body: S.CreateDownloadRequest, svc: Services = Depends(services)) -> dict[str, Any]:
    allow_private = svc.settings.allow_private_networks
    targets: list[tuple[str, str | None, str | None]] = []
    try:
        headers = parse_headers(body.headers)
        options = {**body.options.model_dump(), "headers": headers}
        if body.entries:
            for e in body.entries:
                targets.append((validate_url(e.url, allow_private=allow_private, resolve=False), e.title, e.thumbnail))
        elif body.url:
            url = await asyncio.to_thread(validate_url, body.url, allow_private=allow_private)
            targets.append((url, body.title, body.thumbnail))
        else:
            raise UnsafeInputError("Provide a url or a list of entries.")
        jobs = [svc.jobs.create(url=u, kind=body.kind, options=options, title=t, thumbnail=th,
                                priority=body.priority, scheduled_at=body.scheduled_at,
                                playlist_title=body.playlist_title)
                for u, t, th in targets]
    except UnsafeInputError as e:
        raise _bad(e, 422)
    return {"items": jobs}


@router.get("/downloads/{job_id}/preview")
async def preview_download(job_id: str, svc: Services = Depends(services)):
    """Play what a running (or paused) download has fetched so far, as a live MP4/WebM stream."""
    job = svc.jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Download not found.")
    if job["status"] == "completed":
        raise HTTPException(409, {"code": "completed", "message": "This download has finished. Open it from your library.",
                                  "media_id": job.get("media_id")})
    if job["status"] in ("failed", "cancelled"):
        raise HTTPException(409, {"code": "not_ready", "message": "This download isn't running."})
    ff = ffmpeg_location()
    if not ff:
        raise HTTPException(409, {"code": "not_ready", "message": "Playing while downloading needs FFmpeg."})
    if Path(ff).is_dir():
        ff = str(Path(ff) / ("ffmpeg.exe" if (Path(ff) / "ffmpeg.exe").exists() else "ffmpeg"))
    temp = svc.jobs.temp_root / job_id
    parts = live_parts(temp)

    def refresh(part: dict[str, Any]) -> dict[str, Any]:  # the part's latest state (done yet?)
        return next((p for p in live_parts(temp) if p["path"] == part["path"]), part)

    try:
        stream = await asyncio.to_thread(PreviewStream, ff, parts, job["kind"],
                                         lambda: svc.jobs.is_running(job_id), refresh)
    except PreviewUnplayable as e:
        raise HTTPException(409, {"code": "unplayable", "message": str(e)})
    except PreviewUnavailable as e:
        raise HTTPException(409, {"code": "not_ready", "message": str(e)})
    first = await asyncio.to_thread(stream.read)
    if not first:
        detail = await asyncio.to_thread(stream.error)
        await asyncio.to_thread(stream.close)
        log.info("Preview of %s failed: %s", job_id, detail)
        raise HTTPException(409, {"code": "unplayable", "message": (
            "This download can't be played until it finishes: its file format keeps the index at the end.")})

    async def body():
        try:
            yield first
            while True:
                chunk = await asyncio.to_thread(stream.read)
                if not chunk:
                    break
                yield chunk
        finally:
            await asyncio.to_thread(stream.close)

    return StreamingResponse(body(), media_type=stream.media_type, headers={"Cache-Control": "no-store"})


def _job_action(fn, job_id: str):
    try:
        return fn(job_id)
    except KeyError:
        raise HTTPException(404, "Download not found.")


@router.get("/downloads/{job_id}")
def get_download(job_id: str, svc: Services = Depends(services)):
    job = svc.jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Download not found.")
    return job


@router.post("/downloads/{job_id}/pause")
def pause(job_id: str, svc: Services = Depends(services)):
    return _job_action(svc.jobs.pause, job_id)


@router.post("/downloads/{job_id}/resume")
def resume(job_id: str, svc: Services = Depends(services)):
    return _job_action(svc.jobs.resume, job_id)


@router.post("/downloads/{job_id}/retry")
def retry(job_id: str, svc: Services = Depends(services)):
    return _job_action(svc.jobs.retry, job_id)


@router.post("/downloads/{job_id}/cancel")
def cancel(job_id: str, svc: Services = Depends(services)):
    return _job_action(svc.jobs.cancel, job_id)


@router.patch("/downloads/{job_id}")
def patch_download(job_id: str, body: S.JobPatch, svc: Services = Depends(services)):
    try:
        job = None
        if body.priority is not None:
            job = svc.jobs.set_priority(job_id, body.priority)
        if body.clear_schedule or body.scheduled_at is not None:
            job = svc.jobs.set_schedule(job_id, None if body.clear_schedule else body.scheduled_at)
        return job or svc.jobs.get(job_id)
    except KeyError:
        raise HTTPException(404, "Download not found.")


@router.delete("/downloads/{job_id}", status_code=204)
def delete_download(job_id: str, svc: Services = Depends(services)) -> None:
    if not svc.jobs.delete(job_id):
        raise HTTPException(404, "Download not found.")


@router.post("/downloads/actions/pause-all")
def pause_all(svc: Services = Depends(services)):
    return {"affected": svc.jobs.pause_all()}


@router.post("/downloads/actions/resume-all")
def resume_all(svc: Services = Depends(services)):
    return {"affected": svc.jobs.resume_all()}


@router.post("/downloads/actions/clear")
def clear(scope: str = Query("finished", pattern="^(finished|completed|failed)$"), svc: Services = Depends(services)):
    statuses = {"finished": ("completed", "failed", "cancelled"), "completed": ("completed",),
                "failed": ("failed", "cancelled")}[scope]
    return {"affected": svc.jobs.clear(statuses)}


# --------------------------------------------------------------------- events
@router.get("/events")
async def events(request: Request, svc: Services = Depends(services)):
    q = svc.bus.subscribe()

    async def stream():
        try:
            yield "retry: 3000\n\n"
            yield f"event: hello\ndata: {json.dumps({'time': time.time()})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15)
                    yield msg
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            svc.bus.unsubscribe(q)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------- media
@router.get("/media")
def list_media(kind: str | None = None, q: str | None = Query(None, max_length=200), favorite: bool = False,
               sort: str = "created", order: str = "desc", status: str | None = None, source: str | None = None,
               limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0),
               svc: Services = Depends(services)):
    out = svc.library.list(kind=kind, q=q, favorite=favorite, sort=sort, order=order, status=status, source=source,
                           limit=limit, offset=offset)
    out["sources"] = svc.library.sources()
    return out


@router.get("/media/duplicates")
def duplicates(svc: Services = Depends(services)):
    return {"groups": svc.library.duplicates()}


@router.post("/media/rescan")
async def rescan(svc: Services = Depends(services)):
    return await asyncio.to_thread(svc.library.rescan)


@router.post("/media/bulk-delete")
def bulk_delete(body: S.BulkDelete, svc: Services = Depends(services)):
    n = sum(1 for i in body.ids if svc.library.delete(i, delete_file=body.delete_file))
    svc.bus.publish("media", {"action": "deleted", "ids": body.ids})
    return {"affected": n}


def _media_or_404(svc: Services, media_id: str) -> dict[str, Any]:
    row = svc.library.get(media_id)
    if not row:
        raise HTTPException(404, "Media not found.")
    return row


@router.get("/media/{media_id}")
def get_media(media_id: str, svc: Services = Depends(services)):
    row = _media_or_404(svc, media_id)
    out = svc.library.serialize(row)
    out["playlists"] = svc.db.all(
        "SELECT p.id, p.name FROM playlists p JOIN playlist_items pi ON pi.playlist_id = p.id WHERE pi.media_id = ?",
        (media_id,))
    return out


@router.patch("/media/{media_id}")
def patch_media(media_id: str, body: S.MediaPatch, svc: Services = Depends(services)):
    try:
        item = svc.library.update(media_id, title=body.title, favorite=body.favorite,
                                  play_position=body.play_position, rename_file=body.rename_file)
    except KeyError:
        raise HTTPException(404, "Media not found.")
    except (UnsafeInputError, OSError) as e:
        raise _bad(e, 422)
    if body.play_position is None or body.title is not None or body.favorite is not None:
        svc.bus.publish("media", {"action": "updated", "media": item})
    return item


@router.post("/media/{media_id}/played", status_code=204)
def played(media_id: str, svc: Services = Depends(services)) -> None:
    _media_or_404(svc, media_id)
    svc.library.mark_played(media_id)


@router.delete("/media/{media_id}", status_code=204)
def delete_media(media_id: str, delete_file: bool = True, svc: Services = Depends(services)) -> None:
    if not svc.library.delete(media_id, delete_file=delete_file):
        raise HTTPException(404, "Media not found.")
    svc.bus.publish("media", {"action": "deleted", "ids": [media_id]})


@router.get("/media/{media_id}/stream")
def stream_media(media_id: str, svc: Services = Depends(services)):
    row = _media_or_404(svc, media_id)
    path = svc.library.abs_path(row["path"])
    if not path.exists():
        raise HTTPException(410, "The file is no longer on disk.")
    # FileResponse streams from disk and honours HTTP Range for seeking.
    return FileResponse(path, media_type=row["mime"], headers={"Cache-Control": "private, max-age=3600"})


@router.get("/media/{media_id}/file")
def download_media(media_id: str, svc: Services = Depends(services)):
    row = _media_or_404(svc, media_id)
    path = svc.library.abs_path(row["path"])
    if not path.exists():
        raise HTTPException(410, "The file is no longer on disk.")
    return FileResponse(path, media_type=row["mime"], filename=path.name)


@router.get("/media/{media_id}/thumbnail")
def thumbnail(media_id: str, svc: Services = Depends(services)):
    row = _media_or_404(svc, media_id)
    p = svc.library.thumbnail_file(row)
    if not p:
        raise HTTPException(404, "No thumbnail.")
    return FileResponse(p, headers={"Cache-Control": "private, max-age=604800, immutable"})


@router.get("/media/{media_id}/subtitles/{lang}")
def subtitles(media_id: str, lang: str, svc: Services = Depends(services)):
    row = _media_or_404(svc, media_id)
    for s in json.loads(row["subtitles"] or "[]"):
        if s["lang"] == lang:
            p = svc.library.abs_path(s["path"])
            if p.exists():
                return FileResponse(p, media_type="text/vtt")
    raise HTTPException(404, "Subtitle not found.")


@router.post("/media/{media_id}/subtitles")
def fetch_subtitles(media_id: str, body: S.SubtitleRequest, svc: Services = Depends(services)):
    """Fetch subtitles for a video that's already in the library (from its source page)."""
    from ..engine.downloader import DownloadOptions, fetch_subtitles as fetch

    row = _media_or_404(svc, media_id)
    if row["kind"] != "video" or not row.get("source_url") or not row["source_url"].startswith("http"):
        raise HTTPException(422, "Subtitles can only be fetched for videos downloaded from a website.")
    path = svc.library.abs_path(row["path"])
    if not path.exists():
        raise HTTPException(410, "The file is no longer on disk.")
    opts = DownloadOptions(kind="video", subtitles=True, subtitle_langs=[body.lang])
    errors: list[str] = []
    files = fetch(row["source_url"], opts, path, lambda: None, errors)
    if not files:
        if errors:
            e = classify(errors[-1])
            if e.code not in ("unknown",):
                raise HTTPException(422, e.message)
        raise HTTPException(404, f"No '{body.lang}' subtitles are available for this video.")
    item = svc.library.set_subtitles(media_id, files)
    svc.bus.publish("media", {"action": "updated", "media": item})
    return item


@router.get("/media/{media_id}/audio")
def media_audio(media_id: str, svc: Services = Depends(services)):
    """The item's audio as an MP3 file. Video soundtracks are extracted once with FFmpeg and cached."""
    import subprocess
    from pathlib import Path

    from ..engine.runtime import ffmpeg_location
    from ..engine.security import sanitize_filename

    row = _media_or_404(svc, media_id)
    src = svc.library.abs_path(row["path"])
    if not src.exists():
        raise HTTPException(410, "The file is no longer on disk.")
    name = sanitize_filename(f"{Path(row['path']).stem}.mp3")
    if row["kind"] == "audio" and row["ext"] == "mp3":
        return FileResponse(src, media_type="audio/mpeg", filename=name)
    cache = svc.settings.data_dir.resolve() / "audio-cache"
    cache.mkdir(parents=True, exist_ok=True)
    out = cache / f"{media_id}.mp3"
    if not out.exists() or out.stat().st_mtime < src.stat().st_mtime:
        ff = ffmpeg_location()
        if not ff:
            raise HTTPException(503, "FFmpeg is needed to extract audio and isn't installed.")
        tmp = out.with_suffix(".part.mp3")
        cmd = [ff, "-nostdin", "-loglevel", "error", "-y", "-i", str(src), "-vn", "-map", "0:a:0",
               "-c:a", "libmp3lame", "-b:a", "192k", "-id3v2_version", "3",
               "-metadata", f"title={row['title']}", "-metadata", f"artist={row.get('uploader') or ''}", str(tmp)]
        try:
            subprocess.run(cmd, check=True, timeout=900, capture_output=True)
            tmp.replace(out)
        except (subprocess.SubprocessError, OSError) as e:
            tmp.unlink(missing_ok=True)
            raise HTTPException(500, "Couldn't extract the audio from this file.") from e
    return FileResponse(out, media_type="audio/mpeg", filename=name)


# ------------------------------------------------------------------ playlists
@router.get("/playlists")
def playlists(svc: Services = Depends(services)):
    return {"items": svc.library.playlists()}


@router.post("/playlists", status_code=201)
def create_playlist(body: S.PlaylistCreate, svc: Services = Depends(services)):
    try:
        return svc.library.create_playlist(body.name, body.media_ids)
    except UnsafeInputError as e:
        raise _bad(e, 422)


@router.get("/playlists/{pid}")
def get_playlist(pid: str, svc: Services = Depends(services)):
    p = svc.library.playlist(pid)
    if not p:
        raise HTTPException(404, "Playlist not found.")
    return p


@router.patch("/playlists/{pid}")
def patch_playlist(pid: str, body: S.PlaylistPatch, svc: Services = Depends(services)):
    try:
        p = None
        if body.name is not None:
            p = svc.library.rename_playlist(pid, body.name)
        if body.order is not None:
            p = svc.library.reorder_playlist(pid, body.order)
        return p or svc.library.playlist(pid)
    except KeyError:
        raise HTTPException(404, "Playlist not found.")
    except UnsafeInputError as e:
        raise _bad(e, 422)


@router.delete("/playlists/{pid}", status_code=204)
def delete_playlist(pid: str, svc: Services = Depends(services)) -> None:
    if not svc.library.delete_playlist(pid):
        raise HTTPException(404, "Playlist not found.")


@router.post("/playlists/{pid}/items")
def add_items(pid: str, body: S.PlaylistItems, svc: Services = Depends(services)):
    try:
        return svc.library.add_to_playlist(pid, body.media_ids)
    except KeyError:
        raise HTTPException(404, "Playlist not found.")


@router.delete("/playlists/{pid}/items/{media_id}")
def remove_item(pid: str, media_id: str, svc: Services = Depends(services)):
    p = svc.library.remove_from_playlist(pid, media_id)
    if not p:
        raise HTTPException(404, "Playlist not found.")
    return p


# -------------------------------------------------------------------- storage
@router.get("/storage")
async def storage(svc: Services = Depends(services)):
    data = await asyncio.to_thread(svc.library.storage)
    data["temp_jobs"] = len([d for d in svc.jobs.temp_root.iterdir()]) if svc.jobs.temp_root.exists() else 0
    return data


@router.post("/storage/cleanup-temp")
def cleanup_temp(svc: Services = Depends(services)):
    return {"removed": svc.jobs.cleanup_orphan_temp()}


# ------------------------------------------------------------------- settings
@router.get("/settings")
def get_settings_(svc: Services = Depends(services)):
    return {k: svc.db.get_setting(k, v) for k, v in DEFAULT_PREFS.items()}


@router.put("/settings")
def put_settings(body: S.SettingsPatch, svc: Services = Depends(services)):
    values = body.model_dump(exclude_none=True)
    if "filename_template" in values:
        try:
            values["filename_template"] = validate_template(values["filename_template"])
        except UnsafeInputError as e:
            raise _bad(e, 422)
    for k, v in values.items():
        svc.db.set_setting(k, v)
    if "max_concurrent" in values:
        svc.jobs.wake()
    out = {k: svc.db.get_setting(k, v) for k, v in DEFAULT_PREFS.items()}
    svc.bus.publish("settings", out)
    return out


# ------------------------------------------------------------------- cookies
@router.get("/cookies")
def cookie_status():
    return cookies.status()


@router.put("/cookies")
def cookie_save(body: S.CookiesUpload, svc: Services = Depends(services)):
    try:
        out = cookies.save(body.content)
    except cookies.CookieError as e:
        raise _bad(e, 422)
    svc.db.execute("DELETE FROM info_cache")  # cached failures/limited results may change now
    return out


@router.delete("/cookies")
def cookie_clear(svc: Services = Depends(services)):
    svc.db.execute("DELETE FROM info_cache")
    return cookies.clear()


@router.get("/identify")
def identify_url(url: str = Query(max_length=4096)):
    try:
        u = validate_url(url, resolve=False, allow_private=True)
    except UnsafeInputError as e:
        raise _bad(e, 422)
    return identify(u).as_dict()
