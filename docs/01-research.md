# 01 · Market Research & Product Positioning

_Last updated: 2026-11-14_

## Method

Desk research on current products: vendor pages, F-Droid/AlternativeTo/SourceForge listings, GitHub issue trackers, security research and press coverage. I also tested hands-on with the extraction engine (yt-dlp 2026.10.26) against YouTube and Dailymotion. Many "comparison" articles in this space are written by competing vendors. They are marked below and given less weight.

## Competitor snapshot

| Product | Platforms | Engine | Model | Strengths | Weaknesses / recurring complaints |
|---|---|---|---|---|---|
| **VidMate** | Android (sideload only) | Proprietary | Ad-supported | Huge source list, in-app browser, one-tap download | 2019 security research (Upstream, reported by TechCrunch/TechRadar) found invisible ad fraud, unwanted installs, premium-service sign-ups and data harvesting. Not on Play Store, so cloned-APK malware is common. Heavy bandwidth and battery use. Cluttered UI. |
| **Seal** | Android | yt-dlp (+aria2c) | FOSS | Clean Material You UI, yt-dlp breadth, metadata/thumbnail embedding, custom command templates | Android-only. Breaks when sites change (YouTube "not a bot", JS-runtime deprecation, Instagram impersonation needing curl_cffi; GitHub issues #2413/#2543/#2566, 2026). No real library or player. |
| **NewPipe** | Android | NewPipe Extractor | FOSS | Privacy (no tracking/login), background play, playlists | Few services (YouTube, SoundCloud, PeerTube, Bandcamp). Users get malware from unofficial modded builds. Download manager is basic. |
| **4K Video Downloader Plus** | Win/macOS/Linux | Proprietary | Freemium | Polished desktop UX, smart mode, playlists/channels | Original app discontinued 2026-02-01, and Plus needs a separate license. Downloads stall or break after YouTube changes. Paywalled playlists. No mobile. |
| **Internet Download Manager** | Windows | Proprietary | Paid | Segmented accelerated downloads, browser capture, scheduler | Windows-only. Dated UI. Weak at adaptive (DASH/HLS) streams. No media library. |
| **Stacher** | Win/macOS/Linux | yt-dlp GUI | Free + paid extras | Exposes yt-dlp power, regular updates | Utilitarian UI. Users must understand yt-dlp concepts. Extraction errors usually mean "update yt-dlp". Not open source. |
| **SnapDownloader** | Win/macOS | Proprietary | Paid (48h trial) | Batch/playlist, scheduler, converter | Paid. Desktop only. Free tier limits playlists and channels. |

## Synthesis: what the market gets wrong

1. **Trust.** The most popular mobile app (VidMate) has documented ad fraud. FOSS tools are trusted but visually rough or single-platform. *Opportunity: an ad-free, tracking-free, self-hostable product with a premium UI.*
2. **Fragmentation.** No product covers phone, tablet and desktop with one library. Seal and NewPipe are Android-only, 4K, IDM and SnapDownloader are desktop-only. *Opportunity: one PWA and one server-side library reachable from every device.*
3. **Breakage.** Every tool breaks when YouTube changes. Users can't tell "the site changed" from "the app is broken". *Opportunity: a single replaceable engine (yt-dlp + EJS + curl_cffi), engine version shown in Settings, and human-readable error categories with retry.*
4. **Downloader ≠ library.** Downloaders stop at "file saved". Players don't know where files came from. *Opportunity: downloads land directly in a searchable library with playlists, favorites, resume positions and duplicate detection.*
5. **Format overload.** Stacher and Seal expose raw format tables (itag 137+140…). 4K hides too much. *Opportunity: tiered choice. One "Best" button, then simple quality chips (1080p · 720p · audio MP3), with an "Advanced" tab showing the full table, codec, fps and size.*
6. **Paywalls on basics.** Playlists, batch and concurrency are paywalled elsewhere. *Opportunity: include them all.*

## Engine research notes (Nov 2026)

* yt-dlp ships ~1,750 extractors. YouTube now **requires an external JS runtime** (deno/node/quickjs/bun) plus the `yt-dlp-ejs` package for full format coverage. Only Deno is enabled by default, so VidBuddy enables Node explicitly when found.
* Several extractors (Dailymotion, Instagram, others) need **browser impersonation** via `curl_cffi`, which is bundled.
* FFmpeg is required for merging DASH streams and for audio conversion. VidBuddy uses a system FFmpeg when one is on PATH and falls back to the static binary from `imageio-ffmpeg`.

## Positioning

> **VidBuddy** is a calm, ad-free home for the media you save. Paste any link from 1,700+ sites, pick a quality in one tap, and it lands in a library you can watch, listen to and organize on every device.

Distinctive identity: an editorial dark-first interface (warm graphite surfaces, a single amber accent, Geist typography). The download queue and the library are one continuous flow, not two apps.

## Sources

* Seal: [F-Droid](https://f-droid.org/en/packages/com.junkfood.seal/index.html), [It's FOSS](https://itsfoss.com/news/seal/), GitHub issues [#2413](https://github.com/JunkFood02/Seal/issues/2413), [#2543](https://github.com/JunkFood02/Seal/issues/2543), [#2566](https://github.com/JunkFood02/Seal/issues/2566), [AlternativeTo](https://alternativeto.net/software/seal/about/), [iTechGuides](https://www.itechguides.com/products/seal/review/)
* VidMate security: [TechCrunch](https://techcrunch.com/?p=1898029), [TechRadar](https://techradar.com/news/chinese-vidmate-app-fraud-hits-up-to-half-a-billion-users), [TechNode](https://technode.com/2019/05/20/security-alibaba-app-vidmate/)
* NewPipe: [r/NewPipe team reply](https://lr.ggtyler.dev/r/NewPipe/comments/xzx997/reminder_only_download_newpipe_from_official/irqkw8k/?context=3)
* 4K / SnapDownloader / Stacher: [ScreenApp alternatives (vendor)](https://screenapp.io/blog/4k-video-downloader-alternatives), [4kdownload.com vs SnapDownloader (vendor)](https://4kdownload.com/blog/2024/06/24/4k-video-downloader-plus-vs-snapdownloader), [WinX (vendor)](https://www.winxdvd.com/streaming-video/4k-video-downloader-alternative.htm), [SourceForge compare](https://www.sourceforge.net/software/compare/4k-Video-Downloader-Pro-vs-SnapDownloader), [AlternativeTo Stacher](https://alternativeto.net/software/stacher/?p=4)
* yt-dlp JS runtime: [yt-dlp issue #15012](https://github.com/yt-dlp/yt-dlp/issues/15012), [yt-dlp-ejs on PyPI](https://pypi.org/project/yt-dlp-ejs/), [Gigazine](https://www.gigazine.net/gsc_news/en/20251113-yt-dlp-required-deno-javascript-runtime), [man page](https://man.archlinux.org/man/extra/yt-dlp/yt-dlp.1.en)
