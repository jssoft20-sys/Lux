"""Update dispatcher shared by both bots.

Guarantees that make buttons never "hang":
  * every callback query is acknowledged immediately (before any work), and the
    client sees «печатает…» the instant a message or a tap arrives — the bot is
    visibly alive even while a cash-desk API or the database is still answering;
  * updates are de-duplicated by update_id and callback_id;
  * updates of one chat are processed strictly one at a time (FIFO), other chats
    in parallel — a slow chat never delays anybody else;
  * repeated taps on the same button within a short window are dropped, taps on
    other buttons while a chat is busy are queued (the latest intents win, at most
    a couple of them) instead of being lost;
  * the polling loop never touches the database: the offset is persisted by a
    background writer once per batch, so a slow database cannot stall polling;
  * a streak of failed ``getUpdates`` calls first rebuilds the HTTP client (stale
    sockets, a changed DNS answer) and, if that does not help, ends the process so
    systemd starts a fresh one — the bot can be slow for a moment, never stuck;
  * after downtime the backlog is trimmed: plain-text messages typed long before
    the bot came back are not replayed as fresh commands (media and taps are kept);
  * the polling loop keeps a heartbeat for the watchdog; handlers slower than
    ``slow_warn`` seconds are logged so a stuck cash-desk API is visible.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from .telegram import TelegramClient, TelegramError

logger = logging.getLogger("paygobot.dispatcher")

UpdateHandler = Callable[[dict[str, Any]], None]

REBUILD_AFTER_FAILURES = 10  # consecutive getUpdates failures → new HTTP client
EXIT_AFTER_FAILURES = 60  # … still failing (≈15 min with the capped back-off) → let systemd restart the process
STALE_MESSAGE_SECONDS = 15 * 60  # backlog texts older than this (first poll after start) are skipped


class _Recent:
    def __init__(self, maxlen: int = 4000):
        self._items: OrderedDict[Any, float] = OrderedDict()
        self._maxlen = maxlen
        self._lock = threading.Lock()

    def seen(self, key: Any, window: float | None = None) -> bool:
        now = time.monotonic()
        with self._lock:
            prev = self._items.get(key)
            self._items[key] = now
            self._items.move_to_end(key)
            while len(self._items) > self._maxlen:
                self._items.popitem(last=False)
            if prev is None:
                return False
            return True if window is None else (now - prev) < window


class Dispatcher:
    def __init__(self, client: TelegramClient, handler: UpdateHandler, *, name: str, workers: int = 64, offset_store: Callable[[int | None], int | None] | None = None):
        self.client = client
        self.handler = handler
        self.name = name
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix=f"{name}-upd")
        self.ack_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix=f"{name}-ack")
        self._queues: dict[int, deque] = {}
        self._active: set[int] = set()
        self._guard = threading.Lock()
        self._seen_updates = _Recent(8000)
        self._seen_callbacks = _Recent(8000)
        self._recent_taps = _Recent(8000)
        self.offset_store = offset_store
        self._offset_pending: int | None = None
        self._offset_guard = threading.Lock()
        self._offset_wake = threading.Event()
        self.stop = threading.Event()
        self.max_queue = 12  # queued updates per chat (bursts of text)
        self.max_callbacks_waiting = 2  # queued button taps per chat (the latest wins)
        self.tap_window = 1.0
        self.slow_warn = 8.0
        self.typing = True  # «печатает…» on every message / tap
        self.typing_after = 3.0  # keep it alive while a handler runs longer than this
        self.stale_seconds = STALE_MESSAGE_SECONDS
        self.last_poll_at = time.monotonic()
        self.in_flight = 0
        self.poll_failures = 0
        self.first_batch = True
        self._running: dict[int, tuple[float, float]] = {}  # chat → (started, last typing)
        self.exit_hook: Callable[[], None] = _exit_process

    # ------------------------------------------------------------ helpers
    @staticmethod
    def chat_id_of(update: dict[str, Any]) -> int:
        if "callback_query" in update:
            q = update["callback_query"]
            return int(((q.get("message") or {}).get("chat") or {}).get("id") or (q.get("from") or {}).get("id") or 0)
        message = update.get("message") or update.get("edited_message") or {}
        return int(((message.get("chat") or {}).get("id")) or 0)

    def _typing(self, chat_id: int) -> None:
        send = getattr(self.client, "send_chat_action", None)
        if not self.typing or not chat_id or send is None:
            return
        try:
            self.ack_pool.submit(send, chat_id)
        except RuntimeError:  # pool shut down while stopping
            pass

    def _drain(self, chat_id: int) -> None:
        while not self.stop.is_set():
            with self._guard:
                queue = self._queues.get(chat_id)
                if not queue:
                    self._active.discard(chat_id)
                    self._queues.pop(chat_id, None)
                    return
                update = queue.popleft()
                self.in_flight += 1
            started = time.monotonic()
            with self._guard:
                self._running[chat_id] = (started, started)
            try:
                self.handler(update)
            except Exception:
                logger.exception("[%s] handler failed for chat %s", self.name, chat_id)
            finally:
                with self._guard:
                    self.in_flight -= 1
                    self._running.pop(chat_id, None)
                took = time.monotonic() - started
                if took > self.slow_warn:
                    logger.warning("[%s] slow update for chat %s: %.1fs (%s)", self.name, chat_id, took, _describe(update))

    def keep_typing(self) -> int:
        """Re-send «печатает…» for chats whose handler is still running (call every second or so).

        Telegram shows the indicator for ~5 s, so a slow cash-desk lookup or a long
        assistant answer never looks like a dead bot. Returns how many chats were pinged."""
        now = time.monotonic()
        due: list[int] = []
        with self._guard:
            for chat_id, (started, last) in list(self._running.items()):
                if now - last >= self.typing_after:  # the first ping comes typing_after seconds after the start
                    self._running[chat_id] = (started, now)
                    due.append(chat_id)
        for chat_id in due:
            self._typing(chat_id)
        return len(due)

    # ------------------------------------------------------------ dispatch
    def dispatch(self, update: dict[str, Any]) -> None:
        update_id = int(update.get("update_id") or 0)
        if update_id and self._seen_updates.seen(update_id):
            return
        chat_id = self.chat_id_of(update)
        if not chat_id:
            return
        if "callback_query" in update:
            q = update["callback_query"]
            callback_id = str(q.get("id") or "")
            data = str(q.get("data") or "")
            message_id = int(((q.get("message") or {}).get("message_id")) or 0)
            # 1) acknowledge first — the spinner disappears immediately
            if callback_id:
                self.ack_pool.submit(self.client.answer_callback, callback_id)
            # 2) drop exact duplicates and frantic double taps on the same button
            if callback_id and self._seen_callbacks.seen(callback_id):
                return
            if self._recent_taps.seen((chat_id, message_id, data), self.tap_window):
                return
            update["_callback"] = True
            if data != "noop":
                self._typing(chat_id)
        elif "message" in update:
            chat = (update["message"].get("chat") or {})
            if chat.get("type") not in (None, "private"):
                return
            self._typing(chat_id)
        else:
            return
        start = False
        with self._guard:
            queue = self._queues.setdefault(chat_id, deque())
            if update.get("_callback"):
                # 3) taps while the chat is busy: keep the newest couple, forget older ones
                waiting = [i for i, item in enumerate(queue) if item.get("_callback")]
                while len(waiting) >= self.max_callbacks_waiting:
                    del queue[waiting.pop(0)]
                    waiting = [i for i, item in enumerate(queue) if item.get("_callback")]
            elif len(queue) >= self.max_queue:
                # never let a flood of text queue dozens of stale messages
                for index, item in enumerate(queue):
                    if not item.get("_callback"):
                        del queue[index]
                        break
                else:
                    return
            queue.append(update)
            if chat_id not in self._active:
                self._active.add(chat_id)
                start = True
        if start:
            self.pool.submit(self._drain, chat_id)

    def pop_pending_messages(self, chat_id: int) -> list[dict[str, Any]]:
        """Take queued plain-text messages of a chat (used to merge bursts of messages)."""
        taken: list[dict[str, Any]] = []
        with self._guard:
            queue = self._queues.get(chat_id)
            if not queue:
                return taken
            keep = deque()
            while queue:
                item = queue.popleft()
                message = item.get("message") or {}
                if "message" in item and message.get("text") and not str(message.get("text")).startswith("/") and not item.get("_callback"):
                    taken.append(item)
                else:
                    keep.append(item)
            queue.extend(keep)
        return taken

    def queued(self) -> int:
        with self._guard:
            return sum(len(q) for q in self._queues.values())

    # ------------------------------------------------------------ backlog after downtime
    def trim_backlog(self, updates: list[dict[str, Any]], now: float | None = None) -> list[dict[str, Any]]:
        """Drop plain-text messages typed long before the bot came back (the first poll only).

        A «Пополнить» or an amount typed an hour ago must not start a fresh request now that
        nobody is looking at the chat. Photos, files, contacts and button taps are kept — a
        receipt is still a receipt. The age is measured against both the clock and the newest
        message of the batch, so a wrong server clock can never wipe a whole batch."""
        if not self.stale_seconds or not updates:
            return updates
        now = time.time() if now is None else now
        dates = [int((u.get("message") or {}).get("date") or 0) for u in updates]
        newest = max(dates) if dates else 0
        kept: list[dict[str, Any]] = []
        skipped = 0
        for update, date in zip(updates, dates, strict=True):
            message = update.get("message") or {}
            text_only = bool(message) and "text" in message and not any(k in message for k in ("photo", "document", "video", "voice", "video_note", "audio", "animation", "sticker", "contact"))
            if text_only and date and now - date > self.stale_seconds and newest - date > self.stale_seconds:
                skipped += 1
                continue
            kept.append(update)
        if skipped:
            logger.warning("[%s] skipped %d stale text message(s) from the backlog after downtime", self.name, skipped)
        return kept

    # ------------------------------------------------------------ offset persistence (off the polling thread)
    def _remember_offset(self, offset: int) -> None:
        with self._offset_guard:
            self._offset_pending = offset
        self._offset_wake.set()

    def flush_offset(self) -> None:
        """Write the pending offset right now (called before the process is ended by the watchdog,
        so the same batch of updates is not replayed by the next process)."""
        with self._offset_guard:
            value, self._offset_pending = self._offset_pending, None
        if value is not None and self.offset_store:
            try:
                self.offset_store(value)
            except Exception:
                logger.exception("[%s] offset flush failed", self.name)

    def _offset_writer(self) -> None:
        while True:
            self._offset_wake.wait(1.0)
            self._offset_wake.clear()
            self.flush_offset()
            if self.stop.is_set() and self._offset_pending is None:
                return

    # ------------------------------------------------------------ polling
    def _poll_failed(self, reason: str, delay: float) -> float:
        self.last_poll_at = time.monotonic()  # the loop itself is alive; the network is not
        self.poll_failures += 1
        logger.warning("[%s] getUpdates failed (%d in a row): %s", self.name, self.poll_failures, reason)
        if self.poll_failures % REBUILD_AFTER_FAILURES == 0:
            try:
                self.client.rebuild_http()
            except Exception:
                logger.exception("[%s] http client rebuild failed", self.name)
        if self.poll_failures >= EXIT_AFTER_FAILURES:
            logger.critical("[%s] Telegram unreachable for %d polls — restarting the process", self.name, self.poll_failures)
            self.flush_offset()
            self.exit_hook()
        self.stop.wait(delay)
        return min(15.0, delay * 1.6)

    def run_polling(self, *, allowed: list[str] | None = None) -> None:
        offset = 0
        if self.offset_store:
            try:
                offset = int(self.offset_store(None) or 0)
            except Exception:
                logger.exception("[%s] offset load failed — starting from the live position", self.name)
        self.client.delete_webhook()
        writer = threading.Thread(target=self._offset_writer, name=f"{self.name}-offset", daemon=True)
        writer.start()
        delay = 1.0
        logger.info("[%s] polling started from offset %s", self.name, offset)
        while not self.stop.is_set():
            try:
                updates = self.client.get_updates(offset, timeout=25, allowed=allowed)
                delay = 1.0
                self.poll_failures = 0
            except TelegramError as exc:
                if self.stop.is_set():
                    break
                delay = self._poll_failed(str(exc), delay)
                continue
            except Exception as exc:
                logger.exception("[%s] getUpdates crashed", self.name)
                delay = self._poll_failed(f"{type(exc).__name__}: {exc}", delay)
                continue
            self.last_poll_at = time.monotonic()
            if self.first_batch:
                self.first_batch = False
                batch = self.trim_backlog(updates)
            else:
                batch = updates
            for update in updates:
                offset = max(offset, int(update["update_id"]) + 1)
            for update in batch:
                try:
                    self.dispatch(update)
                except Exception:
                    logger.exception("[%s] dispatch failed", self.name)
            if updates:
                self._remember_offset(offset)
        self._offset_wake.set()
        writer.join(timeout=5)
        self.pool.shutdown(wait=True, cancel_futures=False)
        self.ack_pool.shutdown(wait=False, cancel_futures=True)
        logger.info("[%s] polling stopped", self.name)


def _exit_process() -> None:  # pragma: no cover - ends the process; systemd starts a fresh one
    logging.shutdown()
    os._exit(4)


def _describe(update: dict[str, Any]) -> str:
    if "callback_query" in update:
        return "callback " + str((update["callback_query"] or {}).get("data") or "")[:40]
    message = update.get("message") or {}
    if message.get("text"):
        return "text " + str(message["text"])[:40].replace("\n", " ")
    for key in ("photo", "document", "voice", "video", "sticker", "contact"):
        if key in message:
            return key
    return "message"
