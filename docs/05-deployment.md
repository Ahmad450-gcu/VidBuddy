# 05 · Deployment & Installation

## 1. Docker (recommended)

```bash
cp .env.example .env
```

Set at least `HAUL_API_TOKEN` (`python -c "import secrets;print(secrets.token_urlsafe(32))"`) when the server is reachable by anyone but you.

```bash
docker compose up -d --build
```

* App and API: `http://<host>:8000`. Data (DB, media, thumbnails, temp) lives in the `haul-data` volume (`/data`). To keep media on a host disk, mount `./media:/data/media` (see the compose file) or set `HAUL_MEDIA_DIR`.
* The image contains FFmpeg, a Node binary (yt-dlp's JavaScript runtime for YouTube) and `curl_cffi` (browser impersonation for sites that need it). It runs as non-root UID 10001 and includes a healthcheck.
* **Update the extractor** when a site breaks: rebuild with a newer `yt-dlp` pin in `backend/requirements.txt` (`docker compose build --no-cache haul && docker compose up -d`).

### HTTPS (required for installing on phones)
Service workers, installation and the share target need a secure origin (`localhost` is the only exception).

```bash
docker compose --profile https up -d
```

Set `HAUL_DOMAIN=haul.example.com` in `.env` and point DNS at the server. Caddy (`deploy/Caddyfile`) obtains certificates automatically and passes SSE through unbuffered. When using another reverse proxy, **disable response buffering for `/api/events`** (nginx: `proxy_buffering off;`) and allow large/long responses for `/api/media/*`.

## 2. Bare metal / VM

```bash
cd frontend && npm ci && npm run build
```

```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

```bash
cd backend && HAUL_DATA_DIR=/var/lib/haul HAUL_FRONTEND_DIST=../frontend/dist .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Install `ffmpeg` and Node 20+ (or Deno) from your package manager for the best results. Run it under systemd with `Restart=always`. Use **one worker process**: the job scheduler is in-process by design.

### Frontend on a static host (optional)
The PWA can be hosted separately (e.g. Netlify, Cloudflare Pages). Add that origin to `HAUL_CORS_ORIGINS`, then enter the server address and token under **Settings › Server** on each device.

## 3. Installing the app

| Platform | How |
|---|---|
| Windows / macOS / Linux: Chrome, Edge | Open the HTTPS URL → install icon in the address bar (or **Install Haul** in the sidebar or Settings). Opens in its own window with taskbar/dock icon, share target and shortcuts. |
| macOS Safari 17+ | File › Add to Dock |
| Android: Chrome, Edge, Samsung Internet | Menu › Install app / Add to Home screen. Haul then appears in the **system share sheet**: share from YouTube etc. → Haul. |
| iOS / iPadOS: Safari | Share › Add to Home Screen. (iOS does not support Web Share Target. Use the Paste button, which reads the clipboard after a permission tap.) |
| Firefox desktop | Use as a normal web app (Firefox does not install PWAs). |

## 4. Microsoft Store (PWABuilder)

1. Deploy Haul on a public **HTTPS** domain (the Store package loads your live site).
2. Go to <https://www.pwabuilder.com>, enter the URL and run the report. Haul ships what the report checks: manifest with `id`, name, icons (192, 512, maskable), screenshots (wide + narrow), categories, shortcuts, share target, a service worker with offline fallback, and HTTPS.
3. **Package for stores → Windows.** In Partner Center, create an app reservation (name "Haul" or your own). Copy the **Package ID**, **Publisher ID** and **Publisher display name** into PWABuilder's Windows options. Keep the version at `1.0.0.0` for the first submission.
4. Download the generated `.msixbundle` plus the `.classic.appxbundle`. Test locally by double-clicking the `.msix` (enable Developer Mode or use the test certificate shipped in the ZIP).
5. In Partner Center: create a submission → upload the packages → fill in the store listing (reuse `frontend/public/screenshots/*` and `docs/01-research.md` positioning) → age rating → submit.
6. Updates to the web app reach Store users automatically. Re-package only when the manifest or icons change.

Store policy note: downloader apps must describe how they respect content owners' rights. Haul refuses DRM-protected content, and the listing should state that it's for media you have the right to save.

## 5. Android (Play Store, optional)
PWABuilder's **Android** target produces a Trusted Web Activity (`.aab`). Upload `assetlinks.json` from the generated package to `https://<domain>/.well-known/assetlinks.json` (put it in `frontend/public/.well-known/`). Google Play restricts apps that download from YouTube, so prefer sideloading or the browser install for personal use.

## 6. Operations
* **Backups:** the whole state is the `/data` volume. `haul.db` can be copied while running (WAL) with `sqlite3 haul.db ".backup backup.db"`.
* **Logs:** stdout (uvicorn plus `haul.*` loggers). Failed jobs log their raw extractor error. The API returns only the categorized message.
* **Resources:** each concurrent download uses one thread plus FFmpeg during post-processing. 3–5 concurrent downloads suits a 2-vCPU / 2 GB host.
* **Security checklist:** set `HAUL_API_TOKEN`, keep `HAUL_ALLOW_PRIVATE_NETWORKS=false` unless you trust every user, always use HTTPS on public networks, and keep yt-dlp updated.
