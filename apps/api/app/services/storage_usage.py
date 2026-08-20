"""Disk usage for the uploads volume and one family space."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from ..config import get_settings

KIND_LABELS: dict[str, str] = {
    "video": "Video",
    "audio": "Tiếng",
    "image": "Ảnh",
    "document": "Chữ",
    "other": "Khác",
}

FOLDER_LABELS: dict[str, str] = {
    "media": "Ký ức và giọng",
    "extract": "Giọng từ ký ức",
    "library-ingest": "Nhập chữ",
}

KIND_ORDER = ("video", "audio", "image", "document", "other")
FOLDER_ORDER = ("media", "extract", "library-ingest")

_AUDIO_EXT = {".mp3", ".m4a", ".wav", ".aac", ".webm", ".3gp", ".ogg"}
_VIDEO_EXT = {".mp4", ".mov", ".mts", ".m2ts", ".mkv", ".avi", ".wmv"}
_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".gif"}
_DOC_EXT = {".pdf", ".doc", ".docx", ".txt"}


def _kind_for(path: Path) -> str:
    name = path.name.lower()
    ext = path.suffix.lower()
    if ".playback." in name:
        return "video"
    if ".thumb." in name:
        return "image"
    if ext in _VIDEO_EXT:
        return "video"
    if ext in _AUDIO_EXT:
        return "audio"
    if ext in _IMAGE_EXT:
        return "image"
    if ext in _DOC_EXT:
        return "document"
    return "other"


def _folder_for(parts: tuple[str, ...]) -> str:
    if len(parts) >= 2 and parts[1] in FOLDER_LABELS and parts[1] != "media":
        return parts[1]
    return "media"


def _iter_files(root: Path):
    if not root.is_dir():
        return
    for dirpath, _dirnames, filenames in os.walk(root, followlinks=False):
        for name in filenames:
            path = Path(dirpath) / name
            try:
                if path.is_symlink() or not path.is_file():
                    continue
                yield path, path.stat().st_size
            except OSError:
                continue


def _buckets(counts: dict[str, dict[str, int]], order: tuple[str, ...], labels: dict[str, str]) -> list[dict]:
    rows = []
    for key in order:
        row = counts.get(key)
        if not row or row["files"] == 0:
            continue
        rows.append(
            {
                "key": key,
                "label": labels[key],
                "bytes": row["bytes"],
                "files": row["files"],
            }
        )
    return rows


def summarize_storage(space_id: str) -> dict:
    """Walk UPLOAD_DIR. Volume used = that tree only, not the rest of the VM disk."""
    root = Path(get_settings().upload_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)

    space_bytes = 0
    space_files = 0
    uploads_bytes = 0
    uploads_files = 0
    by_kind: dict[str, dict[str, int]] = {
        key: {"bytes": 0, "files": 0} for key in KIND_ORDER
    }
    by_folder: dict[str, dict[str, int]] = {
        key: {"bytes": 0, "files": 0} for key in FOLDER_ORDER
    }

    for path, size in _iter_files(root):
        uploads_bytes += size
        uploads_files += 1
        try:
            rel = path.relative_to(root)
        except ValueError:
            continue
        parts = rel.parts
        if not parts or parts[0] != space_id:
            continue
        space_bytes += size
        space_files += 1
        kind = _kind_for(path)
        by_kind[kind]["bytes"] += size
        by_kind[kind]["files"] += 1
        folder = _folder_for(parts)
        by_folder[folder]["bytes"] += size
        by_folder[folder]["files"] += 1

    usage = shutil.disk_usage(root)
    total = int(usage.total)
    free = int(usage.free)
    return {
        "space": {
            "bytes": space_bytes,
            "files": space_files,
            "by_kind": _buckets(by_kind, KIND_ORDER, KIND_LABELS),
            "by_folder": _buckets(by_folder, FOLDER_ORDER, FOLDER_LABELS),
        },
        "uploads": {
            "bytes": uploads_bytes,
            "files": uploads_files,
        },
        "volume": {
            "total_bytes": total,
            "used_bytes": uploads_bytes,
            "free_bytes": free,
            "used_ratio": round(uploads_bytes / total, 4) if total else 0.0,
        },
    }
