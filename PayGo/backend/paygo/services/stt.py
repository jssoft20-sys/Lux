"""Speech-to-text for client voice notes in the support chat (pluggable, off by default).

``STT_PROVIDER=local`` runs faster-whisper on this server (``pip install -r requirements-stt.txt``,
the model is downloaded on first use); ``openai`` sends the file to the Whisper API. Clients speak
Russian and Kyrgyz, so the language is auto-detected unless the caller knows better.
``transcribe`` never raises: on any failure the note simply stays without a transcript.
"""
from __future__ import annotations

import logging
import re
import threading
from pathlib import Path
from typing import Any

from ..config import get_settings

logger = logging.getLogger("paygo.stt")

PROVIDERS = ("local", "openai")
MIN_BYTES = 1024  # a shorter OGG/Opus file is an empty or truncated recording
_LANGUAGES = {"ru": "ru", "kg": "ky", "ky": "ky"}  # hint → Whisper language code
# Whisper "hears" these in silence and noise (subtitle credits and outros from its training data);
# a sentence containing one of them is dropped, case-insensitively.
JUNK = (
    "субтитр", "корректор а.", "а.кулакова", "а.семкин", "dimatorzok", "продолжение следует", "спасибо за просмотр",
    "подписывайтесь", "ставьте лайк", "subtitles by", "amara.org", "thank you for watching", "thanks for watching",
    "please subscribe", "like and subscribe",
)
OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions"
_MODEL: Any = None
_MODEL_LOCK = threading.Lock()
_RUN_LOCK = threading.Lock()  # one decode at a time: a small VPS must not run several Whisper passes in parallel


def provider() -> str:
    return (get_settings().stt_provider or "").strip().lower()


def enabled() -> bool:
    return provider() in PROVIDERS


def language_code(hint: str) -> str | None:
    """``None`` means auto-detect (the default); ru/kg/ky map to Whisper's ru/ky."""
    return _LANGUAGES.get((hint or "").strip().lower())


def clean(text: str) -> str:
    """Normalise whitespace and drop hallucinated sentences; ``""`` when nothing real is left."""
    kept = []
    for sentence in re.split(r"(?<=[.!?…])\s+|\n+", " ".join((text or "").split())):
        sentence = sentence.strip()
        low = sentence.lower()
        if sentence and not any(junk in low for junk in JUNK):
            kept.append(sentence)
    out = " ".join(kept)
    return out if re.search(r"\w", out) else ""


def transcribe(path: str | Path, *, language_hint: str = "") -> str:
    """Speech → text for one file. Empty string when STT is off, the file is empty or anything fails."""
    path = Path(path)
    try:
        if not path.is_file() or path.stat().st_size < MIN_BYTES:
            return ""
        name = provider()
        if name == "local":
            raw = _transcribe_local(path, language_code(language_hint))
        elif name == "openai":
            raw = _transcribe_openai(path, language_code(language_hint))
        else:
            return ""
        text = clean(raw)
        logger.info("stt %s: %s → %d chars", name, path.name, len(text))
        return text
    except Exception:
        logger.exception("stt failed for %s", path.name)
        return ""


def reset_model() -> None:
    global _MODEL
    with _MODEL_LOCK:
        _MODEL = None


def _model() -> Any:
    """One faster-whisper model per process, created on the first voice note (download on first run)."""
    global _MODEL
    with _MODEL_LOCK:
        if _MODEL is None:
            from faster_whisper import WhisperModel

            settings = get_settings()
            logger.info("loading whisper model %s (%s, %s)", settings.stt_model, settings.stt_device, settings.stt_compute_type)
            _MODEL = WhisperModel(settings.stt_model, device=settings.stt_device, compute_type=settings.stt_compute_type)
        return _MODEL


def _transcribe_local(path: Path, language: str | None) -> str:
    model = _model()
    with _RUN_LOCK:
        segments, info = model.transcribe(str(path), language=language, vad_filter=True, beam_size=1)
        text = " ".join(seg.text.strip() for seg in segments if seg.text and seg.text.strip())
    logger.info("stt local: %s language=%s (%.2f)", path.name, getattr(info, "language", "?"), float(getattr(info, "language_probability", 0) or 0))
    return text


def _transcribe_openai(path: Path, language: str | None) -> str:
    import httpx

    key = get_settings().openai_api_key
    if not key:
        logger.warning("STT_PROVIDER=openai but OPENAI_API_KEY is empty")
        return ""
    data = {"model": "whisper-1", "response_format": "json"}
    if language:
        data["language"] = language
    with path.open("rb") as fh:
        response = httpx.post(OPENAI_URL, headers={"Authorization": f"Bearer {key}"}, data=data, files={"file": (path.name, fh, "audio/ogg")}, timeout=60.0)
    response.raise_for_status()
    return str(response.json().get("text") or "")
