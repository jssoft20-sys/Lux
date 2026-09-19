"""Administrative CLI: ``python -m paygo.cli <command>``.

Commands:
  init-db            create tables directly from models (dev) — production uses alembic
  create-admin       create an admin account (interactive or --username/--password)
  seed               insert default cash desks, bank links and settings (idempotent)
  gen-secrets        print freshly generated secrets for .env
  check              verify configuration and database connectivity
  import-legacy      import 1xBet/1win cash desk credentials from the old config.json
  revoke-sessions    end every admin-panel session and pending login (used by scripts/kill_stray.sh --sessions)
  optima-otp-test    read the latest Optima confirmation code from the OTP mailbox (verify setup)
  payout-check       full payout status: accounts, network reachability, login, OTP mailbox
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


def cmd_revoke_sessions(_args) -> int:
    """End every admin-panel session and pending login (everybody signs in again)."""
    from sqlalchemy import select

    from .db import transaction
    from .models import Admin, LoginRequest
    from .services import auth
    from .utils import utcnow

    with transaction() as db:
        total = 0
        for admin in db.execute(select(Admin)).scalars().all():
            total += auth.revoke_all_sessions(db, admin.id, reason="revoked_by_cli")
        pending = db.execute(select(LoginRequest).where(LoginRequest.status == "pending")).scalars().all()
        for row in pending:
            row.status = "expired"
            row.decided_at = utcnow()
        auth.audit(db, "auth.sessions_revoked_all", actor="cli", details={"sessions": total, "pending_logins": len(pending)})
    print(f"сеансы админки завершены: {total}; отменено ожидающих входов: {len(pending)}")
    return 0


def cmd_optima_otp_test(_args) -> int:
    """Verify the Optima OTP mailbox: connect and print the newest confirmation code."""
    from .payouts.otp_email import OtpEmailConfig, reader_from_settings

    cfg = OtpEmailConfig.from_settings()
    if not cfg.configured:
        print("Почта для кодов Optima не настроена. Заполните OPTIMA_OTP_IMAP_* в .env")
        return 1
    print(f"Ящик: {cfg.user}@{cfg.host}:{cfg.port}/{cfg.folder}  отправитель-фильтр: {cfg.sender or '(любой)'}")
    reader = reader_from_settings()
    try:
        code = reader.latest_code() if reader else None
    except Exception as exc:
        print(f"Не удалось прочитать почту: {exc}")
        return 1
    if code:
        print(f"Найден код: {code}")
        return 0
    print("Свежих писем с кодом не найдено (проверьте, что Optima присылает коды на этот ящик и фильтр отправителя верный).")
    return 1


def cmd_payout_check(_args) -> int:
    """Full payout connectivity picture: accounts, network reachability, login, OTP mailbox."""
    import socket
    import ssl
    from urllib.parse import urlparse

    from .config import get_settings
    from .payouts import providers_from_settings
    from .payouts.otp_email import OtpEmailConfig, reader_from_settings

    settings = get_settings()
    name = settings.payout_provider_name
    print(f"Канал выплат: {name or '(выключен — PAYOUT_PROVIDER пуст)'}")
    if not name:
        return 1
    pool = providers_from_settings(settings)
    print(f"Аккаунтов настроено: {len(pool)}")
    for provider in pool:
        print(f"  • {provider.key()}  base_url={getattr(provider, 'base_url', '')}")

    # network reachability to each distinct host:port (TCP + TLS), from THIS server.
    # The TLS check uses the SAME trust context as the real client (pinned CA with the SHA-1
    # allowance, or verification off), so a pinned self-signed cert reads as OK here too.
    from .payouts.optima24 import build_ssl_context

    ca_bundle = (settings.optima24_ca_bundle or "").strip()
    tls_verify = settings.optima24_tls_verify
    tls_ctx = build_ssl_context(ca_bundle, tls_verify)
    how = " [через CA bundle]" if (ca_bundle and tls_verify) else (" [проверка выключена]" if not tls_verify else "")
    hosts: set[tuple[str, int]] = set()
    for provider in pool:
        parsed = urlparse(getattr(provider, "base_url", "") or "")
        if parsed.hostname:
            hosts.add((parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80)))
    for host, port in sorted(hosts):
        try:
            sock = socket.create_connection((host, port), timeout=8)
        except Exception as exc:
            print(f"Сеть {host}:{port}: НЕДОСТУПНО — {type(exc).__name__}: {exc}")
            continue
        try:
            ss = tls_ctx.wrap_socket(sock, server_hostname=host)
            print(f"Сеть {host}:{port}: TLS OK ({ss.version()}){how}")
            ss.close()
        except ssl.SSLError as exc:
            print(f"Сеть {host}:{port}: TCP OK, но TLS не принят — {exc}. Проверьте OPTIMA24_CA_BUNDLE или поставьте OPTIMA24_TLS_VERIFY=false")
            sock.close()

    # login / balance per account (will report the missing capture until the requests are wired)
    for provider in pool:
        result = provider.healthcheck()
        if result.ok:
            print(f"Вход {provider.key()}: OK, баланс {result.balance}")
        else:
            print(f"Вход {provider.key()}: нет — {result.message}")

    # OTP mailbox
    cfg = OtpEmailConfig.from_settings()
    if not cfg.configured:
        print("Почта кодов: не настроена (OPTIMA_OTP_IMAP_*)")
        return 0
    reader = reader_from_settings()
    try:
        code = reader.latest_code() if reader else None
        print(f"Почта кодов: OK ({'найден код ' + code if code else 'подключение есть, свежего кода нет'})")
    except Exception as exc:
        print(f"Почта кодов: ошибка — {exc}")
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
    parser = argparse.ArgumentParser(prog="paygo-admin")
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
    sub.add_parser("revoke-sessions").set_defaults(fn=cmd_revoke_sessions)
    sub.add_parser("optima-otp-test").set_defaults(fn=cmd_optima_otp_test)
    sub.add_parser("payout-check").set_defaults(fn=cmd_payout_check)
    p = sub.add_parser("import-legacy")
    p.add_argument("path")
    p.add_argument("--enable", default="1xbet", help="comma separated cash keys to enable (default: 1xbet)")
    p.set_defaults(fn=cmd_import_legacy)
    args = parser.parse_args(argv)
    return int(args.fn(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
