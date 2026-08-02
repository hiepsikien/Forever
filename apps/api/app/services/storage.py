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
    "audio/aac",
    "audio/wav",
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
    "audio/aac": ".aac",
    "audio/wav": ".wav",
    "audio/webm": ".webm",
    "audio/3gpp": ".3gp",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
}

MIME_ALIASES = {
    "audio/mp3": "audio/mpeg",
    "audio/m4a": "audio/mp4",
    "audio/x-m4a": "audio/mp4",
    "audio/wave": "audio/wav",
    "audio/x-wav": "audio/wav",
    "audio/vnd.wave": "audio/wav",
    "audio/vnd.wav": "audio/wav",
    "audio/3gp": "audio/3gpp",
}


def _normalize_mime(mime: str, filename: str = "") -> str:
    lower = (mime or "").split(";")[0].strip().lower()
    if lower in MIME_ALIASES:
        return MIME_ALIASES[lower]
    if lower in EXT_BY_MIME:
        return lower
    if lower.startswith("audio/"):
        sub = lower[len("audio/") :]
        if "wav" in sub or sub == "wave":
            return "audio/wav"
        if "mpeg" in sub or sub == "mp3":
            return "audio/mpeg"
        if "m4a" in sub or "mp4" in sub:
            return "audio/mp4"
        if "aac" in sub:
            return "audio/aac"
        if "webm" in sub:
            return "audio/webm"
        if "3gp" in sub:
            return "audio/3gpp"
    ext = Path(filename or "").suffix.lower()
    ext_map = {
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".wav": "audio/wav",
        ".aac": "audio/aac",
        ".webm": "audio/webm",
        ".3gp": "audio/3gpp",
    }
    if ext in ext_map:
        return ext_map[ext]
    return lower


def guess_mime(upload: UploadFile) -> str:
    content_type = (upload.content_type or "").split(";")[0].strip().lower()
    name = upload.filename or ""
    if content_type and content_type != "application/octet-stream":
        return _normalize_mime(content_type, name)
    guessed, _ = mimetypes.guess_type(name)
    return _normalize_mime(guessed or "application/octet-stream", name)


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

    ext = EXT_BY_MIME.get(mime) or Path(upload.filename or "").suffix.lower()
    if not ext or ext == ".bin":
        ext = ".m4a" if mime.startswith("audio/") else ".jpg"
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
