"""Keep a speaker-embedding model warm and return one vector per clip.

Forever API does the match. This process never sees the family gallery and
never writes a Voice DNA sample. Run beside extract-worker so a long
diarization job cannot sit on the call path.

  speaker-id
  SPEAKER_ID_TOKEN (falls back to EXTRACT_WORKER_TOKEN), HF_TOKEN
"""

from __future__ import annotations

import hmac
import json
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from typing import Any
from urllib.parse import urlparse

DEFAULT_MODEL = "pyannote/wespeaker-voxceleb-resnet34-LM"
_MAX_BYTES = 15 * 1024 * 1024
_EXT = {
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/aac": ".aac",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/webm": ".webm",
    "audio/3gpp": ".3gp",
    "audio/ogg": ".ogg",
}


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _token() -> str | None:
    return (
        os.environ.get("HF_TOKEN")
        or os.environ.get("HUGGINGFACE_TOKEN")
        or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    )


def _device() -> str:
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def load_inference(model_id: str = DEFAULT_MODEL):
    import torch
    from pyannote.audio import Inference, Model

    token = _token()
    kwargs = {"token": token} if token else {}
    try:
        model = Model.from_pretrained(model_id, **kwargs)
    except TypeError:
        model = Model.from_pretrained(model_id, use_auth_token=token)
    if model is None:
        raise RuntimeError(
            f"Failed to load '{model_id}'. Accept the model terms on Hugging Face and set HF_TOKEN."
        )
    inference = Inference(model, window="whole")
    inference.to(torch.device(_device()))
    return inference


def _as_vector(embedding) -> list[float]:
    import numpy as np

    arr = np.asarray(embedding, dtype=np.float64).reshape(-1)
    return [float(x) for x in arr]


def _mono(waveform):
    import torch

    if waveform.ndim == 1:
        waveform = waveform.unsqueeze(0)
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    return waveform.to(dtype=torch.float32)


def embed_waveform(inference, waveform, sample_rate: int) -> list[float]:
    return _as_vector(inference({"waveform": waveform, "sample_rate": sample_rate}))


def embed_file(inference, path: str) -> dict[str, Any]:
    import torchaudio

    waveform, sample_rate = torchaudio.load(path)
    waveform = _mono(waveform)
    frames = int(waveform.shape[-1])
    rate = int(sample_rate) or 1
    duration_s = frames / rate
    embedding = embed_waveform(inference, waveform, rate)
    halves = None
    mid = frames // 2
    # Each half needs a little speech or the cosine is noise, not a second voice.
    if mid >= int(0.4 * rate):
        halves = [
            embed_waveform(inference, waveform[:, :mid], rate),
            embed_waveform(inference, waveform[:, mid:], rate),
        ]
    return {"embedding": embedding, "duration_s": duration_s, "halves": halves}


class EmbedServer(ThreadingHTTPServer):
    def __init__(self, addr, inference, token: str):
        super().__init__(addr, Handler)
        self.inference = inference
        self.token = token
        self.infer_lock = Lock()


class Handler(BaseHTTPRequestHandler):
    server_version = "forever-speaker/1"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        # Path and status only — never the clip.
        super().log_message(fmt, *args)

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        expected = getattr(self.server, "token", "") or ""
        got = (self.headers.get("X-Speaker-Token") or "").strip()
        if not expected or not got:
            return False
        return hmac.compare_digest(got, expected)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path != "/health":
            self._send(404, {"error": "not_found"})
            return
        self._send(200, {"ok": True})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path != "/embed":
            self._send(404, {"error": "not_found"})
            return
        if not self._authorized():
            self._send(401, {"error": "unauthorized"})
            return
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0 or length > _MAX_BYTES:
            self._send(400, {"error": "bad_length"})
            return
        mime = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        suffix = _EXT.get(mime, ".audio")
        data = self.rfile.read(length)
        if len(data) != length:
            self._send(400, {"error": "short_body"})
            return
        tmp_path = ""
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(data)
                tmp_path = tmp.name
            server = self.server
            with server.infer_lock:
                payload = embed_file(server.inference, tmp_path)
        except Exception as exc:  # noqa: BLE001
            self._send(400, {"error": "unreadable", "detail": str(exc)[:200]})
            return
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        self._send(200, payload)


def main() -> int:
    token = _env("SPEAKER_ID_TOKEN") or _env("EXTRACT_WORKER_TOKEN", "forever-extract-worker")
    if not token:
        print("error: SPEAKER_ID_TOKEN or EXTRACT_WORKER_TOKEN required")
        return 2
    host = _env("SPEAKER_ID_BIND", "0.0.0.0")
    port = int(_env("SPEAKER_ID_PORT", "8091") or "8091")
    model_id = _env("SPEAKER_ID_MODEL", DEFAULT_MODEL)
    print(f"[speaker-id] loading {model_id}")
    inference = load_inference(model_id)
    server = EmbedServer((host, port), inference, token)
    print(f"[speaker-id] listening on {host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[speaker-id] stop")
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
