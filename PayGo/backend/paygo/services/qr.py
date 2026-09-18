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


def _font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    path = FONT_DIR / ("LiberationSans-Bold.ttf" if bold else "LiberationSans-Regular.ttf")
    try:
        return ImageFont.truetype(str(path), size)
    except Exception:
        return ImageFont.load_default()


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
    card = Image.new("RGBA", (width, height), (255, 255, 255, 255))
    draw = ImageDraw.Draw(card)
    # light tiled watermark
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
        card.alpha_composite(layer.crop((left, top, left + width, top + height)))
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
    buf = io.BytesIO()
    card.convert("RGB").save(buf, format="PNG", optimize=True)
    return _remember(key, buf.getvalue())


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
    card = Image.new("RGBA", (width, height), (255, 255, 255, 255))
    draw = ImageDraw.Draw(card)
    if watermark:
        layer = Image.new("RGBA", (width * 2, height * 2), (0, 0, 0, 0))
        ldraw = ImageDraw.Draw(layer)
        wfont = _font(30, bold=True)
        for row, y in enumerate(range(0, height * 2, 90)):
            offset = (row % 2) * 130
            for x in range(-260, width * 2, 260):
                ldraw.text((x + offset, y), watermark, font=wfont, fill=WATERMARK)
        layer = layer.rotate(30, resample=Image.BICUBIC, expand=False)
        left, top = (layer.width - width) // 2, (layer.height - height) // 2
        card.alpha_composite(layer.crop((left, top, left + width, top + height)))
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
    buf = io.BytesIO()
    card.convert("RGB").save(buf, format="PNG", optimize=True)
    return _remember(key, buf.getvalue())


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
    img.save(buf, format="PNG", optimize=True)
    return _remember(key, buf.getvalue())


__all__ = ["render_pay_card", "render_qr_png", "Path", "math"]
