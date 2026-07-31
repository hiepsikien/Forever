from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .db import Base, SessionLocal, engine
from .routers import auth, messages, spaces, threads
from .seed import seed_if_empty

settings = get_settings()
Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Forever API", version="0.1.0")

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
    if settings.seed_demo:
        db = SessionLocal()
        try:
            seed_if_empty(db)
        finally:
            db.close()


@app.get("/health")
def health():
    return {"ok": True, "service": "forever"}


app.include_router(auth.router)
app.include_router(spaces.router)
app.include_router(threads.router)
app.include_router(messages.router)
