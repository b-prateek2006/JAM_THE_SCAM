# Jam the Scam: one image with the built PWA, the FastAPI backend and the ML models baked in.
# Builds locally (docker compose up --build) and on Hugging Face Spaces (Docker SDK, runs as UID 1000).
#
# Regenerate backend/requirements.lock after changing requirements*.txt (keep the header lines):
#   docker run --rm -v "$PWD/backend:/src:ro" python:3.12-slim sh -c "pip install -q torch \
#     --index-url https://download.pytorch.org/whl/cpu && pip install -q -r /src/requirements.txt \
#     -r /src/requirements-ml.txt pytest && pip freeze" | grep -v '^torch=='
# and set TORCH_VERSION below to the torch version it installed.

FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/models

RUN useradd -m -u 1000 user
WORKDIR /app

# torch comes from the CPU index; the lock pins everything else to what was tested.
ARG TORCH_VERSION=2.14.1
COPY backend/requirements.lock ./
RUN pip install torch==${TORCH_VERSION} --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r requirements.lock

# Download the models at build time so a cold start never waits on (or fails at) the Hub.
# Change them with build args; on a Space, Variables with the same names are passed as build args.
ARG EMBED_MODEL=sentence-transformers/paraphrase-multilingual-mpnet-base-v2
ARG WHISPER_MODEL=small
# Retries resume from the partial cache; later attempts skip the Xet CDN and use plain HTTP.
RUN for i in 1 2 3; do \
      if [ "$i" -gt 1 ]; then export HF_HUB_DISABLE_XET=1; fi; \
      python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${EMBED_MODEL}', device='cpu')" \
        && python -c "from faster_whisper import download_model; download_model('${WHISPER_MODEL}')" \
        && ok=1 && break; \
      echo "model download failed (attempt $i), retrying"; sleep 10; \
    done; \
    [ "$ok" = 1 ] && chown -R user:user /models

COPY --chown=user:user backend/ ./backend/
COPY --chown=user:user demo/ ./demo/
COPY --from=web --chown=user:user /web/dist ./frontend/dist
RUN mkdir -p /app/data && chown user:user /app/data

ENV EMBED_MODEL=${EMBED_MODEL} \
    WHISPER_MODEL=${WHISPER_MODEL} \
    HF_HUB_OFFLINE=1 \
    FRONTEND_DIST=/app/frontend/dist \
    DB_PATH=/app/data/incidents.db \
    PORT=8000

USER user
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/api/health', timeout=4)"
CMD ["sh", "-c", "exec python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' --ws-max-size 65536"]
