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


def test_llm_off_schema_output_is_ignored(monkeypatch):
    from app.detection import llm as llm_mod
    reasoner = llm_mod.LLMReasoner()
    reasoner.providers = ["groq"]
    for bad in (["not", "an", "object"], {"tactics": [{"type": "AUTHORITY", "confidence": "high"}]}):
        async def fake(prompt, model, bad=bad):
            return bad
        monkeypatch.setattr(reasoner, "_groq", fake)
        assert asyncio.run(reasoner.analyze("CALLER: hello")) is None
    good = llm_mod.parse_result({"tactics": [{"type": "authority", "confidence": 0.9, "evidence": "I am CBI"}, "junk"],
                                 "stage": 2, "explanation_for_user": "x"})
    assert good.tactics == {"AUTHORITY": 0.9}


def test_websocket_ignores_malformed_input(client):
    with client.websocket_connect("/ws/guard") as ws:
        ws.send_text("not json")
        ws.send_text("[1, 2]")
        ws.send_json({"type": "start", "lang": "xx", "use_l3": False})
        ready = ws.receive_json()
        assert ready["type"] == "ready"
        ws.send_bytes(b"\x00" * 3201)  # odd length
        ws.send_json({"type": "text", "text": "I am Inspector Sharma from CBI.", "speaker": "caller"})
        update = ws.receive_json()
        assert update["type"] == "update" and update["tactics"][0]["label"] == "Authority claim"  # fell back to en
        ws.send_json({"type": "stop"})
        assert ws.receive_json()["type"] == "report"
    assert client.post("/api/analyze", json={"lines": [{"text": "hi"}], "lang": "xx"}).status_code == 422


def test_stt_backlog_is_bounded(client, monkeypatch):
    import time as _time
    import numpy as np
    from app.audio.stt_whisper import Transcript

    class SlowSTT:
        name = "slow"
        calls = 0

        def transcribe(self, audio, lang):
            SlowSTT.calls += 1
            _time.sleep(0.2)
            return Transcript("", "en", 200)

    monkeypatch.setattr(ENGINE, "stt", SlowSTT())
    loud = _pcm(_speechy(-12, 2.0, talk=1.0, pause=1.0))  # one 1 s utterance per 64 KB frame
    with client.websocket_connect("/ws/guard") as ws:
        ws.send_json({"type": "start", "use_l3": False})
        assert ws.receive_json()["type"] == "ready"
        for _ in range(60):  # 60 utterances, far faster than real time
            ws.send_bytes(loud)
        msg = ws.receive_json()
        while msg["type"] != "error":
            msg = ws.receive_json()
        assert "falling behind" in msg["message"]
        ws.send_json({"type": "stop"})
        while ws.receive_json()["type"] != "report":
            pass
    assert SlowSTT.calls < 30  # the overflow was dropped, not queued


def test_incident_store_round_trip(tmp_path):
    from app.storage import IncidentStore
    store = IncidentStore(str(tmp_path / "incidents.db"))
    report = {"call_id": "abc", "started_at": "2026-10-08T10:00:00", "peak_score": 97, "peak_level": 3}
    store.save(report, [{"t": 0, "text": "I am CBI"}])
    assert store.list()[0]["call_id"] == "abc"
    assert store.get("abc")["transcript"][0]["text"] == "I am CBI"
    assert store.delete("abc") and store.get("abc") is None
    (tmp_path / "incidents.db").unlink()  # fails on Windows if a connection were left open


def test_hard_rule_label_is_deterministic():
    s = RiskScorer()
    s.add([Detection("AUTHORITY", 0.9, "", "L1")], t=0)
    s.add([Detection("CREDENTIAL", 0.9, "", "L1"), Detection("MONEY_ASK", 0.9, "", "L1")], t=5)
    s.update()
    assert s.state.hard_rule == "AUTHORITY then MONEY_ASK"


def test_spa_does_not_serve_files_outside_dist(client):
    if not main.dist.exists():
        pytest.skip("frontend not built")
    r = client.get("/..%2F..%2Fbackend%2Fapp%2Fconfig.py")
    assert r.status_code == 200 and "<html" in r.text.lower()  # falls back to index.html
    assert "_load_dotenv" not in r.text


def test_llm_falls_back_to_second_provider(monkeypatch):
    from app.detection import llm as llm_mod
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("GROQ_API_KEY", "g")
    monkeypatch.setenv("GEMINI_API_KEY", "m")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    reasoner = llm_mod.LLMReasoner()
    assert reasoner.providers == ["gemini", "groq"] and reasoner.fallback == "groq"
    used = []

    async def rate_limited(prompt, model):
        used.append(("gemini", model))
        raise RuntimeError("429 Too Many Requests")

    async def ok(prompt, model):
        used.append(("groq", model))
        return {"tactics": [{"type": "MONEY_ASK", "confidence": 0.9, "evidence": "send money"}], "stage": 5}

    monkeypatch.setattr(reasoner, "_gemini", rate_limited)
    monkeypatch.setattr(reasoner, "_groq", ok)
    res = asyncio.run(reasoner.analyze("CALLER: send money"))
    assert res.tactics == {"MONEY_ASK": 0.9}
    assert used == [("gemini", llm_mod.DEFAULT_MODELS["gemini"]), ("groq", llm_mod.DEFAULT_MODELS["groq"])]


def _counting_engine(explanation=""):
    from app.detection.llm import LLMReasoner
    llm = LLMReasoner()
    llm.providers = ["groq"]
    llm.calls = 0

    async def fake(prompt, model):
        llm.calls += 1
        return {"tactics": [], "stage": 0, "explanation_for_user": explanation}

    llm._groq = fake
    return Engine(semantic=ENGINE.semantic, llm=llm)


def test_analyze_caps_llm_calls(client, monkeypatch):
    eng = _counting_engine()
    monkeypatch.setattr(main, "engine", eng)
    lines = [{"text": "This is CBI, you are under investigation.", "t": i * 30.0} for i in range(200)]
    assert client.post("/api/analyze", json={"lines": lines}).status_code == 200
    assert eng.llm.calls == main.ANALYZE_LLM_BUDGET


def test_llm_pacing_gap_and_stop_after_critical(monkeypatch):
    from app import session as session_mod
    monkeypatch.setattr(session_mod, "settings",
                        dataclasses.replace(session_mod.settings, llm_interval_s=20, llm_min_gap_s=8))

    async def run(eng, lines, step):
        sess = CallSession(eng, SessionOptions(llm_mode="sync"))
        for i, text in enumerate(lines):
            await sess.process(text, t=i * step)
        return sess

    # Every line is flagged, 2 s apart: the 8 s minimum gap allows one call per 4 lines.
    eng = _counting_engine()
    asyncio.run(run(eng, ["You are under digital arrest."] * 12, step=2))
    assert eng.llm.calls == 3
    # Once the call is critical and L3 has given an explanation, it stops being called.
    eng = _counting_engine(explanation="This is a scam.")
    sess = asyncio.run(run(eng, ["I am Inspector Sharma from CBI.", "Transfer your savings to the RBI safe account."]
                           + ["Do it now."] * 10, step=30))
    assert sess.alerts.level == 3 and eng.llm.calls == 2


def test_llm_stage_accepts_names():
    from app.detection.llm import parse_stage
    assert [parse_stage(v) for v in (3, "4", "Extraction", "Stage 2: Authority", "urgency/threat", None, "??", 9)] == \
        [3, 4, 5, 2, 4, 0, 0, 5]


def test_llm_skips_rate_limited_provider(monkeypatch):
    import httpx
    from app.detection import llm as llm_mod
    reasoner = llm_mod.LLMReasoner()
    reasoner.providers = ["groq", "gemini"]
    calls = []

    async def limited(prompt, model):
        calls.append("groq")
        req = httpx.Request("POST", "https://api.groq.com/x")
        raise httpx.HTTPStatusError("429", request=req,
                                    response=httpx.Response(429, headers={"retry-after": "30"}, request=req))

    async def ok(prompt, model):
        calls.append("gemini")
        return {"tactics": [], "stage": 0}

    monkeypatch.setattr(reasoner, "_groq", limited)
    monkeypatch.setattr(reasoner, "_gemini", ok)
    assert asyncio.run(reasoner.analyze("x")) is not None
    assert asyncio.run(reasoner.analyze("x")) is not None
    assert calls == ["groq", "gemini", "gemini"]  # groq rests for its retry-after instead of failing again


# ---------------------------------------------------------------- audio levels (live mic path)
def _speechy(level_dbfs, seconds, talk=1.5, pause=1.0, seed=0):
    """Speech-like test signal: noise in 4 Hz syllables, `talk` s on / `pause` s off, at `level_dbfs` while talking."""
    import numpy as np
    from app.audio.vad import SAMPLE_RATE
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    env = 0.5 * (1 + np.sin(2 * np.pi * 4 * t)) * ((t % (talk + pause)) < talk)
    x = np.random.default_rng(seed).standard_normal(len(t)) * env
    return x * (32768 * 10 ** (level_dbfs / 20) / np.sqrt(np.mean(x[env > 0] ** 2)))


def _noise(level_dbfs, seconds, seed=1):
    import numpy as np
    from app.audio.vad import SAMPLE_RATE
    return np.random.default_rng(seed).standard_normal(int(seconds * SAMPLE_RATE)) * 32768 * 10 ** (level_dbfs / 20)


def _pcm(x) -> bytes:
    import numpy as np
    return np.clip(x, -32768, 32767).astype(np.int16).tobytes()


def _utterances(x) -> tuple[int, dict]:
    from app.audio.vad import Endpointer
    ep, pcm, n = Endpointer(), _pcm(x), 0
    for i in range(0, len(pcm), 3200):  # 100 ms frames, like the PWA
        n += len(ep.feed(pcm[i:i + 3200]))
    return n + len(ep.finish()), ep.stats()


@pytest.mark.parametrize("level", [-20, -35, -45])
def test_endpointer_hears_quiet_far_field_speech(level):
    n, stats = _utterances(_speechy(level, 12) + _noise(-55, 12))
    assert n >= 4, stats  # 5 bursts of speech


def test_endpointer_ignores_noise_and_tracks_a_fan():
    assert _utterances(_noise(-55, 12))[0] == 0
    assert _utterances(_noise(-40, 12))[0] == 0  # a fan or AC is not speech...
    assert _utterances(_noise(-40, 12) + _speechy(-30, 12))[0] >= 4  # ...and doesn't hide speech over it
    n, stats = _utterances(_noise(-200, 10))  # digital silence
    assert n == 0 and stats["peak_dbfs"] < -80 and stats["audio_s"] == 10.0


def test_silent_mic_gets_a_hint_and_a_logged_summary(client, caplog):
    import logging
    caplog.set_level(logging.INFO, logger="jam")
    with client.websocket_connect("/ws/guard") as ws:
        ws.send_json({"type": "start", "source": "mic", "use_l3": False})
        assert ws.receive_json()["type"] == "ready"
        silence = bytes(3200)  # what a phone gives the browser during a call
        for _ in range(int(main.NO_SPEECH_HINT_S * 10) + 1):
            ws.send_bytes(silence)
        hint = ws.receive_json()
        assert hint["type"] == "hint" and hint["code"] == "no_speech" and hint["speech_s"] == 0
        for _ in range(20):  # sent once per call, not on every frame
            ws.send_bytes(silence)
        ws.send_json({"type": "stop"})
        assert ws.receive_json()["type"] == "report"
    summary = [r.getMessage() for r in caplog.records if " ended: " in r.getMessage()]
    assert len(summary) == 1 and "source=mic" in summary[0] and "utterances=0" in summary[0]


def test_speech_on_the_mic_gets_no_hint(client, monkeypatch):
    from app.audio.stt_whisper import Transcript

    class FakeSTT:
        name = "fake"

        def transcribe(self, audio, lang):
            return Transcript("I am Inspector Sharma from CBI.", "en", 1)

    monkeypatch.setattr(ENGINE, "stt", FakeSTT())
    with client.websocket_connect("/ws/guard") as ws:
        ws.send_json({"type": "start", "source": "mic", "use_l3": False})
        assert ws.receive_json()["type"] == "ready"
        pcm = _pcm(_speechy(-30, 10) + _noise(-55, 10))
        for i in range(0, len(pcm), 3200):
            ws.send_bytes(pcm[i:i + 3200])
        ws.send_json({"type": "stop"})
        kinds = []
        while (msg := ws.receive_json())["type"] != "report":
            kinds.append(msg["type"])
    assert "hint" not in kinds and "stt" in kinds and "update" in kinds


def test_audio_call_that_sends_nothing_gets_a_hint(client, monkeypatch):
    monkeypatch.setattr(main, "NO_AUDIO_HINT_S", 0.2)
    with client.websocket_connect("/ws/guard") as ws:
        ws.send_json({"type": "start", "source": "mic", "use_l3": False})
        assert ws.receive_json()["type"] == "ready"
        hint = ws.receive_json()  # nothing sent: the worklet never started, or the browser blocked the mic
        assert hint["type"] == "hint" and hint["code"] == "no_audio" and hint["audio_s"] == 0
        ws.send_json({"type": "stop"})
        assert ws.receive_json()["type"] == "report"
