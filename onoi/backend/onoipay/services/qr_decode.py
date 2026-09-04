"""Best-effort QR decoding of client photos (zxing-cpp or OpenCV when available)."""
from __future__ import annotations

import io
import logging

from PIL import Image, ImageOps

logger = logging.getLogger("onoipay.qr")

try:  # optional fast engine
    import zxingcpp as _zxing
except Exception:  # pragma: no cover - optional
    _zxing = None

try:  # optional fallback
    import cv2 as _cv2
    import numpy as _np
except Exception:  # pragma: no cover - optional
    _cv2 = None
    _np = None


def _variants(img: Image.Image):
    base = ImageOps.exif_transpose(img).convert("L")
    yield base
    width, height = base.size
    if max(width, height) > 1600:
        scale = 1600 / max(width, height)
        yield base.resize((int(width * scale), int(height * scale)), Image.LANCZOS)
    if max(width, height) < 600:
        yield base.resize((width * 2, height * 2), Image.LANCZOS)
    yield ImageOps.autocontrast(base, cutoff=2)
    yield base.point(lambda v: 255 if v > 128 else 0)


def decode_bytes(raw: bytes) -> str:
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        return ""
    for variant in _variants(img):
        text = _decode_variant(variant)
        if text:
            return text
    return ""


def _decode_variant(img: Image.Image) -> str:
    if _zxing is not None:
        try:
            results = _zxing.read_barcodes(img)
            for res in results:
                if res.text and str(res.format).lower().find("qr") >= 0:
                    return str(res.text)
        except Exception as exc:  # pragma: no cover
            logger.debug("zxing failed: %s", exc)
    if _cv2 is not None and _np is not None:
        try:
            arr = _np.array(img.convert("RGB"))[:, :, ::-1]
            detector = _cv2.QRCodeDetector()
            text, _pts, _ = detector.detectAndDecode(arr)
            if text:
                return str(text)
        except Exception as exc:  # pragma: no cover
            logger.debug("opencv failed: %s", exc)
    return ""


def available() -> bool:
    return _zxing is not None or _cv2 is not None
