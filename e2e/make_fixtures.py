"""Audio fixtures for the end-to-end tests, fed to Chromium as a fake microphone.

    python e2e/make_fixtures.py --tts   # Windows only: voices the English demo scenarios with SAPI (offline)
                                        # into fixtures/scam.wav and fixtures/genuine.wav (committed)
    python e2e/make_fixtures.py         # any OS: derives fixtures/generated/{scam_farfield,silence}.wav

The far-field variant is what a laptop mic hears from a phone on speakerphone half a metre away: a
narrow phone band (300-3400 Hz), 18 dB quieter, a short room reverb and a noise bed.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
FIX = Path(__file__).resolve().parent / "fixtures"
GEN = FIX / "generated"
RATE = 16000
VOICES = {"caller": "Microsoft David Desktop", "user": "Microsoft Zira Desktop", "unknown": "Microsoft David Desktop"}
SCENARIOS = {"scam": "inspector_sharma", "genuine": "genuine_bank_call"}

SAPI = r"""
param([string]$Voice, [string]$TextFile, [string]$Out)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice($Voice)
$s.Rate = 0
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($Out, $fmt)
$s.Speak([IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8))
$s.Dispose()
"""


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path)) as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1 and w.getsampwidth() == 2, path
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64)


def write_wav(path: Path, x: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(np.clip(np.round(x), -32768, 32767).astype(np.int16).tobytes())
    print(f"wrote {path.relative_to(ROOT)} ({len(x) / RATE:.1f} s)")


def tts() -> None:
    if sys.platform != "win32":
        sys.exit("--tts needs Windows (SAPI voices); the committed fixtures/*.wav are used elsewhere")
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        ps = tmp / "say.ps1"
        ps.write_text(SAPI, encoding="utf-8")
        for name, sid in SCENARIOS.items():
            sc = json.loads((ROOT / "demo" / "scenarios" / f"{sid}.json").read_text(encoding="utf-8"))
            parts = [np.zeros(RATE // 2)]
            for i, line in enumerate(sc["lines"]):
                txt, out = tmp / f"{i}.txt", tmp / f"{i}.wav"
                txt.write_text(line["text"], encoding="utf-8")
                subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ps),
                                VOICES[line["speaker"]], str(txt), str(out)], check=True)
                # A natural pause between turns, longer than the server's 0.7 s end-of-utterance gap.
                parts += [read_wav(out), np.zeros(int(RATE * 1.2))]
            write_wav(FIX / f"{name}.wav", np.concatenate(parts))


def far_field(x: np.ndarray, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = len(x)
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / RATE)
    spec[(f < 300) | (f > 3400)] = 0  # a phone call's band
    y = np.fft.irfft(spec, n)
    ir_t = np.arange(int(0.25 * RATE)) / RATE  # ~0.25 s of room reverb
    ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t / 0.06)
    ir[0] = 4.0  # the direct sound
    ir /= np.sqrt(np.sum(ir ** 2))
    y = np.convolve(y, ir)[:n]
    y *= 10 ** (-18 / 20)
    return y + rng.standard_normal(n) * 32768 * 10 ** (-58 / 20)


def derive() -> None:
    scam = FIX / "scam.wav"
    if not scam.exists():
        sys.exit(f"{scam} is missing: run with --tts on Windows first")
    write_wav(GEN / "scam_farfield.wav", far_field(read_wav(scam)))
    write_wav(GEN / "silence.wav", np.zeros(RATE * 20))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tts", action="store_true", help="voice the scenarios first (Windows)")
    args = ap.parse_args()
    if args.tts:
        tts()
    derive()
