"""API + integration tests. Downloads here are real transfers from the local media server."""
import time

from .conftest import network, wait_for


def test_health_and_system(client):
    assert client.get("/api/health").json()["ok"] is True
    sysinfo = client.get("/api/system").json()
    assert sysinfo["engine"]["yt_dlp"] and sysinfo["engine"]["ffmpeg"]
    assert sysinfo["supported_site_count"] > 500


def test_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"


def test_analyze_rejects_invalid_url(client):
    r = client.post("/api/analyze", json={"url": "file:///etc/passwd"})
    assert r.status_code == 422


def test_analyze_direct_media(client, media_server):
    r = client.post("/api/analyze", json={"url": f"{media_server['base']}/small.mp4"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["type"] == "media" and data["source"]["key"] == "direct"
    assert data["formats"] and data["cached"] is False
    again = client.post("/api/analyze", json={"url": f"{media_server['base']}/small.mp4"}).json()
    assert again["cached"] is True


def test_analyze_unsupported_page(client, media_server):
    r = client.post("/api/analyze", json={"url": f"{media_server['base']}/page.html"})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] in ("unsupported", "unavailable")


def test_video_download_to_library_and_stream(client, media_server):
    r = client.post("/api/downloads", json={"url": f"{media_server['base']}/small.mp4", "kind": "video",
                                            "title": "Test clip", "options": {"container": "mp4"}})
    assert r.status_code == 201, r.text
    job = r.json()["items"][0]
    assert job["status"] == "queued"
    done = wait_for(client, job["id"], {"completed", "failed"})
    assert done["status"] == "completed", done
    assert done["progress"] == 1.0 and done["media_id"]

    media = client.get(f"/api/media/{done['media_id']}").json()
    assert media["kind"] == "video" and media["size"] > 10_000 and media["mime"] == "video/mp4"
    # direct links have no remote artwork, so a poster frame is generated locally
    assert media["has_thumbnail"]
    t = client.get(f"/api/media/{media['id']}/thumbnail")
    assert t.status_code == 200 and t.content[:2] == bytes([0xFF, 0xD8])

    # HTTP range streaming (needed for seeking in the player)
    s = client.get(f"/api/media/{media['id']}/stream", headers={"Range": "bytes=0-99"})
    assert s.status_code == 206 and len(s.content) == 100
    assert s.headers["content-range"].startswith("bytes 0-99/")
    f = client.get(f"/api/media/{media['id']}/file")
    assert "attachment" in f.headers["content-disposition"]

    # library queries
    lib = client.get("/api/media", params={"kind": "video", "q": "small"}).json()
    assert lib["total"] == 1
    assert client.get("/api/media", params={"kind": "audio"}).json()["total"] == 0

    # rename (index + file), favorite, playback position
    upd = client.patch(f"/api/media/{media['id']}", json={"title": "Renamed: clip?", "rename_file": True,
                                                          "favorite": True}).json()
    assert upd["title"] == "Renamed: clip?" and upd["favorite"] is True
    assert upd["filename"] == "Renamed_ clip_.mp4"
    assert client.get(f"/api/media/{media['id']}/stream").status_code == 200
    client.patch(f"/api/media/{media['id']}", json={"play_position": 1.5})
    assert client.get(f"/api/media/{media['id']}").json()["play_position"] == 1.5
    assert client.get("/api/media", params={"favorite": True}).json()["total"] == 1


def test_audio_extraction(client, media_server):
    r = client.post("/api/downloads", json={"url": f"{media_server['base']}/small.mp4", "kind": "audio",
                                            "options": {"audio_format": "mp3", "audio_bitrate": 128}})
    done = wait_for(client, r.json()["items"][0]["id"], {"completed", "failed"})
    assert done["status"] == "completed", done
    media = client.get(f"/api/media/{done['media_id']}").json()
    assert media["kind"] == "audio" and media["ext"] == "mp3" and media["mime"] == "audio/mpeg"
    head = client.get(f"/api/media/{media['id']}/stream", headers={"Range": "bytes=0-2"}).content
    assert head in (b"ID3",) or head[:2] == b"\xff\xfb"


def test_m4a_extraction(client, media_server):
    r = client.post("/api/downloads", json={"url": f"{media_server['base']}/small.mp4", "kind": "audio",
                                            "options": {"audio_format": "m4a"}})
    done = wait_for(client, r.json()["items"][0]["id"], {"completed", "failed"})
    assert done["status"] == "completed", done
    assert client.get(f"/api/media/{done['media_id']}").json()["ext"] == "m4a"


def test_failed_download_and_retry(client, media_server):
    handler = media_server["handler"]
    handler.fail_paths = {"/flaky.mp4"}
    # serve the same content at /flaky.mp4 once the failure is lifted
    import shutil
    shutil.copy(media_server["files"]["small"], media_server["files"]["small"].with_name("flaky.mp4"))
    r = client.post("/api/downloads", json={"url": f"{media_server['base']}/flaky.mp4", "kind": "video"})
    job_id = r.json()["items"][0]["id"]
    failed = wait_for(client, job_id, {"completed", "failed"})
    assert failed["status"] == "failed" and failed["error_code"] in ("unavailable", "network", "forbidden")
    assert failed["error"]

    handler.fail_paths = set()
    assert client.post(f"/api/downloads/{job_id}/retry").json()["status"] == "queued"
    done = wait_for(client, job_id, {"completed", "failed"})
    assert done["status"] == "completed", done


def test_pause_resume_continues_partial_download(client, media_server):
    url = f"{media_server['base']}/slow/large.mp4"
    job_id = client.post("/api/downloads", json={"url": url, "kind": "video"}).json()["items"][0]["id"]
    deadline = time.time() + 30
    while time.time() < deadline:
        j = client.get(f"/api/downloads/{job_id}").json()
        if j["status"] == "downloading" and (j["downloaded_bytes"] or 0) > 1_000_000:
            break
        time.sleep(0.2)
    assert client.post(f"/api/downloads/{job_id}/pause").json()["status"] in ("pausing", "paused")
    paused = wait_for(client, job_id, {"paused"}, timeout=15)
    partial = paused["downloaded_bytes"]
    assert partial > 0

    client.post(f"/api/downloads/{job_id}/resume")
    # The first progress report after resuming should already include the earlier bytes.
    deadline = time.time() + 15
    while time.time() < deadline:
        j = client.get(f"/api/downloads/{job_id}").json()
        if j["status"] in ("downloading", "completed") and (j["downloaded_bytes"] or 0) > 0:
            break
        time.sleep(0.1)
    assert j["downloaded_bytes"] >= partial * 0.9, "resume should continue, not restart"
    done = wait_for(client, job_id, {"completed", "failed"}, timeout=60)
    assert done["status"] == "completed"
    size = client.get(f"/api/media/{done['media_id']}").json()["size"]
    # FFmpegMetadata remuxes to add tags, so allow a few bytes of container overhead
    assert abs(size - media_server["files"]["large"].stat().st_size) < 8192


def test_cancel_and_queue_concurrency(client, media_server):
    # All three become due at the same moment, so the scheduler must pick by priority.
    due = time.time() + 1.5
    ids = [client.post("/api/downloads", json={"url": f"{media_server['base']}/slow/large.mp4?n={i}", "kind": "video",
                                              "priority": i, "scheduled_at": due}).json()["items"][0]["id"]
           for i in range(3)]
    time.sleep(3.5)
    listing = client.get("/api/downloads").json()
    active = [j for j in listing["items"] if j["status"] in ("downloading", "processing")]
    assert len(active) <= 2  # max_concurrent_downloads=2 in test settings
    # highest priority (2) should have started first
    started = {j["id"] for j in active}
    assert ids[2] in started
    for i in ids:
        client.post(f"/api/downloads/{i}/cancel")
    for i in ids:
        assert wait_for(client, i, {"cancelled"}, timeout=15)["status"] == "cancelled"
    assert client.post("/api/downloads/actions/clear", params={"scope": "failed"}).json()["affected"] == 3


def test_identical_inflight_request_is_deduplicated(client, media_server):
    body = {"url": f"{media_server['base']}/slow/large.mp4?dedupe", "kind": "video", "scheduled_at": time.time() + 600}
    a = client.post("/api/downloads", json=body).json()["items"][0]
    b = client.post("/api/downloads", json=body).json()["items"][0]
    assert a["id"] == b["id"]
    client.post(f"/api/downloads/{a['id']}/cancel")


def test_scheduled_job_waits(client, media_server):
    at = time.time() + 3600
    job = client.post("/api/downloads", json={"url": f"{media_server['base']}/small.mp4", "kind": "video",
                                              "scheduled_at": at}).json()["items"][0]
    time.sleep(1.5)
    assert client.get(f"/api/downloads/{job['id']}").json()["status"] == "queued"
    client.patch(f"/api/downloads/{job['id']}", json={"clear_schedule": True})
    assert wait_for(client, job["id"], {"completed", "failed"})["status"] == "completed"


def test_playlist_entries_create_jobs_and_playlists(client, media_server):
    import shutil
    for i in range(2):
        shutil.copy(media_server["files"]["small"], media_server["files"]["small"].with_name(f"part{i}.mp4"))
    entries = [{"url": f"{media_server['base']}/part{i}.mp4", "title": f"Part {i}"} for i in range(2)]
    r = client.post("/api/downloads", json={"entries": entries, "kind": "audio", "playlist_title": "Mix",
                                            "options": {"audio_format": "opus"}})
    jobs = r.json()["items"]
    assert len(jobs) == 2 and all(j["playlist_title"] == "Mix" for j in jobs)
    done = [wait_for(client, j["id"], {"completed", "failed"}) for j in jobs]
    assert all(d["status"] == "completed" for d in done), done
    media_ids = [d["media_id"] for d in done]

    pl = client.post("/api/playlists", json={"name": "Road trip", "media_ids": media_ids}).json()
    assert [i["id"] for i in pl["items"]] == media_ids
    pl = client.patch(f"/api/playlists/{pl['id']}", json={"order": media_ids[::-1], "name": "Road trip 2"}).json()
    assert [i["id"] for i in pl["items"]] == media_ids[::-1] and pl["name"] == "Road trip 2"
    pl = client.delete(f"/api/playlists/{pl['id']}/items/{media_ids[0]}").json()
    assert len(pl["items"]) == 1
    listing = client.get("/api/playlists").json()["items"]
    assert listing[0]["count"] == 1


def test_duplicates_storage_and_bulk_delete(client, media_server):
    ids = []
    for _ in range(2):
        j = client.post("/api/downloads", json={"url": f"{media_server['base']}/small.mp4", "kind": "video",
                                                "options": {"filename_template": "%(title)s-%(epoch)s"}})
        assert j.status_code == 422  # unknown template field rejected
        j = client.post("/api/downloads", json={"url": f"{media_server['base']}/small.mp4", "kind": "video"})
        ids.append(wait_for(client, j.json()["items"][0]["id"], {"completed", "failed"})["media_id"])
    # Same output path: second download maps onto the existing library item
    assert ids[0] == ids[1]
    storage = client.get("/api/storage").json()
    assert storage["total_count"] == 1 and storage["total_size"] > 0 and storage["disk"]["free"] > 0

    r = client.post("/api/media/bulk-delete", json={"ids": ids[:1], "delete_file": True})
    assert r.json()["affected"] == 1
    assert client.get("/api/media").json()["total"] == 0


def test_rescan_marks_missing_files(client, media_server, settings):
    j = client.post("/api/downloads", json={"url": f"{media_server['base']}/small.mp4", "kind": "video"})
    done = wait_for(client, j.json()["items"][0]["id"], {"completed"})
    media = client.get(f"/api/media/{done['media_id']}").json()
    (settings.resolved_media_dir() / "video" / media["filename"]).unlink()
    assert client.post("/api/media/rescan").json()["missing"] == 1
    assert client.get(f"/api/media/{media['id']}").json()["status"] == "missing"
    assert client.get(f"/api/media/{media['id']}/stream").status_code == 410


def test_settings_roundtrip(client):
    s = client.get("/api/settings").json()
    assert s["max_concurrent"] == 2
    s = client.put("/api/settings", json={"max_concurrent": 4, "default_audio_format": "opus",
                                          "filename_template": "%(uploader)s - %(title)s"}).json()
    assert s["max_concurrent"] == 4 and s["filename_template"].endswith(".%(ext)s")
    assert client.put("/api/settings", json={"filename_template": "../%(title)s"}).status_code == 422
    assert client.put("/api/settings", json={"max_concurrent": 99}).status_code == 422


def test_auth_token_enforced(tmp_path):
    from fastapi.testclient import TestClient

    from app.config import Settings
    from app.main import create_app

    app = create_app(Settings(data_dir=tmp_path / "d", api_token="s3cret"))
    with TestClient(app) as c:
        assert c.get("/api/health").status_code == 401
        assert c.get("/api/health", headers={"Authorization": "Bearer wrong"}).status_code == 401
        assert c.get("/api/health", headers={"Authorization": "Bearer s3cret"}).status_code == 200
        assert c.get("/api/health", params={"token": "s3cret"}).status_code == 200


def test_rate_limit(tmp_path):
    from fastapi.testclient import TestClient

    from app.config import Settings
    from app.main import create_app

    app = create_app(Settings(data_dir=tmp_path / "d", rate_limit_per_minute=2))
    with TestClient(app) as c:
        codes = [c.post("/api/analyze", json={"url": "ftp://x"}).status_code for _ in range(3)]
        assert codes == [422, 422, 429]


def test_recovery_requeues_interrupted_jobs(tmp_path):
    from app.db import Database
    from app.services.events import EventBus
    from app.services.jobs import JobManager
    from app.services.library import Library

    db = Database(tmp_path / "x.db")
    now = time.time()
    db.insert("jobs", {"id": "j1", "url": "http://x", "kind": "video", "options": "{}", "status": "downloading",
                       "created_at": now, "updated_at": now})
    jm = JobManager(db, Library(db, tmp_path, tmp_path), EventBus(), temp_root=tmp_path)
    assert jm.recover() == 1
    assert jm.get("j1")["status"] == "queued"


@network
def test_live_youtube_analyze_and_audio(client):
    url = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
    data = client.post("/api/analyze", json={"url": url}).json()
    assert data["title"] == "Me at the zoo" and data["presets"]["video"]
    job = client.post("/api/downloads", json={"url": url, "kind": "audio", "options": {"audio_format": "m4a"}}).json()
    done = wait_for(client, job["items"][0]["id"], {"completed", "failed"}, timeout=180)
    assert done["status"] == "completed", done
