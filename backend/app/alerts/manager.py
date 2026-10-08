"""Alert manager (deep-dive section 4.6): three levels with hysteresis.

Each level fires once per call and never flickers back down. Level 3 also
fires immediately when a hard rule trips, whatever the smoothed score.
"""
from __future__ import annotations

from dataclasses import dataclass

from ..detection.tactics import (
    ACCUSATION, ARREST_THREAT, AUTHORITY, CREDENTIAL, ISOLATION, MONEY_ASK, REMOTE_ACCESS,
)

LEVEL_THRESHOLDS = {1: 40, 2: 65, 3: 85}
LEVEL_NAMES = {0: "SAFE", 1: "CAUTION", 2: "WARNING", 3: "CRITICAL"}

# Spoken at levels 2 and 3. Short on purpose: the user hears this mid-call.
SPOKEN = {
    2: {
        "en": "Warning. This is a known scam pattern. Hang up now.",
        "hi": "सावधान. यह एक जाना-पहचाना धोखा है. अभी फ़ोन काट दीजिए.",
        "te": "జాగ్రత్త. ఇది మోసపూరిత కాల్. వెంటనే కాల్ కట్ చేయండి.",
    },
    3: {
        "en": "Danger. This is a fraud call. Do not send any money. Hang up immediately.",
        "hi": "खतरा. यह धोखाधड़ी की कॉल है. कोई पैसा मत भेजिए. तुरंत फ़ोन काटिए.",
        "te": "ప్రమాదం. ఇది మోసపూరిత కాల్. డబ్బు పంపకండి. వెంటనే కాల్ కట్ చేయండి.",
    },
}

# Level-1 banner: explain the specific tactic we saw.
FACTS = {
    AUTHORITY: {
        "en": "The caller claims to be an officer. Real police never arrest or question anyone over a video call.",
        "hi": "कॉलर खुद को अधिकारी बता रहा है. असली पुलिस कभी वीडियो कॉल पर गिरफ्तारी या पूछताछ नहीं करती.",
        "te": "కాలర్ తాను అధికారి అని చెబుతున్నాడు. నిజమైన పోలీసులు వీడియో కాల్‌లో ఎప్పుడూ అరెస్ట్ చేయరు.",
    },
    ISOLATION: {
        "en": "The caller wants you to keep this secret. Real officials never ask you to hide things from your family.",
        "hi": "कॉलर इसे गुप्त रखने को कह रहा है. असली अधिकारी कभी परिवार से बात छिपाने को नहीं कहते.",
        "te": "కాలర్ దీన్ని రహస్యంగా ఉంచమంటున్నాడు. నిజమైన అధికారులు కుటుంబానికి చెప్పవద్దని ఎప్పుడూ అనరు.",
    },
    ARREST_THREAT: {
        "en": "\"Digital arrest\" does not exist in Indian law. No one can arrest you over a phone call.",
        "hi": "भारतीय कानून में \"डिजिटल अरेस्ट\" जैसा कुछ नहीं है. फ़ोन पर कोई गिरफ्तार नहीं कर सकता.",
        "te": "భారత చట్టంలో \"డిజిటల్ అరెస్ట్\" అనేది లేదు. ఫోన్‌లో ఎవరూ మిమ్మల్ని అరెస్ట్ చేయలేరు.",
    },
    ACCUSATION: {
        "en": "Scammers often start by accusing you of a crime. Do not panic, and do not share details.",
        "hi": "धोखेबाज़ अक्सर किसी अपराध का आरोप लगाकर शुरू करते हैं. घबराइए मत, कोई जानकारी मत दीजिए.",
        "te": "మోసగాళ్లు తరచుగా నేరం ఆరోపణతో మొదలుపెడతారు. భయపడకండి, వివరాలు చెప్పకండి.",
    },
    MONEY_ASK: {
        "en": "No government agency asks you to transfer money for \"verification\". Do not send money.",
        "hi": "कोई भी सरकारी एजेंसी \"वेरिफिकेशन\" के लिए पैसे नहीं मांगती. पैसे मत भेजिए.",
        "te": "ఏ ప్రభుత్వ సంస్థ \"వెరిఫికేషన్\" కోసం డబ్బు అడగదు. డబ్బు పంపకండి.",
    },
    REMOTE_ACCESS: {
        "en": "Never install AnyDesk or share your screen with a caller. They can empty your account.",
        "hi": "कॉलर के कहने पर AnyDesk इंस्टॉल मत कीजिए, स्क्रीन शेयर मत कीजिए.",
        "te": "కాలర్ చెప్పినా AnyDesk ఇన్‌స్టాల్ చేయకండి, స్క్రీన్ షేర్ చేయకండి.",
    },
    CREDENTIAL: {
        "en": "Never share an OTP, PIN or CVV with anyone on a call.",
        "hi": "कॉल पर किसी को भी OTP, PIN या CVV मत बताइए.",
        "te": "కాల్‌లో ఎవరికీ OTP, PIN లేదా CVV చెప్పకండి.",
    },
}

DEFAULT_FACT = {
    "en": "This call shows signs of a scam script. Be careful.",
    "hi": "इस कॉल में धोखाधड़ी के संकेत हैं. सावधान रहिए.",
    "te": "ఈ కాల్‌లో మోసం సంకేతాలు ఉన్నాయి. జాగ్రత్తగా ఉండండి.",
}

FACT_PRIORITY = [MONEY_ASK, REMOTE_ACCESS, CREDENTIAL, ARREST_THREAT, ISOLATION, AUTHORITY, ACCUSATION]


@dataclass
class Alert:
    level: int
    name: str
    message: str
    spoken: str
    family_alert: bool


def level_for(score: float, hard_rule: bool) -> int:
    if hard_rule:
        return 3
    level = 0
    for lv, th in LEVEL_THRESHOLDS.items():
        if score >= th:
            level = lv
    return level


def fact_for(tactics: list[str], lang: str) -> str:
    for t in FACT_PRIORITY:
        if t in tactics:
            return FACTS[t].get(lang, FACTS[t]["en"])
    return DEFAULT_FACT.get(lang, DEFAULT_FACT["en"])


class AlertManager:
    def __init__(self, lang: str = "en"):
        self.lang = lang
        self.level = 0

    def update(self, score: float, hard_rule: bool, tactics: list[str], llm_explanation: str = "") -> Alert | None:
        new_level = level_for(score, hard_rule)
        if new_level <= self.level:
            return None  # hysteresis: each level fires once, never steps down
        self.level = new_level
        message = llm_explanation or fact_for(tactics, self.lang)
        spoken = SPOKEN.get(new_level, {}).get(self.lang, "") if new_level >= 2 else ""
        return Alert(new_level, LEVEL_NAMES[new_level], message, spoken, family_alert=new_level == 3)
