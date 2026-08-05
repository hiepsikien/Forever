"""Pick which core values should drive this particular answer.

Listing all six values in the prompt every turn produces uniform warmth —
pleasant, and not much like a person. Choosing one or two that fit what was
asked gives each reply a spine: advice to a child leans on chữ nhân, a message
from the wife leans on thủy chung.
"""

from __future__ import annotations

# Value ids come from the Identity Lock (core_values[].id).
_LENS_BY_TOPIC: dict[str, tuple[str, ...]] = {
    "vo_chong": ("marital_fidelity", "family_love"),
    "con_cai": ("family_love", "filial_piety"),
    "gia_dinh": ("family_love",),
    "nghe_giao": ("teacher_craft",),
    "tho": ("serene_aging",),
    "biet_on": ("filial_piety",),
    "truyen_thong": ("filial_piety", "moral_integrity"),
}

_LENS_BY_INTENT: dict[str, tuple[str, ...]] = {
    "ask_advice": ("moral_integrity", "filial_piety"),
    "grief": ("serene_aging", "family_love"),
}

_FALLBACK = ("family_love",)
MAX_LENS = 2


def _normalized_values(core_values: object | None) -> list[dict]:
    if not isinstance(core_values, list):
        return []
    out: list[dict] = []
    for item in core_values:
        if isinstance(item, dict):
            label = (item.get("label") or item.get("text") or "").strip()
            if not label or "PLACEHOLDER" in label.upper():
                continue
            out.append(
                {
                    "id": (item.get("id") or "").strip(),
                    "label": label,
                    "example": (item.get("example") or "").strip(),
                }
            )
        elif isinstance(item, str) and item.strip():
            out.append({"id": "", "label": item.strip(), "example": ""})
    return out


def select_value_lens(
    core_values: object | None, *, intent: str = "smalltalk", topics: list[str] | None = None
) -> list[dict]:
    values = _normalized_values(core_values)
    if not values:
        return []

    wanted: list[str] = []
    for source in (_LENS_BY_INTENT.get(intent, ()), *(
        _LENS_BY_TOPIC.get(topic, ()) for topic in (topics or [])
    ), _FALLBACK):
        for value_id in source:
            if value_id not in wanted:
                wanted.append(value_id)

    by_id = {value["id"]: value for value in values if value["id"]}
    picked: list[dict] = []
    for value_id in wanted:
        value = by_id.get(value_id)
        if value and value not in picked:
            picked.append(value)
        if len(picked) >= MAX_LENS:
            break
    # A Lock without matching ids still deserves a spine.
    if not picked:
        picked = values[:1]
    return picked


def value_lens_block(values: list[dict]) -> str:
    if not values:
        return ""
    lines = ["LĂNG KÍNH GIÁ TRỊ CHO LƯỢT NÀY:"]
    for value in values:
        line = f"- «{value['label']}»"
        if value.get("example"):
            line += f" — ví dụ hành vi: {value['example']}"
        lines.append(line)
    lines.append(
        "Phản chiếu giá trị này bằng chi tiết đời thường, không thuyết giáo, "
        "không nêu tên giá trị ra thành lời."
    )
    return "\n".join(lines)
