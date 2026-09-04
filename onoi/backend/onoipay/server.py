"""Entry point: ``python -m onoipay.server`` (or ``onoipay-server``)."""
from __future__ import annotations

import logging

import uvicorn

from .config import get_settings


def setup_logging() -> None:
    settings = get_settings()
    logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO), format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def main() -> None:
    settings = get_settings()
    setup_logging()
    uvicorn.run("onoipay.app:app", host=settings.host, port=settings.port, log_level=settings.log_level.lower(), proxy_headers=settings.trust_proxy, forwarded_allow_ips="*" if settings.trust_proxy else None, access_log=False)


if __name__ == "__main__":
    main()
