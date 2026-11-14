# 07 · Implementation Report

_Completed 2026-11-14. VidBuddy 1.0.0._

## What was built

| Area | Delivered |
|---|---|
| Research & product | Competitor analysis with sources ([01](01-research.md)), PRD with priorities, journeys, IA and acceptance criteria ([02](02-prd.md)) |
| Backend (`backend/app`) | FastAPI app; modular engine (security, sources/adapters, extractor, downloader, errors, runtime); persistent job manager (concurrency, priority, schedule, pause/resume, cancel, retry, exponential auto-retry, dedupe, crash recovery, temp cleanup); library service (indexing, generated poster frames, rescan, duplicates, storage stats, playlists); SSE event bus; token auth, rate limiting, security headers, SSRF guard, path confinement; SPA hosting for single-container deploys |
| Frontend (`frontend/src`) | React 19 + TS (strict) + Tailwind 4 + React Router 7 + Zustand. Screens: Home/paste, analysis (video/audio/all-formats, playlist item picker, schedule), Downloads (4 states, bulk actions, per-job menu), Library (grid/list, search, sort, source filter, favorites, recent, multi-select, details panel or sheet, rename, delete, add to playlist, save to device), Playlists (CRUD, reorder, play/shuffle), Storage (usage bar, by source, largest, duplicates, bulk delete, rescan, temp cleanup), Settings (theme, defaults, filename template with live preview, concurrency, server/token, device capabilities, shortcuts, engine info), custom video player, persistent audio engine with mini and expanded player |
| PWA | Manifest (maskable icons, screenshots, shortcuts, share target), Workbox service worker (offline shell, thumbnail/font caching), update prompt, install prompt, share route, iOS meta tags |
| Design system | Token-based dark and light themes, Geist type, component library (buttons, chips, segmented, dialogs/sheets, menus, toasts, skeletons, empty/error states, progress) |
| Deployment | Multi-stage `Dockerfile` (FFmpeg + Node runtime, non-root, healthcheck, tini), `docker-compose.yml` with optional Caddy HTTPS profile, `.env.example`, deployment and Store packaging guide ([05](05-deployment.md)) |

## How it was verified

All results below come from runs on the final code.

| Suite | Result | What it proves |
|---|---|---|
| Backend `pytest` | **58 passed**, 1 skipped (live test, opt-in) | Validation and SSRF rules, error taxonomy, presets and size estimates. **Real downloads** through yt-dlp + FFmpeg from a local media server: video to library, Range streaming (206), attachment download, rename on disk, favorites, resume position, MP3/M4A/Opus extraction, 404 → failed → retry → completed, **pause mid-transfer then resume continuing from partial bytes**, cancel, priority ordering under concurrency limits, scheduling, playlist entries, playlists CRUD/reorder, duplicate mapping, rescan marking missing files (410), settings validation, token auth, rate limiting, crash recovery, poster-frame generation |
| Live network test (`HAUL_NETWORK_TESTS=1`) | **1 passed** | Real YouTube analysis + M4A extraction |
| Manual live run on the dev server | ✅ | YouTube video at ≤240p merged to **MKV (AV1 + Opus)** with English auto-subtitles (VTT) and a thumbnail, plus **Opus** audio extraction, both indexed in the library |
| Frontend `vitest` | **19 passed** | Formatting, share-text URL extraction, selection defaults/fallbacks/size estimates, job grouping and ordering, audio queue (advance, repeat all/one, shuffle invariants, enqueue/remove); component tests for the job row (progress/speed/ETA, stage labels, retry calls API, completed actions) and paste→analysis error flow |
| `tsc -b` (strict) + `vite build` | ✅ | Production build: ~130 KB gzipped main chunk, lazy routes, 17 precached entries |
| Playwright e2e (Google Chrome, desktop 1440×900 + Pixel 7) | **6 passed** | Full journeys against the real backend: paste → analyze → download → completes → library → video plays, `k` shortcut pauses, **play position persisted**; audio extraction → mini player plays → expanded player → create playlist from item menu → playlist page → search and type filters; storage and settings render; unsupported-link error UI; light theme; mobile bottom nav, download, no horizontal overflow, details sheet, playback; PWA manifest + icons, service worker controls the page, **offline shell loads**, share target hand-off analyzes the shared link and detects it's already in the library |
| Production-mode check | ✅ | API serving the built SPA: deep links, `sw.js` with `no-cache`, manifest MIME type, JSON 404 for unknown API routes, traversal attempts fall back to the shell |

Screenshots from the e2e run were reviewed for visual quality. Issues found and fixed during review: duplicate "Best/Original" chip, safe-area padding overriding header spacing, cramped mobile footer, missing thumbnails for direct links (now generated with FFmpeg), mixed tile aspect ratios.

## Bugs found by testing and fixed
* Library serialization crash after inserting a new item (found by the first real download).
* Subtitles stalling a download for minutes on slow subtitle hosts → moved to a separate, short-timeout best-effort pass. Relative temp paths were also nested incorrectly; all paths are now resolved.
* Direct media links treated as video-only (Audio tab disabled) → codec inference fixed, with a regression test.
* Concurrent jobs writing the same output filename → identical in-flight requests are de-duplicated.
* Geo-restriction messages misclassified → pattern broadened, with a test.
* Audio items reporting the source codec instead of the converted one.

## Not verified here
* `docker build` (Docker isn't installed in the development environment). The Dockerfile follows the same steps that were run and verified natively.
* Real installation on physical iOS/Android devices and Microsoft Store submission (these need hosted HTTPS and store accounts). Installability criteria were verified via the manifest and service worker tests.
* Safari/Firefox engines in automation (Chrome only). Behavior on those browsers is covered by feature detection and documented in [06](06-limitations.md).

## Suggested next steps
1. Per-user accounts and libraries for shared household servers.
2. Notifications on completion (Web Push) for long queues.
3. A "check for yt-dlp update" button with an in-place upgrade on the server.
