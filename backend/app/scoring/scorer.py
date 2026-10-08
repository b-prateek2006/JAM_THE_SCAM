"""Stateful risk scorer (deep-dive section 4.5).

The score models the *trajectory* of the call, not single keywords:
  * per-tactic weights, keeping the best confidence seen so far
  * combination multipliers for tactics that co-occur in scams
  * a bonus for the script progressing through its stages in order
  * hard rules: authority followed by a money / remote-access / OTP ask is critical
  * a benign dampener from similarity to genuine calls (the false-positive defence)
  * asymmetric smoothing: rises fast, falls slowly, so small talk can't reset it
"""
from __future__ import annotations

from dataclasses import dataclass, field

from ..detection.fusion import COUNT_THRESHOLD, Detection
from ..detection.tactics import (
    AUTHORITY, CREDENTIAL, ISOLATION, MONEY_ASK, REMOTE_ACCESS, STAGE_OF, WEIGHTS,
)

COMBOS = [
    ({AUTHORITY, ISOLATION}, 1.3),
    ({AUTHORITY, MONEY_ASK}, 1.5),
]
STAGE_BONUS = 8
HARD_RULE_SCORE = 95
EXTRACTION_TACTICS = {MONEY_ASK, REMOTE_ACCESS, CREDENTIAL}
DECAY = 0.85  # when the target drops, keep 85% of the old score each update


@dataclass
class TacticState:
    confidence: float
    evidence: str
    first_t: float
    layers: str
    first_evidence: str = ""  # what was said when the tactic first appeared (for the report timeline)


@dataclass
class ScoreState:
    tactics: dict[str, TacticState] = field(default_factory=dict)
    benign: float = 0.0
    score: float = 0.0
    hard_rule: str = ""
    stage: int = 0
    stages_in_order: int = 0


def stage_progress(tactics: dict[str, TacticState]) -> tuple[int, int]:
    """(highest stage reached, number of distinct stages reached in script order).

    Longest non-decreasing run of stages when tactics are ordered by first appearance.
    """
    ordered = sorted(tactics.items(), key=lambda kv: kv[1].first_t)
    stages = [STAGE_OF[t] for t, _ in ordered]
    if not stages:
        return 0, 0
    # LIS over non-decreasing stages, counting distinct stages.
    best: dict[int, int] = {}  # stage -> longest distinct chain ending at that stage
    for s in stages:
        prev = max((v for k, v in best.items() if k < s), default=0)
        best[s] = max(best.get(s, 0), prev + 1)
    return max(stages), max(best.values())


class RiskScorer:
    def __init__(self):
        self.state = ScoreState()

    def add(self, detections: list[Detection], t: float) -> None:
        for d in detections:
            if d.confidence < COUNT_THRESHOLD:
                continue
            cur = self.state.tactics.get(d.tactic)
            if cur is None:
                self.state.tactics[d.tactic] = TacticState(d.confidence, d.evidence, t, d.layers, d.evidence)
            elif d.confidence > cur.confidence:
                cur.confidence, cur.evidence, cur.layers = d.confidence, d.evidence, d.layers

    def add_benign(self, strength: float) -> None:
        """Genuine-call evidence from L1 protective phrases, L2 benign similarity or L3."""
        self.state.benign = max(strength, self.state.benign * 0.85)

    def _hard_rule(self) -> str:
        auth = self.state.tactics.get(AUTHORITY)
        if not auth:
            return ""
        for t in EXTRACTION_TACTICS:
            ts = self.state.tactics.get(t)
            if ts and ts.first_t >= auth.first_t and ts.confidence >= 0.6:
                return f"{AUTHORITY} then {t}"
        return ""

    def update(self) -> float:
        st = self.state
        present = {k for k in st.tactics}
        base = sum(WEIGHTS[k] * v.confidence for k, v in st.tactics.items())
        for combo, mult in COMBOS:
            if combo <= present:
                base *= mult
        st.stage, st.stages_in_order = stage_progress(st.tactics)
        base += STAGE_BONUS * max(0, st.stages_in_order - 1)
        base *= 1 - 0.5 * st.benign

        st.hard_rule = self._hard_rule()
        if st.hard_rule:
            base = max(base, HARD_RULE_SCORE)

        target = min(100.0, base)
        if target >= st.score:
            st.score = target
        else:
            st.score = DECAY * st.score + (1 - DECAY) * target
        return st.score
