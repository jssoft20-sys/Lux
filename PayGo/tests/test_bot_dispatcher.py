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
