"""Tiny in-process event bus used to push live updates to dashboard WebSocket clients."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

log = logging.getLogger("lux.events")


class EventBus:
    def __init__(self, db: Any | None = None):
        self._queues: set[asyncio.Queue] = set()
        self.db = db
        self.recent: list[dict[str, Any]] = []

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        self._queues.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._queues.discard(q)

    def publish(self, kind: str, payload: dict[str, Any] | None = None, level: str = "info", persist: bool = False) -> None:
        ev = {"kind": kind, "level": level, "ts": time.time(), "data": payload or {}}
        if persist:
            self.recent.append(ev)
            self.recent = self.recent[-300:]
            if self.db is not None:
                try:
                    self.db.add_event(level, f"{kind}: {payload.get('message') if payload else ''}")
                except Exception:  # noqa: BLE001
                    log.exception("event persist failed")
        for q in list(self._queues):
            try:
                q.put_nowait(ev)
            except asyncio.QueueFull:
                # slow client — drop the oldest to keep the stream alive
                try:
                    q.get_nowait()
                    q.put_nowait(ev)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass

    def log(self, message: str, level: str = "info", **extra: Any) -> None:
        getattr(log, "warning" if level in ("warn", "warning") else "error" if level == "error" else "info")(message)
        self.publish("log", {"message": message, **extra}, level=level, persist=True)
