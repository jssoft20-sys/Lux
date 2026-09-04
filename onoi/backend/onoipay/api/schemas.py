"""Pydantic request bodies for the admin API."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


class PasswordChangeBody(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=200)


class AdminCreateBody(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=10, max_length=200)
    role: str = "operator"
    name: str = ""


class AdminUpdateBody(BaseModel):
    role: str | None = None
    name: str | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=10, max_length=200)
    telegram_id: int | None = None


class ActionBody(BaseModel):
    action: str
    reason: str = ""


class EditBody(BaseModel):
    fields: dict[str, Any]


class CashBody(BaseModel):
    key: str | None = None
    name: str | None = None
    provider_type: str | None = None
    enabled: bool | None = None
    priority: int | None = None
    currency: str | None = None
    accepted_currency_ids: str | None = None
    ip_address: str | None = None
    base_url: str | None = None
    deposit_enabled: bool | None = None
    withdraw_enabled: bool | None = None
    deposit_min: str | float | int | None = None
    deposit_max: str | float | int | None = None
    withdraw_min: str | float | int | None = None
    withdraw_max: str | float | int | None = None
    deposit_fee_pct: str | float | int | None = None
    withdraw_fee_pct: str | float | int | None = None
    auto_disable_enabled: bool | None = None
    low_balance_threshold: str | float | int | None = None
    critical_balance_threshold: str | float | int | None = None
    auto_enable_threshold: str | float | int | None = None
    max_daily_limit: str | float | int | None = None
    instructions_text: str | None = None
    notes: str | None = None
    credentials: dict[str, Any] | None = None
    auto_disabled: bool | None = None


class RequisiteBody(BaseModel):
    name: str | None = None
    source: str | None = None
    enabled: bool | None = None
    priority: int | None = None
    cash_id: int | None = None
    notes: str | None = None


class BankLinkBody(BaseModel):
    key: str | None = None
    name: str | None = None
    prefix: str | None = None
    kind: str | None = None
    enabled: bool | None = None
    priority: int | None = None
    encode_payload: bool | None = None


class SettingsBody(BaseModel):
    values: dict[str, Any]


class UserUpdateBody(BaseModel):
    is_blocked: bool | None = None
    block_reason: str | None = None
    support_blocked: bool | None = None
    support_block_reason: str | None = None
    note: str | None = None
    referral_balance: str | float | int | None = None


class SupportReplyBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    photo_url: str = ""


class SupportStatusBody(BaseModel):
    status: str
    note: str = ""


class PushSubscribeBody(BaseModel):
    endpoint: str
    keys: dict[str, str]


class BroadcastBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    photo_url: str = ""
    only_active_days: int = 0


class ManualPaymentBody(BaseModel):
    amount: str | float | int
    note: str = ""
