FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# CPU-only PyTorch — VM has no GPU; keeps image smaller than CUDA wheels.
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu

COPY pyproject.toml README.md ./

# Stub package so the editable install resolves before real source is copied —
# keeps the ~640MB pyannote layer cached when only worker code changes.
RUN mkdir -p extract \
    && touch extract/__init__.py \
    && pip install --no-cache-dir -e ".[worker]"

COPY extract/ extract/

CMD ["extract-worker"]
