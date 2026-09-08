"""Update dispatcher shared by both bots.

Guarantees that make buttons never "hang":
  * every callback query is acknowledged immediately (before any work);
  * updates are de-duplicated by update_id and callback_id;
  * updates of one chat are processed strictly one at a time (FIFO), other chats
    in parallel — a slow chat never delays anybody else;
  * repeated taps on the same button within a short window are dropped, taps on
    other buttons while a chat is busy are queued (the latest intents win, at most
    a couple of them) instead of being lost;
  * the polling loop never touches the database: the offset is persisted by a
    background writer once per batch, so a slow database cannot stall polling;
  * the polling loop keeps a heartbeat for the watchdog; handlers slower than
    ``slow_warn`` seconds are logged so a stuck cash-desk API is visible.
"""
from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from .telegram import TelegramClient, TelegramError

logger = logging.getLogger("paygobot.dispatcher")

UpdateHandler = Callable[[dict[str, Any]], None]


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
        self.last_poll_at = time.monotonic()
        self.in_flight = 0

    # ------------------------------------------------------------ helpers
    @staticmethod
    def chat_id_of(update: dict[str, Any]) -> int:
        if "callback_query" in update:
            q = update["callback_query"]
            return int(((q.get("message") or {}).get("chat") or {}).get("id") or (q.get("from") or {}).get("id") or 0)
        message = update.get("message") or update.get("edited_message") or {}
        return int(((message.get("chat") or {}).get("id")) or 0)

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
            try:
                self.handler(update)
            except Exception:
                logger.exception("[%s] handler failed for chat %s", self.name, chat_id)
            finally:
                with self._guard:
                    self.in_flight -= 1
                took = time.monotonic() - started
                if took > self.slow_warn:
                    logger.warning("[%s] slow update for chat %s: %.1fs (%s)", self.name, chat_id, took, _describe(update))

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
        elif "message" in update:
            chat = (update["message"].get("chat") or {})
            if chat.get("type") not in (None, "private"):
                return
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

    # ------------------------------------------------------------ offset persistence (off the polling thread)
    def _remember_offset(self, offset: int) -> None:
        with self._offset_guard:
            self._offset_pending = offset
        self._offset_wake.set()

    def _offset_writer(self) -> None:
        while True:
            self._offset_wake.wait(1.0)
            self._offset_wake.clear()
            with self._offset_guard:
                value, self._offset_pending = self._offset_pending, None
            if value is not None and self.offset_store:
                try:
                    self.offset_store(value)
                except Exception:
                    logger.exception("[%s] offset store failed", self.name)
            if self.stop.is_set() and self._offset_pending is None:
                return

    # ------------------------------------------------------------ polling
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
            except TelegramError as exc:
                self.last_poll_at = time.monotonic()  # the loop itself is alive; the network is not
                if self.stop.is_set():
                    break
                logger.warning("[%s] getUpdates failed: %s", self.name, exc)
                self.stop.wait(delay)
                delay = min(15.0, delay * 1.6)
                continue
            except Exception:
                self.last_poll_at = time.monotonic()
                logger.exception("[%s] getUpdates crashed", self.name)
                self.stop.wait(delay)
                delay = min(15.0, delay * 1.6)
                continue
            self.last_poll_at = time.monotonic()
            for update in updates:
                try:
                    offset = int(update["update_id"]) + 1
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
