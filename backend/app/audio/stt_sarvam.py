"""Hosted Indic STT (Sarvam AI) for Telugu and code-mixed speech.

Optional: set STT_BACKEND=sarvam and SARVAM_API_KEY. Not yet tested against
the live API (no key during the build); check the request shape against
Sarvam's docs before relying on it on stage.
"""
from __future__ import annotations

import io
import os
import time
import wave

import httpx
import numpy as np

from .stt_whisper import Transcript

LANG_CODES = {"te": "te-IN", "hi": "hi-IN", "en": "en-IN"}


def to_wav(audio: np.ndarray, sr: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
    return buf.getvalue()


class SarvamSTT:
    name = "sarvam"

    def __init__(self):
        self.key = os.environ["SARVAM_API_KEY"]
        self.model = os.getenv("SARVAM_MODEL", "saarika:v2.5")

    def transcribe(self, audio: np.ndarray, lang_hint: str | None = None) -> Transcript:
        t0 = time.perf_counter()
        r = httpx.post(
            "https://api.sarvam.ai/speech-to-text",
            headers={"api-subscription-key": self.key},
            files={"file": ("utt.wav", to_wav(audio), "audio/wav")},
            data={"model": self.model, "language_code": LANG_CODES.get(lang_hint or "", "unknown")},
            timeout=15,
        )
        r.raise_for_status()
        body = r.json()
        lang = (body.get("language_code") or "en").split("-")[0]
        return Transcript(body.get("transcript", ""), lang, int((time.perf_counter() - t0) * 1000))
