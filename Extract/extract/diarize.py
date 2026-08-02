from __future__ import annotations

import os
from pathlib import Path

from extract.types import Segment

DEFAULT_MODEL = "pyannote/speaker-diarization-community-1"


def _resolve_device(requested: str | None) -> str:
    import torch

    if requested and requested != "auto":
        return requested
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _hf_token() -> str | None:
    return (
        os.environ.get("HF_TOKEN")
        or os.environ.get("HUGGINGFACE_TOKEN")
        or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    )


def load_pipeline(model_id: str = DEFAULT_MODEL, device: str | None = None):
    """Load pyannote Community-1 (or compatible) diarization pipeline."""
    import torch
    from pyannote.audio import Pipeline

    token = _hf_token()
    kwargs = {"token": token} if token else {}
    try:
        pipeline = Pipeline.from_pretrained(model_id, **kwargs)
    except TypeError:
        # Older pyannote used use_auth_token=
        pipeline = Pipeline.from_pretrained(model_id, use_auth_token=token)

    if pipeline is None:
        raise RuntimeError(
            f"Failed to load pipeline '{model_id}'. "
            "Accept the model terms on Hugging Face and set HF_TOKEN."
        )

    resolved = _resolve_device(device)
    pipeline.to(torch.device(resolved))
    return pipeline, resolved


def _iter_turns(output) -> list[tuple[float, float, str]]:
    """Normalize pyannote output across community-1 and legacy Annotation APIs."""
    turns: list[tuple[float, float, str]] = []

    speaker_diarization = getattr(output, "speaker_diarization", None)
    if speaker_diarization is not None:
        for item in speaker_diarization:
            # community-1: (turn, speaker) or (turn, track, speaker)
            if len(item) == 2:
                turn, speaker = item
            elif len(item) == 3:
                turn, _track, speaker = item
            else:
                continue
            turns.append((float(turn.start), float(turn.end), str(speaker)))
        return turns

    # Legacy Annotation
    if hasattr(output, "itertracks"):
        for turn, _track, speaker in output.itertracks(yield_label=True):
            turns.append((float(turn.start), float(turn.end), str(speaker)))
        return turns

    raise TypeError(f"Unsupported diarization output type: {type(output)!r}")


def diarize_file(
    wav_path: Path,
    *,
    num_speakers: int,
    model_id: str = DEFAULT_MODEL,
    device: str | None = None,
    pipeline=None,
) -> tuple[list[Segment], str]:
    if num_speakers < 1:
        raise ValueError("num_speakers must be >= 1")

    resolved_device = "cpu"
    if pipeline is None:
        pipeline, resolved_device = load_pipeline(model_id=model_id, device=device)
    else:
        resolved_device = _resolve_device(device)

    output = pipeline(str(wav_path), num_speakers=num_speakers)
    segments = [
        Segment(speaker=_normalize_speaker_label(speaker), start=start, end=end)
        for start, end, speaker in _iter_turns(output)
    ]
    segments.sort(key=lambda s: (s.start, s.end, s.speaker))
    return segments, resolved_device


def _normalize_speaker_label(label: str) -> str:
    text = str(label).strip()
    upper = text.upper()
    if upper.startswith("SPEAKER_"):
        suffix = upper.split("_", 1)[-1]
        if suffix.isdigit():
            return f"SPEAKER_{int(suffix):02d}"
        return f"SPEAKER_{suffix}"
    if text.isdigit():
        return f"SPEAKER_{int(text):02d}"
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in text)
    return safe or "SPEAKER_00"
