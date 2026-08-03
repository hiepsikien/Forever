from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from .storage import absolute_media_path

# Bump when playback transcode settings change (invalidates cached MP4s).
PLAYBACK_CACHE_TAG = "v2"

# AVCHD / legacy camcorder — almost always 1080i; remux copy causes combing/judder on phone.
CAMCORDER_EXTENSIONS = {".mts", ".m2ts", ".mod", ".tod", ".avi", ".wmv", ".mkv"}


class VideoPlaybackError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def require_ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise VideoPlaybackError(
            "ffmpeg chưa cài trên server. Cài trước (vd. brew install ffmpeg)."
        )
    return path


def playback_path_for(media_relative: str) -> Path:
    src = absolute_media_path(media_relative)
    return src.parent / f"{src.stem}.playback.{PLAYBACK_CACHE_TAG}.mp4"


def _needs_deinterlace_transcode(src: Path) -> bool:
    return src.suffix.lower() in CAMCORDER_EXTENSIONS


def _run_ffmpeg(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True)


def _transcode_playback(
    ffmpeg: str, src: Path, tmp: Path, *, deinterlace: bool
) -> None:
    """Encode a phone-friendly MP4; deinterlace 1080i camcorder footage."""
    vf = "yadif=1:-1:0,format=yuv420p" if deinterlace else "format=yuv420p"
    cmd = [
        ffmpeg,
        "-y",
        "-i",
        str(src),
        "-map",
        "0:v:0?",
        "-map",
        "0:a:0?",
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "21",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        str(tmp),
    ]
    proc = _run_ffmpeg(cmd)
    if proc.returncode != 0 or not tmp.exists() or tmp.stat().st_size < 1024:
        if tmp.exists():
            tmp.unlink()
        detail = (proc.stderr or proc.stdout or "unknown").strip()
        raise VideoPlaybackError(f"Không chuyển được video để phát: {detail[:400]}")


def _try_remux_copy(ffmpeg: str, src: Path, tmp: Path) -> bool:
    """Fast remux for progressive phone MP4/MOV only."""
    cmd = [
        ffmpeg,
        "-y",
        "-i",
        str(src),
        "-map",
        "0:v:0?",
        "-map",
        "0:a:0?",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        str(tmp),
    ]
    proc = _run_ffmpeg(cmd)
    return proc.returncode == 0 and tmp.exists() and tmp.stat().st_size > 1024


def ensure_playback_mp4(media_relative: str) -> Path:
    """Transcode camcorder/interlaced sources to progressive MP4 for in-app playback."""
    src = absolute_media_path(media_relative)
    if not src.exists():
        raise VideoPlaybackError("Media file missing.")

    dest = playback_path_for(media_relative)
    legacy = src.parent / f"{src.stem}.playback.mp4"
    if legacy.exists() and legacy != dest:
        legacy.unlink(missing_ok=True)

    if (
        dest.exists()
        and dest.stat().st_size > 1024
        and dest.stat().st_mtime >= src.stat().st_mtime
    ):
        return dest

    ffmpeg = require_ffmpeg()
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part.mp4")
    if tmp.exists():
        tmp.unlink()

    if _needs_deinterlace_transcode(src):
        _transcode_playback(ffmpeg, src, tmp, deinterlace=True)
    else:
        if not _try_remux_copy(ffmpeg, src, tmp):
            if tmp.exists():
                tmp.unlink()
            _transcode_playback(ffmpeg, src, tmp, deinterlace=False)

    tmp.replace(dest)
    return dest
