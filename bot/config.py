"""Runtime configuration, loaded from environment / .env (see .env.example)."""

from __future__ import annotations

import re
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_INLINE_COMMENT = re.compile(r"\s+#.*$")

DEFAULT_SYMBOLS = (
    "BTCUSDT,ETHUSDT,BNBUSDT,ADAUSDT,AVAXUSDT,AAVEUSDT,BCHUSDT,ALGOUSDT,AXSUSDT,"
    "1INCHUSDT,BATUSDT,BANDUSDT,BELUSDT,BNTUSDT,C98USDT,ACMUSDT,ALICEUSDT,AVAUSDT,"
    "LINKUSDT,LTCUSDT,ETCUSDT"
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    # ---- Binance ----
    binance_api_key: str = ""
    binance_api_secret: str = ""
    binance_api_url: str = "https://api.binance.com"
    binance_data_url: str = "https://data-api.binance.vision"
    binance_ws_url: str = "wss://data-stream.binance.vision"
    trading_mode: str = "paper"  # paper | live
    quote_asset: str = "USDT"
    symbols: str = DEFAULT_SYMBOLS
    paper_start_balance: float = 50.0

    # ---- Strategy / risk ----
    position_size_usdt: float = 10.0
    max_position_pct: float = 0.35
    max_positions: int = 3
    take_profit_pct: float = 1.2
    stop_loss_pct: float = 0.8
    trailing_stop_pct: float = 0.5
    trailing_activation_pct: float = 0.5
    max_hold_minutes: int = 45
    min_hold_seconds: float = 90.0  # anti-churn: hold at least this long before a soft exit (SL/TP still fire)
    # ---- scalp mode: targets derived from Binance fees instead of fixed percentages ----
    scalp_mode: bool = True
    fee_multiple: float = 2.5  # take-profit = round-trip commission × this (0.2 % × 2.5 = 0.5 %)
    scalp_max_hold_minutes: int = 12  # get out fast: a scalp that has not worked in this time is closed
    scalp_min_volatility_ratio: float = 0.5  # recent 5-min realised volatility must be ≥ target × ratio (a dead pair cannot pay the fees fast)
    buy_threshold: float = 0.35
    exit_threshold: float = -0.25
    min_news_score: float = 0.05  # entries need at least mildly positive news tone
    daily_loss_limit_usdt: float = 8.0
    max_spread_bps: float = 15.0
    symbol_cooldown_minutes: float = 10.0
    decision_interval_ms: int = 100
    news_half_life_minutes: float = 20.0
    fee_rate: float = 0.001
    paper_slippage_bps: float = 2.0
    w_news: float = 0.55
    w_momentum: float = 0.25
    w_orderbook: float = 0.10
    w_flow: float = 0.10
    min_quote_reserve: float = 0.0

    # ---- News ----
    news_poll_seconds: int = 15
    cryptopanic_token: str = ""
    newsapi_key: str = ""
    extra_rss: str = ""

    # ---- LLM (both providers run together when both keys are set) ----
    anthropic_api_key: str = ""
    llm_model: str = "claude-opus-5"
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1-mini"
    llm_providers: str = "anthropic,openai"  # order of preference
    llm_enabled: bool = True
    llm_batch_size: int = 12
    llm_min_interval_seconds: float = 1.5
    llm_max_batch_wait_seconds: float = 2.0
    llm_max_age_minutes: float = 90.0  # do not pay to analyse stale headlines

    # ---- Server ----
    host: str = "0.0.0.0"
    port: int = 7066
    dashboard_password: str = ""
    dashboard_user: str = "lux"
    db_path: str = "data/lux.db"
    log_level: str = "INFO"

    @field_validator("*", mode="before")
    @classmethod
    def _strip_inline_comment(cls, v: object) -> object:
        """Tolerate ``KEY=value   # comment`` lines from .env files and docker env_file."""
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("#"):
                return ""
            v = _INLINE_COMMENT.sub("", v).strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
        return v

    @field_validator("trading_mode")
    @classmethod
    def _mode(cls, v: str) -> str:
        v = (v or "paper").strip().lower()
        if v not in ("paper", "live"):
            raise ValueError("TRADING_MODE must be 'paper' or 'live'")
        return v

    @property
    def symbol_list(self) -> list[str]:
        out: list[str] = []
        for s in self.symbols.replace(";", ",").split(","):
            s = s.strip().upper().replace("/", "")
            if s and s not in out:
                out.append(s)
        return out

    @property
    def live(self) -> bool:
        return self.trading_mode == "live"

    @property
    def llm_active(self) -> bool:
        return bool(self.llm_enabled and (self.anthropic_api_key or self.openai_api_key))

    @property
    def provider_list(self) -> list[str]:
        out = []
        for p in self.llm_providers.replace(";", ",").split(","):
            p = p.strip().lower()
            if p in ("anthropic", "claude") and self.anthropic_api_key and "anthropic" not in out:
                out.append("anthropic")
            elif p in ("openai", "gpt", "chatgpt") and self.openai_api_key and "openai" not in out:
                out.append("openai")
        return out


@lru_cache
def get_settings() -> Settings:
    return Settings()
