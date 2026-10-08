"""Tactic taxonomy and the 5-stage digital-arrest script model."""

AUTHORITY = "AUTHORITY"
ACCUSATION = "ACCUSATION"
ARREST_THREAT = "ARREST_THREAT"
ISOLATION = "ISOLATION"
URGENCY = "URGENCY"
MONEY_ASK = "MONEY_ASK"
REMOTE_ACCESS = "REMOTE_ACCESS"
CREDENTIAL = "CREDENTIAL"

TACTICS = [AUTHORITY, ACCUSATION, ARREST_THREAT, ISOLATION, URGENCY, MONEY_ASK, REMOTE_ACCESS, CREDENTIAL]

# Risk contribution of each tactic at full confidence.
WEIGHTS = {
    AUTHORITY: 15,
    ACCUSATION: 15,
    ARREST_THREAT: 20,
    ISOLATION: 20,
    URGENCY: 10,
    MONEY_ASK: 30,
    REMOTE_ACCESS: 30,
    CREDENTIAL: 25,
}

# Which stage of the script each tactic belongs to.
# 1 Hook, 2 Authority, 3 Isolation, 4 Urgency/threat, 5 Extraction.
STAGE_OF = {
    ACCUSATION: 1,
    AUTHORITY: 2,
    ISOLATION: 3,
    ARREST_THREAT: 4,
    URGENCY: 4,
    MONEY_ASK: 5,
    REMOTE_ACCESS: 5,
    CREDENTIAL: 5,
}

STAGE_NAMES = {0: "None", 1: "Hook", 2: "Authority", 3: "Isolation", 4: "Urgency", 5: "Extraction"}

LABELS = {
    "en": {
        AUTHORITY: "Authority claim",
        ACCUSATION: "Accusation",
        ARREST_THREAT: "Arrest threat",
        ISOLATION: "Secrecy demand",
        URGENCY: "Time pressure",
        MONEY_ASK: "Money transfer ask",
        REMOTE_ACCESS: "Remote-access app",
        CREDENTIAL: "OTP / PIN request",
    },
    "hi": {
        AUTHORITY: "अधिकारी होने का दावा",
        ACCUSATION: "झूठा आरोप",
        ARREST_THREAT: "गिरफ्तारी की धमकी",
        ISOLATION: "गोपनीयता की मांग",
        URGENCY: "जल्दबाज़ी का दबाव",
        MONEY_ASK: "पैसे भेजने की मांग",
        REMOTE_ACCESS: "रिमोट ऐप",
        CREDENTIAL: "OTP / PIN की मांग",
    },
    "te": {
        AUTHORITY: "అధికారి అని చెప్పడం",
        ACCUSATION: "తప్పుడు ఆరోపణ",
        ARREST_THREAT: "అరెస్ట్ బెదిరింపు",
        ISOLATION: "రహస్యంగా ఉంచమనడం",
        URGENCY: "తొందర పెట్టడం",
        MONEY_ASK: "డబ్బు పంపమనడం",
        REMOTE_ACCESS: "రిమోట్ యాప్",
        CREDENTIAL: "OTP / PIN అడగడం",
    },
}
