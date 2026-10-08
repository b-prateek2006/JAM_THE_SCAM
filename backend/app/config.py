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
    # How often L3 runs at most, and the transcript window it sees.
    llm_interval_s: float = float(os.getenv("LLM_INTERVAL_S", "12"))
    llm_window_s: float = float(os.getenv("LLM_WINDOW_S", "120"))
    db_path: str = os.getenv("DB_PATH", str(BACKEND_DIR / "data" / "incidents.db"))
    frontend_dist: str = os.getenv("FRONTEND_DIST", str(ROOT_DIR / "frontend" / "dist"))


settings = Settings()
