"""CallSession: one guarded call.

Utterance text (from Whisper, browser speech recognition, a demo scenario or an
eval script) → L1 + L2 instantly → fused detections → risk scorer → alert
manager. L3 runs in the background every ~12 s, or sooner when L1/L2 flag
something, and its result re-scores the call when it lands.

The same code path serves the mic, the demo and the eval, so eval numbers
describe what the demo actually runs.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Awaitable, Callable

from .alerts.manager import LEVEL_NAMES, AlertManager
from .alerts.notify import family_message, send_sms, whatsapp_link
from .config import settings
from .detection import lexicon
from .detection.fusion import Detection, fuse, layers_used
from .detection.llm import LLMReasoner, LLMResult
from .detection.semantic import SemanticMatcher
from .detection.tactics import LABELS, STAGE_NAMES, TACTICS
from .report.complaint import build_report, timeline_entry
from .report.extract import extract
from .scoring.scorer import RiskScorer

log = logging.getLogger(__name__)

COMPLIANCE_RX = re.compile(
    r"\b(ok(ay)?|yes|ji|haan|sari|avunu) (sir|madam|ji)\b|i will not tell|won'?t tell|i will transfer|"
    r"kisi ko nahi bataunga|evvariki cheppanu",
    re.IGNORECASE,
)
NOMINATE_THRESHOLD = 0.3  # an L1/L2 signal this strong triggers an early L3 call


@dataclass
class Engine:
    """Shared, expensive components. Built once per process."""
    semantic: SemanticMatcher | None
    llm: LLMReasoner
    stt: object | None = None


@dataclass
class Utterance:
    t: float
    text: str
    speaker: str = "caller"  # caller | user | unknown
    lang: str = ""


@dataclass
class SessionOptions:
    lang: str = "en"
    user_name: str = ""
    family_phone: str = ""
    caller_number: str = ""
    use_l2: bool = True
    use_l3: bool = True
    llm_mode: str = "async"  # async (live) | sync (eval: wait for L3 inline) | off


class CallSession:
    def __init__(self, engine: Engine, opts: SessionOptions,
                 emit: Callable[[dict], Awaitable[None]] | None = None):
        self.engine = engine
        self.opts = opts
        self.emit = emit
        self.call_id = uuid.uuid4().hex[:12]
        self.started_at = datetime.now()
        self.t0 = time.monotonic()
        self.scorer = RiskScorer()
        self.alerts = AlertManager(opts.lang)
        self.transcript: list[Utterance] = []
        self.timeline: list[dict] = []
        self.peak_score = 0.0
        self.compliance: list[str] = []
        self.llm_explanation = ""
        self.last_llm: LLMResult | None = None
        self._last_llm_t = -1e9
        self._llm_task: asyncio.Task | None = None
        self._llm_pending = False
        self._lock = asyncio.Lock()
        self.family_alert_sent: dict | None = None

    # ------------------------------------------------------------------ helpers
    def now(self) -> float:
        return time.monotonic() - self.t0

    @property
    def llm_on(self) -> bool:
        return self.opts.use_l3 and self.opts.llm_mode != "off" and self.engine.llm.enabled

    def _window_text(self, now_t: float) -> tuple[str, str]:
        recent = [u for u in self.transcript if u.t >= now_t - settings.llm_window_s]
        earlier = [u for u in self.transcript if u.t < now_t - settings.llm_window_s]
        fmt = lambda u: f"[{int(u.t)}s] {u.speaker.upper()}: {u.text}"
        summary = ""
        if earlier:
            tactics = ", ".join(self.scorer.state.tactics) or "none"
            summary = f"{len(earlier)} earlier lines. Tactics already detected: {tactics}."
        return "\n".join(fmt(u) for u in recent), summary

    # ------------------------------------------------------------------ core
    async def process(self, text: str, t: float | None = None, speaker: str = "caller", lang: str = "") -> dict:
        text = (text or "").strip()
        if not text:
            return self.snapshot()
        async with self._lock:
            t = self.now() if t is None else t
            utt = Utterance(t, text, speaker, lang)
            self.transcript.append(utt)
            hits: list[str] = []
            nominated = False

            if speaker == "user":
                if COMPLIANCE_RX.search(text):
                    self.compliance.append(text)
                    self.timeline.append(timeline_entry(t, "compliance", text))
            else:
                l1, protective = lexicon.scan(text)
                l2_scores: dict[str, float] = {}
                l2_ev: dict[str, str] = {}
                benign = protective
                if self.opts.use_l2 and self.engine.semantic is not None:
                    sem = self.engine.semantic.score(text)
                    l2_scores, l2_ev = sem.tactic_scores, sem.evidence
                    benign = max(benign, self.engine.semantic.benign_strength(sem))
                detections = []
                for tactic in TACTICS:
                    s1 = l1[tactic].strength if tactic in l1 else 0.0
                    s2 = l2_scores.get(tactic, 0.0)
                    if max(s1, s2) >= NOMINATE_THRESHOLD:
                        nominated = True
                    conf = fuse(s1, s2)
                    if conf <= 0:
                        continue
                    ev = l1[tactic].evidence if tactic in l1 else l2_ev.get(tactic, text)
                    detections.append(Detection(tactic, conf, ev, layers_used(s1, s2, None)))
                before = set(self.scorer.state.tactics)
                self.scorer.add(detections, t)
                self.scorer.add_benign(benign)
                hits = [d.tactic for d in detections if d.confidence >= 0.5]
                for tac in set(self.scorer.state.tactics) - before:
                    ts = self.scorer.state.tactics[tac]
                    self.timeline.append(timeline_entry(t, "tactic", ts.evidence, tactic=tac, layers=ts.layers))

            update = self._rescore(t, utterance=utt, hits=hits)

        if self.llm_on and speaker != "user":
            due = t - self._last_llm_t >= settings.llm_interval_s
            if nominated or due:
                if self.opts.llm_mode == "sync":
                    await self._run_llm(t)
                    update = self.snapshot(utterance=utt, hits=hits)
                else:
                    self._schedule_llm(t)
        if self.emit:
            await self.emit(update)
        return update

    def _schedule_llm(self, t: float) -> None:
        if self._llm_task and not self._llm_task.done():
            self._llm_pending = True  # run again once the current call returns
            return
        self._llm_task = asyncio.create_task(self._run_llm(t))

    async def _run_llm(self, t: float) -> None:
        self._last_llm_t = t
        text, summary = self._window_text(t)
        res = await self.engine.llm.analyze(text, summary, self.opts.lang)
        if res is not None:
            async with self._lock:
                self.last_llm = res
                if res.explanation:
                    self.llm_explanation = res.explanation
                dets = [Detection(k, v, res.evidence.get(k, ""), "L3") for k, v in res.tactics.items()]
                before = set(self.scorer.state.tactics)
                self.scorer.add(dets, t)
                if not res.tactics and res.legit_possible:
                    self.scorer.add_benign(0.5)
                for tac in set(self.scorer.state.tactics) - before:
                    ts = self.scorer.state.tactics[tac]
                    self.timeline.append(timeline_entry(t, "tactic", ts.evidence, tactic=tac, layers="L3"))
                update = self._rescore(self.now() if self.opts.llm_mode == "async" else t, llm=True)
            if self.emit and self.opts.llm_mode == "async":
                await self.emit(update)
        if self._llm_pending and self.opts.llm_mode == "async":
            self._llm_pending = False
            self._llm_task = asyncio.create_task(self._run_llm(self.now()))

    def _rescore(self, t: float, **extra) -> dict:
        score = self.scorer.update()
        self.peak_score = max(self.peak_score, score)
        st = self.scorer.state
        alert = self.alerts.update(score, bool(st.hard_rule), list(st.tactics), self.llm_explanation)
        alert_dict = None
        if alert:
            alert_dict = alert.__dict__.copy()
            self.timeline.append(timeline_entry(t, "alert", alert.message, level=alert.level))
            if alert.family_alert and self.opts.family_phone and not self.family_alert_sent:
                msg = family_message(self.opts.user_name, self.opts.caller_number, list(st.tactics))
                self.family_alert_sent = {"whatsapp_link": whatsapp_link(self.opts.family_phone, msg), "text": msg}
                asyncio.ensure_future(self._send_family_sms(msg))
            if self.family_alert_sent:
                alert_dict["family"] = self.family_alert_sent
        return self.snapshot(alert=alert_dict, **extra)

    async def _send_family_sms(self, msg: str) -> None:
        res = await send_sms(self.opts.family_phone, msg)
        if self.family_alert_sent is not None:
            self.family_alert_sent["sms"] = res

    def snapshot(self, alert: dict | None = None, utterance: Utterance | None = None,
                 hits: list[str] | None = None, llm: bool = False) -> dict:
        st = self.scorer.state
        labels = LABELS.get(self.opts.lang, LABELS["en"])
        out = {
            "type": "update",
            "call_id": self.call_id,
            "t": round(self.now(), 1),
            "score": round(st.score),
            "level": self.alerts.level,
            "level_name": LEVEL_NAMES[self.alerts.level],
            "stage": st.stage,
            "stage_name": STAGE_NAMES[st.stage],
            "hard_rule": st.hard_rule,
            "benign": round(st.benign, 2),
            "tactics": [
                {"type": k, "label": labels[k], "confidence": round(v.confidence, 2),
                 "evidence": v.evidence, "layers": v.layers, "at": round(v.first_t, 1)}
                for k, v in sorted(st.tactics.items(), key=lambda kv: kv[1].first_t)
            ],
            "alert": alert,
            "explanation": self.llm_explanation,
        }
        if utterance is not None:
            out["utterance"] = {"t": round(utterance.t, 1), "text": utterance.text,
                                "speaker": utterance.speaker, "hits": hits or []}
        if llm and self.last_llm:
            out["llm"] = {"latency_ms": self.last_llm.latency_ms, "stage": self.last_llm.stage,
                          "compliance": self.last_llm.compliance}
        return out

    async def finish(self) -> dict:
        if self._llm_task and not self._llm_task.done():
            try:
                await asyncio.wait_for(self._llm_task, timeout=5)
            except Exception:
                pass
        full_text = "\n".join(u.text for u in self.transcript if u.speaker != "user")
        st = self.scorer.state
        tactics = {k: {"confidence": v.confidence, "evidence": v.first_evidence or v.evidence, "first_t": v.first_t}
                   for k, v in st.tactics.items()}
        return build_report(
            call_id=self.call_id, started_at=self.started_at,
            duration_s=max((u.t for u in self.transcript), default=self.now()),
            caller_number=self.opts.caller_number, peak_score=self.peak_score,
            peak_level=self.alerts.level, tactics=tactics, entities=extract(full_text),
            timeline=self.timeline, lang=self.opts.lang,
        )

    def transcript_dicts(self) -> list[dict]:
        return [u.__dict__.copy() for u in self.transcript]
