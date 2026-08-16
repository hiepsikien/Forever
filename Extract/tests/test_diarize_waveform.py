from pathlib import Path
from types import SimpleNamespace

import numpy as np
import soundfile as sf

from extract.diarize import diarize_file, load_waveform


def test_load_waveform_shape_and_rate(tmp_path: Path):
    path = tmp_path / "tone.wav"
    rate = 16000
    samples = np.zeros(rate, dtype=np.float32)
    sf.write(path, samples, rate)

    audio = load_waveform(path)
    assert audio["sample_rate"] == rate
    assert audio["waveform"].ndim == 2
    assert audio["waveform"].shape[0] == 1  # channel first
    assert audio["waveform"].shape[1] == rate


def test_diarize_file_passes_waveform_dict(tmp_path: Path, monkeypatch):
    path = tmp_path / "tone.wav"
    sf.write(path, np.zeros(8000, dtype=np.float32), 16000)

    captured: dict = {}

    class FakeTurn:
        def __init__(self, start: float, end: float):
            self.start = start
            self.end = end

    def fake_pipeline(audio, num_speakers=None):
        captured["audio"] = audio
        captured["num_speakers"] = num_speakers
        return SimpleNamespace(
            speaker_diarization=[(FakeTurn(0.0, 1.0), "SPEAKER_0")]
        )

    monkeypatch.setattr(
        "extract.diarize._resolve_device", lambda requested=None: "cpu"
    )

    segments, device = diarize_file(
        path, num_speakers=1, pipeline=fake_pipeline
    )

    assert device == "cpu"
    assert captured["num_speakers"] == 1
    assert isinstance(captured["audio"], dict)
    assert "waveform" in captured["audio"]
    assert "sample_rate" in captured["audio"]
    assert len(segments) == 1
    assert segments[0].speaker == "SPEAKER_00"
