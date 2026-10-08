"""Family alert at level 3: Twilio SMS when configured, plus a WhatsApp click-to-chat link always.

SMS only goes to numbers listed in SMS_ALLOWLIST (comma-separated, or * for any number), so a
public demo can't be used to text arbitrary numbers. Everyone else gets the WhatsApp link.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime
from urllib.parse import quote

import httpx

log = logging.getLogger(__name__)


def family_message(user_name: str, caller: str, tactics: list[str], lang: str = "en") -> str:
    when = datetime.now().strftime("%H:%M")
    who = user_name or "Your family member"
    caller_txt = f" from {caller}" if caller else ""
    tactic_txt = ", ".join(t.replace("_", " ").lower() for t in tactics[:4])
    return (f"Jam the Scam alert: {who} may be on a scam call right now{caller_txt} (since {when}). "
            f"Detected: {tactic_txt}. Please call them immediately.")


def normalise_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 10:
        digits = "91" + digits
    return digits


def whatsapp_link(phone: str, text: str) -> str:
    return f"https://wa.me/{normalise_phone(phone)}?text={quote(text)}"


def sms_allowed(phone: str) -> bool:
    allow = [p.strip() for p in os.getenv("SMS_ALLOWLIST", "").split(",") if p.strip()]
    return "*" in allow or normalise_phone(phone) in {normalise_phone(p) for p in allow}


async def send_sms(phone: str, text: str) -> dict:
    """Send via Twilio if TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM are set and the number is allowed."""
    sid, token, sender = (os.getenv(k) for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"))
    if not (sid and token and sender and phone):
        return {"sent": False, "reason": "sms not configured"}
    if not sms_allowed(phone):
        return {"sent": False, "reason": "number not in SMS_ALLOWLIST"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                auth=(sid, token),
                data={"To": "+" + normalise_phone(phone), "From": sender, "Body": text},
            )
            r.raise_for_status()
            return {"sent": True, "provider": "twilio", "id": r.json().get("sid")}
    except Exception as e:
        log.warning("family SMS failed: %s", e)
        return {"sent": False, "reason": str(e)}
