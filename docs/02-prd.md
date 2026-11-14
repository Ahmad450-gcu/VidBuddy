# 02 · Product Requirements — VidBuddy

## Goals
1. Paste or share a link and get the media in under three taps.
2. A download manager that always shows exactly what each job is doing.
3. Downloads become a real library you can play, organize and manage on any device.
4. One installable PWA for phone, tablet and desktop. No ads, no tracking.

## Non-goals (v1)
* Bypassing DRM. Protected streams are rejected with a clear message.
* Multi-tenant SaaS accounts. VidBuddy is single-owner and self-hosted, with an optional access token.
* Native mobile background download services (see the limitations doc).

## Personas
* **Commuter (mobile):** saves lectures and podcasts on Wi-Fi to play later. Shares links from the YouTube app straight into VidBuddy.
* **Archivist (desktop):** grabs whole playlists in a specific codec and resolution, runs 3–5 jobs at once, schedules big jobs overnight.
* **Listener:** extracts audio to MP3/M4A with artwork and builds playlists.

## Feature priorities

| P | Feature | Status |
|---|---|---|
| P0 | Link analysis: source ID, metadata, thumbnail, duration, formats | ✅ |
| P0 | Video download with resolution/container/codec/fps choice, "Best" preset, size estimates | ✅ |
| P0 | Audio extraction: MP3/M4A/AAC/OPUS/WAV/FLAC, bitrate, embedded tags + artwork | ✅ |
| P0 | Download manager: concurrency, queue, priority, pause/resume, cancel, retry, speed/ETA/size, states, history, crash recovery | ✅ |
| P0 | Library: videos/audio/favorites/recent, search, sort, filter, grid/list, rename, delete, multi-select | ✅ |
| P0 | Video player with custom controls, speed, PiP, subtitles, keyboard + touch, resume position, next/prev | ✅ |
| P0 | Audio player: queue, repeat, shuffle, speed, artwork, Media Session background controls | ✅ |
| P0 | PWA: manifest, service worker, offline shell, installable, share target | ✅ |
| P1 | Playlist / collection downloads with per-item selection | ✅ |
| P1 | Custom playlists | ✅ |
| P1 | Storage dashboard: totals, breakdown, large files, duplicates, bulk delete | ✅ |
| P1 | Subtitle and thumbnail downloads | ✅ |
| P1 | Filename templates, default preferences, concurrency setting, theme | ✅ |
| P1 | Download scheduling ("start at") | ✅ |
| P1 | Clipboard-assisted paste | ✅ |
| P2 | Save to device via File System Access API, with a normal browser download as fallback | ✅ |
| P2 | Direct media URL support (generic extractor) | ✅ |

## Key user journeys
1. **Paste → Download.** Home → paste field (auto-focus; a Paste button reads the clipboard) → analysis card (thumbnail, title, source, duration) → choose a Video or Audio tab with quality chips → Download → the job appears in Downloads with live progress → on completion a toast offers "Play", and the item is in the library.
2. **Share from another app (Android/desktop Chrome).** Share → VidBuddy → the app opens `/share?url=…` → analysis starts automatically.
3. **Playlist.** Paste a playlist URL → list of entries with checkboxes (select all/none) → one quality preset → N jobs queued.
4. **Recover.** Network drop → job fails with "Network error" → Retry resumes from the `.part` file. A server restart re-queues interrupted jobs automatically.
5. **Listen.** Library → Audio → play → mini-player persists across pages → queue, shuffle, repeat → lock-screen controls via Media Session.
6. **Take a file offline to the device.** Item menu → "Save to device" → native save picker (File System Access API) or a standard browser download.

## Information architecture
* **Home**: paste/analyze, active download summary, recently added.
* **Downloads**: tabs Active · Queued · Completed · Failed, global pause/resume, clear finished.
* **Library**: Videos · Audio · Favorites · Recent; search, sort, filters, grid/list, selection mode.
* **Playlists**: custom playlists, plus detail with play-all.
* **Storage**: usage, breakdown, largest files, duplicates.
* **Settings**: appearance, download defaults, filename template, concurrency, access token, engine info.
* **Player**: full-screen video route. The audio mini-player sits above the bottom nav or sidebar footer.

Desktop: left sidebar + content + contextual detail panel (library item details). Mobile: bottom nav (Home, Downloads, Library, Playlists, More).

## Acceptance criteria (abridged)
* Analyzing a supported URL returns a title and at least one format within the engine timeout. An unsupported URL returns a categorized error (`unsupported`, `private`, `geo`, `drm`, `network`).
* Starting a download creates a job visible instantly. Progress updates at least once per second while bytes flow.
* With concurrency N, at most N jobs are in `downloading/processing`. The rest are `queued` and ordered by priority, then creation time.
* Pause keeps partial data. Resume continues the transfer rather than restarting it, when the source supports ranges.
* Jobs in `downloading` when the server stops become `queued` on restart.
* Completed jobs create library items with path, size, duration, mime type and thumbnail, and are playable via HTTP range streaming.
* Library search matches title/uploader. Sorting and filters combine.
* Deleting a library item removes the file only when "delete file" is chosen.
* The app shell loads offline after first visit. Lighthouse installability criteria are met.
