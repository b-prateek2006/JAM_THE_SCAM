"""Pull complaint-worthy entities out of the call transcript.

Regex-based so it works offline; the LLM layer can enrich it later.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

PHONE = re.compile(r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)")
UPI = re.compile(r"\b[a-zA-Z0-9.\-_]{2,64}@(?:ok)?[a-zA-Z]{2,20}\b(?!\.[a-z])")
IFSC = re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b")
ACCOUNT = re.compile(r"(?:account|a/c|khata|ఖాతా|खाता)\D{0,25}(\d[\d\s-]{8,20}\d)", re.IGNORECASE)
# The (?<![\d,]) keeps the bare "5 lakh" branch from retrying at every digit of a long number,
# which made extraction quadratic (seconds on a long digit run, blocking the event loop).
AMOUNT = re.compile(r"(?:rs\.?|₹|inr|rupees)\s?([\d,]+(?:\.\d+)?\s?(?:lakh|lakhs|crore|thousand|k)?)|(?<![\d,])([\d,]+\s?(?:lakh|lakhs|crore))\s?(?:rupees)?", re.IGNORECASE)
BADGE = re.compile(r"(?:badge|employee|officer|id)\s*(?:number|no\.?|id)?\s*(?:is\s*)?[:#]?\s*([A-Z0-9][A-Z0-9/-]{2,15})", re.IGNORECASE)
FIR = re.compile(r"(?:fir|case|complaint)\s*(?:number|no\.?)\s*(?:is\s*)?[:#]?\s*([A-Z0-9][A-Z0-9/-]{2,25})", re.IGNORECASE)
NAME = re.compile(
    r"(?:[Ii] am|[Ii]'m|[Tt]his is|[Mm]y name is|[Mm]ain|[Mm]era naam)\s+"
    r"((?i:inspector|sub[- ]inspector|officer|constable|dcp|acp|sp|mr\.?|mrs\.?|dr\.?)?\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)",
)
NOT_NAMES = {"delhi", "mumbai", "hyderabad", "bangalore", "bengaluru", "chennai", "kolkata", "calling", "speaking",
             "from", "the", "fedex", "dhl", "trai", "customs"}
AGENCIES = [
    "CBI", "Enforcement Directorate", "ED", "Narcotics Control Bureau", "NCB", "Customs", "Cyber Crime",
    "Cyber Cell", "Crime Branch", "TRAI", "RBI", "Reserve Bank", "Income Tax", "Supreme Court", "Mumbai Police",
    "Delhi Police", "Hyderabad Police", "FedEx", "DHL", "Interpol",
]
CANONICAL = {"fedex": "FedEx", "dhl": "DHL", "ed": "ED", "rbi": "RBI", "trai": "TRAI", "cbi": "CBI", "ncb": "NCB"}
AGENCY_RX = re.compile(r"\b(" + "|".join(re.escape(a) for a in AGENCIES) + r")\b", re.IGNORECASE)
APPS = re.compile(r"\b(any ?desk|team ?viewer|quick ?support|skype|whatsapp)\b", re.IGNORECASE)
EMAIL_DOMAINS = ("gmail", "yahoo", "outlook", "hotmail")


@dataclass
class Entities:
    claimed_names: list[str] = field(default_factory=list)
    agencies: list[str] = field(default_factory=list)
    phone_numbers: list[str] = field(default_factory=list)
    upi_ids: list[str] = field(default_factory=list)
    bank_accounts: list[str] = field(default_factory=list)
    ifsc_codes: list[str] = field(default_factory=list)
    badge_numbers: list[str] = field(default_factory=list)
    fir_numbers: list[str] = field(default_factory=list)
    amounts: list[str] = field(default_factory=list)
    apps_mentioned: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _add(lst: list[str], val: str) -> None:
    val = val.strip(" .,")
    if val and val.lower() not in (x.lower() for x in lst):
        lst.append(val)


def extract(text: str) -> Entities:
    e = Entities()
    for m in NAME.finditer(text):
        name = m.group(1).strip()
        words = name.lower().split()
        if len(name) > 2 and words[-1] not in NOT_NAMES and words[0] not in NOT_NAMES:
            _add(e.claimed_names, name)
    for m in AGENCY_RX.finditer(text):
        _add(e.agencies, CANONICAL.get(m.group(1).lower(), m.group(1).upper() if len(m.group(1)) <= 4 else m.group(1).title()))
    for m in PHONE.finditer(text):
        _add(e.phone_numbers, re.sub(r"[\s-]", "", m.group(0)))
    for m in UPI.finditer(text):
        handle = m.group(0)
        if not any(handle.lower().split("@")[1].startswith(d) for d in EMAIL_DOMAINS):
            _add(e.upi_ids, handle)
    for m in IFSC.finditer(text):
        _add(e.ifsc_codes, m.group(0))
    for m in ACCOUNT.finditer(text):
        digits = re.sub(r"\D", "", m.group(1))
        if 9 <= len(digits) <= 18:
            _add(e.bank_accounts, digits)
    for m in BADGE.finditer(text):
        if any(c.isdigit() for c in m.group(1)):
            _add(e.badge_numbers, m.group(1))
    for m in FIR.finditer(text):
        if any(c.isdigit() for c in m.group(1)):
            _add(e.fir_numbers, m.group(1))
    for m in AMOUNT.finditer(text):
        _add(e.amounts, (m.group(1) or m.group(2) or "").strip())
    for m in APPS.finditer(text):
        _add(e.apps_mentioned, m.group(1))
    # A number that is a bank account isn't also a phone number.
    e.phone_numbers = [p for p in e.phone_numbers if re.sub(r"\D", "", p)[-10:] not in "".join(e.bank_accounts)]
    return e
