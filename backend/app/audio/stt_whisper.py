"""faster-whisper speech-to-text (English / Hindi / code-mixed; Telugu is weaker, see stt_sarvam)."""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import numpy as np

log = logging.getLogger(__name__)

# Biases decoding towards the words that matter for this domain.
DOMAIN_PROMPT = ("CBI, ED, Mumbai cyber crime, customs, FedEx parcel, Aadhaar, money laundering, "
                 "digital arrest, arrest warrant, RBI safe account, UPI, OTP, AnyDesk, FIR number.")


@dataclass
class Transcript:
    text: str
    lang: str
    latency_ms: int


class WhisperSTT:
    name = "faster-whisper"

    def __init__(self, model_size: str = "small", device: str = "cpu", compute_type: str = "int8"):
        from faster_whisper import WhisperModel

        t0 = time.perf_counter()
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)
        self.name = f"faster-whisper:{model_size}"
        log.info("Whisper %s loaded in %.1fs", model_size, time.perf_counter() - t0)

    def transcribe(self, audio: np.ndarray, lang_hint: str | None = None) -> Transcript:
        t0 = time.perf_counter()
        segments, info = self.model.transcribe(
            audio,
            language=lang_hint if lang_hint in ("en", "hi", "te") else None,
            beam_size=1,
            vad_filter=True,  # Silero VAD inside faster-whisper trims silence
            condition_on_previous_text=False,
            initial_prompt=DOMAIN_PROMPT,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        return Transcript(text, info.language, int((time.perf_counter() - t0) * 1000))
