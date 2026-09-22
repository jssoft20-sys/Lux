"""Process-level safety nets shared by both bots: watchdog, keep-alive, parallel fan-out, bounded side work.

The bots run under systemd with ``Restart=always``; when the polling loop stops
making progress the watchdog ends the process and systemd starts a fresh one —
a bot can be slow for a moment, but it can never stay hung. Between updates the
process keeps itself warm (database connection checked every half a minute), so
the first tap after a quiet day is answered as fast as the hundredth.
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


def start_watchdog(name: str, heartbeat: Callable[[], float], *, stall_seconds: float = 180.0, check_every: float = 10.0, stop: threading.Event | None = None, before_exit: Callable[[], None] | None = None) -> threading.Thread:
    """Exit the process when ``heartbeat()`` (a monotonic timestamp) stops advancing.

    ``before_exit`` runs first (bounded to a few seconds) — the dispatcher uses it to
    persist the update offset, so the next process does not replay the same batch."""

    def _run() -> None:
        while not (stop and stop.is_set()):
            time.sleep(check_every)
            try:
                gap = time.monotonic() - float(heartbeat())
            except Exception:
                continue
            if gap > stall_seconds:
                logger.critical("[%s] no progress for %.0fs — restarting the process", name, gap)
                if before_exit is not None:
                    flush = threading.Thread(target=_quiet(before_exit), name=f"{name}-flush", daemon=True)
                    flush.start()
                    flush.join(timeout=5.0)
                logging.shutdown()
                os._exit(3)

    thread = threading.Thread(target=_run, name=f"{name}-watchdog", daemon=True)
    thread.start()
    return thread


def _quiet(fn: Callable[[], None]) -> Callable[[], None]:
    def _run() -> None:
        try:
            fn()
        except Exception:
            logger.exception("before-exit hook failed")

    return _run


def start_periodic(name: str, fn: Callable[[], Any], interval: float, *, stop: threading.Event | None = None) -> threading.Thread:
    """Run ``fn`` every ``interval`` seconds on a daemon thread; failures are logged, never fatal."""

    def _run() -> None:
        while not (stop and stop.is_set()):
            try:
                fn()
            except Exception:
                logger.exception("[%s] periodic task failed", name)
            if stop is not None:
                stop.wait(interval)
            else:
                time.sleep(interval)

    thread = threading.Thread(target=_run, name=name, daemon=True)
    thread.start()
    return thread


def start_heartbeat(name: str, *, interval: float = 60.0, stop: threading.Event | None = None) -> threading.Thread:
    """Пульс процесса в базе: по нему «сторож тишины» в панели видит, что бот жив, даже
    когда сообщений нет (при тишине смещение обновлений не пишется, и молчание было неотличимо
    от упавшего процесса)."""
    from paygo.db import transaction
    from paygo.models import BotSession
    from paygo.utils import utcnow
    from sqlalchemy import select

    key = f"{name}:beat"[:16]

    def _tick() -> None:
        with transaction() as db:
            row = db.execute(select(BotSession).where(BotSession.bot == key, BotSession.telegram_id == 0)).scalar_one_or_none()
            if row is None:
                db.add(BotSession(bot=key, telegram_id=0, state="beat", data={"at": utcnow().isoformat()}))
            else:
                row.data = {"at": utcnow().isoformat()}
                row.state = "beat"

    return start_periodic(f"{name}-heartbeat", _tick, interval, stop=stop)


def start_db_keepalive(name: str, *, interval: float = 30.0, stop: threading.Event | None = None) -> threading.Thread:
    """Keep one pooled database connection warm and verified, so a handler after a quiet day
    never pays for a reconnect (or discovers a connection the server dropped meanwhile)."""
    from paygo.db import ping

    state = {"ok": True}

    def _tick() -> None:
        ok = ping()
        if ok != state["ok"]:
            (logger.warning if not ok else logger.info)("[%s] database %s", name, "unreachable — waiting for it to come back" if not ok else "reachable again")
            state["ok"] = ok

    return start_periodic(f"{name}-db-keepalive", _tick, interval, stop=stop)


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
    """Bounded executor for fire-and-forget Telegram calls (deletes, button strips, screen notes)."""

    def __init__(self, name: str, workers: int = 12):
        self.prefix = f"{name}-side"
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix=self.prefix)
        self._pending = 0
        self._guard = threading.Lock()
        self._idle = threading.Event()
        self._idle.set()

    def _done(self) -> None:
        with self._guard:
            self._pending -= 1
            if self._pending <= 0:
                self._pending = 0
                self._idle.set()

    def submit(self, fn: Callable, *args: Any) -> Future | None:
        """Run ``fn`` off the handler. The future is returned for the rare caller that has to know
        when the task landed (a screen note the next screen must not overtake)."""

        def _run() -> None:
            try:
                fn(*args)
            except Exception as exc:  # deletes of already-gone messages are normal
                logger.debug("side task failed: %s", exc)
            finally:
                self._done()

        with self._guard:
            self._pending += 1
            self._idle.clear()
        try:
            return self.pool.submit(_run)
        except RuntimeError:  # pool shut down while stopping
            self._done()
            return None

    def busy(self) -> bool:
        """True while a submitted task is still queued or running (used to keep order without waiting)."""
        with self._guard:
            return self._pending > 0

    def wait(self, timeout: float = 5.0) -> bool:
        """Block until every submitted task has finished (shutdown, tests)."""
        return self._idle.wait(timeout)
