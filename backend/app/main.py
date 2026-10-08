"""FastAPI app: REST routes, the /ws/guard WebSocket, and the built PWA.

WebSocket protocol (client → server):
  {"type": "start", "lang": "en|hi|te", "user_name", "family_phone", "caller_number", "use_l2", "use_l3"}
  binary frames: 16 kHz mono int16 PCM (mic or an audio file streamed by the browser)
  {"type": "text", "text": "...", "speaker": "caller|user|unknown"}  (browser speech recognition / demo)
  {"type": "stop", "keep": true|false}
Server → client: {"type": "ready"}, {"type": "update", ...}, {"type": "stt", ...}, {"type": "report", ...},
  {"type": "error", "message"}  (server busy, STT unavailable, call time limit reached)

Public-deploy limits come from config: MAX_SESSIONS concurrent sockets, MAX_SESSION_S per call,
MAX_TEXT_CHARS per line, ANALYZE_PER_MIN per client IP on /api/analyze.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .audio.vad import Endpointer
from .config import ROOT_DIR, settings
from .detection.llm import LLMReasoner
from .detection.semantic import SemanticMatcher
from .session import CallSession, Engine, SessionOptions
from .storage import IncidentStore

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("jam")

SCENARIO_DIR = ROOT_DIR / "demo" / "scenarios"
MAX_AUDIO_FRAME = 64 * 1024  # the PWA sends 3.2 KB (100 ms) frames
engine: Engine | None = None
store = IncidentStore(settings.db_path) if settings.store_incidents else None
stt_status = {"backend": settings.stt_backend, "ready": False, "error": ""}
active_sockets = 0


class RateLimiter:
    """Sliding one-minute window per key. In-memory: the app runs as a single process."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= self.per_minute:
            return False
        q.append(now)
        return True


analyze_limiter = RateLimiter(settings.analyze_per_min)


def load_stt():
    if settings.stt_backend == "whisper":
        from .audio.stt_whisper import WhisperSTT
        return WhisperSTT(settings.whisper_model, settings.whisper_device, settings.whisper_compute)
    if settings.stt_backend == "sarvam":
        from .audio.stt_sarvam import SarvamSTT
        return SarvamSTT()
    return None


async def _load_stt_background():
    try:
        engine.stt = await asyncio.to_thread(load_stt)
        stt_status["ready"] = engine.stt is not None
    except Exception as e:
        stt_status["error"] = str(e)
        log.warning("STT unavailable: %s (browser speech recognition and text still work)", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global engine
    semantic = await asyncio.to_thread(SemanticMatcher, settings.embed_backend, settings.embed_model)
    engine = Engine(semantic=semantic, llm=LLMReasoner())
    asyncio.create_task(_load_stt_background())
    yield


app = FastAPI(title="Jam the Scam", lifespan=lifespan)
if settings.cors_origins:
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["*"], allow_headers=["*"])


# ---------------------------------------------------------------- REST
@app.get("/api/health")
def health():
    return {
        "ok": True,
        "l2": engine.semantic.backend_name if engine and engine.semantic else None,
        "l3": {"provider": engine.llm.provider, "model": engine.llm.model} if engine and engine.llm.enabled else None,
        "stt": {**stt_status, "name": getattr(engine.stt, "name", None) if engine else None},
    }


class Line(BaseModel):
    text: str = Field(max_length=settings.max_text_chars)
    speaker: str = "caller"
    t: float | None = None


class AnalyzeRequest(BaseModel):
    lines: list[Line] = Field(max_length=200)
    lang: str = "en"
    use_l2: bool = True
    use_l3: bool = True
    caller_number: str = Field("", max_length=32)


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest, request: Request):
    """Run a whole transcript through the live pipeline at once (L3 inline). Handy for tests and the eval."""
    if not analyze_limiter.allow(request.client.host if request.client else "?"):
        raise HTTPException(429, "too many requests, try again in a minute")
    sess = CallSession(engine, SessionOptions(lang=req.lang, use_l2=req.use_l2, use_l3=req.use_l3,
                                              llm_mode="sync", caller_number=req.caller_number))
    updates = []
    for i, line in enumerate(req.lines):
        u = await sess.process(line.text, t=line.t if line.t is not None else i * 6.0, speaker=line.speaker)
        updates.append({k: u[k] for k in ("score", "level", "stage") if k in u} | {"t": u.get("utterance", {}).get("t")})
    return {"final": sess.snapshot(), "trace": updates, "report": await sess.finish()}


@app.get("/api/scenarios")
def scenarios():
    out = []
    for p in sorted(SCENARIO_DIR.glob("*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        out.append({"id": p.stem, "title": d.get("title", p.stem), "kind": d.get("kind", ""),
                    "lang": d.get("lang", "en"), "description": d.get("description", "")})
    return out


@app.get("/api/scenarios/{sid}")
def scenario(sid: str):
    p = SCENARIO_DIR / f"{Path(sid).name}.json"
    if not p.exists():
        raise HTTPException(404, "no such scenario")
    return json.loads(p.read_text(encoding="utf-8"))


if store is not None:
    @app.get("/api/incidents")
    def incidents():
        return store.list()

    @app.get("/api/incidents/{call_id}")
    def incident(call_id: str):
        r = store.get(call_id)
        if not r:
            raise HTTPException(404, "not found")
        return r

    @app.delete("/api/incidents/{call_id}")
    def delete_incident(call_id: str):
        return {"deleted": store.delete(call_id)}


# ---------------------------------------------------------------- WebSocket
@app.websocket("/ws/guard")
async def guard(ws: WebSocket):
    global active_sockets
    await ws.accept()
    send_lock = asyncio.Lock()

    async def emit(msg: dict):
        async with send_lock:
            try:
                await ws.send_json(msg)
            except Exception:
                pass

    if active_sockets >= settings.max_sessions:
        await emit({"type": "error", "message": "The server is busy guarding other calls. Try again in a minute."})
        await ws.close(code=1013)  # try again later
        return
    active_sockets += 1
    deadline = time.monotonic() + settings.max_session_s

    session: CallSession | None = None
    endpointer = Endpointer()
    stt_queue: asyncio.Queue = asyncio.Queue()

    async def stt_worker():
        while True:
            item = await stt_queue.get()
            if item is None:
                return
            start_t, audio = item
            if engine.stt is None:
                await emit({"type": "error", "message": "Server speech-to-text is still loading or unavailable. "
                                                        "Use browser speech recognition instead."})
                continue
            try:
                tr = await asyncio.to_thread(engine.stt.transcribe, audio, session.opts.lang)
            except Exception as e:
                log.warning("STT failed: %s", e)
                continue
            await emit({"type": "stt", "text": tr.text, "lang": tr.lang, "latency_ms": tr.latency_ms, "t": round(start_t, 1)})
            if tr.text:
                await session.process(tr.text, t=start_t, speaker="unknown", lang=tr.lang)

    worker: asyncio.Task | None = None

    async def finish_call(keep: bool, keep_transcript: bool) -> None:
        nonlocal session, worker
        for utt in endpointer.finish():
            await stt_queue.put(utt)
        await stt_queue.put(None)
        if worker:
            await asyncio.wait_for(worker, timeout=30)
        report = await session.finish()
        if store is not None and keep:
            store.save(report, session.transcript_dicts() if keep_transcript else None)
        await emit({"type": "report", "report": report})
        session, worker = None, None

    try:
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=max(0.1, deadline - time.monotonic()))
            except asyncio.TimeoutError:
                await emit({"type": "error", "message": f"Calls are limited to {int(settings.max_session_s // 60)} minutes "
                                                        "on this server. The report is below."})
                if session is not None:
                    await finish_call(keep=True, keep_transcript=False)
                break
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("bytes") is not None:
                if session is None or len(msg["bytes"]) > MAX_AUDIO_FRAME:
                    continue
                for utt in endpointer.feed(msg["bytes"]):
                    await stt_queue.put(utt)
                continue
            data = json.loads(msg.get("text") or "{}")
            kind = data.get("type")
            if kind == "start" and session is None:
                opts = SessionOptions(
                    lang=data.get("lang", "en"), user_name=str(data.get("user_name", ""))[:60],
                    family_phone=str(data.get("family_phone", ""))[:32],
                    caller_number=str(data.get("caller_number", ""))[:32],
                    use_l2=data.get("use_l2", True), use_l3=data.get("use_l3", True),
                )
                session = CallSession(engine, opts, emit=emit)
                endpointer = Endpointer()
                worker = asyncio.create_task(stt_worker())
                await emit({"type": "ready", "call_id": session.call_id, **health()})
            elif kind == "text" and session is not None:
                text = str(data.get("text", ""))[:settings.max_text_chars]
                await session.process(text, speaker=data.get("speaker", "caller"))
            elif kind == "stop" and session is not None:
                await finish_call(keep=data.get("keep", True), keep_transcript=bool(data.get("keep_transcript")))
    except WebSocketDisconnect:
        pass
    finally:
        active_sockets -= 1
        if worker and not worker.done():
            worker.cancel()


# ---------------------------------------------------------------- PWA
dist = Path(settings.frontend_dist)
if dist.exists():
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "not found")
        f = dist / path
        if path and f.is_file() and dist in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(dist / "index.html")
