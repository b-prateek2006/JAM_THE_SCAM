# Jam the Scam: evaluation results (held-out set)

Held-out scripts: written after tuning and never used to adjust the lexicon or libraries. 

Scripts: 10 scam calls, 10 benign hard negatives. L2 backend: `st:paraphrase-multilingual-mpnet-base-v2`. L3: `groq:qwen/qwen3.8-27b`. Alert = Level 2 (WARNING, score ≥ 65) or higher.

| Configuration | Scam calls caught | False alerts on benign | Precision | Median time to alert | Median lead before money ask | Alerted before money ask |
|---|---|---|---|---|---|---|
| L1 rules only | 3/10 (30%) | 0/10 (+0 cautions) | 100% | 25s | 0s | 1/3 |
| L1 + L2 semantic | 9/10 (90%) | 1/10 (+0 cautions) | 90% | 23s | 0s | 2/9 |
| L1 + L2 + L3 LLM | 10/10 (100%) | 1/10 (+0 cautions) | 91% | 17s | 8s | 9/10 |

## Per-call detail (L1 + L2 + L3 LLM)

| Call | Kind | Lang | Peak | Level | Alert at | Money ask at | Tactics |
|---|---|---|---|---|---|---|---|
| कस्टम्स अधिकारी, वीडियो कॉल पर पैसे की मांग | scam | hi | 100 | 3 | 11.0 | 20.0 | ACCUSATION, AUTHORITY, REMOTE_ACCESS, ARREST_THREAT, MONEY_ASK, ISOLATION |
| Mee ammayi case lo pattubadindi (romanised Telugu) | scam | te | 100 | 3 | 17.0 | 23.0 | AUTHORITY, ISOLATION, ACCUSATION, URGENCY, CREDENTIAL |
| DoT KYC: number to be disconnected, then 'cyber police' | scam | en | 100 | 3 | 17.0 | 32.0 | AUTHORITY, URGENCY, ACCUSATION, ISOLATION, REMOTE_ACCESS, MONEY_ASK |
| ED: your account was used as a money mule | scam | en | 100 | 3 | 15.0 | 23.0 | AUTHORITY, ACCUSATION, ISOLATION, MONEY_ASK, ARREST_THREAT |
| Income tax 'refund' needs your OTP, then penalty threat | scam | en | 95 | 3 | 0.0 | 9.0 | AUTHORITY, MONEY_ASK, CREDENTIAL |
| 'Online court hearing' with a judge, bail by UPI | scam | en | 100 | 3 | 19.0 | 27.0 | AUTHORITY, ACCUSATION, ISOLATION, MONEY_ASK |
| Package with illegal items, paraphrased (few keywords) | scam | en | 100 | 3 | 18.0 | 26.0 | ACCUSATION, ARREST_THREAT, ISOLATION, AUTHORITY, URGENCY, MONEY_ASK |
| Mumbai police, Skype par aao, FIR ka darr | scam | hi | 100 | 3 | 18.0 | 26.0 | AUTHORITY, ACCUSATION, ISOLATION, REMOTE_ACCESS, ARREST_THREAT, MONEY_ASK |
| RBI అధికారి: ఖాతా ఫ్రీజ్, సేఫ్ అకౌంట్‌కు డబ్బు | scam | te | 100 | 3 | 11.0 | 19.0 | ACCUSATION, AUTHORITY, ISOLATION, MONEY_ASK, ARREST_THREAT, URGENCY |
| Stock tips group turns into a 'SEBI' arrest threat | scam | en | 100 | 3 | 25.0 | 25.0 | ARREST_THREAT, ISOLATION, URGENCY, MONEY_ASK, AUTHORITY, ACCUSATION |
| Bank asks you to update KYC at the branch | benign | en | 0 | 0 | - | - |  |
| Cab driver asks for the ride OTP at pickup | benign | en | 0 | 0 | - | - |  |
| Credit card sales call with a 'today only' offer | benign | en | 0 | 0 | - | - |  |
| Real cyber police follow-up on a complaint you filed | benign | en | 34 | 0 | - | - | AUTHORITY, ARREST_THREAT |
| Friend asks to return borrowed money (romanised Telugu) | benign | te | 0 | 0 | - | - |  |
| ఆసుపత్రి అపాయింట్‌మెంట్ రిమైండర్ | benign | te | 0 | 0 | - | - |  |
| Courier scheduling delivery of a legal notice in person | benign | en | 12 | 0 | - | - | AUTHORITY |
| गैस सिलेंडर बुकिंग की पुष्टि, डिलीवरी OTP | benign | hi | 0 | 0 | - | - |  |
| School accounts office: term fee reminder | benign | en | 0 | 0 | - | - |  |
| Police tenant verification, thane aana hai | benign | hi | 95 | 3 | 18.0 | - | AUTHORITY, ISOLATION, CREDENTIAL |

Scripts are written from patterns in public police advisories and news reports; they are not real call recordings. Text-level results: speech-to-text errors are not included.
