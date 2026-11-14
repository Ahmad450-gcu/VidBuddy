# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Haul: single-container production image
#   stage 1 builds the PWA, stage 2 runs FastAPI + yt-dlp + FFmpeg and serves it.
# ---------------------------------------------------------------------------
FROM node:22.11.0-bookworm-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npx tsc -b && npx vite build

FROM node:22.11.0-bookworm-slim AS noderuntime

FROM python:3.12.7-slim-bookworm AS app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HAUL_DATA_DIR=/data \
    HAUL_FRONTEND_DIST=/app/web \
    HAUL_FFMPEG_PATH=/usr/bin/ffmpeg \
    HAUL_JS_RUNTIME=/usr/local/bin/node
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
# JavaScript runtime required by yt-dlp for full YouTube support (single static binary)
COPY --from=noderuntime /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/app ./app
COPY --from=web /web/dist ./web
RUN useradd --system --uid 10001 --home /data haul && mkdir -p /data && chown haul /data
USER haul
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request,os;urllib.request.urlopen('http://127.0.0.1:8000/api/health'+('?token='+os.environ['HAUL_API_TOKEN'] if os.environ.get('HAUL_API_TOKEN') else ''))" || exit 1
ENTRYPOINT ["tini", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
