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
from .ai_usage import UsageContext, _chars_from_gemini_contents, record_usage

_JSON_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


@dataclass
class GeminiResult:
    text: str | None = None
    finish_reason: str | None = None
    error: str | None = None
    latency_ms: int = 0
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    thoughts_tokens: int | None = None

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
    usage: UsageContext | None = None
    audio_bytes: int = 0


def thoughts_tokens(data: dict) -> int | None:
    """Số token model tiêu cho phần suy nghĩ ẩn của lượt này."""
    usage = data.get("usageMetadata") or {}
    if not isinstance(usage, dict):
        return None
    count = usage.get("thoughtsTokenCount")
    return int(count) if count is not None else None


def parse_usage_metadata(data: dict) -> tuple[int | None, int | None, int | None]:
    usage = data.get("usageMetadata") or {}
    if not isinstance(usage, dict):
        return None, None, None
    prompt = usage.get("promptTokenCount")
    completion = usage.get("candidatesTokenCount")
    total = usage.get("totalTokenCount")
    return (
        int(prompt) if prompt is not None else None,
        int(completion) if completion is not None else None,
        int(total) if total is not None else None,
    )


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


def _telemetry(
    *,
    call: GeminiCall,
    result: GeminiResult,
    input_chars: int,
    output_chars: int,
) -> None:
    ctx = call.usage
    if ctx is None:
        return
    record_usage(
        service="gemini",
        provider="gemini",
        operation=ctx.operation,
        model=call.model,
        input_tokens=result.prompt_tokens,
        output_tokens=result.completion_tokens,
        input_chars=input_chars + len(call.system_prompt or ""),
        output_chars=output_chars,
        audio_bytes=call.audio_bytes,
        latency_ms=result.latency_ms,
        ok=result.ok and not result.error,
        error=result.error,
        context=ctx,
        meta=_telemetry_meta(result),
    )


def _telemetry_meta(result: GeminiResult) -> dict | None:
    """Ghi cả token suy nghĩ — thiếu nó thì một lượt bị bóp cụt trông như bình thường."""
    meta: dict = {}
    if result.finish_reason:
        meta["finish_reason"] = result.finish_reason
    if result.thoughts_tokens is not None:
        meta["thoughts_tokens"] = result.thoughts_tokens
    return meta or None


def thinking_config_for_model(model: str) -> dict[str, int | str]:
    """Per-model thinking config for generateContent.

    ``thinkingBudget: 0`` is cheap and works on 3.1 Lite / 3.5 Flash, but
    Gemini 3.6 Flash and 3.5 Flash-Lite reject it (HTTP 400). 3.7 Flash
    rejects ``thinkingLevel: minimal`` — use ``low`` there instead.
    """
    name = (model or "").strip().lower()
    if "3.7" in name:
        return {"thinkingLevel": "low"}
    if "3.6" in name or "3.5-flash-lite" in name:
        return {"thinkingLevel": "minimal"}
    return {"thinkingBudget": 0}


# Chỗ chừa cho phần suy nghĩ ẩn, KHÔNG phải trần của nó: Gemini 3 chỉ nhận mức
# `thinkingLevel`, không cho đặt số. Suy nghĩ tính chung vào `maxOutputTokens`,
# nên không chừa đủ thì câu trả lời bị bóp cụt — hoặc mất hẳn. Chừa rộng không
# tốn thêm: hoá đơn tính trên token thực sinh ra, chỗ chừa chỉ là chỗ để câu trả
# lời có đường đi.
_THINKING_HEADROOM: dict[str, int] = {"minimal": 1024, "low": 2048}


def thinking_headroom_tokens(model: str) -> int:
    config = thinking_config_for_model(model)
    if config.get("thinkingBudget") == 0:
        return 0
    level = str(config.get("thinkingLevel") or "")
    return _THINKING_HEADROOM.get(level, 2048)


def call_gemini(settings: Settings, call: GeminiCall) -> GeminiResult:
    api_key = settings.gemini_api_key.strip()
    if not api_key:
        result = GeminiResult(error="no_api_key")
        _telemetry(
            call=call,
            result=result,
            input_chars=_chars_from_gemini_contents(call.contents),
            output_chars=0,
        )
        return result
    if not call.contents:
        result = GeminiResult(error="empty_contents")
        _telemetry(call=call, result=result, input_chars=0, output_chars=0)
        return result

    # `max_output_tokens` là chỗ cho câu trả lời NHÌN THẤY. Phần suy nghĩ ẩn
    # được cộng thêm ở đây, nên chỗ gọi không phải biết model nào đang chạy.
    generation: dict = {
        "temperature": call.temperature,
        "maxOutputTokens": (
            call.max_output_tokens + thinking_headroom_tokens(call.model)
        ),
        "thinkingConfig": thinking_config_for_model(call.model),
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

    input_chars = _chars_from_gemini_contents(call.contents)
    started = time.monotonic()
    last_error = "unknown"
    last_prompt_tokens: int | None = None
    last_completion_tokens: int | None = None
    last_total_tokens: int | None = None
    last_thoughts_tokens: int | None = None

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
                data = res.json()
                last_prompt_tokens, last_completion_tokens, last_total_tokens = (
                    parse_usage_metadata(data)
                )
                last_thoughts_tokens = thoughts_tokens(data)
                text, finish_reason = extract_text(data)
                elapsed = int((time.monotonic() - started) * 1000)
                if not text:
                    result = GeminiResult(
                        finish_reason=finish_reason,
                        error="empty_text",
                        latency_ms=elapsed,
                        prompt_tokens=last_prompt_tokens,
                        completion_tokens=last_completion_tokens,
                        total_tokens=last_total_tokens,
                        thoughts_tokens=last_thoughts_tokens,
                    )
                    _telemetry(
                        call=call,
                        result=result,
                        input_chars=input_chars,
                        output_chars=0,
                    )
                    return result
                output_chars = len(text)
                result = GeminiResult(
                    text=text,
                    finish_reason=finish_reason,
                    latency_ms=elapsed,
                    prompt_tokens=last_prompt_tokens,
                    completion_tokens=last_completion_tokens,
                    total_tokens=last_total_tokens,
                    thoughts_tokens=last_thoughts_tokens,
                )
                _telemetry(
                    call=call,
                    result=result,
                    input_chars=input_chars,
                    output_chars=output_chars,
                )
                return result
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

    elapsed = int((time.monotonic() - started) * 1000)
    result = GeminiResult(
        error=last_error,
        latency_ms=elapsed,
        prompt_tokens=last_prompt_tokens,
        completion_tokens=last_completion_tokens,
        total_tokens=last_total_tokens,
    )
    _telemetry(call=call, result=result, input_chars=input_chars, output_chars=0)
    return result


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
