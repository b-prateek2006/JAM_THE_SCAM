---
title: Jam the Scam
emoji: 🛡️
colorFrom: indigo
colorTo: red
sdk: docker
app_port: 8000
startup_duration_timeout: 1h
pinned: false
short_description: Spots digital-arrest scam calls live
---

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
| L3 | LLM reasoner over the last ~2 min of transcript, strict JSON with quoted evidence, explained in the user's language (Groq / Gemini free keys with automatic fallback, or Claude; optional) | every ~20 s, or on a flag (≥15 s apart) |

The **risk scorer** models the call's trajectory, not keywords: tactic weights, combination multipliers (authority + secrecy, authority + money ask), a bonus for the script progressing through its stages in order, hard rules (authority followed by a money / OTP / remote-access ask is always critical), a benign dampener for genuine-call language, and asymmetric smoothing so small talk can't reset it.

Alert levels: **Caution 40+** (alert in the live-call panel), **Warning 65+** (full screen, vibration, spoken warning), **Critical 85+ or hard rule** (hang-up button, family alert).

## Evaluation

`backend/eval/` has two sets of scripted calls across English, Hindi and Telugu (script and romanised). An alert means Warning (65+) or higher. L2 is `paraphrase-multilingual-mpnet-base-v2`, and L3 is Groq `qwen/qwen3.8-27b` with Gemini fallback.

**Held-out set: quote these.** It has 10 scam and 10 benign scripts written after tuning, never used to adjust anything ([RESULTS_heldout.md](backend/eval/results/RESULTS_heldout.md)).

| Configuration | Scam calls caught | False alerts | Alerted before the money ask |
|---|---|---|---|
| L1 rules only | 3/10 | 0/10 | — |
| L1 + L2 semantic | 9/10 | 1/10 | 2/10 |
| L1 + L2 + L3 LLM | **10/10** | 1/10 | **9/10** |

**Dev set.** It has 15 scam and 15 benign scripts. They were also used while tuning, so these numbers are optimistic ([RESULTS.md](backend/eval/results/RESULTS.md)).

| Configuration | Scam calls caught | False alerts | Alerted before the money ask |
|---|---|---|---|
| L1 rules only | 11/15 | 0/15 | 1/11 |
| L1 + L2 semantic | 15/15 | 0/15 (1 caution) | 9/15 |
| L1 + L2 + L3 LLM | 15/15 | 0/15 (1 caution) | 9/15 |

**What the held-out set shows:**
- The keyword layer alone generalises poorly (3/10).
- L3 catches the one scam the embeddings miss: an income-tax "refund" that only asks for an OTP.
- L3 moves the warning ahead of the money ask in 9 of 10 calls.
- **Known false alert:** a genuine police tenant-verification call in romanised Hindi ("bring your Aadhaar to the chowki") trips the authority-then-credential hard rule. It's left unfixed here on purpose; tuning against the held-out set would make its numbers meaningless.

To rerun: `python -m eval.run_eval --set heldout --l3-gap 20`. The gap keeps it inside Groq's free per-minute limits.

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

**L3 with free keys.** Put a [Groq key](https://console.groq.com/keys) and a [Gemini key](https://aistudio.google.com/apikey) in `backend/.env` (both free, no card) with `LLM_PROVIDER=groq`. Groq (`qwen/qwen3.8-27b`, ~1 s) answers first; when its free per-minute limit is hit, the call goes to Gemini (`gemini-3.5-flash`, ~5 s) and Groq rests for its `retry-after`. `/api/health` shows both. Without keys the app runs on L1 + L2.

```bash
cd frontend && npm install && npm run build
```

```bash
cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8000
```

Open http://localhost:8000. The first start downloads the embedding model (~1 GB) and Whisper `small` (~0.5 GB).

For frontend development, run `npm run dev` in `frontend/` (port 5173, proxies `/api` and `/ws` to :8000).
Frontend tests (Vitest + Testing Library, no backend needed): `npm test` in `frontend/`.

Phones need HTTPS for the microphone: expose port 8000 with a tunnel (for example `cloudflared tunnel --url http://localhost:8000`) and open the HTTPS URL on the phone.

### Input sources (same pipeline for all)

- **Demo scenario**: scripted calls in `demo/scenarios/` (Inspector Sharma, genuine bank call, Hindi, Telugu).
- **Microphone**: 16 kHz PCM over the WebSocket → VAD → faster-whisper.
- **Microphone, browser speech-to-text**: Chrome's recogniser (te-IN / hi-IN / en-IN) sends text; useful for Telugu.
- **Recorded call**: plays an audio file aloud and streams it exactly like the mic.

### Tests and eval

```bash
cd backend
.venv/Scripts/python -m pip install -r requirements-dev.txt   # once: adds pytest
.venv/Scripts/python -m pytest -q tests
.venv/Scripts/python -m eval.run_eval                 # writes eval/results/RESULTS.md
.venv/Scripts/python -m eval.run_eval --embed ngram   # no ML packages needed
```

### Docker

```bash
docker compose up --build
```

The image bakes in the embedding model and Whisper (`EMBED_MODEL` / `WHISPER_MODEL` build args) and runs offline at startup, so the first build takes a while and later starts take seconds. Keys go in `backend/.env`; the public-deploy limits (`MAX_SESSIONS`, `SMS_ALLOWLIST`, `STORE_INCIDENTS`, ...) are listed in [.env.example](.env.example).

### Deploy (Hugging Face Spaces)

The YAML block at the top of this file is the Space config (Docker SDK, port 8000). Create a Docker Space, add the keys as Space secrets, and push this repo to it:

```bash
git remote add space https://huggingface.co/spaces/<hf-user>/jam-the-scam
git push space main
```

Open the app at `https://<hf-user>-jam-the-scam.hf.space` (not the huggingface.co page, which wraps it in an iframe) so the microphone and PWA install work on phones.

## Privacy

Opt-in per call. Audio is never stored. Transcripts stay in memory for the length of the call. Incident reports are kept in the browser on the user's device; the server saves nothing unless it runs with `STORE_INCIDENTS=1`. The app advises; it never blocks a call.
