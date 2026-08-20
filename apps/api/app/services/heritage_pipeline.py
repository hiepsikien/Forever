"""Per-space heritage AI pipeline toggles + LLM model picks (steward/owner).

Global env flags/models in config.py remain the server default / kill-switch.
Space overrides live in SpaceSettings.heritage_pipeline_json.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from typing import Any

from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..models import SpaceSettings

logger = logging.getLogger(__name__)

# Keys stored in heritage_pipeline_json and shown in admin UI.
PIPELINE_FLAG_KEYS = (
    "stt",
    "analyzer",
    "grounding",
    "critic",
    "tts",
    "anti_repeat",
    "family_bridge",
)

PIPELINE_FLAG_META: dict[str, dict[str, str]] = {
    "stt": {
        "label": "STT",
        "help": "Nghe giọng thành chữ trước khi người được nhớ trả lời. Tắt = tin giọng không có chữ.",
    },
    "analyzer": {
        "label": "Analyzer",
        "help": "Hiểu ngữ cảnh (intent, độ dài) trước khi nói. +1 lần gọi Gemini mỗi lượt.",
    },
    "grounding": {
        "label": "Grounding",
        "help": "Kiểm tra năm/tên trong câu trả lời có neo vào ký ức không.",
    },
    "critic": {
        "label": "Critic",
        "help": "Viết lại câu khi nghi bịa. Cần Grounding bật. +1 lần gọi Gemini khi có nghi.",
    },
    "tts": {
        "label": "TTS",
        "help": "Đọc câu trả lời bằng giọng đã clone — chỉ khi thành viên nói (Gọi / tin giọng). Chat chữ vẫn là Gemini, không gọi MiniMax. Tắt = chỉ chữ.",
    },
    "anti_repeat": {
        "label": "Anti-repeat",
        "help": "Tránh hỏi thăm lặp — có thể gọi lại compose một lần.",
    },
    "family_bridge": {
        "label": "Cầu nối gia đình",
        "help": "Sau nỗi nhớ, thêm một câu nhắc về người sống. Không bịa ký ức.",
    },
}

# Gemini text/audio models stewards may pick for LLM phases.
LLM_MODEL_KEYS = ("stt", "analyzer", "compose", "critic")

LLM_MODEL_META: dict[str, dict[str, str]] = {
    "stt": {
        "label": "STT",
        "help": "Ghi âm → chữ. Nên giữ 3.1 Flash-Lite.",
    },
    "analyzer": {
        "label": "Analyzer",
        "help": "Phân tích ngữ cảnh trước lượt trả lời. Nên giữ 3.1 Flash-Lite.",
    },
    "compose": {
        "label": "Compose",
        "help": "Câu trả lời chính của người được nhớ (luôn bật). Nên 3.5 Flash.",
    },
    "critic": {
        "label": "Critic",
        "help": "Viết lại khi Grounding nghi bịa. Nên 3.1 Flash-Lite.",
    },
}

LLM_MODEL_CHOICES: tuple[dict[str, str], ...] = (
    {
        "id": "gemini-3.1-flash-lite",
        "label": "3.1 Flash-Lite",
        "help": "Rẻ nhất — phù hợp STT / việc nhẹ",
    },
    {
        "id": "gemini-3.5-flash",
        "label": "3.5 Flash",
        "help": "Cân bằng — mặc định compose",
    },
    {
        "id": "gemini-3.6-flash",
        "label": "3.6 Flash",
        "help": "Mới hơn; output ~17% rẻ hơn 3.5",
    },
    {
        "id": "gemini-3.7-flash",
        "label": "3.7 Flash",
        "help": "Mới nhất — mạnh hơn cho compose; giá intro giống 3.6 đến hết 2026",
    },
)

_ALLOWED_MODEL_IDS = frozenset(c["id"] for c in LLM_MODEL_CHOICES)


@dataclass(frozen=True)
class HeritagePipeline:
    stt: bool
    analyzer: bool
    grounding: bool
    critic: bool
    tts: bool
    anti_repeat: bool
    family_bridge: bool
    stt_model: str
    analyzer_model: str
    compose_model: str
    critic_model: str

    def as_flag_map(self) -> dict[str, bool]:
        return {k: bool(getattr(self, k)) for k in PIPELINE_FLAG_KEYS}

    def as_model_map(self) -> dict[str, str]:
        return {k: str(getattr(self, f"{k}_model")) for k in LLM_MODEL_KEYS}


def server_pipeline_defaults(settings: Settings | None = None) -> HeritagePipeline:
    s = settings or get_settings()
    compose = s.compose_model
    analyzer = s.analyzer_model
    stt = (s.stt_model or "").strip() or s.gemini_model
    return HeritagePipeline(
        stt=bool(s.stt_enabled),
        analyzer=bool(s.heritage_analyzer_enabled),
        grounding=bool(s.heritage_grounding_enabled),
        critic=bool(s.heritage_critic_enabled),
        tts=bool(s.heritage_tts_enabled),
        anti_repeat=bool(s.heritage_anti_repeat_enabled),
        family_bridge=bool(s.heritage_family_bridge_enabled),
        stt_model=stt,
        analyzer_model=analyzer,
        compose_model=compose,
        critic_model=s.critic_model,
    )


def _load_raw(raw: object) -> dict[str, Any]:
    if raw is None or not isinstance(raw, str) or not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("heritage_pipeline_json invalid JSON")
        return {}
    return data if isinstance(data, dict) else {}


def _parse_flag_overrides(data: dict[str, Any]) -> dict[str, bool]:
    out: dict[str, bool] = {}
    for key in PIPELINE_FLAG_KEYS:
        if key not in data:
            continue
        val = data[key]
        if isinstance(val, bool):
            out[key] = val
    return out


def _parse_model_overrides(data: dict[str, Any]) -> dict[str, str]:
    nested = data.get("models")
    if not isinstance(nested, dict):
        return {}
    out: dict[str, str] = {}
    for key in LLM_MODEL_KEYS:
        if key not in nested:
            continue
        val = nested[key]
        if isinstance(val, str) and val.strip() in _ALLOWED_MODEL_IDS:
            out[key] = val.strip()
    return out


def load_heritage_pipeline(
    db: Session, space_id: str, *, settings: Settings | None = None
) -> HeritagePipeline:
    """Effective flags + models for this family space."""
    defaults = server_pipeline_defaults(settings)
    row = (
        db.query(SpaceSettings)
        .filter(SpaceSettings.space_id == space_id)
        .one_or_none()
    )
    data = _load_raw(getattr(row, "heritage_pipeline_json", None) if row else None)
    flag_overrides = _parse_flag_overrides(data)
    model_overrides = _parse_model_overrides(data)
    flags = defaults.as_flag_map()
    flags.update(flag_overrides)
    models = defaults.as_model_map()
    models.update(model_overrides)
    return HeritagePipeline(
        **{k: bool(flags[k]) for k in PIPELINE_FLAG_KEYS},
        stt_model=models["stt"],
        analyzer_model=models["analyzer"],
        compose_model=models["compose"],
        critic_model=models["critic"],
    )


def pipeline_admin_payload(
    db: Session, space_id: str, *, settings: Settings | None = None
) -> dict[str, Any]:
    """Shape for GET/PATCH settings — labels + effective + server defaults."""
    defaults = server_pipeline_defaults(settings)
    effective = load_heritage_pipeline(db, space_id, settings=settings)
    row = (
        db.query(SpaceSettings)
        .filter(SpaceSettings.space_id == space_id)
        .one_or_none()
    )
    data = _load_raw(getattr(row, "heritage_pipeline_json", None) if row else None)
    flag_overrides = _parse_flag_overrides(data)
    model_overrides = _parse_model_overrides(data)

    flags = []
    for key in PIPELINE_FLAG_KEYS:
        meta = PIPELINE_FLAG_META[key]
        flags.append(
            {
                "key": key,
                "label": meta["label"],
                "help": meta["help"],
                "enabled": getattr(effective, key),
                "server_default": getattr(defaults, key),
                "overridden": key in flag_overrides,
            }
        )

    models = []
    for key in LLM_MODEL_KEYS:
        meta = LLM_MODEL_META[key]
        models.append(
            {
                "key": key,
                "label": meta["label"],
                "help": meta["help"],
                "model": getattr(effective, f"{key}_model"),
                "server_default": getattr(defaults, f"{key}_model"),
                "overridden": key in model_overrides,
            }
        )

    return {
        "flags": flags,
        "models": models,
        "model_choices": list(LLM_MODEL_CHOICES),
        "note": (
            "Mặc định: STT/Analyzer/Critic = 3.1 Flash-Lite, Compose = 3.5 Flash. "
            "3.6/3.7 chỉ khi steward chủ động chọn."
        ),
    }


def apply_pipeline_overrides(
    row: SpaceSettings,
    *,
    flags: dict[str, bool | None] | None = None,
    models: dict[str, str | None] | None = None,
) -> None:
    """Merge steward toggles/models into heritage_pipeline_json.

    Pass ``None`` for a flag/model key to clear the space override.
    """
    data = _load_raw(getattr(row, "heritage_pipeline_json", None))
    current_flags = _parse_flag_overrides(data)
    current_models = _parse_model_overrides(data)

    if flags:
        for key, value in flags.items():
            if key not in PIPELINE_FLAG_KEYS:
                continue
            if value is None:
                current_flags.pop(key, None)
            else:
                current_flags[key] = bool(value)

    if models:
        for key, value in models.items():
            if key not in LLM_MODEL_KEYS:
                continue
            if value is None:
                current_models.pop(key, None)
                continue
            cleaned = value.strip()
            if cleaned not in _ALLOWED_MODEL_IDS:
                raise ValueError(f"Unsupported model for {key}: {cleaned}")
            current_models[key] = cleaned

    payload: dict[str, Any] = dict(current_flags)
    if current_models:
        payload["models"] = current_models
    row.heritage_pipeline_json = (
        json.dumps(payload, ensure_ascii=False) if payload else ""
    )


# Back-compat helper used by older tests that passed a flat bool dict.
def apply_pipeline_flag_overrides(
    row: SpaceSettings, updates: dict[str, bool | None]
) -> None:
    apply_pipeline_overrides(row, flags=updates)
