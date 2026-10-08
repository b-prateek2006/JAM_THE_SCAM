"""SQLite incident store. Audio is never stored; the transcript only if the user keeps it."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS incidents (
    call_id      TEXT PRIMARY KEY,
    started_at   TEXT NOT NULL,
    caller       TEXT,
    peak_score   INTEGER,
    peak_level   INTEGER,
    report_json  TEXT NOT NULL,
    transcript   TEXT
);
"""


class IncidentStore:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self._conn() as c:
            c.executescript(SCHEMA)

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path)

    def save(self, report: dict, transcript: list[dict] | None = None) -> None:
        with self._conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO incidents VALUES (?,?,?,?,?,?,?)",
                (report["call_id"], report["started_at"], report.get("caller_number", ""),
                 report["peak_score"], report["peak_level"], json.dumps(report, ensure_ascii=False),
                 json.dumps(transcript, ensure_ascii=False) if transcript else None),
            )

    def list(self, limit: int = 50) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT call_id, started_at, caller, peak_score, peak_level FROM incidents ORDER BY started_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(zip(["call_id", "started_at", "caller", "peak_score", "peak_level"], r)) for r in rows]

    def get(self, call_id: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT report_json, transcript FROM incidents WHERE call_id=?", (call_id,)).fetchone()
        if not row:
            return None
        report = json.loads(row[0])
        report["transcript"] = json.loads(row[1]) if row[1] else None
        return report

    def delete(self, call_id: str) -> bool:
        with self._conn() as c:
            return c.execute("DELETE FROM incidents WHERE call_id=?", (call_id,)).rowcount > 0
