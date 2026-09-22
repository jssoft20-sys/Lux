"""QR images for the client bot and the admin panel.

* ``render_pay_card`` — the photo sent with a deposit request: white card with a
  red frame, a black QR (error-correction level H), «ОТСКАНИРУЙТЕ QR / В любом
  банке» captions, a light brand watermark and a translucent diagonal overlay
  text. The overlay is light enough (luminance stays on the right side of the
  threshold for both black and white modules) that the code scans with ordinary
  banking apps; tests verify decodability with zxing.
* ``render_qr_png`` — plain QR (admin panel, withdrawals).
"""
from __future__ import annotations

import io
import math
import threading
from collections import OrderedDict
from pathlib import Path

import qrcode
from PIL import Image, ImageDraw, ImageFont
from qrcode.constants import ERROR_CORRECT_H

from ..config import PACKAGE_DIR

FONT_DIR = PACKAGE_DIR / "assets" / "fonts"
BLACK = (17, 17, 17)
FRAME = (196, 32, 32)
BLUE = (24, 62, 196)
OVERLAY = (255, 64, 64, 105)  # translucent light red — keeps module contrast
WATERMARK = (150, 150, 150, 46)

_CACHE: OrderedDict[str, bytes] = OrderedDict()
_LOCK = threading.Lock()
_BACKGROUNDS: dict[tuple[int, int, str], Image.Image] = {}
_FONTS = threading.local()  # a FreeType face is not shared between threads
PALETTE_COLORS = 64  # the card is flat colour work: a 64-colour palette looks the same and halves the bytes Telegram has to carry


def _font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    cache = getattr(_FONTS, "cache", None)
    if cache is None:
        cache = _FONTS.cache = {}
    font = cache.get((size, bold))
    if font is None:
        path = FONT_DIR / ("LiberationSans-Bold.ttf" if bold else "LiberationSans-Regular.ttf")
        try:
            font = ImageFont.truetype(str(path), size)
        except Exception:
            font = ImageFont.load_default()
        cache[(size, bold)] = font
    return font


def _remember(key: str, data: bytes) -> bytes:
    with _LOCK:
        _CACHE[key] = data
        while len(_CACHE) > 300:
            _CACHE.popitem(last=False)
    return data


def _cached(key: str) -> bytes | None:
    with _LOCK:
        cached = _CACHE.get(key)
        if cached:
            _CACHE.move_to_end(key)
        return cached


def _background(width: int, height: int, watermark: str) -> Image.Image:
    """White card with the tiled diagonal watermark.

    It is the same picture for every request, and drawing + rotating it is by far the most
    expensive part of a card (~0.3 s), so it is built once per size and reused: a card then
    costs only its QR, its texts and the PNG encoder."""
    key = (width, height, watermark)
    with _LOCK:
        ready = _BACKGROUNDS.get(key)
    if ready is not None:
        return ready
    base = Image.new("RGBA", (width, height), (255, 255, 255, 255))
    if watermark:
        layer = Image.new("RGBA", (width * 2, height * 2), (0, 0, 0, 0))
        ldraw = ImageDraw.Draw(layer)
        wfont = _font(30, bold=True)
        step_x, step_y = 260, 90
        for row, y in enumerate(range(0, height * 2, step_y)):
            offset = (row % 2) * (step_x // 2)
            for x in range(-step_x, width * 2, step_x):
                ldraw.text((x + offset, y), watermark, font=wfont, fill=WATERMARK)
        layer = layer.rotate(30, resample=Image.BICUBIC, expand=False)
        left, top = (layer.width - width) // 2, (layer.height - height) // 2
        base.alpha_composite(layer.crop((left, top, left + width, top + height)))
    with _LOCK:
        if len(_BACKGROUNDS) > 12:
            _BACKGROUNDS.clear()
        _BACKGROUNDS[key] = base
    return base


def _encode(card: Image.Image) -> bytes:
    """PNG bytes of a finished card: palette first (smaller file, faster encoder, identical look)."""
    image = card.convert("RGB")
    try:
        image = image.quantize(colors=PALETTE_COLORS, method=Image.MEDIANCUT, dither=Image.NONE)
    except Exception:  # pragma: no cover - Pillow without median cut
        pass
    buf = io.BytesIO()
    image.save(buf, format="PNG", compress_level=6)
    return buf.getvalue()


def prewarm(watermark: str = "") -> None:
    """Build the card backgrounds ahead of the first client (called at bot start, off the hot path).

    Without an argument the watermark the owner set in the panel is used, so the warm-up hits the
    same cache entry the first real payment card will ask for."""
    if not watermark:
        try:
            from . import settings_store

            watermark = str(settings_store.get(None, "qr_watermark_text") or "PAYGO")
        except Exception:  # pragma: no cover - no database yet: the default card is warmed anyway
            watermark = "PAYGO"
    try:
        _background(880, 1100, watermark)
        _background(880, 560, watermark)
    except Exception:  # pragma: no cover - warming up must never break a start-up
        pass


def _qr_image(value: str, *, size: int, fill=BLACK) -> Image.Image:
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=10, border=1)
    qr.add_data(value)
    qr.make(fit=True)
    img = qr.make_image(fill_color=fill, back_color="white").convert("RGB")
    return img.resize((size, size), Image.NEAREST)


def _text_width(draw: ImageDraw.ImageDraw, text: str, font) -> int:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0]


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = (current + " " + word).strip()
        if current and _text_width(draw, candidate, font) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines or [text]


def render_pay_card(value: str, *, title: str = "ОТСКАНИРУЙТЕ QR", subtitle: str = "В любом банке", overlay: str = "", watermark: str = "PAYGO") -> bytes:
    key = f"card:{title}|{subtitle}|{overlay}|{watermark}|{value}"
    cached = _cached(key)
    if cached:
        return cached
    width, height = 880, 1100
    card = _background(width, height, watermark).copy()
    # frame
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle([6, 6, width - 7, height - 7], radius=22, outline=FRAME, width=8)
    # QR
    qr_size = 690
    qr_img = _qr_image(value, size=qr_size)
    qx, qy = (width - qr_size) // 2, 70
    card.paste(qr_img, (qx, qy))
    # translucent diagonal overlay over the code
    if overlay:
        layer = Image.new("RGBA", (qr_size, qr_size), (0, 0, 0, 0))
        ldraw = ImageDraw.Draw(layer)
        ofont = _font(58, bold=True)
        lines = _wrap(ldraw, overlay.upper(), ofont, int(qr_size * 0.95))
        line_h = 66
        total_h = line_h * len(lines)
        for i, line in enumerate(lines):
            tw = _text_width(ldraw, line, ofont)
            ldraw.text(((qr_size - tw) // 2, (qr_size - total_h) // 2 + i * line_h), line, font=ofont, fill=OVERLAY)
        layer = layer.rotate(45, resample=Image.BICUBIC, expand=False)
        card.alpha_composite(layer, (qx, qy))
    # captions
    draw = ImageDraw.Draw(card)
    tfont = _font(46, bold=True)
    sfont = _font(40, bold=True)
    y = qy + qr_size + 60
    for line in _wrap(draw, title, tfont, width - 120):
        draw.text(((width - _text_width(draw, line, tfont)) // 2, y), line, font=tfont, fill=BLACK)
        y += 56
    y += 8
    for line in _wrap(draw, subtitle, sfont, width - 120):
        draw.text(((width - _text_width(draw, line, sfont)) // 2, y), line, font=sfont, fill=BLUE)
        y += 50
    return _remember(key, _encode(card))


STATUS_STYLES = {
    "success": ((16, 157, 106), "ОПЛАЧЕНО"),
    "cancelled": ((189, 52, 74), "ОТМЕНЕНО"),
    "expired": ((120, 132, 150), "ВРЕМЯ ИСТЕКЛО"),
}


def render_status_card(kind: str, title: str = "", subtitle: str = "", *, watermark: str = "PAYGO") -> bytes:
    """A card without any payment data: replaces the QR picture once a request is paid / cancelled / expired."""
    color, default_title = STATUS_STYLES.get(kind, STATUS_STYLES["expired"])
    title = (title or default_title).strip()
    key = f"status:{kind}|{title}|{subtitle}|{watermark}"
    cached = _cached(key)
    if cached:
        return cached
    width, height = 880, 560
    card = _background(width, height, watermark).copy()
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle([6, 6, width - 7, height - 7], radius=22, outline=color + (255,), width=8)
    # big status circle with a mark
    cx, cy, r = width // 2, 190, 92
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (255,))
    if kind == "success":
        draw.line([(cx - 44, cy + 4), (cx - 12, cy + 36), (cx + 48, cy - 34)], fill=(255, 255, 255, 255), width=16, joint="curve")
    else:
        draw.line([(cx - 36, cy - 36), (cx + 36, cy + 36)], fill=(255, 255, 255, 255), width=16)
        draw.line([(cx + 36, cy - 36), (cx - 36, cy + 36)], fill=(255, 255, 255, 255), width=16)
    tfont, sfont = _font(60, bold=True), _font(36, bold=True)
    y = cy + r + 50
    for line in _wrap(draw, title, tfont, width - 120):
        draw.text(((width - _text_width(draw, line, tfont)) // 2, y), line, font=tfont, fill=color + (255,))
        y += 70
    for line in _wrap(draw, subtitle, sfont, width - 120)[:2]:
        draw.text(((width - _text_width(draw, line, sfont)) // 2, y + 6), line, font=sfont, fill=BLACK)
        y += 46
    return _remember(key, _encode(card))


def render_qr_png(value: str, *, branded: bool = False, box_size: int = 10, border: int = 3) -> bytes:
    """Plain QR (admin panel, payout QR previews). ``branded`` is accepted for backwards compatibility."""
    key = f"plain:{box_size}:{border}:{value}"
    cached = _cached(key)
    if cached:
        return cached
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=box_size, border=border)
    qr.add_data(value)
    qr.make(fit=True)
    img = qr.make_image(fill_color=BLACK, back_color="white").convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)  # a plain black/white QR is a few KB either way
    return _remember(key, buf.getvalue())


__all__ = ["render_pay_card", "render_status_card", "render_qr_png", "prewarm", "Path", "math"]
