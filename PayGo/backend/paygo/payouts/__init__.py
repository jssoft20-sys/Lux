"""Payout providers: send a validated client withdrawal to the client's card/wallet.

This is the *outgoing* side of the desk. The bookmaker adapters in ``paygo.providers``
tell us how much the client is owed; a payout provider actually moves that money from an
owner banking account (Optima24 today) to the client's Elcart card or bank QR — the step
an operator does by hand today.

Nothing here moves money on import. A provider is only built when ``PAYOUT_PROVIDER`` is
set in the environment, and the engine (:mod:`paygo.services.autopay`) keeps a dry-run
guard in front of every real transfer.
"""
from __future__ import annotations

from .base import (
    PayoutError,
    PayoutProvider,
    PayoutResult,
    PayoutTarget,
    build_provider,
    provider_from_settings,
    register,
)

__all__ = [
    "PayoutError",
    "PayoutProvider",
    "PayoutResult",
    "PayoutTarget",
    "build_provider",
    "provider_from_settings",
    "register",
]
