"""Administrative CLI: ``python -m onoipay.cli <command>``.

Commands:
  init-db            create tables directly from models (dev) — production uses alembic
  create-admin       create an admin account (interactive or --username/--password)
  seed               insert default cash desks, bank links and settings (idempotent)
  gen-secrets        print freshly generated secrets for .env
  check              verify configuration and database connectivity
  import-legacy      import 1xBet/1win cash desk credentials from the old config.json
  set-webhook-secret rotate WEBHOOK_SECRET helper (prints new value)
"""
from __future__ import annotations

import argparse
import getpass
import json
import secrets
import sys
from pathlib import Path


def cmd_gen_secrets(_args) -> int:
    for name in ("SECRET_KEY", "JWT_SECRET", "SESSION_SECRET", "WEBHOOK_SECRET", "ENCRYPTION_KEY"):
        print(f"{name}={secrets.token_urlsafe(48)}")
    try:
        from .services.push_keys import generate_vapid

        priv, pub = generate_vapid()
        print(f"VAPID_PRIVATE_KEY={priv}")
        print(f"VAPID_PUBLIC_KEY={pub}")
    except Exception as exc:  # pragma: no cover
        print(f"# VAPID keys not generated: {exc}")
    return 0


def cmd_init_db(_args) -> int:
    from .db import create_all

    create_all()
    print("schema created")
    return 0


def cmd_create_admin(args) -> int:
    from .db import transaction
    from .services import auth

    username = args.username or input("Логин администратора: ").strip()
    password = args.password or getpass.getpass("Пароль (мин. 10 символов, буквы разного регистра и цифра): ")
    role = args.role or "owner"
    with transaction() as db:
        try:
            admin = auth.create_admin(db, username, password, role, args.name or username)
        except ValueError as exc:
            print(f"Ошибка: {exc}")
            return 1
        print(f"Администратор создан: {admin.username} ({admin.role})")
    return 0


def cmd_seed(_args) -> int:
    from .db import transaction
    from .seed import seed_defaults

    with transaction() as db:
        report = seed_defaults(db)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def cmd_check(_args) -> int:
    from .config import get_settings
    from .db import ping

    settings = get_settings()
    problems = settings.require_secrets()
    print(f"env: {settings.app_env}")
    print(f"database: {settings.database_url.split('://')[0]} -> {'ok' if ping() else 'UNREACHABLE'}")
    print(f"public url: {settings.public_url}{settings.base_path}/")
    print(f"main bot token: {'set' if settings.main_bot_token else 'MISSING'}")
    print(f"support bot token: {'set' if settings.support_bot_token else 'MISSING'}")
    print(f"smtp: {'configured' if settings.smtp_host else 'not configured'}")
    print(f"push: {'configured' if settings.vapid_public_key else 'not configured'}")
    if problems:
        print("MISSING SECRETS: " + ", ".join(problems))
        return 1
    print("config ok")
    return 0


def cmd_import_legacy(args) -> int:
    from .db import transaction
    from .legacy_import import import_config

    path = Path(args.path)
    if not path.exists():
        print(f"файл не найден: {path}")
        return 1
    with transaction() as db:
        report = import_config(db, json.loads(path.read_text(encoding="utf-8")), enable_keys=set((args.enable or "1xbet").split(",")))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="onoipay-admin")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("gen-secrets").set_defaults(fn=cmd_gen_secrets)
    sub.add_parser("init-db").set_defaults(fn=cmd_init_db)
    p = sub.add_parser("create-admin")
    p.add_argument("--username")
    p.add_argument("--password")
    p.add_argument("--role", choices=["owner", "admin", "operator", "viewer"])
    p.add_argument("--name")
    p.set_defaults(fn=cmd_create_admin)
    sub.add_parser("seed").set_defaults(fn=cmd_seed)
    sub.add_parser("check").set_defaults(fn=cmd_check)
    p = sub.add_parser("import-legacy")
    p.add_argument("path")
    p.add_argument("--enable", default="1xbet", help="comma separated cash keys to enable (default: 1xbet)")
    p.set_defaults(fn=cmd_import_legacy)
    args = parser.parse_args(argv)
    return int(args.fn(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
