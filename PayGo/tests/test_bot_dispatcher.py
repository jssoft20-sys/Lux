import threading
import time

from paygobot.dispatcher import Dispatcher


class FakeClient:
    def __init__(self):
        self.acks = []

    def answer_callback(self, callback_id, text="", alert=False):
        self.acks.append(callback_id)

    def delete_webhook(self):
        pass


def _cb(update_id, chat_id, cb_id, data, message_id=1):
    return {"update_id": update_id, "callback_query": {"id": cb_id, "data": data, "from": {"id": chat_id}, "message": {"message_id": message_id, "chat": {"id": chat_id}}}}


def test_callbacks_are_acked_deduped_and_serialized():
    client = FakeClient()
    handled = []
    lock = threading.Lock()
    concurrent = {"max": 0, "cur": 0}

    def handler(update):
        with lock:
            concurrent["cur"] += 1
            concurrent["max"] = max(concurrent["max"], concurrent["cur"])
        time.sleep(0.05)
        handled.append(update["callback_query"]["id"])
        with lock:
            concurrent["cur"] -= 1

    d = Dispatcher(client, handler, name="t", workers=4)
    d.tap_window = 0.0  # keep only the exact duplicate / busy-chat rules for this test
    d.dispatch(_cb(1, 10, "a", "act:deposit"))
    d.dispatch(_cb(1, 10, "a", "act:deposit"))  # duplicate update id
    d.dispatch(_cb(2, 10, "a", "act:deposit"))  # duplicate callback id
    d.dispatch(_cb(3, 10, "b", "profile"))  # chat busy with a callback → queued (acked at once), runs after "a"
    d.dispatch(_cb(4, 20, "c", "profile"))  # other chat runs in parallel
    time.sleep(0.5)
    assert sorted(client.acks) == ["a", "a", "b", "c"]
    assert sorted(handled) == ["a", "b", "c"]
    assert handled.index("a") < handled.index("b")  # one chat: strictly one at a time
    assert concurrent["max"] <= 2
    # after the transitions finished the chat accepts the next tap
    d.dispatch(_cb(5, 10, "d", "profile"))
    time.sleep(0.2)
    assert "d" in handled


def test_latest_taps_win_while_busy():
    client = FakeClient()
    handled = []

    def handler(update):
        time.sleep(0.15)
        handled.append(update["callback_query"]["id"])

    d = Dispatcher(client, handler, name="t", workers=2)
    d.tap_window = 0.0
    d.dispatch(_cb(1, 7, "run", "act:deposit"))
    time.sleep(0.02)
    for i, data in enumerate(["profile", "help", "menu", "act:withdraw"]):
        d.dispatch(_cb(10 + i, 7, f"q{i}", data))
    time.sleep(0.9)
    assert handled[0] == "run"
    assert handled[1:] == ["q2", "q3"]  # only the two newest intents are kept, older taps are forgotten
    assert len(client.acks) == 5  # every tap is acknowledged, nothing spins


def test_offset_is_persisted_off_the_polling_thread():
    stores = []

    class Client(FakeClient):
        def __init__(self):
            super().__init__()
            self.polls = 0

        def get_updates(self, offset, timeout=30, allowed=None):
            self.polls += 1
            if self.polls == 1:
                return [_cb(41, 1, "a", "x"), _cb(42, 1, "b", "y")]
            d.stop.set()
            return []

    client = Client()
    d = Dispatcher(client, lambda u: None, name="t", workers=2, offset_store=lambda v: stores.append(v) if v is not None else 0)
    d.run_polling()
    assert stores == [43]  # one write for the whole batch, after both updates were dispatched


def test_double_tap_window():
    client = FakeClient()
    handled = []
    d = Dispatcher(client, lambda u: handled.append(u["update_id"]), name="t", workers=2)
    d.dispatch(_cb(1, 1, "x1", "menu"))
    time.sleep(0.1)
    d.dispatch(_cb(2, 1, "x2", "menu"))  # same button within 1s → dropped
    time.sleep(0.2)
    assert handled == [1]


class TypingClient(FakeClient):
    def __init__(self):
        super().__init__()
        self.typing = []
        self.rebuilds = 0

    def send_chat_action(self, chat_id, action="typing"):
        self.typing.append((chat_id, action))
        return True

    def rebuild_http(self):
        self.rebuilds += 1


def _msg(update_id, chat_id, text=None, date=None, **extra):
    message = {"message_id": update_id, "chat": {"id": chat_id, "type": "private"}, "from": {"id": chat_id}, **extra}
    if text is not None:
        message["text"] = text
    if date is not None:
        message["date"] = date
    return {"update_id": update_id, "message": message}


def test_typing_is_sent_the_moment_a_message_or_tap_arrives():
    client = TypingClient()
    d = Dispatcher(client, lambda u: None, name="t", workers=2)
    d.dispatch(_msg(1, 10, "Пополнить"))
    d.dispatch(_cb(2, 20, "a", "act:deposit"))
    d.dispatch(_cb(3, 30, "b", "noop"))  # a no-op tap never shows «печатает…»
    time.sleep(0.3)
    assert sorted(c for c, _ in client.typing) == [10, 20]
    assert all(a == "typing" for _, a in client.typing)


def test_keep_typing_pings_chats_whose_handler_is_slow():
    client = TypingClient()

    def handler(update):
        time.sleep(0.6)

    d = Dispatcher(client, handler, name="t", workers=2)
    d.typing_after = 0.3
    d.dispatch(_msg(1, 7, "123456"))
    time.sleep(0.35)
    client.typing.clear()
    assert d.keep_typing() == 1  # running longer than typing_after → pinged
    time.sleep(0.05)  # the ping goes through the ack pool
    assert client.typing == [(7, "typing")]
    assert d.keep_typing() == 0  # not again within the same interval
    time.sleep(0.6)
    assert d.keep_typing() == 0  # handler finished — nothing to ping


def test_backlog_after_downtime_drops_old_texts_but_keeps_media_and_taps():
    d = Dispatcher(TypingClient(), lambda u: None, name="t", workers=2)
    now = 1_700_000_000
    old = now - 3600
    updates = [
        _msg(1, 1, "Пополнить", date=old),  # typed an hour ago → skipped
        _msg(2, 1, None, date=old, photo=[{"file_id": "x"}]),  # a receipt is still a receipt → kept
        _cb(3, 1, "a", "cash:1"),  # a tap has no date → kept
        _msg(4, 2, "/start", date=now - 30),  # fresh → kept
    ]
    kept = d.trim_backlog(updates, now=now)
    assert [u["update_id"] for u in kept] == [2, 3, 4]


def test_backlog_trim_survives_a_wrong_server_clock():
    d = Dispatcher(TypingClient(), lambda u: None, name="t", workers=2)
    now = 1_700_000_000
    # the server clock is two hours ahead of Telegram: every message looks old against the clock,
    # but not against the newest message of the batch — nothing may be thrown away
    updates = [_msg(1, 1, "Пополнить", date=now - 7200 - 20), _msg(2, 1, "1000", date=now - 7200)]
    assert len(d.trim_backlog(updates, now=now)) == 2
    d.stale_seconds = 0  # the trimming can be switched off entirely
    assert len(d.trim_backlog([_msg(1, 1, "x", date=1)], now=now)) == 1


def test_poll_failure_streak_rebuilds_the_client_then_restarts(monkeypatch):
    import paygobot.dispatcher as mod
    from paygobot.telegram import TelegramError

    monkeypatch.setattr(mod, "REBUILD_AFTER_FAILURES", 2)
    monkeypatch.setattr(mod, "EXIT_AFTER_FAILURES", 5)

    class FastStop(threading.Event):
        def wait(self, timeout=None):  # no back-off sleeps in the test
            return self.is_set()

    class Client(TypingClient):
        def get_updates(self, offset, timeout=30, allowed=None):
            raise TelegramError("network: dns")

    client = Client()
    exits = []
    d = Dispatcher(client, lambda u: None, name="t", workers=2)
    d.stop = FastStop()
    d.exit_hook = lambda: (exits.append(1), d.stop.set())
    d.run_polling()
    assert client.rebuilds == 2  # after the 2nd and the 4th failure
    assert exits == [1] and d.poll_failures == 5
