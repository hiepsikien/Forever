from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import HTTPException, UploadFile
from nanoid import generate

from ..config import get_settings

MAX_UPLOAD_BYTES = 25 * 1024 * 1024

ALLOWED_MIME = {
    "audio/mpeg",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/aac",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "audio/3gpp",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}

EXT_BY_MIME = {
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/aac": ".aac",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/webm": ".webm",
    "audio/3gpp": ".3gp",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
}


def guess_mime(upload: UploadFile) -> str:
    content_type = (upload.content_type or "").split(";")[0].strip().lower()
    if content_type and content_type != "application/octet-stream":
        return content_type
    name = upload.filename or ""
    guessed, _ = mimetypes.guess_type(name)
    return (guessed or "application/octet-stream").lower()


def save_upload(space_id: str, upload: UploadFile) -> tuple[str, str]:
    """Save upload under upload_dir/space_id/. Returns (relative_path, mime)."""
    settings = get_settings()
    mime = guess_mime(upload)
    if mime not in ALLOWED_MIME:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {mime or 'unknown'}.",
        )

    data = upload.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 25MB).")

    ext = EXT_BY_MIME.get(mime) or Path(upload.filename or "").suffix.lower() or ".bin"
    relative = f"{space_id}/{generate()}{ext}"
    dest = Path(settings.upload_dir) / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return relative.replace("\\", "/"), mime


def absolute_media_path(relative: str) -> Path:
    settings = get_settings()
    root = Path(settings.upload_dir).resolve()
    path = (root / relative).resolve()
    if not str(path).startswith(str(root)):
        raise HTTPException(status_code=400, detail="Invalid media path.")
    return path


def copy_media(space_id: str, relative: str) -> str:
    """Copy an existing media file into a new path under space_id/. Returns new relative path."""
    src = absolute_media_path(relative)
    if not src.exists():
        raise HTTPException(status_code=404, detail="Media file missing.")
    ext = src.suffix or ".bin"
    new_relative = f"{space_id}/{generate()}{ext}"
    dest = Path(get_settings().upload_dir) / new_relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(src.read_bytes())
    return new_relative.replace("\\", "/")


def save_bytes(space_id: str, data: bytes, *, ext: str = ".mp3") -> str:
    """Write raw bytes under upload_dir/space_id/. Returns relative path."""
    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 25MB).")
    if not ext.startswith("."):
        ext = f".{ext}"
    relative = f"{space_id}/{generate()}{ext}"
    dest = Path(get_settings().upload_dir) / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return relative.replace("\\", "/")
