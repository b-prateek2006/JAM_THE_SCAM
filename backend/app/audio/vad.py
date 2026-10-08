"""Utterance endpointing on a 16 kHz mono int16 PCM stream.

A light energy-based endpointer with an adaptive noise floor cuts the stream
into utterances at natural pauses (~0.7 s of silence, or 12 s max). Each
utterance is then transcribed with faster-whisper's built-in Silero VAD filter,
which trims any remaining silence inside it.

The noise floor is the quietest frame of the last few seconds (minimum
statistics), so speech can't drag it up and a fan or AC that switches on is
tracked within seconds. The endpointer also keeps level stats, which feed the
per-call log line and the "can't hear the call" hint.
"""
from __future__ import annotations

import math
from collections import deque

import numpy as np

SAMPLE_RATE = 16000
FRAME = 480  # 30 ms
FLOOR_WINDOW = 167  # frames (~5 s) the noise floor looks back over
SPEECH_FACTOR = 2.5  # a frame is speech when it is this much louder than the floor...
SPEECH_MIN_RMS = 150.0  # ...and above ~-47 dBFS, so quiet far-field speech (a speakerphone across a desk) counts


def dbfs(rms: float) -> float:
    return round(20 * math.log10(max(rms, 1.0) / 32768), 1)


class Endpointer:
    def __init__(self, silence_ms: int = 700, max_utt_s: float = 12.0, min_utt_s: float = 0.4):
        self.silence_frames = silence_ms // 30
        self.max_samples = int(max_utt_s * SAMPLE_RATE)
        self.min_samples = int(min_utt_s * SAMPLE_RATE)
        self._recent = deque(maxlen=FLOOR_WINDOW)
        self._pending = np.zeros(0, dtype=np.int16)
        self._utt: list[np.ndarray] = []
        self._utt_len = 0
        self._silent_run = 0
        self._in_speech = False
        self.samples_seen = 0
        self.utt_start_sample = 0
        # Level stats for the whole call.
        self.frames = 0
        self.speech_frames = 0
        self.peak_rms = 0.0
        self._rms_sum = 0.0

    @property
    def noise_floor(self) -> float:
        return min(self._recent) if self._recent else 0.0

    @property
    def seconds(self) -> float:
        return self.frames * FRAME / SAMPLE_RATE

    def stats(self) -> dict:
        return {
            "audio_s": round(self.seconds, 1), "speech_s": round(self.speech_frames * FRAME / SAMPLE_RATE, 1),
            "peak_dbfs": dbfs(self.peak_rms), "mean_dbfs": dbfs(self._rms_sum / self.frames if self.frames else 0.0),
            "floor_dbfs": dbfs(self.noise_floor),
        }

    def _is_speech(self, frame: np.ndarray) -> bool:
        rms = float(np.sqrt(np.mean(frame.astype(np.float32) ** 2)))
        self._recent.append(rms)
        self.frames += 1
        self._rms_sum += rms
        self.peak_rms = max(self.peak_rms, rms)
        speech = rms > max(self.noise_floor * SPEECH_FACTOR, SPEECH_MIN_RMS)
        self.speech_frames += speech
        return speech

    def feed(self, pcm: bytes) -> list[tuple[float, np.ndarray]]:
        """Feed raw int16 LE bytes. Returns finished utterances as (start_seconds, float32 audio)."""
        out: list[tuple[float, np.ndarray]] = []
        if len(pcm) % 2:  # int16 frames come in byte pairs; a stray odd byte would make frombuffer raise
            pcm = pcm[:-1]
        self._pending = np.concatenate([self._pending, np.frombuffer(pcm, dtype=np.int16)])
        while len(self._pending) >= FRAME:
            frame, self._pending = self._pending[:FRAME], self._pending[FRAME:]
            speech = self._is_speech(frame)
            if speech and not self._in_speech:
                self._in_speech = True
                self.utt_start_sample = self.samples_seen
            if self._in_speech:
                self._utt.append(frame)
                self._utt_len += FRAME
                self._silent_run = 0 if speech else self._silent_run + 1
                if self._silent_run >= self.silence_frames or self._utt_len >= self.max_samples:
                    utt = self._flush()
                    if utt is not None:
                        out.append(utt)
            self.samples_seen += FRAME
        return out

    def _flush(self) -> tuple[float, np.ndarray] | None:
        audio = np.concatenate(self._utt) if self._utt else np.zeros(0, dtype=np.int16)
        start = self.utt_start_sample / SAMPLE_RATE
        self._utt, self._utt_len, self._silent_run, self._in_speech = [], 0, 0, False
        if len(audio) < self.min_samples:
            return None
        return start, audio.astype(np.float32) / 32768.0

    def finish(self) -> list[tuple[float, np.ndarray]]:
        if not self._in_speech:
            return []
        utt = self._flush()
        return [utt] if utt is not None else []
