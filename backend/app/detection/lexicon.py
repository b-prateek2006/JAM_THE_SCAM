"""Layer 1: fast multilingual rule lexicon.

Every pattern carries a strength. Weak patterns (a bank also says "OTP") only
*nominate* a tactic and need support from L2/L3 before they count. Strong
patterns ("digital arrest", "safe account", "AnyDesk") are specific enough to
count on their own.

Covers English, Hindi (Devanagari + romanised) and Telugu (script + romanised).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .tactics import (
    ACCUSATION, ARREST_THREAT, AUTHORITY, CREDENTIAL, ISOLATION, MONEY_ASK,
    REMOTE_ACCESS, URGENCY,
)

STRONG = 0.9
MEDIUM = 0.7
WEAK = 0.55

# (tactic, strength, pattern). Latin patterns get word boundaries added.
RAW_LEXICON: list[tuple[str, float, str]] = [
    # ---------------- AUTHORITY ----------------
    (AUTHORITY, MEDIUM, r"cbi"),
    (AUTHORITY, MEDIUM, r"central bureau of investigation"),
    (AUTHORITY, MEDIUM, r"enforcement directorate"),
    (AUTHORITY, MEDIUM, r"narcotics( control)?( bureau)?"),
    (AUTHORITY, MEDIUM, r"ncb"),
    (AUTHORITY, MEDIUM, r"customs (department|officer|office)"),
    (AUTHORITY, WEAK, r"customs"),
    (AUTHORITY, MEDIUM, r"cyber ?(crime|cell)"),
    (AUTHORITY, WEAK, r"police( station)?"),
    (AUTHORITY, WEAK, r"(senior|investigating|ips) officer"),
    (AUTHORITY, MEDIUM, r"(inspector|sub[- ]inspector|dcp|acp|sp) [a-z]+"),
    (AUTHORITY, MEDIUM, r"(badge|employee|officer) (number|no|id)"),
    (AUTHORITY, MEDIUM, r"fir (number|no)"),
    (AUTHORITY, WEAK, r"trai"),
    (AUTHORITY, WEAK, r"telecom regulatory"),
    (AUTHORITY, WEAK, r"rbi|reserve bank"),
    (AUTHORITY, MEDIUM, r"supreme court|high court|judge"),
    (AUTHORITY, MEDIUM, r"income tax (department|officer)"),
    (AUTHORITY, MEDIUM, r"(mumbai|delhi|hyderabad|bangalore|bengaluru) (police|crime branch|cyber)"),
    (AUTHORITY, MEDIUM, r"crime branch"),
    (AUTHORITY, MEDIUM, r"interpol"),
    (AUTHORITY, MEDIUM, "पुलिस"),
    (AUTHORITY, MEDIUM, "सीबीआई"),
    (AUTHORITY, MEDIUM, "अधिकारी"),
    (AUTHORITY, MEDIUM, "इंस्पेक्टर"),
    (AUTHORITY, MEDIUM, r"(main|mai|hum) .{0,25}(police|cbi|crime branch|customs) (se|say) (bol|baat)"),
    (AUTHORITY, MEDIUM, "పోలీస్"),
    (AUTHORITY, MEDIUM, "సీబీఐ"),
    (AUTHORITY, MEDIUM, "అధికారి"),
    (AUTHORITY, MEDIUM, "ఇన్స్పెక్టర్"),

    # ---------------- ACCUSATION ----------------
    (ACCUSATION, STRONG, r"money laundering"),
    (ACCUSATION, MEDIUM, r"hawala"),
    (ACCUSATION, STRONG, r"(contains?|containing|found|seized|mili?|mile) .{0,40}(drugs|mdma|narcotics|fake passports?|ganja)"),
    (ACCUSATION, MEDIUM, r"(parcel|package|courier) .{0,50}(stopped|seized|held|intercepted|blocked) .{0,20}(customs|airport)"),
    (ACCUSATION, STRONG, r"(parcel|package|courier).{0,40}(drugs|mdma|narcotics|fake passports?|illegal)"),
    (ACCUSATION, STRONG, r"(drugs|mdma|fake passports?).{0,40}(parcel|package|courier)"),
    (ACCUSATION, MEDIUM, r"aadhaa?r.{0,40}(misuse|linked|used|fraud|illegal|crime)"),
    (ACCUSATION, MEDIUM, r"(illegal|fraudulent) (sim|account|activities|transactions?)"),
    (ACCUSATION, MEDIUM, r"(your|aapka|aapke) name .{0,30}(case|investigation|complaint|fir)"),
    (ACCUSATION, MEDIUM, r"(case|complaint|fir) (is |has been )?(registered|filed|lodged) against you"),
    (ACCUSATION, MEDIUM, r"(sim|number) (will be|is being) (blocked|deactivated|suspended)"),
    (ACCUSATION, MEDIUM, r"sim .{0,30}(block|band) ho (jayega|jaega|jayegi)"),
    (ACCUSATION, MEDIUM, r"human trafficking|terror(ist)? funding"),
    (ACCUSATION, MEDIUM, r"(parcel|courier) (mein|me) (drugs|ganja)"),
    (ACCUSATION, MEDIUM, "मनी लॉन्ड्रिंग"),
    (ACCUSATION, MEDIUM, "ड्रग्स"),
    (ACCUSATION, MEDIUM, "आपके नाम"),
    (ACCUSATION, MEDIUM, "మనీ లాండరింగ్"),
    (ACCUSATION, MEDIUM, "డ్రగ్స్"),
    (ACCUSATION, MEDIUM, "మీ పేరు మీద"),

    # ---------------- ARREST_THREAT ----------------
    (ARREST_THREAT, STRONG, r"digital(ly)? arrest(ed)?"),
    (ARREST_THREAT, STRONG, r"arrest warrant"),
    (ARREST_THREAT, MEDIUM, r"(you|aap) (will|would|can) be arrested"),
    (ARREST_THREAT, MEDIUM, r"(we|i) (will|are going to) arrest"),
    (ARREST_THREAT, MEDIUM, r"non[- ]bailable"),
    (ARREST_THREAT, MEDIUM, r"(jail|prison)"),
    (ARREST_THREAT, MEDIUM, r"giraft?aa?r"),
    (ARREST_THREAT, MEDIUM, r"arrest (ho jaye?ga|kar(enge|na padega))"),
    (ARREST_THREAT, MEDIUM, r"(accounts?|bank accounts?) (will be )?(frozen|freeze|seized)"),
    (ARREST_THREAT, MEDIUM, "गिरफ्तार"),
    (ARREST_THREAT, MEDIUM, "वारंट"),
    (ARREST_THREAT, MEDIUM, "जेल"),
    (ARREST_THREAT, MEDIUM, "అరెస్ట్"),
    (ARREST_THREAT, MEDIUM, "వారెంట్"),
    (ARREST_THREAT, MEDIUM, "జైలు"),

    # ---------------- ISOLATION ----------------
    (ISOLATION, STRONG, r"(do ?n[o']?t|do not|never) (tell|inform|share this with) (anyone|anybody|your (family|wife|husband|son|daughter|children|relatives))"),
    (ISOLATION, STRONG, r"(don'?t|do not) (disconnect|cut|end|hang up)( the)?( call| video)?"),
    (ISOLATION, STRONG, r"stay on (the )?(video|call|line)"),
    (ISOLATION, MEDIUM, r"(strictly )?confidential( matter| investigation)?"),
    (ISOLATION, MEDIUM, r"national security"),
    (ISOLATION, MEDIUM, r"(go|sit|stay) (to|in) a (separate|closed|private) room"),
    (ISOLATION, MEDIUM, r"(keep|keeping) (this|it) (secret|confidential)"),
    (ISOLATION, STRONG, r"kisi(ko| ko) (bhi )?(mat|nahi|nahin) (batana|bataiye|bataye)"),
    (ISOLATION, MEDIUM, r"(call|phone) (mat|nahi) (katna|kaatna|kaatiye)"),
    (ISOLATION, STRONG, "किसी को मत बताना"),
    (ISOLATION, STRONG, "किसी को भी मत"),
    (ISOLATION, MEDIUM, "गोपनीय"),
    (ISOLATION, STRONG, "ఎవరికీ చెప్పకండి"),
    (ISOLATION, STRONG, "ఎవరికీ చెప్పొద్దు"),
    (ISOLATION, MEDIUM, "రహస్యం"),
    (ISOLATION, MEDIUM, "కాల్ కట్ చేయకండి"),
    (ISOLATION, STRONG, r"evvariki (cheppakandi|cheppoddu|cheppakudadhu)"),

    # ---------------- URGENCY ----------------
    (URGENCY, MEDIUM, r"within (the next )?(\d+|one|two|three|24) (hours?|minutes?)"),
    (URGENCY, WEAK, r"today itself|right now|immediately|urgent(ly)?"),
    (URGENCY, MEDIUM, r"(before|by) (\d+|[a-z]+) ?(pm|am|o'?clock)"),
    (URGENCY, WEAK, r"abhi( ke abhi)?|turant|jaldi"),
    (URGENCY, MEDIUM, r"(do|ek|teen|char|\d+) ghant(e|a|on) (mein|me|ke andar)"),
    (URGENCY, MEDIUM, r"(last|final) (warning|chance)"),
    (URGENCY, WEAK, "तुरंत"),
    (URGENCY, WEAK, "अभी"),
    (URGENCY, WEAK, "వెంటనే"),
    (URGENCY, WEAK, "ఇప్పుడే"),

    # ---------------- MONEY_ASK ----------------
    (MONEY_ASK, STRONG, r"(safe|secure|secret|government|rbi|verification|escrow|supervisory) (bank )?account"),
    (MONEY_ASK, STRONG, r"(verification|security|clearance|bail) (amount|money|deposit|fee)"),
    (MONEY_ASK, MEDIUM, r"(refundable|will be refunded|refund(ed)? after)"),
    (MONEY_ASK, MEDIUM, r"transfer (all )?(your |the )?(money|funds|amount|savings|balance)"),
    (MONEY_ASK, MEDIUM, r"(send|pay|deposit|transfer) (rs\.?|₹|inr)? ?\d[\d,]*"),
    (MONEY_ASK, MEDIUM, r"(liquidate|break) (your )?(fd|fixed deposits?|mutual funds?)"),
    (MONEY_ASK, WEAK, r"\btransfer\b|\bupi\b|\bneft\b|\brtgs\b|\bimps\b"),
    (MONEY_ASK, MEDIUM, r"paise? (bhej|transfer kar)"),
    (MONEY_ASK, STRONG, "सुरक्षित खाते"),
    (MONEY_ASK, MEDIUM, "पैसे ट्रांसफर"),
    (MONEY_ASK, MEDIUM, "पैसे भेज"),
    (MONEY_ASK, MEDIUM, "డబ్బు పంపండి"),
    (MONEY_ASK, MEDIUM, "డబ్బులు ట్రాన్స్ఫర్"),
    (MONEY_ASK, STRONG, "సురక్షిత ఖాతా"),
    (MONEY_ASK, MEDIUM, r"dabbu (pampandi|transfer cheyandi)"),

    # ---------------- REMOTE_ACCESS ----------------
    (REMOTE_ACCESS, STRONG, r"any ?desk|team ?viewer|quick ?support|rust ?desk|airdroid"),
    (REMOTE_ACCESS, STRONG, r"share (your )?screen|screen ?share"),
    (REMOTE_ACCESS, MEDIUM, r"(install|download) (this|the|an?) (app|application|apk)"),
    (REMOTE_ACCESS, MEDIUM, r"(skype|whatsapp) (video )?call"),

    # ---------------- CREDENTIAL ----------------
    (CREDENTIAL, WEAK, r"otp|one[- ]time password"),
    (CREDENTIAL, MEDIUM, r"(tell|read|share|give) (me )?(the |your )?(otp|code|pin|cvv|password)"),
    (CREDENTIAL, MEDIUM, r"\bcvv\b|\bupi pin\b|\batm pin\b|net ?banking password"),
    (CREDENTIAL, MEDIUM, r"(otp|code) (bata|batao|bataiye|boliye)"),
    (CREDENTIAL, WEAK, "ओटीपी"),
    (CREDENTIAL, WEAK, "ఓటీపీ"),
]

# Phrases genuine callers use. They lower risk instead of raising it, and they
# suppress weak CREDENTIAL / MONEY_ASK hits in the same sentence
# ("never share your OTP with anyone").
PROTECTIVE_PATTERNS = [
    r"(never|do ?n[o']?t|do not|should not|shouldn'?t) (share|tell|give|disclose)[^.?!]{0,30}(otp|pin|cvv|password|code)",
    r"(we|the bank|bank) (will )?never ask (you )?(for )?",
    r"(visit|come to) (your )?(nearest |home )?(branch|police station)",
    r"call (the|our) (official )?(number|helpline) (on|printed)",
    r"(did|have) you (make|made|authori[sz]e|do) (this|a|the) (transaction|payment)",
    r"(block|freeze) (your|the) card for (your )?safety",
    r"(cancel|cancellation) (of )?(your|the) order",
    r"(delivery|deliver) (your )?(order|parcel|package)",
    r"passport verification",
    r"ओटीपी किसी (को|से) (शेयर|साझा) (न|मत)",
    r"otp (kisi ko|kisiko) (mat|nahi|na) (batana|share)",
    r"ఓటీపీ ఎవరికీ (చెప్పకండి|ఇవ్వకండి)",
]

SUPPRESSIBLE = {CREDENTIAL, MONEY_ASK}


def _compile(pat: str) -> re.Pattern:
    if re.fullmatch(r"[\x00-\x7f]+", pat) and not pat.startswith(r"\b"):
        pat = rf"\b(?:{pat})\b"
    return re.compile(pat, re.IGNORECASE)


LEXICON = [(t, s, _compile(p)) for t, s, p in RAW_LEXICON]
PROTECTIVE = [re.compile(p, re.IGNORECASE) for p in PROTECTIVE_PATTERNS]

_SENT_SPLIT = re.compile(r"(?<=[.?!।])\s+|\n+")


@dataclass
class L1Hit:
    tactic: str
    strength: float
    evidence: str


def split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in _SENT_SPLIT.split(text) if p and p.strip()]
    return parts or ([text.strip()] if text.strip() else [])


def protective_score(text: str) -> float:
    """0..1: how strongly the text reads like a genuine, protective caller."""
    hits = sum(1 for p in PROTECTIVE if p.search(text))
    return min(1.0, 0.6 * hits)


def scan(text: str) -> tuple[dict[str, L1Hit], float]:
    """Return the strongest hit per tactic, plus a protective score."""
    best: dict[str, L1Hit] = {}
    prot_total = 0.0
    for sent in split_sentences(text):
        prot = protective_score(sent)
        prot_total = max(prot_total, prot)
        for tactic, strength, rx in LEXICON:
            m = rx.search(sent)
            if not m:
                continue
            s = strength
            if prot > 0 and tactic in SUPPRESSIBLE:
                s = 0.0  # "never share your OTP" is advice, not an ask
            if s <= 0:
                continue
            if tactic not in best or s > best[tactic].strength:
                best[tactic] = L1Hit(tactic, s, sent)
    return best, prot_total
