from __future__ import annotations

import subprocess
from pathlib import Path

from .video_playback import VideoPlaybackError, ensure_playback_mp4, require_ffmpeg
from .storage import absolute_media_path

THUMB_CACHE_TAG = "v1"


def thumbnail_path_for(media_relative: str) -> Path:
    src = absolute_media_path(media_relative)
    return src.parent / f"{src.stem}.thumb.{THUMB_CACHE_TAG}.jpg"


def ensure_video_thumbnail(media_relative: str) -> Path:
    src = absolute_media_path(media_relative)
    if not src.exists():
        raise VideoPlaybackError("Media file missing.")

    dest = thumbnail_path_for(media_relative)
    if (
        dest.exists()
        and dest.stat().st_size > 256
        and dest.stat().st_mtime >= src.stat().st_mtime
    ):
        return dest

    ffmpeg = require_ffmpeg()
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part.jpg")
    if tmp.exists():
        tmp.unlink()

    # Prefer playback MP4 if already built — faster & more reliable seek.
    try:
        input_path = ensure_playback_mp4(media_relative)
    except VideoPlaybackError:
        input_path = src

    for seek in ("2", "0.5", "0"):
        cmd = [
            ffmpeg,
            "-y",
            "-ss",
            seek,
            "-i",
            str(input_path),
            "-frames:v",
            "1",
            "-q:v",
            "4",
            "-vf",
            "scale=640:-2",
            str(tmp),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode == 0 and tmp.exists() and tmp.stat().st_size > 256:
            tmp.replace(dest)
            return dest

    if tmp.exists():
        tmp.unlink()
    raise VideoPlaybackError("Không tạo được ảnh xem trước video.")
