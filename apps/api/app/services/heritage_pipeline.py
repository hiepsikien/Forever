"""Per-space heritage AI pipeline toggles (steward/owner admin).

Global env flags in config.py remain the server default / kill-switch.
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
)

PIPELINE_FLAG_META: dict[str, dict[str, str]] = {
    "stt": {
        "label": "STT",
        "help": "Nghe giọng thành chữ trước khi Bố trả lời. Tắt = tin giọng không có chữ.",
    },
    "analyzer": {
        "label": "Analyzer",
        "help": "Hiểu ngữ cảnh (intent, độ dài) trước khi nói. +1 lần gọi Gemini mỗi lượt.",
    },
    "grounding": {
        "label": "Grounding",
        "help": "Kiểm tra năm/tên trong câu Bố có neo vào ký ức không.",
    },
    "critic": {
        "label": "Critic",
        "help": "Viết lại câu khi nghi bịa. Cần Grounding bật. +1 lần gọi Gemini khi có nghi.",
    },
    "tts": {
        "label": "TTS",
        "help": "Đọc câu trả lời bằng giọng đã clone. Tắt = chỉ chữ.",
    },
    "anti_repeat": {
        "label": "Anti-repeat",
        "help": "Tránh hỏi thăm lặp — có thể gọi lại compose một lần.",
    },
}


@dataclass(frozen=True)
class HeritagePipeline:
    stt: bool
    analyzer: bool
    grounding: bool
    critic: bool
    tts: bool
    anti_repeat: bool

    def as_flag_map(self) -> dict[str, bool]:
        return asdict(self)


def server_pipeline_defaults(settings: Settings | None = None) -> HeritagePipeline:
    s = settings or get_settings()
    return HeritagePipeline(
        stt=bool(s.stt_enabled),
        analyzer=bool(s.heritage_analyzer_enabled),
        grounding=bool(s.heritage_grounding_enabled),
        critic=bool(s.heritage_critic_enabled),
        tts=bool(s.heritage_tts_enabled),
        anti_repeat=bool(s.heritage_anti_repeat_enabled),
    )


def _parse_overrides(raw: str | None) -> dict[str, bool]:
    if not raw or not str(raw).strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("heritage_pipeline_json invalid JSON")
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, bool] = {}
    for key in PIPELINE_FLAG_KEYS:
        if key not in data:
            continue
        val = data[key]
        if isinstance(val, bool):
            out[key] = val
    return out


def load_heritage_pipeline(
    db: Session, space_id: str, *, settings: Settings | None = None
) -> HeritagePipeline:
    """Effective flags for this family space."""
    defaults = server_pipeline_defaults(settings)
    row = (
        db.query(SpaceSettings)
        .filter(SpaceSettings.space_id == space_id)
        .one_or_none()
    )
    overrides = _parse_overrides(
        getattr(row, "heritage_pipeline_json", None) if row else None
    )
    if not overrides:
        return defaults
    merged = defaults.as_flag_map()
    merged.update(overrides)
    return HeritagePipeline(**{k: bool(merged[k]) for k in PIPELINE_FLAG_KEYS})


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
    overrides = _parse_overrides(
        getattr(row, "heritage_pipeline_json", None) if row else None
    )
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
                "overridden": key in overrides,
            }
        )
    return {
        "flags": flags,
        "note": (
            "Tắt Analyzer/Critic để giảm chi phí. Grounding vẫn có thể bật "
            "để chỉ gắn cờ mà không viết lại (khi Critic tắt)."
        ),
    }


def apply_pipeline_overrides(
    row: SpaceSettings, updates: dict[str, bool | None]
) -> None:
    """Merge steward toggles into heritage_pipeline_json.

    Pass ``None`` for a key to clear the space override (follow server default).
    """
    current = _parse_overrides(getattr(row, "heritage_pipeline_json", None))
    for key, value in updates.items():
        if key not in PIPELINE_FLAG_KEYS:
            continue
        if value is None:
            current.pop(key, None)
        else:
            current[key] = bool(value)
    row.heritage_pipeline_json = (
        json.dumps(current, ensure_ascii=False) if current else ""
    )
