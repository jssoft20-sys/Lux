from bot.config import Settings


def test_inline_comments_and_quotes_are_tolerated():
    s = Settings(
        _env_file=None,
        anthropic_api_key="# без ключа работает только лексика",
        cryptopanic_token="   ",
        position_size_usdt="12   # сумма сделки",
        dashboard_password='"secret"',
        trading_mode="LIVE  # real orders",
    )
    assert s.anthropic_api_key == ""
    assert not s.llm_active
    assert s.cryptopanic_token == ""
    assert s.position_size_usdt == 12.0
    assert s.dashboard_password == "secret"
    assert s.trading_mode == "live" and s.live


def test_symbol_list_normalises():
    s = Settings(_env_file=None, symbols=" btc/usdt, ETHUSDT ;ethusdt,")
    assert s.symbol_list == ["BTCUSDT", "ETHUSDT"]
