from decimal import Decimal

import pytest
from onoipay.services import elqr, qr

TEMPLATE = "00020101021132710013QR.Optima.C2B01032031016109182123435011811112149664:1:1120211130212331500112149664:1:15204999953034175904ELQR6304F6A1"


def test_inject_amount_roundtrip():
    payload = elqr.inject_amount(TEMPLATE, Decimal("1500.37"))
    assert payload.startswith("000201")
    assert elqr.amount_from_payload(payload) == Decimal("1500.37")
    # amount is locked against editing (32.12 = 12)
    root = dict(elqr.parse_tlv(elqr.strip_crc(payload)))
    assert dict(elqr.parse_tlv(root["32"]))["12"] == "12"


def test_normalize_from_bank_link():
    link = "https://mobile.optima24.kg/my-qr/confirm-screen?qr-url=" + TEMPLATE
    prefix, payload = elqr.normalize(link)
    assert payload.startswith("000201") and "6304" not in payload[-8:]


def test_bank_meta():
    meta = elqr.bank_meta(TEMPLATE)
    assert meta["bank_name"] == "Optima Bank"
    assert meta["account"] == "1091821234350118"


def test_bank_links_encoding():
    payload = elqr.inject_amount(TEMPLATE, 100)
    links = elqr.bank_links(payload, [{"key": "mbank", "name": "MBank", "prefix": "https://app.mbank.kg/qr/#", "enabled": True, "priority": 1}, {"key": "odengi", "name": "O", "prefix": "https://api.dengi.o.kg/#", "enabled": True, "priority": 2, "encode_payload": True}, {"key": "off", "name": "x", "prefix": "https://x/#", "enabled": False}])
    assert len(links) == 2
    assert links[0]["url"].endswith(payload)
    assert "%3A" in links[1]["url"]


def test_branded_qr_decodes():
    zxing = pytest.importorskip("zxingcpp")
    import io

    from PIL import Image

    value = elqr.qr_image_value(elqr.inject_amount(TEMPLATE, Decimal("250.11")))
    png = qr.render_qr_png(value)
    img = Image.open(io.BytesIO(png))
    results = zxing.read_barcodes(img)
    assert results and results[0].text == value
    small = img.resize((240, 240))
    assert zxing.read_barcodes(small)[0].text == value
