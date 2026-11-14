# 04 · API & Database Reference

Base path `/api`. JSON in and out. Interactive OpenAPI docs are served at `/api/docs`.

**Auth:** when `HAUL_API_TOKEN` is set, every request needs `Authorization: Bearer <token>` or `?token=<token>`. The query form exists because `<video src>` and `EventSource` cannot send headers. Constant-time comparison is used.
**Errors:** `{"detail": "message"}` or, for engine errors, `{"detail": {"code", "message", "detail"}}`. Status codes: 401 auth, 404 not found, 410 file gone from disk, 422 invalid input or unsupported media, 429 rate limited (with `Retry-After`), 504 extractor timeout.
**Rate limit:** `POST /analyze` and `POST /downloads` are limited to `HAUL_RATE_LIMIT_PER_MINUTE` per client.

## System
| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness: `{ok, time, subscribers}` |
| GET | `/system` | Engine versions (yt-dlp, EJS, curl_cffi, FFmpeg, JS runtime), media root, auth flag, extractor count |
| GET | `/sources?q=` | Supported extractor names |
| GET | `/identify?url=` | Source for a URL without fetching it |

## Analysis
`POST /analyze` `{url, refresh?}` returns one of:

* `type: "media"`: `source`, `title`, `uploader`, `thumbnail`, `duration`, `formats[]` (normalized: `format_id, ext, height, width, fps, vcodec, acodec, abr, tbr, filesize, exact_size, has_video, has_audio, …`), `presets` (`video[]`: `{id:"h1080", label:"1080p60", codecs, hdr, size_estimate}`; `audio`: targets, bitrates, source abr/codec), `subtitles {manual[], automatic[]}`, `existing {video, audio}` (already in the library), `cached`.
* `type: "playlist"`: `title`, `entry_count`, `entries[] {index, url, title, duration, thumbnail, uploader}`.

Results are cached for `HAUL_INFO_CACHE_TTL` seconds. Pass `refresh: true` to bypass the cache.

## Downloads
| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | `/downloads?status=active\|queued\|completed\|failed` | | `{items, counts, concurrency}` |
| POST | `/downloads` | `{url \| entries[], kind, options, priority(-10..10), scheduled_at?, title?, thumbnail?, playlist_title?}` | 201 `{items: Job[]}` |
| GET | `/downloads/{id}` | | Job |
| POST | `/downloads/{id}/pause` · `resume` · `retry` · `cancel` | | `pausing`/`cancelling` are returned while a worker stops |
| PATCH | `/downloads/{id}` | `{priority?, scheduled_at?, clear_schedule?}` | |
| DELETE | `/downloads/{id}` | | Removes the job from history (cancels it if running) |
| POST | `/downloads/actions/pause-all` · `resume-all` | | |
| POST | `/downloads/actions/clear?scope=finished\|completed\|failed` | | Library files are untouched |

`options`: `quality` (`best` \| `h<height>` \| `fmt:<format_id>`), `container` (mp4/webm/mkv), `audio_format` (mp3/m4a/aac/opus/flac/wav), `audio_bitrate` (0 = best VBR), `subtitles`, `subtitle_langs[]`, `auto_subtitles`, `embed_metadata`, `embed_thumbnail`, `filename_template`, `max_filesize_mb`, `rate_limit_kbps`.

**Job** fields: `id, url, source, title, thumbnail, kind, options, status, priority, progress (0–1), downloaded_bytes, total_bytes, speed (B/s), eta (s), stage (starting|downloading|merging|converting|embedding|tagging|subtitles|finalizing), error, error_code, attempts, playlist_title, media_id, scheduled_at, created_at, updated_at, started_at, finished_at`.

## Events (SSE)
`GET /events`:

| event | data |
|---|---|
| `hello` | sent on connect |
| `job` | partial job fields `{id, status?, progress?, speed?, …}` |
| `job_created` | full job |
| `job_deleted` | `{id}` |
| `media` | `{action: "added"\|"updated", media}` or `{action: "deleted", ids}` |
| `settings` | full preferences |

A keep-alive comment is sent every 15 s. Clients should reload `/downloads` after reconnecting.

## Library
| Method | Path | Notes |
|---|---|---|
| GET | `/media?kind&q&favorite&sort=created\|title\|size\|duration\|played&order&status&source&limit&offset` | `{items, total, sources}` |
| GET | `/media/{id}` | Includes `playlists[]` |
| PATCH | `/media/{id}` | `{title?, rename_file?, favorite?, play_position?}` |
| POST | `/media/{id}/played` | Increments play count |
| DELETE | `/media/{id}?delete_file=true` | |
| POST | `/media/bulk-delete` | `{ids[], delete_file}` |
| GET | `/media/{id}/stream` | Range-enabled inline stream |
| GET | `/media/{id}/file` | Attachment download |
| GET | `/media/{id}/thumbnail` | |
| GET | `/media/{id}/subtitles/{lang}` | WebVTT |
| GET | `/media/{id}/audio` | The audio as an MP3 attachment (extracted from video with FFmpeg on first request, then cached) |
| POST | `/media/{id}/subtitles` | Fetch subtitles for a library video from its source page. Body `{ "lang": "en" }`; falls back to auto captions |
| GET | `/media/duplicates` | Groups by identical content hash or same source |
| POST | `/media/rescan` | Reconcile with disk: `{missing, restored, imported}` |

## Playlists
`GET/POST /playlists`, `GET/PATCH/DELETE /playlists/{id}` (`PATCH {name?, order?[]}`), `POST /playlists/{id}/items {media_ids[]}`, `DELETE /playlists/{id}/items/{media_id}`.

## Storage & settings
`GET /storage` returns totals, `by_kind`, `by_source`, `by_ext`, `largest[]`, `recent[]`, disk usage, media root, duplicate count, reclaimable bytes, missing count and temp folder count. `POST /storage/cleanup-temp` deletes orphaned temp folders.
`GET /settings`, `PUT /settings`: `max_concurrent (1–10), default_kind, default_quality, default_container, default_audio_format, default_audio_bitrate, filename_template, subtitles, subtitle_langs, embed_metadata, embed_thumbnail`.

---

## Sign-in cookies
`GET /cookies` returns `{present, count, sites[], youtube, updated_at}`. `PUT /cookies {content}` stores a Netscape `cookies.txt` (validated, max 1 MB, saved as `<data>/cookies.txt`). `DELETE /cookies` removes it. Cookie values are never returned. Each yt-dlp call gets a private snapshot because yt-dlp rewrites its cookie file on exit.

---

## Database schema (SQLite, WAL)

```sql
jobs(id PK, url, source, title, thumbnail, kind CHECK(video|audio), options JSON, status, priority, progress,
     downloaded_bytes, total_bytes, speed, eta, stage, error, error_code, attempts, playlist_title, media_id,
     scheduled_at, created_at, updated_at, started_at, finished_at)
  INDEX (status, priority DESC, created_at)            -- scheduler pick query

media(id PK, job_id, title, uploader, source, source_url, kind, path UNIQUE (relative to media root), size, duration,
      mime, ext, width, height, vcodec, acodec, thumbnail_path, subtitles JSON, favorite, play_position, play_count,
      last_played_at, content_hash, status (ready|missing), created_at)
  INDEX (kind, created_at DESC), (content_hash), (source_url)

playlists(id PK, name, created_at, updated_at)
playlist_items(playlist_id FK CASCADE, media_id FK CASCADE, position, PK(playlist_id, media_id))
settings(key PK, value JSON)
info_cache(url PK, data JSON, created_at)
```

* Paths are stored **relative** to the media root and always resolved through `safe_join`, so the media folder can move without breaking the DB and a crafted path can't escape it.
* `content_hash` = SHA-1 of the size plus the first and last MiB. It's fast for duplicate detection on multi-GB files.
* Schema version is tracked in `PRAGMA user_version` for future migrations.
