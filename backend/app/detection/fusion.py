"""Fuse L1 (lexicon), L2 (semantic) and L3 (LLM) evidence into one confidence per tactic."""
from __future__ import annotations

from dataclasses import dataclass

from .lexicon import MEDIUM, STRONG

# A tactic counts towards risk only at or above this fused confidence.
COUNT_THRESHOLD = 0.5


@dataclass
class Detection:
    tactic: str
    confidence: float
    evidence: str
    layers: str  # e.g. "L1+L2", "L3"


def fuse(l1: float = 0.0, l2: float = 0.0, l3: float | None = None) -> float:
    """
    * L3, when it ran, is trusted on its own.
    * L2 and L1 agreeing is the normal path: 0.6*l2 + 0.4*l1.
    * A close L2 paraphrase (>= 0.6) counts on its own, slightly discounted.
    * A medium/strong lexicon phrase alone ("arrest warrant", "AnyDesk") still counts,
      slightly discounted. A weak keyword alone ("OTP", "police") never does.
    """
    candidates = [0.6 * l2 + 0.4 * l1]
    if l2 >= 0.6:  # a close paraphrase of a known scam line counts even with no keyword
        candidates.append(l2 - 0.1)
    if l3 is not None:
        candidates.append(l3)
    if l1 >= MEDIUM:
        candidates.append(l1 - 0.15)
    if l1 >= STRONG:
        candidates.append(l1)
    return max(0.0, min(1.0, max(candidates)))


def layers_used(l1: float, l2: float, l3: float | None) -> str:
    used = []
    if l1 > 0:
        used.append("L1")
    if l2 >= 0.3:
        used.append("L2")
    if l3:
        used.append("L3")
    return "+".join(used) or "-"
