"""Record and aggregate AI API usage for cost visibility (Phase 0 telemetry).

Costs are estimates from static rate tables — not provider invoices.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from nanoid import generate
from sqlalchemy.orm import Session

from ..db import SessionLocal
from ..models import AiUsageEvent

from .heritage_safety import presence_for_space

logger = logging.getLogger(__name__)

# Rough USD rates — update when provider pricing changes.
_GEMINI_INPUT_PER_M = 0.075
_GEMINI_OUTPUT_PER_M = 0.30
_ELEVENLABS_PER_K_CHARS = 0.30
# MiniMax pay-as-you-go (platform.minimax.io): Turbo $60/M, HD $100/M.
_MINIMAX_TURBO_PER_K_CHARS = 0.06
_MINIMAX_HD_PER_K_CHARS = 0.10

OPERATIONS = frozenset(
    {
        "stt",
        "heritage_compose",
        "heritage_analyzer",
        "heritage_grounding",
        "heritage_compact",
        "heritage_repeat",
        "agent",
        "voice_script",
        "tts_chat",
        "tts_lab",
    }
)


@dataclass
class UsageContext:
    space_id: str | None = None
    thread_id: str | None = None
    message_id: str | None = None
    user_id: str | None = None
    operation: str = "unknown"


def _chars_from_gemini_contents(contents: list[dict]) -> int:
    total = 0
    for item in contents:
        for part in (item.get("parts") or []):
            if not isinstance(part, dict):
                continue
            text = part.get("text")
            if text:
                total += len(str(text))
            inline = part.get("inline_data") or {}
            data = inline.get("data")
            if data:
                # Base64 audio — rough proxy for metering when tokens missing.
                total += len(str(data)) // 4
    return total


def estimate_cost_usd(
    *,
    service: str,
    operation: str,
    model: str = "",
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    input_chars: int = 0,
    output_chars: int = 0,
    audio_bytes: int = 0,
) -> float:
    """Return an estimated USD cost for one API call."""
    svc = (service or "").strip().lower()
    if svc == "gemini":
        prompt = input_tokens
        completion = output_tokens
        if prompt is None and input_chars:
            prompt = max(1, input_chars // 4)
        if completion is None and output_chars:
            completion = max(0, output_chars // 4)
        if prompt is None and audio_bytes:
            # Audio inline: very rough — prefer usageMetadata when available.
            prompt = max(1, audio_bytes // 32)
        cost = 0.0
        if prompt:
            cost += (prompt / 1_000_000) * _GEMINI_INPUT_PER_M
        if completion:
            cost += (completion / 1_000_000) * _GEMINI_OUTPUT_PER_M
        return round(cost, 6)
    if svc in ("elevenlabs", "minimax"):
        chars = output_chars or input_chars
        if svc == "minimax":
            model_l = (model or "").strip().lower()
            rate = (
                _MINIMAX_HD_PER_K_CHARS
                if "hd" in model_l
                else _MINIMAX_TURBO_PER_K_CHARS
            )
        else:
            rate = _ELEVENLABS_PER_K_CHARS
        return round((chars / 1000) * rate, 6) if chars else 0.0
    return 0.0


def record_usage(
    *,
    service: str,
    operation: str,
    model: str = "",
    provider: str = "",
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    input_chars: int = 0,
    output_chars: int = 0,
    audio_bytes: int = 0,
    latency_ms: int = 0,
    ok: bool = True,
    error: str | None = None,
    context: UsageContext | None = None,
    meta: dict | None = None,
) -> None:
    """Persist one usage row. Never raises into the chat path."""
    ctx = context or UsageContext()
    op = operation if operation in OPERATIONS else operation or "unknown"
    svc = (service or "unknown").strip().lower()
    prov = (provider or svc).strip().lower()
    cost = estimate_cost_usd(
        service=svc,
        operation=op,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        input_chars=input_chars,
        output_chars=output_chars,
        audio_bytes=audio_bytes,
    )
    extra: dict = {}
    if meta:
        extra.update(meta)
    if error:
        extra["error"] = error
    try:
        db = SessionLocal()
        try:
            row = AiUsageEvent(
                id=generate(),
                space_id=ctx.space_id,
                thread_id=ctx.thread_id,
                message_id=ctx.message_id,
                user_id=ctx.user_id,
                service=svc,
                provider=prov,
                operation=op,
                model=(model or "")[:120],
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                input_chars=max(0, input_chars),
                output_chars=max(0, output_chars),
                audio_bytes=max(0, audio_bytes),
                latency_ms=max(0, latency_ms),
                estimated_cost_usd=cost,
                ok=ok,
                meta_json=json.dumps(extra, ensure_ascii=False) if extra else "",
                created_at=datetime.now(timezone.utc),
            )
            db.add(row)
            db.commit()
        finally:
            db.close()
    except Exception:  # noqa: BLE001 — telemetry must not break product paths
        logger.exception("ai usage record failed op=%s svc=%s", op, svc)


_MODALITY_ORDER = ("llm", "tts", "stt")
_MODALITY_LABELS = {
    "llm": "LLM",
    "tts": "TTS",
    "stt": "STT",
}
_TTS_OPERATIONS = frozenset({"tts_chat", "tts_lab"})


def modality_for_operation(operation: str) -> str:
    """Roll fine-grained operations into LLM / TTS / STT."""
    op = (operation or "").strip().lower()
    if op == "stt":
        return "stt"
    if op in _TTS_OPERATIONS or op.startswith("tts"):
        return "tts"
    return "llm"


def _bucket_label(service: str, operation: str) -> str:
    if service == "gemini":
        if operation == "stt":
            return "Gemini · STT"
        if operation in ("heritage_compose", "heritage_repeat"):
            return "Gemini · Trả lời Bố"
        if operation == "heritage_analyzer":
            return "Gemini · Phân tích"
        if operation == "heritage_grounding":
            return "Gemini · Soát grounding"
        if operation == "heritage_compact":
            return "Gemini · Gom trí nhớ"
        if operation == "agent":
            return "Gemini · Người giữ nhà"
        if operation == "voice_script":
            return "Gemini · Script Voice DNA"
        return f"Gemini · {operation}"
    if service in ("elevenlabs", "minimax"):
        label = "ElevenLabs" if service == "elevenlabs" else "MiniMax"
        if operation == "tts_chat":
            return f"{label} · TTS chat"
        if operation == "tts_lab":
            return f"{label} · TTS lab"
        return f"{label} · TTS"
    return f"{service} · {operation}"


def aggregate_space_usage(db: Session, *, space_id: str, days: int = 30) -> dict:
    """Summarize usage for steward dashboard."""
    days = max(1, min(days, 366))
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)

    rows = (
        db.query(AiUsageEvent)
        .filter(
            AiUsageEvent.space_id == space_id,
            AiUsageEvent.created_at >= start,
        )
        .order_by(AiUsageEvent.created_at.asc())
        .all()
    )

    total_cost = 0.0
    total_calls = len(rows)
    by_service: dict[str, dict] = {}
    by_operation: dict[str, dict] = {}
    by_modality: dict[str, dict] = {
        key: {
            "label": _MODALITY_LABELS[key],
            "service": key,
            "operation": key,
            "calls": 0,
            "ok_calls": 0,
            "estimated_usd": 0.0,
            "input_tokens": 0,
            "output_tokens": 0,
            "input_chars": 0,
            "output_chars": 0,
            "latency_ms": 0,
        }
        for key in _MODALITY_ORDER
    }
    daily: dict[str, dict] = {}

    def _acc(
        bucket: dict,
        key: str,
        row: AiUsageEvent,
        *,
        label: str | None = None,
        service: str | None = None,
        operation: str | None = None,
    ) -> None:
        entry = bucket.setdefault(
            key,
            {
                "label": label or _bucket_label(row.service, row.operation),
                "service": service if service is not None else row.service,
                "operation": operation if operation is not None else row.operation,
                "calls": 0,
                "ok_calls": 0,
                "estimated_usd": 0.0,
                "input_tokens": 0,
                "output_tokens": 0,
                "input_chars": 0,
                "output_chars": 0,
                "latency_ms": 0,
            },
        )
        entry["calls"] += 1
        if row.ok:
            entry["ok_calls"] += 1
        entry["estimated_usd"] = round(
            entry["estimated_usd"] + (row.estimated_cost_usd or 0), 6
        )
        if row.input_tokens:
            entry["input_tokens"] += row.input_tokens
        if row.output_tokens:
            entry["output_tokens"] += row.output_tokens
        entry["input_chars"] += row.input_chars or 0
        entry["output_chars"] += row.output_chars or 0
        entry["latency_ms"] += row.latency_ms or 0

    for row in rows:
        total_cost += row.estimated_cost_usd or 0
        _acc(by_service, row.service, row)
        _acc(by_operation, row.operation, row)
        modality = modality_for_operation(row.operation)
        _acc(
            by_modality,
            modality,
            row,
            label=_MODALITY_LABELS[modality],
            service=modality,
            operation=modality,
        )
        day = row.created_at.date().isoformat()
        day_entry = daily.setdefault(
            day, {"date": day, "calls": 0, "estimated_usd": 0.0}
        )
        day_entry["calls"] += 1
        day_entry["estimated_usd"] = round(
            day_entry["estimated_usd"] + (row.estimated_cost_usd or 0), 6
        )

    # Round bucket totals
    for entry in by_service.values():
        entry["estimated_usd"] = round(entry["estimated_usd"], 4)
    for entry in by_operation.values():
        entry["estimated_usd"] = round(entry["estimated_usd"], 4)
    for entry in by_modality.values():
        entry["estimated_usd"] = round(entry["estimated_usd"], 4)

    daily_list = sorted(daily.values(), key=lambda d: d["date"])
    modality_list = [
        by_modality[key] for key in _MODALITY_ORDER if by_modality[key]["calls"] > 0
    ]

    return {
        "period_days": days,
        "from": start.isoformat(),
        "to": now.isoformat(),
        "totals": {
            "estimated_usd": round(total_cost, 4),
            "calls": total_calls,
            "by_modality": modality_list,
            "by_service": sorted(
                by_service.values(), key=lambda x: -x["estimated_usd"]
            ),
            "by_operation": sorted(
                by_operation.values(), key=lambda x: -x["estimated_usd"]
            ),
        },
        "daily": daily_list,
        "disclaimer": (
            "Chi phí ước tính từ bảng giá tham chiếu — không phải hoá đơn thật "
            "từ Google/ElevenLabs/MiniMax."
        ),
        "presence": presence_for_space(db, space_id=space_id, days=days),
    }
