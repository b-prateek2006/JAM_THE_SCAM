# Jam the Scam: file architecture

Follows `scam-call-guardian-deep-dive.md` (sections 3, 4, 7, 8) and the stack promised on slide 7 of the round-1 deck.
Owner column maps to the 24h plan: **A** audio & backend, **B** detection & AI, **C** frontend & demo.

```
JAM_THE_SCAM/
├── README.md                     how to run (backend, frontend, demo, eval)
├── ARCHITECTURE.md               this file
├── Dockerfile                    one image: built PWA + backend + baked-in models (Hugging Face Space / VM)
├── docker-compose.yml            local / cloud-VM run of the same image (slide 7)
├── .dockerignore                 keeps host venvs, node_modules and .env out of the build
├── .github/workflows/ci.yml      tests + eval smoke, frontend tests + build, Docker image boot check + e2e
├── docs/TESTING.md               automated suites, real-call test checklist, reading the per-call log line
├── .env.example                  every optional key (LLM, STT, SMS) with comments
│
├── backend/                      Python FastAPI service
│   ├── requirements.txt          core deps (FastAPI, uvicorn, numpy, httpx)
│   ├── requirements-ml.txt       heavy optional deps (faster-whisper, sentence-transformers)
│   ├── requirements.lock         exact versions the Docker image installs (torch pinned in the Dockerfile)
│   ├── app/
│   │   ├── main.py               A  FastAPI app: REST routes + WebSocket /ws/guard, serves built frontend
│   │   ├── config.py             A  env settings (model names, thresholds, which providers are on)
│   │   ├── session.py            A  CallSession: one guarded call; wires STT → detectors → scorer → alerts
│   │   │
│   │   ├── audio/                     ── 4.1 Audio → text ──
│   │   │   ├── vad.py            A  utterance endpointing on the 16 kHz PCM stream (minimum-statistics noise floor,
│   │   │                        level stats for the per-call log and the "can't hear" hint); Silero inside Whisper trims
│   │   │   ├── stt_whisper.py    A  faster-whisper transcription (EN/HI, code-mixed)
│   │   │   └── stt_sarvam.py     A  hosted Indic STT for Telugu (optional, needs key)
│   │   │
│   │   ├── detection/                 ── 4.2–4.4 the 3-layer detection engine ──
│   │   │   ├── tactics.py        B  tactic taxonomy, weights, 5-stage model, labels in EN/HI/TE
│   │   │   ├── lexicon.py        B  L1 multilingual regex lexicon + protective (genuine-caller) patterns
│   │   │   ├── semantic.py       B  L2 embedding kNN vs scam + benign libraries (MiniLM/LaBSE, char-ngram fallback)
│   │   │   ├── llm.py            B  L3 LLM reasoner: Groq / Gemini / Claude, strict JSON, fallback to a second
│   │   │   │                        provider on failure, 429 cooldown
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
│   │   └── storage.py            A  SQLite incidents, only when STORE_INCIDENTS=1 (the PWA keeps reports on-device)
│   │
│   ├── data/
│   │   ├── script_library.json   B  L2 scam lines (tagged by tactic) + benign hard negatives
│   │   └── incidents.db          (created at runtime, git-ignored)
│   │
│   ├── eval/                          ── section 7: data & evaluation ──
│   │   ├── scripts/{scam,benign}/  B  dev set: 15 + 15 scripts, also used while tuning (numbers are optimistic)
│   │   ├── scripts_heldout/{scam,benign}/  held-out set: 10 + 10 scripts never tuned against (--set heldout)
│   │   ├── run_eval.py           B  recall/false alerts at Level 2, time-to-alert vs money ask,
│   │   │                             and the L1 → L1+L2 → L1+L2+L3 ablation table for the slide
│   │   └── results/              generated metrics: RESULTS.md (dev), RESULTS_heldout.md (held-out)
│   │
│   └── tests/
│       └── test_core.py          lexicon, hard rules, smoothing, entity extraction, whole calls, endpointer levels, hints
│
├── frontend/                     React PWA (Vite)
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js            dev proxy to the backend; Vitest config (npm test)
│   ├── public/
│   │   ├── pcm-worklet.js        C  AudioWorklet: downsample to 16 kHz Int16 PCM
│   │   ├── manifest.webmanifest  PWA install
│   │   ├── sw.js                 service worker (offline shell + icons)
│   │   └── icons/                SVG, 192/512 PNG, maskable 512, apple-touch-icon
│   └── src/
│       ├── main.jsx              mounts App, bundles the Poppins font, registers the service worker
│       ├── App.jsx               C  state + composition: settings, history, routes, which page shows
│       ├── api.js                REST + WebSocket client
│       ├── audio/
│       │   ├── micCapture.js     C  WebAudio mic → 16 kHz PCM frames over the WebSocket
│       │   └── browserStt.js     C  Web Speech API fallback (te-IN / hi-IN / en-IN)
│       ├── hooks/
│       │   └── useGuardCall.js   C  one guarded call: socket, input source, alerts, start / end / abort
│       ├── screens/
│       │   ├── HistoryScreen.jsx C  past incidents on this device, delete one / all
│       │   ├── SettingsScreen.jsx C name, family contact, caller number, language, L3
│       │   └── HelpScreen.jsx    C  what real police never do, how it works, 1930
│       ├── components/
│       │   ├── TopBar.jsx / Sidebar.jsx   brand, status, language; navigation (bottom bar on phones)
│       │   ├── GuardHero.jsx     C  hero card: call source setup, start / end button
│       │   ├── HeroPhone.jsx     C  hero illustration; its scam-tell chips light up as tactics are detected
│       │   ├── LivePanel.jsx     C  caller, risk ring, inline alert, scam stages, transcript
│       │   ├── RiskMeter.jsx     C  0–100 ring gauge (40 / 65 / 85 thresholds)
│       │   ├── StageTrack.jsx    C  Hook → Authority → Isolation → Threat → Money ask, with evidence quotes
│       │   ├── Transcript.jsx    C  rolling transcript with flagged lines (aria-live log)
│       │   ├── SideRail.jsx      C  quick actions (hang up, alert family, complaint), caller details
│       │   ├── AlertBanner.jsx   C  level 2/3 full-screen takeover (focus-trapped dialog)
│       │   ├── ReportView.jsx    C  incident report, copy / share complaint, 1930 links
│       │   ├── HowItWorks.jsx, LangSwitch.jsx, Icon.jsx
│       ├── lib/
│       │   ├── i18n.js           C  EN / HI / TE UI strings, t(lang, key, vars)
│       │   ├── storage.js        C  settings + on-device incident history (localStorage)
│       │   ├── route.js          C  hash routes: #/history, #/report/<id>, ...
│       │   ├── format.js         C  clock, family WhatsApp link, status pill, hard-rule text
│       │   └── tts.js            C  spoken warnings via speechSynthesis
│       ├── test/setup.js         Vitest + Testing Library setup (jsdom)
│       ├── **/*.test.js(x)       unit, component, hook and App tests
│       └── styles.css            theme tokens, layout, three breakpoints
│
├── demo/
│   ├── scenarios/*.json          scripted calls for stage (Inspector Sharma, genuine bank call)
│   └── DEMO.md                   3-minute run sheet from section 9, plus the judge Q&A from section 11
│
└── e2e/                          Playwright: the real PWA in Chromium, a WAV file as the microphone
    ├── make_fixtures.py          voices the English scenarios (SAPI, --tts) and derives far-field / silent variants
    ├── fixtures/*.wav            scam.wav, genuine.wav (committed); generated/ is derived and git-ignored
    └── tests/call.spec.js        mic scam / far-field / genuine / silence, recorded file, demo scenario
```

## How a call flows through the files

1. `micCapture.js` streams PCM to `/ws/guard` (or `browserStt.js` / a demo scenario sends text).
2. `main.py` cuts the audio into utterances with `vad.py` and transcribes them with `stt_whisper.py`. If an audio call sends nothing, or only silence (the app on the same phone as the call), it sends a `hint` the PWA shows; every call ends with one log line of its audio levels and counts.
3. Each utterance goes through `lexicon.py` (L1) and `semantic.py` (L2) instantly; `llm.py` (L3) runs every ~20 s, or sooner (but ≥15 s apart) when L1/L2 flags something, and stops once it has explained a critical call.
4. `fusion.py` merges the layers, `scorer.py` updates the risk score, `manager.py` decides the alert level.
5. The WebSocket pushes score, chips, evidence and alerts to the UI; level 3 triggers `notify.py`.
6. On hang-up, `extract.py` + `complaint.py` build the report; the PWA saves it on the device (and `storage.py` on the server if `STORE_INCIDENTS=1`).

The pipeline is the same for mic, browser STT, demo scenario and eval: only the input differs (deep-dive section 8 fallback).
