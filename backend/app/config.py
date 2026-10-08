"""Settings from environment (and an optional backend/.env file)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = BACKEND_DIR.parent


def _load_dotenv() -> None:
    for path in (BACKEND_DIR / ".env", ROOT_DIR / ".env"):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()


@dataclass(frozen=True)
class Settings:
    # L2 semantic backend: auto (sentence-transformers if installed) | st | ngram
    embed_backend: str = os.getenv("EMBED_BACKEND", "auto")
    embed_model: str = os.getenv("EMBED_MODEL", "sentence-transformers/paraphrase-multilingual-mpnet-base-v2")
    # STT: whisper | sarvam | none  (browser speech recognition and demo scenarios send text instead)
    stt_backend: str = os.getenv("STT_BACKEND", "whisper")
    whisper_model: str = os.getenv("WHISPER_MODEL", "small")
    whisper_device: str = os.getenv("WHISPER_DEVICE", "cpu")
    whisper_compute: str = os.getenv("WHISPER_COMPUTE", "int8")
    # L3 pacing (free keys have daily caps): a routine check every LLM_INTERVAL_S, sooner when L1/L2
    # flag something but never within LLM_MIN_GAP_S of the last call. Plus the transcript window it sees.
    llm_interval_s: float = float(os.getenv("LLM_INTERVAL_S", "20"))
    llm_min_gap_s: float = float(os.getenv("LLM_MIN_GAP_S", "15"))  # Groq free: ~1000 output tokens/min ≈ 4 calls
    llm_window_s: float = float(os.getenv("LLM_WINDOW_S", "120"))
    db_path: str = os.getenv("DB_PATH", str(BACKEND_DIR / "data" / "incidents.db"))
    frontend_dist: str = os.getenv("FRONTEND_DIST", str(ROOT_DIR / "frontend" / "dist"))
    # Server-side incident store. Off by default: the PWA keeps reports on the device, and a
    # shared server list would show every visitor's reports to everyone on a public deploy.
    store_incidents: bool = os.getenv("STORE_INCIDENTS", "0") == "1"
    # Limits for a public deploy: Whisper on a small CPU box only serves a few live calls at once.
    max_sessions: int = int(os.getenv("MAX_SESSIONS", "6"))
    max_session_s: float = float(os.getenv("MAX_SESSION_S", "1200"))
    max_text_chars: int = int(os.getenv("MAX_TEXT_CHARS", "1000"))
    analyze_per_min: int = int(os.getenv("ANALYZE_PER_MIN", "10"))
    # Extra origins allowed to call the API cross-site (comma-separated). The PWA is same-origin.
    cors_origins: tuple[str, ...] = tuple(o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip())


settings = Settings()
