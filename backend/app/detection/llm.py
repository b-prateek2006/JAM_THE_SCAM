"""Layer 3: LLM reasoner.

Gets the rolling transcript (last ~2 minutes plus a short summary of what came
before) and returns strict JSON: tactics with quoted evidence, the script
stage, and a one-line explanation in the user's language.

Providers are the ones with a key (GROQ_API_KEY / GEMINI_API_KEY /
ANTHROPIC_API_KEY), LLM_PROVIDER first. A failed call (a free key's rate limit,
a timeout, an off-schema reply) is retried once on the next provider. With no
key the layer is simply off and the scorer runs on L1 + L2.
"""
from __future__ import annotations

import json
import logging
import os
import time
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
- Only tag a tactic if a CALLER line supports it, and quote the shortest exact words that show it (at most
  ~12 words) as evidence. Keep every string short: free API tiers cap output tokens.
- confidence is 0..1.
- user_compliance_signals: short quotes where the victim is complying ("okay sir I won't tell anyone").
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

# Groq and Gemini JSON modes only guarantee valid JSON, not this shape, so the schema goes in the prompt.
# (Claude gets it as a structured-output format instead.)
SYSTEM_PROMPT_WITH_SCHEMA = SYSTEM_PROMPT + "\nThe JSON must match this JSON Schema:\n" + json.dumps(JSON_SCHEMA)


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


STAGE_BY_NAME = {"hook": 1, "accusation": 1, "authority": 2, "isolation": 3, "urgency": 4, "threat": 4,
                 "extraction": 5}


def parse_stage(value) -> int:
    """Models in plain JSON mode sometimes name the stage ("Extraction") instead of numbering it."""
    try:
        return max(0, min(5, int(value or 0)))
    except (TypeError, ValueError):
        words = str(value).lower().replace("/", " ").split()
        return next((STAGE_BY_NAME[w] for w in words if w in STAGE_BY_NAME), 0)


def build_user_prompt(transcript: str, summary: str, lang: str) -> str:
    parts = []
    if summary:
        parts.append(f"Summary of earlier part of the call:\n{summary}\n")
    parts.append(f"Recent transcript (most recent last):\n{transcript}\n")
    parts.append(f"Write explanation_for_user in language code: {lang}")
    return "\n".join(parts)


def parse_result(raw: dict, latency_ms: int = 0) -> LLMResult:
    if not isinstance(raw, dict):
        raise ValueError(f"expected a JSON object, got {type(raw).__name__}")
    res = LLMResult(latency_ms=latency_ms)
    for t in raw.get("tactics", []) or []:
        if not isinstance(t, dict):
            continue
        typ = str(t.get("type", "")).upper()
        if typ not in TACTICS:
            continue
        conf = float(t.get("confidence", 0) or 0)
        if conf > res.tactics.get(typ, 0):
            res.tactics[typ] = max(0.0, min(1.0, conf))
            res.evidence[typ] = str(t.get("evidence", ""))[:300]
    res.stage = parse_stage(raw.get("stage"))
    res.legit_possible = bool(raw.get("legit_explanation_possible", True))
    res.compliance = [str(x) for x in raw.get("user_compliance_signals", []) or []][:5]
    res.explanation = str(raw.get("explanation_for_user", ""))[:400]
    res.lang = str(raw.get("explanation_lang", "en"))
    return res


KEY_ENV = {"groq": "GROQ_API_KEY", "gemini": "GEMINI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}
# Checked against each provider's model list (Oct 2026): Groq retired its Llama 70B models, and
# Gemini closed gemini-2.5-flash to new keys. On a Telugu/English scam call and a genuine bank call
# both of these tag correctly; qwen3.8-27b answers in ~1 s, gemini-3.5-flash in ~5 s.
DEFAULT_MODELS = {
    "groq": "qwen/qwen3.8-27b",
    "gemini": "gemini-3.5-flash",
    "anthropic": "claude-opus-5-5",
}


class LLMReasoner:
    """Calls the primary provider; if it fails (rate limit on a free key, timeout, off-schema
    reply), retries the same request once on the next provider that has a key."""

    def __init__(self):
        self.providers = self._pick_providers()
        self.timeout = float(os.getenv("LLM_TIMEOUT_S", "10"))
        self._anthropic = None
        self._cooldown: dict[str, float] = {}  # provider -> monotonic time it may be called again
        if self.providers:
            log.info("L3 LLM reasoner on: %s", ", then ".join(f"{p} ({self.model_for(p)})" for p in self.providers))
        else:
            log.info("L3 LLM reasoner off: no GROQ_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY set")

    @staticmethod
    def _pick_providers() -> list[str]:
        """Providers with a key, LLM_PROVIDER first. LLM_PROVIDER=none turns the layer off."""
        forced = os.getenv("LLM_PROVIDER", "").strip().lower()
        if forced == "none":
            return []
        order = sorted(KEY_ENV, key=lambda name: name != forced)  # stable: forced first, rest in KEY_ENV order
        return [name for name in order if os.getenv(KEY_ENV[name])]

    @property
    def provider(self) -> str | None:
        return self.providers[0] if self.providers else None

    @property
    def fallback(self) -> str | None:
        return self.providers[1] if len(self.providers) > 1 else None

    @property
    def enabled(self) -> bool:
        return bool(self.providers)

    def model_for(self, provider: str) -> str:
        # LLM_MODEL overrides the primary provider only; a fallback uses its own default.
        if provider == self.provider and os.getenv("LLM_MODEL"):
            return os.environ["LLM_MODEL"]
        return DEFAULT_MODELS.get(provider, "")

    @property
    def model(self) -> str:
        return self.model_for(self.provider) if self.provider else ""

    def _note_rate_limit(self, provider: str, error: Exception) -> None:
        """On HTTP 429, rest the provider for its retry-after (default 20 s, at most 2 min)."""
        if isinstance(error, httpx.HTTPStatusError) and error.response.status_code == 429:
            try:
                wait = float(error.response.headers.get("retry-after", 20))
            except ValueError:
                wait = 20.0
            self._cooldown[provider] = time.monotonic() + min(max(wait, 1.0), 120.0)

    async def analyze(self, transcript: str, summary: str = "", lang: str = "en") -> LLMResult | None:
        if not self.enabled:
            return None
        prompt = build_user_prompt(transcript, summary, lang)
        calls = {"groq": self._groq, "gemini": self._gemini, "anthropic": self._claude}
        now = time.monotonic()
        ready = [p for p in self.providers if self._cooldown.get(p, 0.0) <= now]  # skip rate-limited ones
        for provider in ready[:2]:
            t0 = time.perf_counter()
            try:
                raw = await calls[provider](prompt, self.model_for(provider))
                # Valid JSON in the wrong shape (a list, "confidence": "high") is treated like no answer.
                return parse_result(raw, int((time.perf_counter() - t0) * 1000))
            except Exception as e:  # the scorer must keep working if the LLM is slow, down or off-schema
                self._note_rate_limit(provider, e)
                log.warning("L3 call failed (%s): %s: %s", provider, type(e).__name__, e)
        return None

    async def _groq(self, prompt: str, model: str) -> dict:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"},
                json={
                    "model": model,
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT_WITH_SCHEMA},
                        {"role": "user", "content": prompt},
                    ],
                },
            )
            r.raise_for_status()
            return json.loads(r.json()["choices"][0]["message"]["content"])

    async def _gemini(self, prompt: str, model: str) -> dict:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(
                url,
                headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]},
                json={
                    "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT_WITH_SCHEMA}]},
                    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
                },
            )
            r.raise_for_status()
            text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text)

    async def _claude(self, prompt: str, model: str) -> dict:
        import anthropic

        if self._anthropic is None:
            # Explicit base_url so a stray ANTHROPIC_BASE_URL in the shell can't redirect calls.
            self._anthropic = anthropic.AsyncAnthropic(
                api_key=os.environ["ANTHROPIC_API_KEY"],
                base_url=os.getenv("JAM_ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
                timeout=self.timeout,
            )
        resp = await self._anthropic.messages.create(
            model=model,
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
