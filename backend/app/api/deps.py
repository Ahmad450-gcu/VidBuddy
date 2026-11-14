"""Shared dependencies: service container, authentication, rate limiting."""
from __future__ import annotations

import hmac
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status

from ..config import Settings
from ..db import Database
from ..services.events import EventBus
from ..services.jobs import JobManager
from ..services.library import Library


@dataclass
class Services:
    settings: Settings
    db: Database
    bus: EventBus
    library: Library
    jobs: JobManager


def services(request: Request) -> Services:
    return request.app.state.services


def require_auth(request: Request, svc: Services = Depends(services)) -> None:
    token = svc.settings.api_token
    if not token:
        return
    supplied = None
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        supplied = header[7:].strip()
    # EventSource and <video src> cannot send headers, so a query token is accepted too.
    supplied = supplied or request.query_params.get("token")
    if not supplied or not hmac.compare_digest(supplied, token):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing or invalid access token.")


class RateLimiter:
    """Sliding-window limiter keyed by client address (single instance, in-memory)."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window: float = 60.0) -> None:
        if limit <= 0:
            return
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                retry = int(window - (now - q[0])) + 1
                raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests. Slow down a little.",
                                    headers={"Retry-After": str(retry)})
            q.append(now)


limiter = RateLimiter()


def rate_limited(request: Request, svc: Services = Depends(services)) -> None:
    client = request.client.host if request.client else "unknown"
    limiter.check(f"{client}:{request.url.path}", svc.settings.rate_limit_per_minute)
