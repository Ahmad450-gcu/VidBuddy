"""In-process pub/sub that fans job/library events out to SSE subscribers."""
from __future__ import annotations

import asyncio
import json
from typing import Any


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[str]] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=500)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str]) -> None:
        self._subscribers.discard(q)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def _dispatch(self, payload: str) -> None:
        for q in list(self._subscribers):
            if q.full():  # slow consumer: drop oldest so progress stays current
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(payload)

    def publish(self, event: str, data: Any) -> None:
        """Thread-safe publish usable from worker threads and the event loop."""
        payload = f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"
        loop = self._loop
        if loop is None:
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            self._dispatch(payload)
        else:
            loop.call_soon_threadsafe(self._dispatch, payload)
