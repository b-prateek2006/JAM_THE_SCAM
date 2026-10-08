"""Incident report + pre-filled complaint for 1930 / cybercrime.gov.in / Sanchar Saathi Chakshu."""
from __future__ import annotations

from datetime import datetime

from ..detection.tactics import LABELS, STAGE_NAMES
from .extract import Entities


def _fmt_t(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    return f"{m:02d}:{s:02d}"


def build_report(*, call_id: str, started_at: datetime, duration_s: float, caller_number: str,
                 peak_score: float, peak_level: int, tactics: dict, entities: Entities,
                 timeline: list[dict], lang: str = "en") -> dict:
    labels = LABELS.get(lang, LABELS["en"])
    tactic_rows = sorted(
        ({"type": t, "label": labels.get(t, t), "evidence": v["evidence"], "at": _fmt_t(v["first_t"]),
          "confidence": round(v["confidence"], 2)} for t, v in tactics.items()),
        key=lambda r: r["at"],
    )
    complaint = complaint_text(started_at=started_at, duration_s=duration_s, caller_number=caller_number,
                               tactic_rows=tactic_rows, entities=entities)
    return {
        "call_id": call_id,
        "started_at": started_at.isoformat(timespec="seconds"),
        "duration": _fmt_t(duration_s),
        "caller_number": caller_number,
        "peak_score": round(peak_score),
        "peak_level": peak_level,
        "tactics": tactic_rows,
        "entities": entities.to_dict(),
        "timeline": timeline,
        "complaint_text": complaint,
        "report_to": [
            {"name": "National Cyber Crime Helpline", "contact": "1930"},
            {"name": "National Cyber Crime Reporting Portal", "contact": "https://cybercrime.gov.in"},
            {"name": "Sanchar Saathi - Chakshu (report fraud calls)", "contact": "https://sancharsaathi.gov.in"},
        ],
    }


def complaint_text(*, started_at: datetime, duration_s: float, caller_number: str,
                   tactic_rows: list[dict], entities: Entities) -> str:
    e = entities
    lines = [
        "Subject: Complaint about a fraudulent \"digital arrest\" / impersonation call",
        "",
        f"On {started_at.strftime('%d %B %Y')} at {started_at.strftime('%H:%M')}, I received a call"
        + (f" from {caller_number}" if caller_number else "")
        + f" that lasted about {max(1, round(duration_s / 60))} minute(s).",
    ]
    if e.claimed_names or e.agencies:
        who = ", ".join(e.claimed_names) or "The caller"
        agency = ", ".join(e.agencies)
        lines.append(f"{who} claimed to be from {agency or 'a government agency'}.")
    if tactic_rows:
        lines += ["", "What the caller said (with time into the call):"]
        for r in tactic_rows:
            lines.append(f"- [{r['at']}] {LABELS['en'].get(r['type'], r['type'])}: \"{r['evidence']}\"")
    details = [
        ("Phone numbers mentioned", e.phone_numbers),
        ("Badge / ID numbers given", e.badge_numbers),
        ("FIR / case numbers given", e.fir_numbers),
        ("UPI IDs given", e.upi_ids),
        ("Bank accounts given", e.bank_accounts),
        ("IFSC codes given", e.ifsc_codes),
        ("Amounts demanded", e.amounts),
        ("Apps I was asked to use", e.apps_mentioned),
    ]
    details = [(k, v) for k, v in details if v]
    if details:
        lines += ["", "Details the caller gave:"]
        lines += [f"- {k}: {', '.join(v)}" for k, v in details]
    lines += ["", "I request that action be taken against these numbers and accounts.",
              "This report was prepared with the Jam the Scam app."]
    return "\n".join(lines)


def timeline_entry(t: float, kind: str, text: str, **extra) -> dict:
    return {"at": _fmt_t(t), "t": round(t, 1), "kind": kind, "text": text, **extra}


__all__ = ["build_report", "complaint_text", "timeline_entry", "STAGE_NAMES"]
