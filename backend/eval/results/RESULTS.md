# Jam the Scam: evaluation results

Scripts: 15 scam calls, 15 benign hard negatives. L2 backend: `st:paraphrase-multilingual-mpnet-base-v2`. L3: `off`. Alert = Level 2 (WARNING, score ≥ 65) or higher.

| Configuration | Scam calls caught | False alerts on benign | Precision | Median time to alert | Median lead before money ask | Alerted before money ask |
|---|---|---|---|---|---|---|
| L1 rules only | 11/15 (73%) | 0/15 (+0 cautions) | 100% | 19s | 0s | 1/11 |
| L1 + L2 semantic | 15/15 (100%) | 0/15 (+1 cautions) | 100% | 18s | 7s | 9/15 |

## Per-call detail (L1 + L2 semantic)

| Call | Kind | Lang | Peak | Level | Alert at | Money ask at | Tactics |
|---|---|---|---|---|---|---|---|
| Aadhaar misuse, Devanagari | scam | hi | 100 | 3 | 5.0 | 18.0 | AUTHORITY, ACCUSATION, MONEY_ASK, ARREST_THREAT, ISOLATION |
| Aadhaar money laundering | scam | en | 100 | 3 | 24.0 | 37.0 | AUTHORITY, ACCUSATION, ISOLATION, REMOTE_ACCESS, ARREST_THREAT, MONEY_ASK |
| CBI officer, romanised Hindi | scam | hi | 91 | 3 | 13.0 | 19.0 | AUTHORITY, ACCUSATION, ARREST_THREAT, ISOLATION, CREDENTIAL |
| Courier drugs, Hinglish | scam | hi | 100 | 3 | 18.0 | 35.0 | ACCUSATION, AUTHORITY, ARREST_THREAT, ISOLATION, URGENCY, CREDENTIAL, MONEY_ASK |
| Customs gift parcel fee | scam | en | 95 | 3 | 17.0 | 17.0 | AUTHORITY, ARREST_THREAT, MONEY_ASK |
| Enforcement Directorate digital custody | scam | en | 100 | 3 | 14.0 | 21.0 | AUTHORITY, ACCUSATION, ARREST_THREAT, ISOLATION, REMOTE_ACCESS, MONEY_ASK |
| Paraphrased scam, few keywords | scam | en | 100 | 3 | 20.0 | 27.0 | AUTHORITY, ACCUSATION, ISOLATION, ARREST_THREAT, MONEY_ASK |
| DHL parcel held at customs | scam | en | 100 | 3 | 40.0 | 40.0 | ACCUSATION, AUTHORITY, ISOLATION, MONEY_ASK |
| Fake cyber police, screen share | scam | en | 100 | 3 | 6.0 | 6.0 | AUTHORITY, REMOTE_ACCESS, ISOLATION, CREDENTIAL |
| Slow burn, money ask late | scam | en | 100 | 3 | 35.0 | 35.0 | AUTHORITY, ACCUSATION, ISOLATION, MONEY_ASK |
| Your son is arrested | scam | en | 100 | 3 | 23.0 | 23.0 | AUTHORITY, ACCUSATION, ISOLATION, MONEY_ASK |
| Telugu/English code-mixed ED call | scam | te | 97 | 3 | 19.0 | 19.0 | ACCUSATION, ISOLATION, ARREST_THREAT, REMOTE_ACCESS |
| Telugu parcel scam | scam | te | 100 | 3 | 11.0 | 23.0 | AUTHORITY, ACCUSATION, ARREST_THREAT, ISOLATION, MONEY_ASK |
| Romanised Telugu police | scam | te | 100 | 3 | 12.0 | 24.0 | AUTHORITY, ACCUSATION, ISOLATION, ARREST_THREAT, MONEY_ASK |
| TRAI SIM block | scam | en | 100 | 3 | 21.0 | 34.0 | AUTHORITY, ACCUSATION, ISOLATION, CREDENTIAL |
| Bank fraud team verifying a transaction | benign | en | 0 | 0 | - | - |  |
| Bank fraud team, Hinglish | benign | hi | 15 | 0 | - | - | URGENCY, CREDENTIAL |
| Customer care, cancellation OTP in app | benign | en | 0 | 0 | - | - |  |
| Police cyber-awareness talk (lots of keywords) | benign | en | 9 | 0 | - | - | AUTHORITY |
| Delivery agent, Devanagari | benign | hi | 0 | 0 | - | - |  |
| Delivery agent asking for delivery OTP | benign | en | 0 | 0 | - | - |  |
| Clinic appointment | benign | en | 0 | 0 | - | - |  |
| Electricity bill reminder, Hinglish | benign | hi | 62 | 1 | - | - | ISOLATION, URGENCY, CREDENTIAL |
| EMI bounce notice | benign | en | 0 | 0 | - | - |  |
| Insurance renewal reminder | benign | en | 0 | 0 | - | - |  |
| Genuine passport verification | benign | en | 0 | 0 | - | - |  |
| Relative urgently asking for money | benign | en | 0 | 0 | - | - |  |
| Telugu bank fraud team | benign | te | 8 | 0 | - | - | ACCUSATION |
| Telugu delivery call | benign | te | 0 | 0 | - | - |  |
| Telugu relative asking for money | benign | te | 16 | 0 | - | - | URGENCY, CREDENTIAL |

Scripts are written from patterns in public police advisories and news reports; they are not real call recordings. Text-level results: speech-to-text errors are not included.
