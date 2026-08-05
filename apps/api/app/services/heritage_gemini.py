"""Shared Gemini transport for the heritage pipeline.

Every stage (analyzer, compose, critic, compactor) goes through here so that
timeout, retry and "never raise into the chat path" behave the same way.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field

import httpx

from ..config import Settings

_JSON_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


@dataclass
class GeminiResult:
    text: str | None = None
    finish_reason: str | None = None
    error: str | None = None
    latency_ms: int = 0

    @property
    def ok(self) -> bool:
        return bool(self.text)


@dataclass
class GeminiCall:
    system_prompt: str
    contents: list[dict]
    model: str
    temperature: float = 0.5
    max_output_tokens: int = 768
    json_mode: bool = False
    response_schema: dict | None = None
    timeout_s: float = 60.0
    attempts: int = 2
    generation_extra: dict = field(default_factory=dict)


def extract_text(data: dict) -> tuple[str | None, str | None]:
    candidates = data.get("candidates") or []
    if not candidates:
        return None, None
    candidate = candidates[0]
    finish_reason = candidate.get("finishReason")
    parts = ((candidate.get("content") or {}).get("parts")) or []
    texts: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        # Gemini 2.5/3 may return thought parts — never surface those as chat text.
        if part.get("thought"):
            continue
        chunk = part.get("text")
        if chunk:
            texts.append(chunk)
    text = "\n".join(texts).strip()
    return text or None, finish_reason


def call_gemini(settings: Settings, call: GeminiCall) -> GeminiResult:
    api_key = settings.gemini_api_key.strip()
    if not api_key:
        return GeminiResult(error="no_api_key")
    if not call.contents:
        return GeminiResult(error="empty_contents")

    generation: dict = {
        "temperature": call.temperature,
        "maxOutputTokens": call.max_output_tokens,
        "thinkingConfig": {"thinkingBudget": 0},
    }
    if call.json_mode:
        generation["responseMimeType"] = "application/json"
        if call.response_schema:
            generation["responseSchema"] = call.response_schema
    generation.update(call.generation_extra)

    base = settings.gemini_api_base.rstrip("/")
    url = f"{base}/models/{call.model}:generateContent"
    payload = {
        "systemInstruction": {"parts": [{"text": call.system_prompt}]},
        "contents": call.contents,
        "generationConfig": generation,
    }

    started = time.monotonic()
    last_error = "unknown"
    for attempt in range(max(1, call.attempts)):
        try:
            with httpx.Client(timeout=call.timeout_s) as client:
                res = client.post(
                    url,
                    params={"key": api_key},
                    headers={"Content-Type": "application/json"},
                    json=payload,
                )
                res.raise_for_status()
                text, finish_reason = extract_text(res.json())
                elapsed = int((time.monotonic() - started) * 1000)
                if not text:
                    return GeminiResult(
                        finish_reason=finish_reason,
                        error="empty_text",
                        latency_ms=elapsed,
                    )
                return GeminiResult(
                    text=text, finish_reason=finish_reason, latency_ms=elapsed
                )
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            last_error = f"http_{status}"
            # 4xx other than rate limiting will fail the same way on retry.
            if status < 500 and status != 429:
                break
        except Exception as exc:  # noqa: BLE001 — chat must never raise here
            last_error = type(exc).__name__
        if attempt + 1 < max(1, call.attempts):
            time.sleep(0.4 * (attempt + 1))

    return GeminiResult(
        error=last_error, latency_ms=int((time.monotonic() - started) * 1000)
    )


def parse_json_object(raw: str | None) -> dict | None:
    """Tolerate code fences and trailing prose around the JSON body."""
    if not raw:
        return None
    cleaned = _JSON_FENCE.sub("", raw.strip())
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            parsed = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError:
            return None
    return parsed if isinstance(parsed, dict) else None
