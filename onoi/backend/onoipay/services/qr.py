"""QR image generation with OnoiPay branding.

The QR keeps error-correction level H, dark modules (deep brand pink on white,
contrast ratio > 7:1) and a small centred logo that covers far less than the
30 % that level H can recover. The result scans with ordinary phone apps.
"""
from __future__ import annotations

import io
import threading
from collections import OrderedDict
from pathlib import Path

import qrcode
from PIL import Image, ImageDraw
from qrcode.constants import ERROR_CORRECT_H

from ..config import PROJECT_ROOT

BRAND_DARK = (156, 15, 90)  # deep OnoiPay pink, luminance ~0.08 → contrast 8:1 on white
BRAND_PINK = (232, 24, 122)
LOGO_PATH = PROJECT_ROOT / "frontend" / "admin" / "brand" / "onoipay-logo.png"

_CACHE: OrderedDict[str, bytes] = OrderedDict()
_LOCK = threading.Lock()
_LOGO: dict[str, Image.Image | None] = {}


def _logo(path: Path | None = None) -> Image.Image | None:
    key = str(path or LOGO_PATH)
    if key in _LOGO:
        return _LOGO[key]
    try:
        img = Image.open(key).convert("RGBA")
    except Exception:
        img = None
    _LOGO[key] = img
    return img


def render_qr_png(value: str, *, branded: bool = True, box_size: int = 10, border: int = 3) -> bytes:
    cache_key = f"{int(branded)}:{box_size}:{border}:{value}"
    with _LOCK:
        cached = _CACHE.get(cache_key)
        if cached:
            _CACHE.move_to_end(cache_key)
            return cached
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=box_size, border=border)
    qr.add_data(value)
    qr.make(fit=True)
    fill = BRAND_DARK if branded else (0, 0, 0)
    img = qr.make_image(fill_color=fill, back_color="white").convert("RGBA")
    if branded:
        logo = _logo()
        if logo is not None:
            width, height = img.size
            # logo occupies ~20% of the side (4% of the area) — well inside level-H tolerance
            side = max(48, int(min(width, height) * 0.20))
            pad = max(4, side // 10)
            plate = Image.new("RGBA", (side + pad * 2, side + pad * 2), (255, 255, 255, 0))
            ImageDraw.Draw(plate).rounded_rectangle(
                [0, 0, plate.width - 1, plate.height - 1], radius=side // 4, fill=(255, 255, 255, 255)
            )
            resized = logo.resize((side, side), Image.LANCZOS)
            plate.alpha_composite(resized, (pad, pad))
            img.alpha_composite(plate, ((width - plate.width) // 2, (height - plate.height) // 2))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG", optimize=True)
    data = buf.getvalue()
    with _LOCK:
        _CACHE[cache_key] = data
        while len(_CACHE) > 300:
            _CACHE.popitem(last=False)
    return data
