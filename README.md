# Jam the Scam

**This scam follows a script. Our AI knows the script.**

Jam the Scam listens alongside a call (on speakerphone, or from a second device), recognises the script of a "digital arrest" / impersonation scam as it unfolds, and gets the victim off the call before money moves: a live risk meter, a spoken warning in Telugu, Hindi or English, a family alert, and a pre-filled complaint for 1930 / cybercrime.gov.in.

HackVibe 2.0 entry. See [ARCHITECTURE.md](ARCHITECTURE.md) for the file layout and call flow.

## How it detects

Each utterance goes through three layers, fused into one confidence per tactic:

| Layer | What | Speed |
|---|---|---|
| L1 | Multilingual regex lexicon (EN / HI / TE, script + romanised), plus "protective" phrases genuine callers use | ms |
| L2 | kNN against a library of scam lines and genuine-call lines (multilingual sentence embeddings) | ~50 ms |
| L3 | LLM reasoner over the last ~2 min of transcript, strict JSON with quoted evidence (Groq / Gemini / Claude, optional) | every ~12 s or on a flag |

The **risk scorer** models the call's trajectory, not keywords: tactic weights, combination multipliers (authority + secrecy, authority + money ask), a bonus for the script progressing through its stages in order, hard rules (authority followed by a money / OTP / remote-access ask is always critical), a benign dampener for genuine-call language, and asymmetric smoothing so small talk can't reset it.

Alert levels: **Caution 40+** (banner), **Warning 65+** (full screen, vibration, spoken warning), **Critical 85+ or hard rule** (hang-up button, family alert).

## Evaluation

`backend/eval/` holds 15 scam scripts and 15 benign hard negatives (bank fraud teams, delivery OTPs, passport police, a police cyber-awareness talk, relatives asking for money) across English, Hindi and Telugu. Current results are in [backend/eval/results/RESULTS.md](backend/eval/results/RESULTS.md):

| Configuration | Scam calls caught | False alerts | Alerted before the money ask |
|---|---|---|---|
| L1 rules only | 11/15 | 0/15 | 1/11 |
| L1 + L2 semantic | 15/15 | 0/15 (1 caution) | 9/15 |

These scripts were also used while tuning the lexicon and libraries, so treat them as a dev set; write a fresh held-out set before quoting numbers on stage. L3 isn't in the table until an LLM key is configured.

## Run it

Requirements: Python 3.10+, Node 18+.

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt          # macOS/Linux: .venv/bin/python
.venv/Scripts/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/python -m pip install -r requirements-ml.txt       # optional: Whisper STT + embeddings
cp ../.env.example .env                                          # optional: LLM / SMS keys
```

```bash
cd frontend && npm install && npm run build
```

```bash
cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8000
```

Open http://localhost:8000. The first start downloads the embedding model (~1 GB) and Whisper `small` (~0.5 GB).

For frontend development, run `npm run dev` in `frontend/` (port 5173, proxies `/api` and `/ws` to :8000).

Phones need HTTPS for the microphone: expose port 8000 with a tunnel (for example `cloudflared tunnel --url http://localhost:8000`) and open the HTTPS URL on the phone.

### Input sources (same pipeline for all)

- **Demo scenario**: scripted calls in `demo/scenarios/` (Inspector Sharma, genuine bank call, Hindi, Telugu).
- **Microphone**: 16 kHz PCM over the WebSocket → VAD → faster-whisper.
- **Microphone, browser speech-to-text**: Chrome's recogniser (te-IN / hi-IN / en-IN) sends text; useful for Telugu.
- **Recorded call**: plays an audio file aloud and streams it exactly like the mic.

### Tests and eval

```bash
cd backend
.venv/Scripts/python -m pytest -q tests
.venv/Scripts/python -m eval.run_eval                 # writes eval/results/RESULTS.md
.venv/Scripts/python -m eval.run_eval --embed ngram   # no ML packages needed
```

### Docker

```bash
docker compose up --build
```

## Privacy

Opt-in per call. Audio is never stored. Transcripts stay in memory and are saved only if the user keeps the incident report. The app advises; it never blocks a call.
