from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .db import Base, SessionLocal, engine
from .routers import auth, extract, interviews, memories, memory_candidates, messages, spaces, stewardship, threads
from .routers import settings as settings_router
from .routers import voice_dna
from .schema_patch import ensure_schema
from .seed import seed_if_empty, seed_interview_prompts

settings = get_settings()
Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)

# Synced from brand/logo/app via scripts/generate-brand-kit.py
_STATIC_BRAND = Path(__file__).resolve().parents[1] / "static" / "brand"
_FAVICON_ICO = _STATIC_BRAND / "favicon.ico"

app = FastAPI(
    title="Forever API",
    version="0.1.0",
    swagger_ui_parameters={"favicon_url": "/favicon.ico"} if _FAVICON_ICO.exists() else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException):
    if isinstance(exc.detail, dict):
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"error": str(exc.detail)})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=400,
        content={"error": "Invalid request.", "details": exc.errors()},
    )


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_schema()
    db = SessionLocal()
    try:
        if settings.seed_demo:
            seed_if_empty(db)
        else:
            seed_interview_prompts(db)
    finally:
        db.close()


@app.get("/health")
def health():
    return {"ok": True, "service": "forever"}


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    if not _FAVICON_ICO.exists():
        raise HTTPException(status_code=404, detail="Favicon not found.")
    return FileResponse(_FAVICON_ICO, media_type="image/x-icon")


if _STATIC_BRAND.is_dir():
    app.mount("/brand", StaticFiles(directory=str(_STATIC_BRAND)), name="brand")


app.include_router(auth.router)
app.include_router(spaces.router)
app.include_router(stewardship.router)
app.include_router(settings_router.router)
app.include_router(threads.router)
app.include_router(messages.router)
app.include_router(messages.media_router)
app.include_router(memories.router)
app.include_router(memory_candidates.router)
app.include_router(interviews.router)
app.include_router(voice_dna.router)
app.include_router(extract.router)
app.include_router(extract.internal_router)
