"""Layer 3: LLM reasoner.

Gets the rolling transcript (last ~2 minutes plus a short summary of what came
before) and returns strict JSON: tactics with quoted evidence, the script
stage, and a one-line explanation in the user's language.

Provider is picked from env: LLM_PROVIDER=groq|gemini|anthropic, or the first
of GROQ_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY that is set. With no key
the layer is simply off and the scorer runs on L1 + L2.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field

import httpx

from .tactics import TACTICS

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are Jam the Scam, a real-time scam-call analyst for India.
You read a live phone/video-call transcript (English, Hindi, Telugu or code-mixed) and decide
whether the CALLER is running a "digital arrest" / impersonation scam.

Tactic taxonomy (use these exact type names):
- AUTHORITY: claims to be police, CBI, ED, NCB, customs, cyber cell, TRAI, RBI, court; gives badge/FIR numbers.
- ACCUSATION: says the victim is linked to drugs in a parcel, money laundering, Aadhaar/SIM misuse, a case.
- ARREST_THREAT: arrest warrant, "digital arrest", jail, freezing accounts.
- ISOLATION: don't tell family, confidential / national security, stay on video, don't disconnect.
- URGENCY: deadlines, "within 2 hours", "immediately".
- MONEY_ASK: transfer money to a "safe/RBI/verification" account, "refundable" deposits, fees, UPI IDs.
- REMOTE_ACCESS: AnyDesk, TeamViewer, screen sharing, installing an app, moving to Skype video.
- CREDENTIAL: asking for OTP, PIN, CVV, passwords, card numbers.

The script usually runs in stages: 1 Hook (accusation), 2 Authority, 3 Isolation, 4 Urgency/threat, 5 Extraction (money/OTP/remote access).

Legitimate counter-patterns (these are NOT scams; do not tag tactics for them):
- Real banks ask "did you make this transaction?" and tell you never to share your OTP. They never ask for an OTP to receive money or "verify" funds.
- Real police serve notices in person or by post, and passport verification is an in-person visit. "Digital arrest" does not exist in Indian law; no agency arrests over video or asks for money transfers.
- Delivery agents and cab drivers ask for a delivery/ride OTP; customer care may send an OTP to cancel an order in the app.
- A relative asking for money is not a digital-arrest scam unless it comes with authority/arrest claims.

Rules:
- Only tag a tactic if a CALLER line supports it, and quote the exact words as evidence.
- confidence is 0..1.
- user_compliance_signals: quotes where the victim is complying ("okay sir I won't tell anyone").
- explanation_for_user: ONE short sentence, plain words, in the language code given, telling the user what is wrong (or that the call looks normal).
Return only JSON matching the schema."""

JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "tactics": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": TACTICS},
                    "evidence": {"type": "string"},
                    "confidence": {"type": "number"},
                },
                "required": ["type", "evidence", "confidence"],
                "additionalProperties": False,
            },
        },
        "stage": {"type": "integer"},
        "legit_explanation_possible": {"type": "boolean"},
        "user_compliance_signals": {"type": "array", "items": {"type": "string"}},
        "explanation_for_user": {"type": "string"},
        "explanation_lang": {"type": "string"},
    },
    "required": ["tactics", "stage", "legit_explanation_possible", "user_compliance_signals",
                 "explanation_for_user", "explanation_lang"],
    "additionalProperties": False,
}


@dataclass
class LLMResult:
    tactics: dict[str, float] = field(default_factory=dict)
    evidence: dict[str, str] = field(default_factory=dict)
    stage: int = 0
    legit_possible: bool = True
    compliance: list[str] = field(default_factory=list)
    explanation: str = ""
    lang: str = "en"
    latency_ms: int = 0


def build_user_prompt(transcript: str, summary: str, lang: str) -> str:
    parts = []
    if summary:
        parts.append(f"Summary of earlier part of the call:\n{summary}\n")
    parts.append(f"Recent transcript (most recent last):\n{transcript}\n")
    parts.append(f"Write explanation_for_user in language code: {lang}")
    return "\n".join(parts)


def parse_result(raw: dict, latency_ms: int = 0) -> LLMResult:
    res = LLMResult(latency_ms=latency_ms)
    for t in raw.get("tactics", []) or []:
        typ = str(t.get("type", "")).upper()
        if typ not in TACTICS:
            continue
        conf = float(t.get("confidence", 0) or 0)
        if conf > res.tactics.get(typ, 0):
            res.tactics[typ] = max(0.0, min(1.0, conf))
            res.evidence[typ] = str(t.get("evidence", ""))[:300]
    res.stage = int(raw.get("stage", 0) or 0)
    res.legit_possible = bool(raw.get("legit_explanation_possible", True))
    res.compliance = [str(x) for x in raw.get("user_compliance_signals", []) or []][:5]
    res.explanation = str(raw.get("explanation_for_user", ""))[:400]
    res.lang = str(raw.get("explanation_lang", "en"))
    return res


class LLMReasoner:
    def __init__(self):
        self.provider = self._pick_provider()
        self.timeout = float(os.getenv("LLM_TIMEOUT_S", "8"))
        self._anthropic = None
        if self.provider:
            log.info("L3 LLM reasoner on: %s (%s)", self.provider, self.model)
        else:
            log.info("L3 LLM reasoner off: no GROQ_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY set")

    @staticmethod
    def _pick_provider() -> str | None:
        forced = os.getenv("LLM_PROVIDER", "").strip().lower()
        if forced == "none":
            return None
        keys = {"groq": "GROQ_API_KEY", "gemini": "GEMINI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}
        if forced in keys:
            return forced if os.getenv(keys[forced]) else None
        for name, env in keys.items():
            if os.getenv(env):
                return name
        return None

    @property
    def enabled(self) -> bool:
        return self.provider is not None

    @property
    def model(self) -> str:
        defaults = {
            "groq": "llama-3.3-70b-versatile",
            "gemini": "gemini-2.5-flash",
            "anthropic": "claude-opus-5-5",
        }
        return os.getenv("LLM_MODEL") or defaults.get(self.provider or "", "")

    async def analyze(self, transcript: str, summary: str = "", lang: str = "en") -> LLMResult | None:
        if not self.enabled:
            return None
        import time

        prompt = build_user_prompt(transcript, summary, lang)
        t0 = time.perf_counter()
        try:
            if self.provider == "groq":
                raw = await self._groq(prompt)
            elif self.provider == "gemini":
                raw = await self._gemini(prompt)
            else:
                raw = await self._claude(prompt)
        except Exception as e:  # the scorer must keep working if the LLM is slow or down
            log.warning("L3 call failed (%s): %s", self.provider, e)
            return None
        return parse_result(raw, int((time.perf_counter() - t0) * 1000))

    async def _groq(self, prompt: str) -> dict:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"},
                json={
                    "model": self.model,
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT + "\nJSON keys: " + ", ".join(JSON_SCHEMA["required"])},
                        {"role": "user", "content": prompt},
                    ],
                },
            )
            r.raise_for_status()
            return json.loads(r.json()["choices"][0]["message"]["content"])

    async def _gemini(self, prompt: str) -> dict:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(
                url,
                headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]},
                json={
                    "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
                    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
                },
            )
            r.raise_for_status()
            text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text)

    async def _claude(self, prompt: str) -> dict:
        import anthropic

        if self._anthropic is None:
            # Explicit base_url so a stray ANTHROPIC_BASE_URL in the shell can't redirect calls.
            self._anthropic = anthropic.AsyncAnthropic(
                api_key=os.environ["ANTHROPIC_API_KEY"],
                base_url=os.getenv("JAM_ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
                timeout=self.timeout,
            )
        resp = await self._anthropic.messages.create(
            model=self.model,
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            output_config={"effort": os.getenv("LLM_EFFORT", "low"),
                           "format": {"type": "json_schema", "schema": JSON_SCHEMA}},
            messages=[{"role": "user", "content": prompt}],
        )
        if resp.stop_reason == "refusal":
            raise RuntimeError("model declined the request")
        text = next(b.text for b in resp.content if b.type == "text")
        return json.loads(text)
