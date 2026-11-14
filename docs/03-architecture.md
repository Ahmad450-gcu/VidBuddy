# 03 · Technical Architecture

## System overview

```
┌──────────────── Browser / installed PWA (any device) ────────────────┐
│ React 19 + TS + Tailwind 4 │ Zustand stores │ IndexedDB │ Service worker │
│   REST (fetch)  ─────────────┐        ┌──── SSE /api/events (live)    │
└──────────────────────────────┼────────┼─────────────────────────────────┘
                               ▼        │
┌─────────────────────── Haul server (FastAPI, single process) ──────────┐
│ api/routes ── auth (Bearer/token) ── rate limiter ── security headers  │
│     │                                                                  │
│ services/jobs.JobManager ── scheduler loop (asyncio) ── EventBus ──────┘
│     │  thread pool (yt-dlp is blocking)                                │
│ engine/  sources → extractor → downloader → FFmpeg post-processing     │
│ services/library ── SQLite (WAL) ── media folder ── thumbnails         │
└────────────────────────────────────────────────────────────────────────┘
```

### Key decisions

| Decision | Choice | Why |
|---|---|---|
| Distribution | PWA served by the backend | One codebase for Windows, macOS, Linux, Android and iOS. Installable, offline shell, share target. Store-packagable via PWABuilder. |
| Where downloads run | **Server-side** | Browsers can't run yt-dlp/FFmpeg or bypass CORS on media CDNs. A server does the heavy lifting, and every device sees the same library. |
| Backend | FastAPI + yt-dlp Python API | yt-dlp is the most complete extractor ecosystem (~1,750 extractors). Calling its Python API (not a shell) gives structured progress hooks and no shell-injection surface. |
| Queue | In-process scheduler + SQLite | A single-instance self-hosted app doesn't need Redis/Celery. SQLite (WAL) persists every state transition, so the queue survives restarts. Redis would add an always-on service for no user benefit. |
| Real-time | Server-Sent Events | One-way server→client, auto-reconnect, proxy-friendly, no client library. |
| Client state | Zustand (not Redux Toolkit) | The server is the source of truth. The client only needs a job map patched by events, the player queue and UI state. Zustand covers that in ~1 KB with no boilerplate. |
| Local data | IndexedDB (recent links, audio queue), localStorage (theme, token) | Per-device conveniences. The library and jobs stay on the server. |
| Styling | Tailwind 4 with CSS-variable design tokens | Themeable (dark/light) through tokens and no runtime CSS-in-JS. |

## Download engine (`backend/app/engine`)

| Module | Responsibility |
|---|---|
| `security.py` | URL validation (http/https only, length, credentials-free), **SSRF guard** (resolves DNS and rejects private, loopback, link-local, reserved and metadata IPs unless `HAUL_ALLOW_PRIVATE_NETWORKS`), filename sanitization (Windows-reserved names, byte-length budget), `safe_join` path confinement, filename-template whitelist. |
| `sources.py` | **Source identification and adapters.** Matches a URL to a yt-dlp extractor and a `SourceAdapter` (`YouTubeAdapter` enables the JS runtime, `DirectMediaAdapter` forces the generic extractor for `.mp4/.mp3/.m3u8/...`, `DefaultAdapter` handles everything else). Supporting a site-specific tweak means adding one adapter class. The frontend never sees extractor details. |
| `extractor.py` | `analyze(url)`: metadata (title, uploader, duration, thumbnail, subtitles) and format discovery, normalized into a stable schema. Builds **presets** (one per resolution with fps/HDR/codec families and size estimates = video + best audio) and audio targets. Playlists are enumerated flat (fast) with per-entry URLs. |
| `downloader.py` | Translates user options into yt-dlp options. Format selection uses yt-dlp's sorter (`res:<h>`, `vcodec:h264` for MP4 compatibility, `vcodec:vp9` for WebM). Audio uses `FFmpegExtractAudio` → MP3/M4A/AAC/Opus/FLAC/WAV with bitrate, `FFmpegMetadata` and `EmbedThumbnail`. Reports progress across multi-stream downloads (video+audio) and post-processing stages (merging, converting, tagging). Subtitles are a **separate best-effort pass** (WebVTT sidecars) so a slow subtitle host can never fail the media. |
| `errors.py` | Classifies raw errors into stable codes (`unsupported`, `auth`, `geo`, `drm`, `network`, `rate_limited`, `unavailable`, `format`, `processing`, …) with user-facing messages. A set of codes is marked retryable. |
| `runtime.py` | Locates FFmpeg (config → PATH → bundled `imageio-ffmpeg`), the JS runtime (deno/node/bun), engine versions, and poster-frame extraction. |

### Job lifecycle

```
            create ──► queued ──(slot free, schedule due, highest priority first)──► downloading ──► processing ──► completed
                         ▲  │                                                          │   │
               resume ───┘  └─► paused ◄────────── pause (cooperative; .part kept) ───┘   │
               retry ◄──── failed ◄──── non-retryable error / retries exhausted ◄──────────┤
                                 queued(+backoff 5s·2ⁿ) ◄── retryable error (network, 429…) ┘
               cancel → cancelled (temp folder removed)        server restart: downloading/processing → queued
```

* Each job downloads into `tmp/<job_id>/` and yt-dlp moves the final file into `media/<video|audio>/`. Resuming re-runs yt-dlp with `continuedl`, which picks up the `.part` file with HTTP Range (verified by tests).
* Pause and cancel are cooperative. The progress hook raises `JobInterrupted` on the next callback, so they take effect within a fraction of a second while bytes flow. FFmpeg post-processing can't be interrupted mid-step and finishes first.
* Identical requests already in flight (same URL, type and options) are de-duplicated.
* On startup: interrupted jobs are re-queued, the library is reconciled with disk (missing files flagged, untracked media imported), and orphaned temp folders are deleted.

### Progress pipeline
yt-dlp hook (worker thread) → throttled to 2.5/s → `JobManager._set` (DB write at most every 2 s while downloading, always on state change) → `EventBus.publish` (thread-safe via `call_soon_threadsafe`) → SSE → `useDownloads.patch`. Slow SSE consumers drop the oldest events rather than block.

## Media delivery
* `GET /api/media/{id}/stream` uses Starlette's `FileResponse`, which streams from disk with **HTTP Range** support (seeking, iOS playback) and never loads files into memory.
* `GET /api/media/{id}/file` sends the same file with `Content-Disposition: attachment` for "Save to device".
* Frontend "Save to device": with the File System Access API, the response body is **piped directly into the file handle** (`res.body.pipeTo(writable)`, constant memory). Otherwise it falls back to a native browser download.

## Frontend architecture (`frontend/src`)

```
lib/        api.ts (typed client), events.ts (SSE), platform.ts (feature detection, install, save), idb.ts, format.ts, types.ts
stores/     downloads.ts, player.ts (audio queue/shuffle/repeat), prefs.ts, ui.ts (theme, toasts, connection)
components/ ui/ (Button, IconButton, Dialog, ConfirmDialog, Menu, Segmented, Chip, Switch, Input, Select, Thumb, Toasts, Skeleton, ProgressBar, Badge, EmptyState, ErrorState)
            layout/ (AppShell with sidebar + bottom nav, PageHeader, Logo, UpdatePrompt)
features/   home, analyze (PasteBar, MediaOptions, PlaylistOptions, selection.ts), downloads, library, player (AudioEngine, MiniPlayer, VideoPlayerPage), playlists, storage, settings
```

* Business logic stays out of components: `analyze/selection.ts` (pure: defaults, options, size estimates), `stores/*`, `library/actions.ts`.
* Routes other than Home and Downloads are lazy-loaded. Library uses paged queries with infinite scroll, memoized tiles, and lazy images.
* A single `<audio>` element (`AudioEngine`) is mounted at the root, so audio continues across navigation. It integrates the Media Session API for lock-screen and hardware keys, and persists the queue in IndexedDB.

## PWA architecture
* `vite-plugin-pwa` (Workbox `generateSW`): precached app shell, navigation fallback (except `/api`), runtime caching for fonts and library thumbnails (CacheFirst, 30 days). Media files are **not** cached by the service worker because they can be gigabytes.
* Manifest: standalone display, maskable icons, wide and narrow screenshots, shortcuts, and a **Web Share Target** (`/share?url&text&title`). The share route extracts the first URL from shared text and starts analysis.
* Update flow: `registerType: 'prompt'`. A new version shows a "Reload" banner instead of swapping under active playback.
* Install: the `beforeinstallprompt` event is captured and offered in the sidebar and Settings. iOS gets Add-to-Home-Screen guidance.

## Design system
* **Tokens** (`src/index.css`): surfaces `bg → surface-1 → surface-2 → surface-3` express elevation through lightness. One accent (amber `#FFB547` dark / `#C97A00` light), plus semantic success/danger/info with soft variants. Every token is redefined for light theme.
* **Type:** Geist / Geist Mono, a 12–15 px UI scale with tabular numerals for sizes, speeds and times.
* **Radii:** 6 / 10 / 14 / 20. **Motion:** 160–220 ms ease-out rise/fade, disabled under `prefers-reduced-motion`.
* **Patterns:** chips for choices, segmented controls for modes, native `<dialog>` for modals (a bottom sheet on phones), portal menus with arrow-key navigation, skeletons for loading, and an empty state with a next action on every list.

## Deployment architecture
A single container: the Python app serves the API and the built PWA, with FFmpeg and a Node binary (yt-dlp's JS runtime) inside. State lives in one volume (`/data`: SQLite DB, media, thumbnails, temp). An optional Caddy container terminates TLS with automatic certificates, and `flush_interval -1` keeps SSE streaming. See [05-deployment.md](05-deployment.md).
