import time

from bot.news.book import NewsItem, SentimentBook
from bot.news.entities import EntityExtractor
from bot.news.sentiment import analyse

BASES = ["BTC", "ETH", "ADA", "AAVE", "LINK", "ALICE", "BAND", "AVA", "BCH"]


def test_lexicon_polarity():
    assert analyse("Aave hacked: $20M drained from lending protocol").score < -0.7
    assert analyse("Binance Will List My Neighbor Alice (ALICE)").score > 0.6
    assert analyse("Bitcoin ETF approved by SEC, record inflows").score > 0.7
    assert abs(analyse("Weekly market wrap").score) < 0.05


def test_negation_and_questions():
    assert analyse("Exchange denies it was hacked").score > analyse("Exchange was hacked").score
    assert abs(analyse("Will bitcoin crash?").score) < abs(analyse("Bitcoin crashes").score)


def test_entities():
    ex = EntityExtractor(BASES)
    assert ex.extract("Cardano founder says ADA upgrade delayed")[0] == ["ADA"]
    assert ex.extract("Band members reunite for tour")[0] == []
    assert ex.extract("Band Protocol announces oracle upgrade")[0] == ["BAND"]
    tickers, mw = ex.extract("SEC sues Coinbase; Bitcoin falls 5% as crypto market tumbles")
    assert "BTC" in tickers and mw
    assert ex.extract("Chainlink partners with SWIFT")[0] == ["LINK"]
    assert ex.extract("BTC/USDT breaks $100k, ETHUSDT follows")[0] == ["BTC", "ETH"]


def _item(id_, tickers, score, age_s=0, market_wide=False, importance=0.8, weight=1.0):
    now = time.time()
    return NewsItem(id=id_, ts=now - age_s, fetched=now, source="t", title=id_, summary="", url="", tickers=tickers, market_wide=market_wide, score=score, importance=importance, confidence=1.0, source_weight=weight)


def test_sentiment_book_decay_and_relevance():
    book = SentimentBook(["ADAUSDT", "ETHUSDT"], {"ADAUSDT": "ADA", "ETHUSDT": "ETH"}, half_life_minutes=10)
    book.add(_item("a", ["ADA"], 0.9))
    fresh = book.score("ADAUSDT")["score"]
    assert fresh > 0.3
    book2 = SentimentBook(["ADAUSDT"], {"ADAUSDT": "ADA"}, half_life_minutes=10)
    book2.add(_item("b", ["ADA"], 0.9, age_s=3600))
    assert book2.score("ADAUSDT")["score"] < fresh / 4
    # BTC news moves ETH at half weight, unrelated coin does not
    book.add(_item("c", ["BTC"], -0.9))
    assert book.score("ETHUSDT")["score"] < 0
    assert book.score("ETHUSDT")["count"] == 1


def test_llm_update_blends():
    book = SentimentBook(["ADAUSDT"], {"ADAUSDT": "ADA"})
    book.add(_item("a", ["ADA"], 0.2))
    book.update_llm("a", -0.8, 0.9, "lawsuit", "high")
    it = book.by_id["a"]
    assert it.effective_score < 0
    assert it.effective_importance >= 0.8
