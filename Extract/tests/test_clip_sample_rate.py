import shutil
import subprocess

import pytest

from extract.cut import cut_segments
from extract.normalize import (
    DIARIZE_SAMPLE_RATE,
    MAX_CLIP_SAMPLE_RATE,
    normalize_audio,
    probe_sample_rate,
    resolve_clip_sample_rate,
)
from extract.types import Segment

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="needs ffmpeg + ffprobe",
)


def _tone(path, rate, seconds=4.0):
    subprocess.run(
        [
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", f"sine=frequency=440:sample_rate={rate}:duration={seconds}",
            "-ac", "1", str(path),
        ],
        capture_output=True,
        check=True,
    )
    return path


def test_clip_rate_follows_source(tmp_path):
    assert resolve_clip_sample_rate(_tone(tmp_path / "a.wav", 48000)) == 48000
    assert resolve_clip_sample_rate(_tone(tmp_path / "b.wav", 44100)) == 44100


def test_clip_rate_never_upsamples_or_exceeds_cap(tmp_path):
    assert resolve_clip_sample_rate(_tone(tmp_path / "low.wav", 22050)) == 22050
    high = resolve_clip_sample_rate(_tone(tmp_path / "high.wav", 96000))
    assert high == MAX_CLIP_SAMPLE_RATE


def test_clips_keep_full_bandwidth_not_the_diarization_rate(tmp_path):
    """Clone clips must come from the clip copy, not the 16 kHz diarize copy."""
    source = _tone(tmp_path / "src.wav", 48000, seconds=6.0)
    diarize_wav = normalize_audio(
        source, tmp_path / "source.wav", sample_rate=DIARIZE_SAMPLE_RATE
    )
    clip_wav = normalize_audio(
        source, tmp_path / "source.clip.wav", sample_rate=resolve_clip_sample_rate(source)
    )
    assert probe_sample_rate(diarize_wav) == DIARIZE_SAMPLE_RATE

    written = cut_segments(clip_wav, [Segment("SPEAKER_00", 0.5, 4.5)], tmp_path / "out")
    assert written
    cut_path = tmp_path / "out" / written[0].file
    assert probe_sample_rate(cut_path) == 48000
