# 3-minute demo run sheet

Setup: backend running, PWA open on the "victim" phone (HTTPS tunnel) or laptop, volume up, trusted family contact filled in under Settings, language set to Telugu for the spoken warning.

1. **Hook (20 s).** "This scam has a script. Our AI knows the script." Show one news headline (₹1,935 cr lost to digital-arrest scams in 2024, MHA reply in Rajya Sabha, March 2025).
2. **Live attack (90 s).** Source: Microphone (or Demo scenario "Inspector Sharma" as the fallback). A teammate plays Inspector Sharma on speaker, following `scenarios/inspector_sharma.json`. Point at the meter: authority chip, then "don't tell your family" (secrecy chip, warning), then "digital arrest" (spoken warning), then "RBI safe account" (CRITICAL, hard rule). Show the family WhatsApp alert.
3. **False-positive proof (30 s).** Run "Genuine bank fraud-team call". It mentions OTP, bank and a transaction, and the meter stays at 0.
4. **Incident report (20 s).** Badge number, FIR number, UPI ID and AnyDesk extracted into a complaint ready for 1930.
5. **Numbers and scale (20 s).** Eval table from `backend/eval/results/RESULTS.md` (re-run on a held-out set first), then the roadmap: on-device model, OEM dialer, telecom and bank integration.

Backup: if the mic or Wi-Fi fails, switch the source to Demo scenario. It runs the same detection code.

## Judge questions

- **"Can't the scammer avoid keywords?"** L2 matches meaning, not words (the eval has a paraphrased call with no keywords), and the scam must eventually ask for secrecy or money.
- **"False alarms on real police or banks?"** Genuine-call language actively lowers the score; the eval includes bank fraud teams, passport police and a police cyber-awareness talk. The app only advises.
- **"How does it hear the call?"** Android blocks third-party apps from recording the other side of a cellular call. Digital-arrest scams usually run on WhatsApp/Skype video on speaker, so we listen through the mic, from the same or a second device. Production path: OEM dialer or telecom network-side integration.
- **"Privacy?"** Opt-in per call, no audio stored, transcript only if the user keeps the report, on-device roadmap.
- **"Latency and cost?"** L1 and L2 run locally in milliseconds; the LLM runs at most every ~12 seconds.
