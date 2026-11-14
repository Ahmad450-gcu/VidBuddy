# 06 · Supported Functionality Matrix & Known Limitations

## Sources

| Source type | Status | Notes |
|---|---|---|
| YouTube videos, Shorts, playlists, channels' upload playlists | ✅ Verified (live test) | Needs a JS runtime (Node/Deno) for full format coverage. VidBuddy auto-detects it. YouTube periodically blocks datacenter IPs ("confirm you're not a bot"), which shows as a `blocked` error. |
| ~1,750 other yt-dlp extractors (Vimeo, SoundCloud, Bandcamp, Twitch VODs/clips, Reddit, X, TikTok, Internet Archive, PeerTube, …) | ✅ Supported via yt-dlp | Reliability depends on each extractor and on the site. Update yt-dlp when a site changes. |
| Dailymotion and other impersonation-requiring sites | ✅ Supported | Uses `curl_cffi` impersonation. On the test network Dailymotion's CDN timed out, a network condition that surfaces as a `network` error. |
| Direct media links (`.mp4 .webm .mkv .mov .mp3 .m4a .ogg .opus .wav .flac .m3u8 .mpd`) | ✅ Verified (automated tests) | Poster frames are generated with FFmpeg when there's no artwork. |
| Private, members-only and age-restricted media | ✅ With sign-in cookies | Upload a `cookies.txt` from an account that can watch it (Settings › Sign-in cookies). Without cookies these are reported as `auth`, with an **Add cookies** shortcut. |
| DRM streams (Netflix, Spotify, Disney+, …) | ❌ By design | Reported as `drm`. |
| Live streams in progress | ❌ | Reported as `live`. Download after the stream ends. |

## Features by platform

| Capability | Chrome/Edge desktop | Safari macOS | Firefox | Android Chrome | iOS Safari |
|---|---|---|---|---|---|
| Install as app | ✅ | ✅ (Add to Dock) | ❌ (web only) | ✅ | ✅ (Home Screen) |
| Share target (share a link into VidBuddy) | ✅ (installed) | ❌ | ❌ | ✅ (installed) | ❌ (use Paste) |
| Clipboard Paste button | ✅ | ✅ (prompt) | ✅ (prompt) | ✅ | ✅ (prompt) |
| Native "Save as" dialog (streamed) | ✅ File System Access | ❌ → browser download | ❌ → browser download | ❌ → browser download | ❌ → Files › Downloads |
| Picture-in-picture | ✅ | ✅ | ✅ (own UI) | ✅ | ✅ |
| Background audio + lock-screen controls | ✅ | ✅ | ✅ | ✅ | ✅ while the app stays open. iOS may suspend long background sessions. |
| Offline app shell | ✅ | ✅ | ✅ | ✅ | ✅ |
| Fullscreen | ✅ | ✅ | ✅ | ✅ (+ landscape lock) | ✅ native video fullscreen |

## Format playback in the built-in player
The player uses the browser's codecs. **MP4 (H.264/AAC)** plays everywhere, which is why MP4 + H.264 is the default. **WebM/VP9/AV1** and **MKV** play in Chromium and Firefox but not reliably in Safari/iOS. **Opus** doesn't play in older Safari. **FLAC/WAV** play in all modern browsers. Any file can still be saved to the device and opened in another player. The quality picker says "MP4: plays everywhere".

## Known limitations
1. **Server-side downloading.** Files are downloaded to the VidBuddy server, then streamed or saved to the device. That's what makes 1,700+ sources, FFmpeg merging and a shared library possible from a browser. Browsers can't do it themselves, because of CORS and missing FFmpeg and extractors.
2. **Single-instance design.** The scheduler and rate limiter are in-process. Run one worker process. Horizontal scaling would need Redis plus a shared database (Postgres). It isn't needed for the self-hosted use case.
3. **Pause/cancel granularity.** These take effect on the next progress callback (sub-second while downloading). FFmpeg post-processing in progress (e.g. a long merge) finishes before a pause is honored.
4. **Resume after pause** continues partial data for HTTP downloads with Range support. Fragmented HLS/DASH downloads resume from the last completed fragment set, which yt-dlp handles. Sources with expiring URLs are re-extracted on resume automatically.
5. **Subtitles** are downloaded as WebVTT sidecars (best effort). Not embedding them keeps them switchable in the player. Hosts that are slow can cause subtitles to be skipped without failing the download.
6. **Duplicate detection** uses a fast partial hash (size + first/last MiB) and same-source matching. Re-encodes of the same video aren't detected.
7. **Single user.** There's one optional shared access token and no per-user accounts or libraries.
8. **Docker image** was written and reviewed but not built in the development environment (Docker isn't installed there). The same app was verified in "production mode" (API serving the built PWA) directly. See the implementation report.
9. **Microsoft Store packaging** depends on a publicly reachable HTTPS deployment and a Partner Center account. Instructions are complete, but submission is an account-holder action.
