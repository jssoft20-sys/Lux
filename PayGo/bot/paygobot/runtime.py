"""Process-level safety nets shared by both bots: watchdog, parallel fan-out, bounded side work.

The bots run under systemd with ``Restart=always``; when the polling loop stops
making progress the watchdog ends the process and systemd starts a fresh one —
a bot can be slow for a moment, but it can never stay hung.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Callable, Iterable
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any

logger = logging.getLogger("paygobot.runtime")


def start_watchdog(name: str, heartbeat: Callable[[], float], *, stall_seconds: float = 180.0, check_every: float = 10.0, stop: threading.Event | None = None) -> threading.Thread:
    """Exit the process when ``heartbeat()`` (a monotonic timestamp) stops advancing."""

    def _run() -> None:
        while not (stop and stop.is_set()):
            time.sleep(check_every)
            try:
                gap = time.monotonic() - float(heartbeat())
            except Exception:
                continue
            if gap > stall_seconds:
                logger.critical("[%s] no progress for %.0fs — restarting the process", name, gap)
                logging.shutdown()
                os._exit(3)

    thread = threading.Thread(target=_run, name=f"{name}-watchdog", daemon=True)
    thread.start()
    return thread


def fan_out(pool: ThreadPoolExecutor, items: Iterable[Any], fn: Callable[[Any], None], *, label: str = "") -> int:
    """Run ``fn`` for every item on the pool and wait for all of them; errors are logged, never raised."""
    futures: list[Future] = [pool.submit(fn, item) for item in items]
    failed = 0
    for future in futures:
        try:
            future.result()
        except Exception:
            failed += 1
            logger.exception("%s task failed", label or "fan-out")
    return len(futures) - failed


class SidePool:
    """Bounded executor for fire-and-forget Telegram calls (deletes, button strips)."""

    def __init__(self, name: str, workers: int = 12):
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix=f"{name}-side")

    def submit(self, fn: Callable, *args: Any) -> None:
        def _run() -> None:
            try:
                fn(*args)
            except Exception as exc:  # deletes of already-gone messages are normal
                logger.debug("side task failed: %s", exc)

        try:
            self.pool.submit(_run)
        except RuntimeError:  # pool shut down while stopping
            pass
