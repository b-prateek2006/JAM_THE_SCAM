# Jam the Scam: file architecture

Follows `scam-call-guardian-deep-dive.md` (sections 3, 4, 7, 8) and the stack promised on slide 7 of the round-1 deck.
Owner column maps to the 24h plan: **A** audio & backend, **B** detection & AI, **C** frontend & demo.

```
JAM_THE_SCAM/
├── README.md                     how to run (backend, frontend, demo, eval)
├── ARCHITECTURE.md               this file
├── docker-compose.yml            backend + frontend for the cloud-VM deploy (slide 7)
├── .env.example                  every optional key (LLM, STT, SMS) with comments
│
├── backend/                      Python FastAPI service
│   ├── requirements.txt          core deps (FastAPI, uvicorn, numpy, httpx)
│   ├── requirements-ml.txt       heavy optional deps (faster-whisper, sentence-transformers)
│   ├── Dockerfile
│   ├── app/
│   │   ├── main.py               A  FastAPI app: REST routes + WebSocket /ws/guard, serves built frontend
│   │   ├── config.py             A  env settings (model names, thresholds, which providers are on)
│   │   ├── session.py            A  CallSession: one guarded call; wires STT → detectors → scorer → alerts
│   │   │
│   │   ├── audio/                     ── 4.1 Audio → text ──
│   │   │   ├── vad.py            A  utterance endpointing on the 16 kHz PCM stream (Silero via faster-whisper, energy fallback)
│   │   │   ├── stt_whisper.py    A  faster-whisper transcription (EN/HI, code-mixed)
│   │   │   └── stt_sarvam.py     A  hosted Indic STT for Telugu (optional, needs key)
│   │   │
│   │   ├── detection/                 ── 4.2–4.4 the 3-layer detection engine ──
│   │   │   ├── tactics.py        B  tactic taxonomy, weights, 5-stage model, labels in EN/HI/TE
│   │   │   ├── lexicon.py        B  L1 multilingual regex lexicon + protective (genuine-caller) patterns
│   │   │   ├── semantic.py       B  L2 embedding kNN vs scam + benign libraries (MiniLM/LaBSE, char-ngram fallback)
│   │   │   ├── llm.py            B  L3 LLM reasoner: Groq / Gemini / Claude, strict JSON, async, rate-limited
│   │   │   └── fusion.py         B  fuse L1/L2/L3 per tactic into one confidence
│   │   │
│   │   ├── scoring/                   ── 4.5 risk scorer ──
│   │   │   └── scorer.py         B  stateful score: weights, combo multipliers, stage progression,
│   │   │                             hard rules, benign dampener, asymmetric smoothing
│   │   │
│   │   ├── alerts/                    ── 4.6 alert manager ──
│   │   │   ├── manager.py        B  levels 1/2/3 with hysteresis, spoken-warning text in EN/HI/TE
│   │   │   └── notify.py         A  family alert: Twilio / MSG91 SMS, else WhatsApp click-to-chat link
│   │   │
│   │   ├── report/                    ── post-call incident report ──
│   │   │   ├── extract.py        B  entities: caller no., claimed name/agency, badge/FIR, UPI IDs, accounts, IFSC
│   │   │   └── complaint.py      B  complaint draft for 1930 / cybercrime.gov.in / Chakshu
│   │   │
│   │   └── storage.py            A  SQLite incidents (transcript kept only if the user chooses)
│   │
│   ├── data/
│   │   ├── script_library.json   B  L2 scam lines (tagged by tactic) + benign hard negatives
│   │   └── incidents.db          (created at runtime, git-ignored)
│   │
│   ├── eval/                          ── section 7: data & evaluation ──
│   │   ├── scripts/scam/*.json   B  ~30 scam call scripts (parcel, Aadhaar, TRAI, "son arrested", RBI)
│   │   ├── scripts/benign/*.json B  ~30 hard negatives (bank fraud team, courier, passport police, relative)
│   │   ├── run_eval.py           B  precision/recall at Level 2, time-to-alert vs money ask, false alerts
│   │   ├── ablation.py           B  L1 → L1+L2 → L1+L2+L3 table for the slide
│   │   ├── make_audio.py         A  TTS the scripts into WAVs for the audio path
│   │   └── results/              generated metrics (JSON + markdown table)
│   │
│   └── tests/
│       ├── test_lexicon.py
│       ├── test_scorer.py        hard rules, smoothing, dampener
│       └── test_pipeline.py      whole call through CallSession, text-only
│
├── frontend/                     React PWA (Vite)
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js            dev proxy to the backend
│   ├── public/
│   │   ├── manifest.webmanifest  PWA install
│   │   ├── sw.js                 service worker (offline shell)
│   │   └── icons/
│   └── src/
│       ├── main.jsx
│       ├── App.jsx               screens: Home → Guard (live call) → Report; Settings drawer
│       ├── api.js                REST + WebSocket client
│       ├── audio/
│       │   ├── micCapture.js     C  WebAudio mic → 16 kHz PCM frames over the WebSocket
│       │   ├── pcm-worklet.js    C  AudioWorklet downsampler
│       │   └── browserStt.js     C  Web Speech API fallback (te-IN / hi-IN / en-IN)
│       ├── components/
│       │   ├── RiskMeter.jsx     C  0–100 gauge
│       │   ├── TacticChips.jsx   C  chips that light up with evidence on hover
│       │   ├── Transcript.jsx    C  rolling transcript with highlighted evidence
│       │   ├── AlertBanner.jsx   C  caution banner / full-screen warning / critical takeover
│       │   ├── StageTrack.jsx    C  Hook → Authority → Isolation → Urgency → Money ask
│       │   └── ReportView.jsx    C  incident report + copyable complaint
│       ├── lib/
│       │   ├── tts.js            C  spoken warnings via speechSynthesis
│       │   └── i18n.js           C  EN / HI / TE UI strings
│       └── styles.css
│
└── demo/
    ├── scenarios/*.json          scripted calls for stage (Inspector Sharma, genuine bank call)
    └── DEMO.md                   3-minute run sheet from section 9, plus the judge Q&A from section 11
```

## How a call flows through the files

1. `micCapture.js` streams PCM to `/ws/guard` (or `browserStt.js` / a demo scenario sends text).
2. `session.py` passes audio to `vad.py` → `stt_whisper.py` and gets utterances back.
3. Each utterance goes through `lexicon.py` (L1) and `semantic.py` (L2) instantly; `llm.py` (L3) runs every 10–15 s or when L1/L2 flags something.
4. `fusion.py` merges the layers, `scorer.py` updates the risk score, `manager.py` decides the alert level.
5. The WebSocket pushes score, chips, evidence and alerts to the UI; level 3 triggers `notify.py`.
6. On hang-up, `extract.py` + `complaint.py` build the report and `storage.py` saves it if the user keeps it.

The pipeline is the same for mic, browser STT, demo scenario and eval: only the input differs (deep-dive section 8 fallback).
