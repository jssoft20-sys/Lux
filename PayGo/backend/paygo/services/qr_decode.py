"""Robust QR decoding of client photos.

Clients photograph bank QR codes from screens and paper: tilted, blurred, dark, with glare,
tiny or huge. The decoder tries a ladder of image variants (scale, contrast, sharpening,
adaptive threshold, rotations, crops) with zxing-cpp until one reads, within a time budget
so the bot stays fast. OpenCV is used as a fallback when installed.
"""
from __future__ import annotations

import io
import logging
import multiprocessing
import os
import threading
import time
from collections.abc import Iterator
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout

from PIL import Image, ImageChops, ImageFilter, ImageOps

logger = logging.getLogger("paygo.qr")

try:  # fast engine
    import zxingcpp as _zxing
except Exception:  # pragma: no cover - optional
    _zxing = None

try:  # optional fallback
    import cv2 as _cv2
    import numpy as _np
except Exception:  # pragma: no cover - optional
    _cv2 = None
    _np = None

_QR_FORMATS = None
if _zxing is not None:
    try:
        _QR_FORMATS = _zxing.BarcodeFormat.QRCode | _zxing.BarcodeFormat.MicroQRCode
    except Exception:  # pragma: no cover - older builds
        _QR_FORMATS = None


def _fit(img: Image.Image, longest: int) -> Image.Image:
    w, h = img.size
    if max(w, h) == longest:
        return img
    scale = longest / max(w, h)
    return img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)


def _adaptive(img: Image.Image, radius: int = 18, bias: int = 6) -> Image.Image:
    """Local-mean threshold: survives shadows, glare and uneven screen brightness."""
    blurred = img.filter(ImageFilter.BoxBlur(radius))
    diff = ImageChops.subtract(img, blurred, scale=1.0, offset=128)
    return diff.point(lambda v: 255 if v > 128 - bias else 0)


def _variants(img: Image.Image) -> Iterator[Image.Image]:
    base = ImageOps.exif_transpose(img).convert("L")
    w, h = base.size
    longest = max(w, h)
    # 1) sensible size first: huge photos are slow and noisy, tiny ones lose modules
    normal = _fit(base, 1400) if longest > 1400 else (_fit(base, 900) if longest < 500 else base)
    yield normal
    yield ImageOps.autocontrast(normal, cutoff=2)
    yield normal.filter(ImageFilter.UnsharpMask(radius=2, percent=180, threshold=2))
    yield _adaptive(normal)
    # 2) other scales
    if longest > 1400:
        yield ImageOps.autocontrast(_fit(base, 2000), cutoff=1)
    yield ImageOps.autocontrast(_fit(normal, 700), cutoff=2)
    # 3) crops: the code is usually in the middle of the frame
    nw, nh = normal.size
    for frac in (0.8, 0.62):
        cw, ch = int(nw * frac), int(nh * frac)
        crop = normal.crop(((nw - cw) // 2, (nh - ch) // 2, (nw + cw) // 2, (nh + ch) // 2))
        yield ImageOps.autocontrast(_fit(crop, 1000), cutoff=2)
    # 4) small rotations (zxing handles 90° steps itself; phones tilt by a few degrees)
    pre = ImageOps.autocontrast(normal, cutoff=2)
    for angle in (7, -7, 14, -14, 22, -22, 32, -32):
        yield pre.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=255)
    # 5) hard threshold + adaptive on the sharpened picture as a last resort
    sharp = normal.filter(ImageFilter.UnsharpMask(radius=3, percent=250, threshold=1))
    yield _adaptive(sharp, radius=12, bias=4)
    yield ImageOps.autocontrast(sharp, cutoff=5).point(lambda v: 255 if v > 118 else 0)
    yield ImageOps.equalize(normal)


def decode_bytes(raw: bytes, budget: float = 2.5) -> str:
    """Decode the QR in an image; returns the payload or ''. Stops after ``budget`` seconds."""
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        return ""
    return decode_image(img, budget=budget)


def decode_image(img: Image.Image, budget: float = 2.5) -> str:
    started = time.monotonic()
    for variant in _variants(img):
        text = _decode_variant(variant)
        if text:
            return text
        if time.monotonic() - started > budget:
            logger.info("qr decode: budget exhausted")
            break
    return ""


def _read_zxing(img: Image.Image, binarizer) -> str:
    kwargs = {"try_rotate": True, "try_downscale": True, "try_invert": True}
    if _QR_FORMATS is not None:
        kwargs["formats"] = _QR_FORMATS
    if binarizer is not None:
        kwargs["binarizer"] = binarizer
    for res in _zxing.read_barcodes(img, **kwargs):
        text = str(res.text or "")
        if text and "qr" in str(res.format).lower():
            return text
    return ""


def _decode_variant(img: Image.Image) -> str:
    if _zxing is not None:
        binarizers = [None]
        try:
            binarizers = [_zxing.Binarizer.LocalAverage, _zxing.Binarizer.GlobalHistogram, _zxing.Binarizer.FixedThreshold]
        except Exception:  # pragma: no cover
            pass
        for binarizer in binarizers:
            try:
                text = _read_zxing(img, binarizer)
                if text:
                    return text
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


# ----------------------------------------------------------------- off-thread decoding
# Image work holds the GIL for long stretches; done in the bot/API process it would freeze
# every other chat for the duration. A helper process keeps the main threads responsive.
_POOL: ProcessPoolExecutor | None = None
_POOL_LOCK = threading.Lock()
_MAX_OFFLOAD_BYTES = 25 * 1024 * 1024
_FAILURES = 0
_MAX_FAILURES = 2  # after that the helper is abandoned for the life of the process (in-process decoding)


def _workers() -> int:
    try:
        return max(0, int(os.environ.get("QR_DECODE_WORKERS", "1")))
    except ValueError:
        return 1


def _pool() -> ProcessPoolExecutor:
    global _POOL
    with _POOL_LOCK:
        if _POOL is None:
            _POOL = ProcessPoolExecutor(max_workers=_workers(), mp_context=multiprocessing.get_context("spawn"))
        return _POOL


def _reset_pool() -> None:
    global _POOL
    with _POOL_LOCK:
        pool, _POOL = _POOL, None
    if pool is not None:
        try:
            pool.shutdown(wait=False, cancel_futures=True)
        except Exception:  # pragma: no cover
            pass


def warm_up() -> None:
    """Start the helper process early so the first client photo is decoded without a spawn delay."""
    if _workers() <= 0:
        return
    try:
        _pool().submit(available)
    except Exception as exc:  # pragma: no cover - environment without process support
        logger.info("qr helper unavailable: %s", exc)


def decode_offloaded(raw: bytes, budget: float = 2.5, timeout: float | None = None) -> str:
    """``decode_bytes`` in the helper process; falls back to in-process decoding when it is unavailable."""
    global _FAILURES
    if _workers() <= 0 or _FAILURES >= _MAX_FAILURES or len(raw) > _MAX_OFFLOAD_BYTES:
        return decode_bytes(raw, budget=budget)
    try:
        future = _pool().submit(decode_bytes, raw, budget)
        text = future.result(timeout=timeout or budget + 6.0)
        _FAILURES = 0
        return text
    except FutureTimeout:
        logger.warning("qr decode: helper process timed out")
        _reset_pool()
        return ""
    except Exception as exc:
        _FAILURES += 1
        logger.warning("qr decode: helper failed (%s) — decoding in-process%s", exc, "; helper disabled" if _FAILURES >= _MAX_FAILURES else "")
        _reset_pool()
        return decode_bytes(raw, budget=budget)
