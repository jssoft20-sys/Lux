"""Update dispatcher shared by both bots.

Guarantees that make buttons never "hang":
  * every callback query is acknowledged immediately (before any work);
  * updates are de-duplicated by update_id and callback_id;
  * updates of one chat are processed strictly one at a time (FIFO), other chats
    in parallel;
  * repeated taps on the same button within a short window are dropped;
  * a callback that arrives while the previous one for the same chat is still
    running is acknowledged and discarded (the first transition wins);
  * the polling offset is persisted so a restart never replays old updates.
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

logger = logging.getLogger("onoibot.dispatcher")

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
    def __init__(self, client: TelegramClient, handler: UpdateHandler, *, name: str, workers: int = 32, offset_store: Callable[[int | None], int | None] | None = None):
        self.client = client
        self.handler = handler
        self.name = name
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix=f"{name}-upd")
        self.ack_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix=f"{name}-ack")
        self._queues: dict[int, deque] = {}
        self._active: set[int] = set()
        self._busy_callbacks: set[int] = set()
        self._guard = threading.Lock()
        self._seen_updates = _Recent(8000)
        self._seen_callbacks = _Recent(8000)
        self._recent_taps = _Recent(8000)
        self.offset_store = offset_store
        self.stop = threading.Event()
        self.max_queue = 12
        self.tap_window = 1.0

    # ------------------------------------------------------------ helpers
    @staticmethod
    def chat_id_of(update: dict[str, Any]) -> int:
        if "callback_query" in update:
            q = update["callback_query"]
            return int(((q.get("message") or {}).get("chat") or {}).get("id") or (q.get("from") or {}).get("id") or 0)
        message = update.get("message") or update.get("edited_message") or {}
        return int(((message.get("chat") or {}).get("id")) or 0)

    def _finish(self, chat_id: int, update: dict[str, Any]) -> None:
        if update.get("_callback"):
            with self._guard:
                self._busy_callbacks.discard(chat_id)

    def _drain(self, chat_id: int) -> None:
        while not self.stop.is_set():
            with self._guard:
                queue = self._queues.get(chat_id)
                if not queue:
                    self._active.discard(chat_id)
                    self._queues.pop(chat_id, None)
                    return
                update = queue.popleft()
            try:
                self.handler(update)
            except Exception:
                logger.exception("[%s] handler failed for chat %s", self.name, chat_id)
            finally:
                self._finish(chat_id, update)

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
            # 2) drop exact duplicates and frantic double taps
            if callback_id and self._seen_callbacks.seen(callback_id):
                return
            if self._recent_taps.seen((chat_id, message_id, data), self.tap_window):
                return
            # 3) one UI transition at a time per chat
            with self._guard:
                if chat_id in self._busy_callbacks:
                    return
                self._busy_callbacks.add(chat_id)
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
            if len(queue) >= self.max_queue:
                # never let a burst of taps queue dozens of stale actions
                for index, item in enumerate(queue):
                    if item.get("_callback"):
                        del queue[index]
                        self._busy_callbacks.discard(chat_id) if not any(x.get("_callback") for x in queue) else None
                        break
                else:
                    self._finish(chat_id, update)
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

    # ------------------------------------------------------------ polling
    def run_polling(self, *, allowed: list[str] | None = None) -> None:
        offset = int((self.offset_store(None) if self.offset_store else 0) or 0)
        self.client.delete_webhook()
        delay = 1.0
        logger.info("[%s] polling started from offset %s", self.name, offset)
        while not self.stop.is_set():
            try:
                updates = self.client.get_updates(offset, timeout=30, allowed=allowed)
                delay = 1.0
            except TelegramError as exc:
                if self.stop.is_set():
                    break
                logger.warning("[%s] getUpdates failed: %s", self.name, exc)
                time.sleep(delay)
                delay = min(15.0, delay * 1.6)
                continue
            for update in updates:
                offset = int(update["update_id"]) + 1
                if self.offset_store:
                    try:
                        self.offset_store(offset)
                    except Exception:
                        logger.exception("offset store failed")
                self.dispatch(update)
        self.pool.shutdown(wait=True, cancel_futures=False)
        self.ack_pool.shutdown(wait=False, cancel_futures=True)
        logger.info("[%s] polling stopped", self.name)
