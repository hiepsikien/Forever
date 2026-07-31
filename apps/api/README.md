# Forever API

FastAPI backend for family spaces, chat, and (later) heritage memory.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
# start Postgres: docker compose up -d db  (from repo root)
.venv/bin/uvicorn app.main:app --reload --port 8000
```
