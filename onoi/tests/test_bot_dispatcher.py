import threading
import time

from onoibot.dispatcher import Dispatcher


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
    d.dispatch(_cb(3, 10, "b", "profile"))  # chat busy with a callback → dropped, but acked
    d.dispatch(_cb(4, 20, "c", "profile"))  # other chat runs in parallel
    time.sleep(0.4)
    assert sorted(client.acks) == ["a", "a", "b", "c"]
    assert sorted(handled) == ["a", "c"]
    assert concurrent["max"] <= 2
    # after the first transition finished the chat accepts the next tap
    d.dispatch(_cb(5, 10, "d", "profile"))
    time.sleep(0.2)
    assert "d" in handled


def test_double_tap_window():
    client = FakeClient()
    handled = []
    d = Dispatcher(client, lambda u: handled.append(u["update_id"]), name="t", workers=2)
    d.dispatch(_cb(1, 1, "x1", "menu"))
    time.sleep(0.1)
    d.dispatch(_cb(2, 1, "x2", "menu"))  # same button within 1s → dropped
    time.sleep(0.2)
    assert handled == [1]
