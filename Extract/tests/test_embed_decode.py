import shutil
import subprocess

import pytest

from extract.embed_server import embed_file

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="needs ffmpeg"
)


def test_embed_file_decodes_without_torchaudio(tmp_path, monkeypatch):
    """Phone clips are m4a. Decoding must not go through torchcodec."""
    pytest.importorskip("torch")
    pytest.importorskip("soundfile")
    clip = tmp_path / "clip.m4a"
    subprocess.run(
        [
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", "sine=frequency=440:sample_rate=16000:duration=1",
            "-c:a", "aac", str(clip),
        ],
        capture_output=True,
        check=True,
    )
    seen: list[int] = []

    def fake_inference(payload):
        seen.append(int(payload["waveform"].shape[-1]))
        assert payload["sample_rate"] == 16000
        assert payload["waveform"].shape[0] == 1
        return [1.0, 0.0, 0.0]

    monkeypatch.setattr(
        "extract.embed_server.embed_waveform",
        lambda inference, waveform, sample_rate: inference(
            {"waveform": waveform, "sample_rate": sample_rate}
        ),
    )
    payload = embed_file(fake_inference, str(clip))
    assert payload["duration_s"] == pytest.approx(1.0, abs=0.05)
    assert seen
    assert payload["embedding"] == [1.0, 0.0, 0.0]
