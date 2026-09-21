#!/usr/bin/env python3
"""Проверка ключа Binance с сервера: доступ, разрешения, баланс, какие пары из SYMBOLS торгуемы.
Ничего не покупает и не продаёт (используются только чтение и тестовые ордера).

    python -m scripts.check_binance
"""

from __future__ import annotations

import asyncio
import sys

from bot.config import get_settings
from bot.exchange.binance import BinanceError, BinanceREST


async def main() -> int:
    cfg = get_settings()
    rest = BinanceREST(cfg.binance_api_key, cfg.binance_api_secret, cfg.binance_api_url, cfg.binance_data_url)
    ok = True
    try:
        print("1. Публичные данные ...", end=" ")
        await rest.ping()
        offset = await rest.sync_time()
        print(f"ок (расхождение часов {offset} мс)")

        print("2. Аккаунт ...", end=" ")
        if not cfg.binance_api_key or not cfg.binance_api_secret:
            print("ПРОПУСК: ключи не заданы в .env")
            return 1
        bal = await rest.balances()
        quote = bal.get(cfg.quote_asset, (0.0, 0.0))[0]
        print(f"ок. Свободно {quote:.4f} {cfg.quote_asset}; другие активы: " + ", ".join(f"{a}={f:g}" for a, (f, _l) in bal.items() if f > 0 and a != cfg.quote_asset) or "нет")
        if quote < 5.25:
            print(f"   ! Для сделки нужно минимум ~5.25 {cfg.quote_asset}")

        print("3. Ограничения ключа ...", end=" ")
        try:
            r = await rest.api_restrictions()
            print("ок")
            print(f"   спот-торговля: {'ДА' if r.get('enableSpotAndMarginTrading') else 'НЕТ  <-- включите!'}")
            print(f"   вывод средств: {'ДА  <-- отключите, боту не нужно' if r.get('enableWithdrawals') else 'нет (хорошо)'}")
            print(f"   ограничение по IP: {'да' if r.get('ipRestrict') else 'НЕТ  <-- рекомендуется указать IP сервера'}")
            if not r.get("enableSpotAndMarginTrading"):
                ok = False
        except BinanceError as e:
            print(f"не удалось: {e.msg}")

        print("4. Тестовые ордера по парам (ничего не покупается):")
        rules = await rest.exchange_info(cfg.symbol_list)
        for s in cfg.symbol_list:
            rule = rules.get(s)
            if rule is None:
                print(f"   {s:10} нет такой пары")
                continue
            try:
                await rest.market_buy(s, float(rule.min_notional) * 1.05, test=True)
                print(f"   {s:10} ок (мин. сумма {rule.min_notional} {rule.quote})")
            except BinanceError as e:
                if "insufficient" in e.msg.lower():
                    print(f"   {s:10} разрешена, но не хватает баланса")
                else:
                    print(f"   {s:10} НЕТ: {e.msg}")
    except BinanceError as e:
        print(f"\nОШИБКА: {e.msg}")
        if e.status == 451:
            print("Сервер находится в регионе, где Binance недоступен. Нужен сервер в другой стране.")
        return 2
    finally:
        await rest.close()
    print("\nИтог:", "всё готово к live-торговле" if ok else "есть проблемы, см. выше")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
