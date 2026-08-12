from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import HTTPException, UploadFile
from nanoid import generate

from ..config import get_settings

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_MEMORY_MEDIA_BYTES = 200 * 1024 * 1024
MAX_EXTRACT_UPLOAD_BYTES = 200 * 1024 * 1024
# Voice DNA video → audio extract (Zalo / phone clips). Larger than sample audio.
MAX_VOICE_VIDEO_BYTES = 100 * 1024 * 1024

AUDIO_MIME = {
    "audio/mpeg",
    "audio/mp4",
    "audio/aac",
    "audio/wav",
    "audio/webm",
    "audio/3gpp",
}

VIDEO_MIME = {
    "video/mp4",
    "video/quicktime",
    "video/mp2t",
    "video/x-matroska",
    "video/x-msvideo",
    "video/x-ms-wmv",
    "video/webm",
    "video/3gpp",
}

IMAGE_MIME = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}

PDF_MIME = {"application/pdf"}

DOCX_MIME = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

DOC_MIME = {"application/msword"}

ALLOWED_MIME = AUDIO_MIME | VIDEO_MIME | IMAGE_MIME
LIBRARY_INGEST_MIME = IMAGE_MIME | PDF_MIME | DOCX_MIME | DOC_MIME
EXTRACTABLE_MIME = AUDIO_MIME | VIDEO_MIME

EXT_BY_MIME = {
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
    "audio/wav": ".wav",
    "audio/webm": ".webm",
    "audio/3gpp": ".3gp",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/mp2t": ".mts",
    "video/x-matroska": ".mkv",
    "video/x-msvideo": ".avi",
    "video/x-ms-wmv": ".wmv",
    "video/webm": ".webm",
    "video/3gpp": ".3gp",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/msword": ".doc",
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
    "video/mpeg": "video/mp2t",
    "video/x-matroska": "video/x-matroska",
    "video/x-ms-wmv": "video/x-ms-wmv",
    "video/x-msvideo": "video/x-msvideo",
    "application/vnd.apple.mpegurl": "video/mp2t",
}

EXT_TO_MIME = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".aac": "audio/aac",
    ".webm": "audio/webm",
    ".3gp": "audio/3gpp",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".mts": "video/mp2t",
    ".m2ts": "video/mp2t",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".wmv": "video/x-ms-wmv",
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
}


def is_audio_mime(mime: str) -> bool:
    return mime.startswith("audio/")


def is_video_mime(mime: str) -> bool:
    return mime.startswith("video/")


def is_extractable_mime(mime: str) -> bool:
    return mime in EXTRACTABLE_MIME or is_audio_mime(mime) or is_video_mime(mime)


def max_bytes_for_mime(mime: str) -> int:
    if is_video_mime(mime):
        return MAX_MEMORY_MEDIA_BYTES
    return MAX_UPLOAD_BYTES


def max_bytes_for_voice_sample(mime: str) -> int:
    """Limits for Voice DNA sample upload (audio small; video larger then stripped)."""
    if is_video_mime(mime):
        return MAX_VOICE_VIDEO_BYTES
    return MAX_UPLOAD_BYTES


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
    if lower.startswith("video/"):
        sub = lower[len("video/") :]
        if "mp2t" in sub or sub in {"mts", "m2ts"}:
            return "video/mp2t"
        if "quicktime" in lower or sub == "mov":
            return "video/quicktime"
        if "matroska" in lower or "mkv" in sub:
            return "video/x-matroska"
        if sub == "mp4":
            return "video/mp4"
        if "webm" in sub:
            return "video/webm"
        if "3gp" in sub:
            return "video/3gpp"
        if "msvideo" in lower or sub == "avi":
            return "video/x-msvideo"
        if "wmv" in sub:
            return "video/x-ms-wmv"
    ext = Path(filename or "").suffix.lower()
    if ext in EXT_TO_MIME:
        return EXT_TO_MIME[ext]
    return lower


def guess_mime(upload: UploadFile) -> str:
    content_type = (upload.content_type or "").split(";")[0].strip().lower()
    name = upload.filename or ""
    if content_type and content_type != "application/octet-stream":
        return _normalize_mime(content_type, name)
    guessed, _ = mimetypes.guess_type(name)
    return _normalize_mime(guessed or "application/octet-stream", name)


def save_upload(
    space_id: str,
    upload: UploadFile,
    *,
    max_bytes: int | None = None,
) -> tuple[str, str]:
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
    limit = max_bytes if max_bytes is not None else max_bytes_for_mime(mime)
    if len(data) > limit:
        cap_mb = limit // (1024 * 1024)
        raise HTTPException(status_code=400, detail=f"File too large (max {cap_mb}MB).")

    ext = EXT_BY_MIME.get(mime) or Path(upload.filename or "").suffix.lower()
    if not ext or ext == ".bin":
        if mime.startswith("audio/"):
            ext = ".m4a"
        elif mime.startswith("video/"):
            ext = ".mp4"
        else:
            ext = ".jpg"
    relative = f"{space_id}/{generate()}{ext}"
    dest = Path(settings.upload_dir) / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return relative.replace("\\", "/"), mime


def save_library_ingest_upload(
    space_id: str,
    job_id: str,
    upload: UploadFile,
    *,
    max_bytes: int = MAX_UPLOAD_BYTES,
) -> tuple[str, str]:
    """Save image/PDF/DOC/DOCX for library ingest under space/library-ingest/job_id/."""
    settings = get_settings()
    mime = guess_mime(upload)
    # Filename wins for Word when clients send octet-stream.
    name = (upload.filename or "").lower()
    if name.endswith(".docx"):
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif name.endswith(".doc"):
        mime = "application/msword"
    if mime not in LIBRARY_INGEST_MIME and not mime.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type: {mime or 'unknown'}. "
                "Dùng ảnh, PDF, DOC hoặc DOCX."
            ),
        )
    data = upload.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(data) > max_bytes:
        cap_mb = max_bytes // (1024 * 1024)
        raise HTTPException(status_code=400, detail=f"File too large (max {cap_mb}MB).")
    ext = EXT_BY_MIME.get(mime) or Path(upload.filename or "").suffix.lower() or ".bin"
    relative = f"{space_id}/library-ingest/{job_id}/input{ext}"
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


def delete_media_artifacts(media_relative: str) -> None:
    """Remove original upload and derived video cache files (thumbnail, playback)."""
    src = absolute_media_path(media_relative)
    if not src.exists():
        return
    parent = src.parent
    stem = src.stem
    src.unlink(missing_ok=True)
    for pattern in (
        f"{stem}.thumb.*.jpg",
        f"{stem}.playback.*.mp4",
        f"{stem}.playback.mp4",
    ):
        for path in parent.glob(pattern):
            path.unlink(missing_ok=True)


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
