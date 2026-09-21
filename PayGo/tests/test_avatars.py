"""Client Telegram avatars: fetched once a day, shrunk to a 128 px JPEG, exposed to the panel."""
from __future__ import annotations

import io
from datetime import timedelta

import pytest
from paygo.config import get_settings, reset_settings_cache
from paygo.db import read_session, transaction
from paygo.models import User, Withdrawal
from paygo.services import avatars
from paygo.utils import as_utc, utcnow
from PIL import Image

P = "/paygo/api"
TG = 111222333  # telegram id of the ``user`` fixture
SIZES = [{"file_id": "s", "width": 160, "height": 160}, {"file_id": "m", "width": 320, "height": 320}, {"file_id": "l", "width": 640, "height": 640}]


def _png(size=(300, 300)):
    buf = io.BytesIO()
    Image.new("RGB", size, (30, 120, 200)).save(buf, format="PNG")
    return buf.getvalue()


class FakeTelegram:
    """Answers getUserProfilePhotos / getFile / the file download the way the Bot API does."""

    def __init__(self):
        self.sizes = list(SIZES)
        self.photo = _png()
        self.broken_tokens: set[str] = set()  # bots that never met the client
        self.calls: list[tuple] = []

    def get(self, token, method, **params):
        self.calls.append((token, method, params))
        if token in self.broken_tokens:
            raise RuntimeError(f"{method}: Bad Request: user not found")
        if method == "getUserProfilePhotos":
            return {"total_count": 1 if self.sizes else 0, "photos": [self.sizes] if self.sizes else []}
        if method == "getFile":
            return {"file_id": params["file_id"], "file_path": f"photos/{params['file_id']}.jpg"}
        raise AssertionError(method)

    def download(self, url):
        self.calls.append(("download", url))
        return self.photo


@pytest.fixture
def tg(monkeypatch):
    fake = FakeTelegram()
    monkeypatch.setattr(avatars, "_tg_get", fake.get)
    monkeypatch.setattr(avatars, "_download", fake.download)
    return fake


@pytest.fixture
def enabled(monkeypatch):
    """Both bot tokens configured, not the test env, and pool jobs run inline (no threads in tests)."""
    monkeypatch.setenv("APP_ENV", "dev")
    monkeypatch.setenv("MAIN_BOT_TOKEN", "1:main")
    monkeypatch.setenv("SUPPORT_BOT_TOKEN", "2:support")
    reset_settings_cache()

    class InlinePool:
        def submit(self, fn, *args):
            fn(*args)

    monkeypatch.setattr(avatars, "_pool", InlinePool())
    yield
    reset_settings_cache()


def _avatar_file():
    return get_settings().uploads_dir() / "avatars" / f"{TG}.jpg"


def test_fetch_and_store_makes_small_jpeg(user, tg):
    url = avatars.fetch_and_store(TG, token="1:main")
    assert url == f"/uploads/avatars/{TG}.jpg"
    path = _avatar_file()
    assert path.is_file() and path.stat().st_size < 20_000
    with Image.open(path) as img:
        assert img.format == "JPEG" and img.size == (128, 128)
    # the smallest Telegram size that is still >= 96 px is downloaded, not the 640 px one
    assert ("1:main", "getFile", {"file_id": "s"}) in tg.calls
    assert tg.calls[-1] == ("download", "https://api.telegram.org/file/bot1:main/photos/s.jpg")
    with transaction() as db:
        u = db.get(User, user)
        assert u.avatar_url == url
        assert u.avatar_checked_at is not None and utcnow() - as_utc(u.avatar_checked_at) < timedelta(minutes=1)


def test_size_choice():
    assert avatars._pick_size(SIZES)["file_id"] == "s"
    assert avatars._pick_size([{"file_id": "a", "width": 64}, {"file_id": "b", "width": 80}])["file_id"] == "b"
    assert avatars._pick_size([]) is None


def test_no_photo_clears_avatar_but_marks_checked(user, tg):
    avatars.fetch_and_store(TG, token="1:main")
    assert _avatar_file().is_file()
    tg.sizes = []
    assert avatars.fetch_and_store(TG, token="1:main") == ""
    assert not _avatar_file().exists()
    with transaction() as db:
        u = db.get(User, user)
        assert u.avatar_url == "" and u.avatar_checked_at is not None


def test_bot_fallback_and_errors_never_raise(user, tg, enabled, monkeypatch):
    tg.broken_tokens = {"1:main"}  # the client never started the main bot → the support bot is asked
    assert avatars.fetch_and_store(TG) == f"/uploads/avatars/{TG}.jpg"
    assert tg.calls[-1] == ("download", "https://api.telegram.org/file/bot2:support/photos/s.jpg")
    tg.broken_tokens = {"1:main", "2:support"}
    assert avatars.fetch_and_store(TG) == ""
    assert not _avatar_file().exists()
    with transaction() as db:
        u = db.get(User, user)
        assert u.avatar_url == "" and u.avatar_checked_at is not None

    def boom(url):
        raise OSError("network down")

    tg.broken_tokens = set()
    monkeypatch.setattr(avatars, "_download", boom)
    assert avatars.fetch_and_store(TG) == ""


def test_refresh_if_stale_once_a_day(user, tg, enabled):
    with transaction() as db:
        u = db.get(User, user)
        assert u.avatar_checked_at is None
        assert avatars.refresh_if_stale(db, u) is True  # never checked → fetched (inline here)
        db.refresh(u)
        assert u.avatar_url == f"/uploads/avatars/{TG}.jpg" and u.avatar_checked_at is not None
        calls = len(tg.calls)
        assert avatars.refresh_if_stale(db, u) is False  # checked less than a day ago
        assert len(tg.calls) == calls
    with transaction() as db:
        db.get(User, user).avatar_checked_at = utcnow() - timedelta(hours=25)
    with transaction() as db:
        u = db.get(User, user)
        assert avatars.refresh_if_stale(db, u) is True
        assert len(tg.calls) > calls
        db.refresh(u)
        assert utcnow() - as_utc(u.avatar_checked_at) < timedelta(minutes=1)
    with read_session() as db:
        u = db.get(User, user)
        u.avatar_checked_at = None
        avatars._inflight.add(TG)  # a job already queued for this client is not queued twice
        try:
            assert avatars.refresh_if_stale(db, u) is False
        finally:
            avatars._inflight.discard(TG)


def test_hook_is_silent_in_tests(user, tg, monkeypatch):
    with transaction() as db:
        u = db.get(User, user)
        assert avatars.refresh_if_stale(db, u) is False  # no bot token in the test settings
    monkeypatch.setenv("MAIN_BOT_TOKEN", "1:main")  # bot tests configure a fake token: still no network
    reset_settings_cache()
    try:
        with transaction() as db:
            assert avatars.refresh_if_stale(db, db.get(User, user)) is False
    finally:
        reset_settings_cache()
    assert tg.calls == []
    with transaction() as db:
        assert db.get(User, user).avatar_checked_at is None


def test_get_or_create_asks_for_a_refresh(seeded, monkeypatch):
    from paygo.services import users as user_service

    seen = []
    monkeypatch.setattr(user_service.avatars, "refresh_if_stale", lambda db, u: seen.append(u.telegram_id))
    with transaction() as db:
        user_service.get_or_create(db, {"id": 424242, "first_name": "New"})  # new client
        user_service.get_or_create(db, {"id": 424242, "first_name": "New"})  # known client
    assert seen == [424242, 424242]


def test_files_endpoint_and_api_payloads(logged, user, tg, fake_provider):
    from fastapi.testclient import TestClient
    from paygo.services import deposits, support, withdrawals
    from paygo.services.cashes import get_cash
    from paygo.services.users import get_or_create, public_user

    url = avatars.fetch_and_store(TG, token="1:main")
    r = logged.get(P + f"/files/avatars/{TG}.jpg")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    with Image.open(io.BytesIO(r.content)) as img:
        assert img.size == (128, 128)
    with TestClient(logged.app) as anon:
        assert anon.get(P + f"/files/avatars/{TG}.jpg").status_code in (401, 403)
    assert logged.get(P + "/files/avatars/%2e%2e/%2e%2e/%2e%2e/.env").status_code == 404
    # serializers carry the avatar ("" when the client has none)
    with transaction() as db:
        u = db.get(User, user)
        cash = get_cash(db, "1xbet")
        cash_id = cash.id
        assert public_user(u)["avatar_url"] == url
        assert public_user(get_or_create(db, {"id": 999888777, "first_name": "Second"}))["avatar_url"] == ""
        dep, _ = deposits.create_deposit(db, user=u, cash=cash, player_id="123456", amount="500", idempotency_key="av1")
        assert deposits.public_deposit(db, dep)["user_avatar"] == url
        assert support.public_conversation(support.get_or_open_conversation(db, u))["user_avatar"] == url
    wid = withdrawals.create_withdrawal(user_id=user, cash_id=cash_id, player_id="123456", code="ADM1234", idempotency_key="av2")["withdrawal"]["id"]
    with transaction() as db:
        assert withdrawals.public_withdrawal(db.get(Withdrawal, wid))["user_avatar"] == url
    # ...and so do the panel endpoints built on them
    body = logged.get(P + f"/users/{user}").json()
    assert body["item"]["avatar_url"] == url
    assert body["deposits"][0]["user_avatar"] == url and body["withdrawals"][0]["user_avatar"] == url and body["conversations"][0]["user_avatar"] == url
    assert logged.get(P + "/users?q=tester").json()["items"][0]["avatar_url"] == url
