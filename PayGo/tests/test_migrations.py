"""The alembic chain must apply cleanly from scratch (the installer and update.sh rely on it)."""
from __future__ import annotations

import sqlite3
from pathlib import Path


def test_alembic_upgrade_head_from_empty(tmp_path, monkeypatch):
    from alembic import command
    from alembic.config import Config

    url = f"sqlite:///{tmp_path / 'migrate.sqlite3'}"
    monkeypatch.setenv("DATABASE_URL", url)
    root = Path(__file__).resolve().parent.parent
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")
    con = sqlite3.connect(str(tmp_path / "migrate.sqlite3"))
    cols = {row[1] for row in con.execute("PRAGMA table_info(bank_links)")}
    assert {"emoji", "custom_emoji_id"} <= cols
    cols = {row[1] for row in con.execute("PRAGMA table_info(payment_cashes)")}
    assert {"deposit_photo", "code_photo", "withdraw_address"} <= cols
