"""Fast tests: lexicon, scorer rules, and a whole call through CallSession (char n-gram L2, no LLM)."""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["LLM_PROVIDER"] = "none"

from app.detection import lexicon  # noqa: E402
from app.detection.fusion import Detection  # noqa: E402
from app.detection.llm import LLMReasoner  # noqa: E402
from app.detection.semantic import SemanticMatcher  # noqa: E402
from app.report.extract import extract  # noqa: E402
from app.scoring.scorer import RiskScorer  # noqa: E402
from app.session import CallSession, Engine, SessionOptions  # noqa: E402

ENGINE = Engine(semantic=SemanticMatcher("ngram"), llm=LLMReasoner())


def test_lexicon_strong_and_protective():
    hits, prot = lexicon.scan("You are under digital arrest. Transfer to the RBI safe account.")
    assert "ARREST_THREAT" in hits and "MONEY_ASK" in hits and prot == 0
    hits, prot = lexicon.scan("Never share your OTP with anyone.")
    assert prot > 0 and "CREDENTIAL" not in hits


def test_hard_rule_needs_authority_first():
    s = RiskScorer()
    s.add([Detection("MONEY_ASK", 0.9, "send money", "L1")], t=1)
    s.add([Detection("AUTHORITY", 0.9, "I am CBI", "L1")], t=5)
    s.update()
    assert not s.state.hard_rule
    s.add([Detection("CREDENTIAL", 0.9, "tell OTP", "L1")], t=9)
    assert s.update() >= 95 and s.state.hard_rule


def test_score_rises_fast_falls_slowly():
    s = RiskScorer()
    s.add([Detection("AUTHORITY", 0.9, "", "L1"), Detection("ISOLATION", 0.9, "", "L1")], t=0)
    high = s.update()
    s.add_benign(1.0)
    assert s.update() > high * 0.8


def test_extract_entities():
    e = extract("I am Inspector Vikram Sharma, CBI, badge number CBI4521. UPI ID rbi.safe@okaxis, install AnyDesk.")
    assert "Inspector Vikram Sharma" in e.claimed_names
    assert e.upi_ids == ["rbi.safe@okaxis"] and e.badge_numbers == ["CBI4521"]


def _run(lines):
    async def go():
        sess = CallSession(ENGINE, SessionOptions(llm_mode="off"))
        for i, text in enumerate(lines):
            await sess.process(text, t=i * 6)
        return sess
    return asyncio.run(go())


def test_scam_call_goes_critical():
    sess = _run([
        "I am Inspector Sharma from Mumbai cyber crime, CBI.",
        "Do not tell anyone in your family, this is confidential.",
        "You are under digital arrest, an arrest warrant is ready.",
        "Transfer your savings to the RBI safe account for verification.",
    ])
    assert sess.alerts.level == 3


def test_genuine_bank_call_stays_low():
    sess = _run([
        "This is the fraud monitoring team from your bank. Did you make this transaction?",
        "We will block your card for your safety.",
        "Never share your OTP or PIN with anyone, the bank will never ask for it.",
    ])
    assert sess.alerts.level == 0
