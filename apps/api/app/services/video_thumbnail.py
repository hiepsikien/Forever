from __future__ import annotations

import subprocess
from pathlib import Path

from .video_playback import (
    VideoPlaybackError,
    is_playable_video,
    playback_path_for,
    require_ffmpeg,
)
from .storage import absolute_media_path

THUMB_CACHE_TAG = "v1"


def thumbnail_path_for(media_relative: str) -> Path:
    src = absolute_media_path(media_relative)
    return src.parent / f"{src.stem}.thumb.{THUMB_CACHE_TAG}.jpg"


def _thumbnail_inputs(media_relative: str, src: Path) -> list[Path]:
    """Original first — remuxed playback can be broken for some phone MP4s."""
    inputs: list[Path] = [src]
    playback = playback_path_for(media_relative)
    if playback != src and is_playable_video(playback):
        inputs.append(playback)
    return inputs


def _grab_frame(ffmpeg: str, input_path: Path, tmp: Path, seek: str) -> bool:
    cmd = [
        ffmpeg,
        "-y",
        "-ss",
        seek,
        "-i",
        str(input_path),
        "-frames:v",
        "1",
        "-update",
        "1",
        "-q:v",
        "4",
        "-vf",
        "scale=640:-2",
        str(tmp),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    return proc.returncode == 0 and tmp.exists() and tmp.stat().st_size > 256


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

    for input_path in _thumbnail_inputs(media_relative, src):
        for seek in ("2", "0.5", "0"):
            if _grab_frame(ffmpeg, input_path, tmp, seek):
                tmp.replace(dest)
                return dest
        if tmp.exists():
            tmp.unlink()

    raise VideoPlaybackError("Không tạo được ảnh xem trước video.")
