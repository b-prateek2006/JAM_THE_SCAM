# Testing Jam the Scam

## Automated

| Suite | Command | What it covers |
|---|---|---|
| Backend | `cd backend && .venv/Scripts/python -m pytest -q tests` | Detector, scorer, WebSocket protocol and limits, endpointer levels, "can't hear" hints |
| Frontend | `cd frontend && npm test` | Hooks, screens, components (Vitest, no backend) |
| End to end | see below | The real PWA in Chromium against the running app; a WAV file is the microphone |
| Detection quality | `cd backend && .venv/Scripts/python -m eval.run_eval --set heldout` | Catch rate, false alerts, lead time ([README](../README.md#evaluation)) |

**End to end** (needs the app running on port 8000, e.g. `scripts\demo.ps1`):

```bash
cd e2e
npm install
python make_fixtures.py                      # derives the far-field and silent variants
npx playwright install chromium              # or skip this and set E2E_CHANNEL=chrome to use installed Chrome
npx playwright test
```

| Case | Input | Expected |
|---|---|---|
| Mic, scam | Inspector Sharma, voiced (`fixtures/scam.wav`) | Transcript lines, then CRITICAL |
| Mic, scam over a speakerphone | Same call, phone band, 18 dB quieter, room reverb, noise | CRITICAL |
| Mic, genuine bank call | `fixtures/genuine.wav` | Never Warning or Critical |
| Mic, silence | What a phone gives the browser during a call | "I can't hear the call" hint |
| Recorded file | `fixtures/scam.wav` uploaded | CRITICAL, then the report when the file ends |
| Demo scenario | Inspector Sharma | CRITICAL |

L3 is off in these tests so the results don't depend on an LLM key. CI runs them on every push to `main`, against the Docker image.

To re-voice the fixtures after changing a scenario: `python make_fixtures.py --tts` (Windows; uses the built-in David and Zira voices).

## Manual: real calls

### The setup that works

A phone can't listen to its own call. Android and iOS give other apps (the browser, the PWA) silence while a call is using the microphone, and the dialer puts the browser in the background anyway.

1. **Phone A** takes the call and puts it on **speakerphone**.
2. **Device B** (a laptop, or a second phone) opens the app link and stays **next to phone A's speaker**.
3. On device B: Source = **Microphone (speakerphone next to this device)**, language = the call's language, then press **Start guarding this call**.

### Checklist

| # | Device B | Browser | Source | Call | Expected |
|---|---|---|---|---|---|
| 1 | Laptop | Chrome / Edge | Microphone | Scam script read aloud on phone A (English) | Transcript lines appear within ~5 s of each sentence; Warning, then Critical |
| 2 | Laptop | Chrome / Edge | Microphone | Genuine conversation | Stays Safe or Caution |
| 3 | Second phone | Chrome (Android) | Microphone | Scam script | As 1 |
| 4 | Second phone | Chrome (Android) | Microphone, browser speech-to-text | Scam script in Telugu or Hindi | As 1 |
| 5 | **Phone A itself** | any | Microphone | Any call | The "I can't hear the call" hint within ~10 s (expected, not a bug) |
| 6 | Laptop | Chrome / Edge | Recorded call (file) | A recording of the call | As 1, then the report |

### When a live test fails, read the server's line for that call

```powershell
docker compose logs --since 10m | Select-String "jam: call"
```

Every call ends with one line like:

```
call 267b3d6d8980 ended: source=mic lang=en {'audio_s': 78.6, 'speech_s': 47.8, 'peak_dbfs': -10.2, 'mean_dbfs': -24.1, 'floor_dbfs': -90.3} utterances=17 stt_texts=16/17 lines=16 peak_score=100
```

| What you see | Meaning | Fix |
|---|---|---|
| `audio_s` = 0, hint `no_audio` | The browser sent no audio | Allow the microphone for the site; reload |
| `peak_dbfs` around -90, hint `no_speech` | The mic delivers digital silence | The app is on the phone that has the call: use a second device |
| `speech_s` > 0 but `peak_dbfs` below about -40 | Very quiet | Move device B closer to the speaker; turn the call volume up |
| `stt_texts` much lower than `utterances` | Whisper hears noise, not words | Closer, louder, quieter room; for Telugu try browser speech-to-text |
| Lines appear but the score stays low | Detection, not audio | Compare with the same transcript on the recorded-file path |
