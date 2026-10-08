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


# ---------------------------------------------------------------- public-deploy limits
import dataclasses  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402
from app.alerts import notify  # noqa: E402


@pytest.fixture
def client(monkeypatch):
    # No lifespan: reuse the n-gram engine instead of loading the ML models.
    monkeypatch.setattr(main, "engine", ENGINE)
    monkeypatch.setattr(main, "analyze_limiter", main.RateLimiter(3))
    return TestClient(main.app)


def test_sms_only_to_allowlisted_numbers(monkeypatch):
    for k, v in {"TWILIO_ACCOUNT_SID": "AC1", "TWILIO_AUTH_TOKEN": "t", "TWILIO_FROM": "+1555"}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setenv("SMS_ALLOWLIST", "+91 98765 43210")
    assert notify.sms_allowed("9876543210")
    res = asyncio.run(notify.send_sms("9123456789", "hi"))  # returns before any network call
    assert res == {"sent": False, "reason": "number not in SMS_ALLOWLIST"}
    monkeypatch.setenv("SMS_ALLOWLIST", "")
    assert not notify.sms_allowed("9876543210")
    monkeypatch.setenv("SMS_ALLOWLIST", "*")
    assert notify.sms_allowed("9123456789")


def test_analyze_caps_size_and_rate(client):
    too_many = {"lines": [{"text": "hello"}] * 201, "use_l3": False}
    assert client.post("/api/analyze", json=too_many).status_code == 422
    too_long = {"lines": [{"text": "x" * 5000}], "use_l3": False}
    assert client.post("/api/analyze", json=too_long).status_code == 422
    ok = {"lines": [{"text": "I am Inspector Sharma from CBI."}], "use_l3": False}
    assert [client.post("/api/analyze", json=ok).status_code for _ in range(4)] == [200, 200, 200, 429]


def test_incident_routes_off_by_default(client):
    assert main.store is None
    assert client.get("/api/incidents").status_code == 404


def test_websocket_session_cap(client, monkeypatch):
    monkeypatch.setattr(main, "settings", dataclasses.replace(main.settings, max_sessions=1))
    with client.websocket_connect("/ws/guard") as first:
        with client.websocket_connect("/ws/guard") as second:
            assert second.receive_json()["type"] == "error"
        first.send_json({"type": "start", "lang": "en", "use_l3": False})
        assert first.receive_json()["type"] == "ready"
        first.send_json({"type": "text", "text": "I am Inspector Sharma from CBI.", "speaker": "caller"})
        assert first.receive_json()["type"] == "update"
        first.send_json({"type": "stop"})
        assert first.receive_json()["type"] == "report"
    assert main.active_sockets == 0


def test_extract_amounts_and_long_digit_runs_stay_fast():
    import time
    e = extract("Transfer Rs. 2,50,000 now, and 5 lakh rupees by tomorrow.")
    assert e.amounts == ["2,50,000", "5 lakh"]
    t0 = time.perf_counter()
    extract("9" * 20000)
    assert time.perf_counter() - t0 < 0.5
