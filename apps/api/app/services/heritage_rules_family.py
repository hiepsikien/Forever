"""Tầng 2 — Hiến chương gia đình: mỗi nhà tự chốt, mọi người được nhớ cùng theo.

Khác tầng 1 ở chỗ đây là lựa chọn của một gia đình, không phải luật sản phẩm —
nên nó nằm trong DB (`SpaceSettings.family_charter_json`) và steward sửa được
mà không cần deploy. Khác tầng 3 ở chỗ nó không thuộc riêng ai: Bố và Bà trong
cùng một nhà chịu chung hiến chương này.

Như tầng 1, không câu chữ nào ở đây được viết cứng đại từ của một người: bộ dò
phủ hết từ thân tộc, còn lời nói ra thì dựng từ `Persona`.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, replace
from typing import Any

from sqlalchemy.orm import Session

from ..models import SpaceSettings
from .heritage_persona import Persona, cap
from .heritage_rules_app import KINSHIP_SELF_WORDS

logger = logging.getLogger(__name__)

SENSITIVE_DOMAINS = ("divide", "money", "health", "legal", "afterlife")

_KIN = "|".join(KINSHIP_SELF_WORDS)

_DIVIDE = re.compile(
    r"("
    r"các\s+con\s+không\s+(hiểu|thương|quan\s+tâm|yêu)|"
    rf"con\s+không\s+hiểu\s+({_KIN})|"
    rf"chỉ\s+có\s+({_KIN})\s+hiểu|"
    rf"không\s+ai\s+hiểu\s+({_KIN})|"
    rf"các\s+con\s+(bỏ|bội)\s+({_KIN})"
    r")",
    re.IGNORECASE,
)

# Quyết định / lời khuyên — không phải nhắc tới một căn nhà hay bệnh cũ.
_MONEY = re.compile(
    r"("
    r"thừa\s*kế|chia\s+tài|chia\s+nhà|"
    r"nên\s+(bán|mua)\s+(nhà|căn|đất)|"
    r"bán\s+(nhà|căn|đất)\s+(không|đi|chưa|hộ)|"
    r"sổ\s*đỏ|vay\s+tiền|thế\s+chấp|"
    rf"cho\s+tiền\s+(con|cháu|{_KIN})|"
    r"đầu\s+tư\s+(không|đi|vào)"
    r")",
    re.IGNORECASE,
)

_HEALTH = re.compile(
    r"("
    r"uống\s+thuốc\s+(này|kia|huyết|đó)|"
    r"kê\s+đơn|"
    r"chẩn\s+đoán|"
    rf"bác\s+sĩ\s+(bảo|nói|kêu)\s+(con|cháu|{_KIN})|"
    rf"({_KIN})\s+nên\s+(uống|mổ|khám)|"
    rf"({_KIN})\s+bảo\s+({_KIN})\s+(uống|mổ|khám)"
    r")",
    re.IGNORECASE,
)

_LEGAL = re.compile(
    r"("
    r"kiện\s+tụng|luật\s+sư|công\s+chứng|"
    r"làm\s+di\s+chúc|viết\s+di\s+chúc|"
    r"đơn\s+kiện|tranh\s+chấp\s+(đất|nhà)|"
    rf"giấy\s+tờ\s+nhà|ra\s+tòa|\bkiện\s+(các\s+con|{_KIN})"
    r")",
    re.IGNORECASE,
)

_AFTERLIFE = re.compile(
    r"("
    r"kiếp\s+sau|thế\s+giới\s+bên\s+kia|bên\s+kia\s+thế\s+giới|"
    r"báo\s+mộng|cõi\s+âm|thiên\s+đường|"
    rf"linh\s+hồn\s+({_KIN})|"
    rf"({_KIN})\s+đang\s+ở\s+trên|"
    r"nói\s+chuyện\s+với\s+người\s+chết"
    r")",
    re.IGNORECASE,
)

# «Con nhớ bố» là lời bình thường của sản phẩm — không phải buổi cần hạ nhịp.
_GRIEF = re.compile(
    rf"(nhớ\s+({_KIN})\s+quá|nhớ\s+quá|thương\s+quá|buồn\s+quá)",
    re.IGNORECASE,
)

# Model lẫn code đều hay kết bằng «hãy nói chuyện với gia đình». Bắt rộng để
# không chồng ba lượt liên tiếp.
_REDIRECT_BASE = (
    r"kể với (các con|mẹ|anh chị|người nhà|gia đình|chúng)|"
    r"bàn với (gia đình|người nhà)|"
    r"nói chuyện với (gia đình|người nhà|các con|mẹ)|"
    r"gọi (chúng|các con|anh chị)|"
    r"nhà mình còn|"
    r"về với (gia đình|người thật|người sống)|"
    r"kể với người đang sống"
)

FAMILY_REDIRECT = re.compile(f"({_REDIRECT_BASE})", re.IGNORECASE)

_SENT_SPLIT = re.compile(r"(?<=[.!?…])\s+")

DEFAULT_LIVING_KIN = "người nhà"

# Hiến chương mặc định — chỉ việc lớn. Chuyện nhà, thơ, người thân: được kể.
DEFAULT_CHARTER_LINES: tuple[str, ...] = (
    "Không quyết hộ người sống việc lớn: bán nhà, chia tài, uống thuốc, giấy tờ pháp lý.",
    "Không nói xấu, không chia rẽ những người đang sống trong nhà.",
    "Được nhớ và nhận xét chuyện nhà, thơ, con cháu đã có trong ký ức — kể cả lời dặn "
    "của chính mình, khi đó là giá trị hay bài thơ đã lưu.",
    "Thiếu một chi tiết thì nói chưa nhớ phần đó, rồi trả lời phần còn biết. Đừng từ chối "
    "cả câu, đừng biến mỗi lượt thành «hãy nói với gia đình».",
)


@dataclass(frozen=True)
class FamilyCharter:
    lines: tuple[str, ...] = DEFAULT_CHARTER_LINES
    living_kin: str = DEFAULT_LIVING_KIN
    spouse_affection_per_day: int = 1

    @property
    def redirect_re(self) -> re.Pattern[str]:
        if self.living_kin == DEFAULT_LIVING_KIN:
            return FAMILY_REDIRECT
        extra = re.escape(self.living_kin)
        return re.compile(
            f"({_REDIRECT_BASE}|kể với {extra}|bàn với {extra})", re.IGNORECASE
        )

    def render(self) -> str:
        return "\n".join(f"- {line}" for line in self.lines)


DEFAULT_CHARTER = FamilyCharter()


def _load_raw(raw: object) -> dict[str, Any]:
    if not isinstance(raw, str) or not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("family_charter_json invalid JSON")
        return {}
    return data if isinstance(data, dict) else {}


def charter_from_data(data: dict[str, Any]) -> FamilyCharter:
    charter = DEFAULT_CHARTER
    raw_lines = data.get("lines")
    if isinstance(raw_lines, list):
        lines = tuple(
            " ".join(str(line).split())
            for line in raw_lines
            if isinstance(line, str) and line.strip()
        )
        if lines:
            charter = replace(charter, lines=lines)
    kin = data.get("living_kin")
    if isinstance(kin, str) and kin.strip():
        charter = replace(charter, living_kin=kin.strip())
    per_day = data.get("spouse_affection_per_day")
    if isinstance(per_day, int) and not isinstance(per_day, bool) and per_day >= 0:
        charter = replace(charter, spouse_affection_per_day=per_day)
    return charter


def load_family_charter(db: Session, space_id: str) -> FamilyCharter:
    """Hiến chương đang hiệu lực của một nhà (mặc định nếu chưa sửa)."""
    row = (
        db.query(SpaceSettings)
        .filter(SpaceSettings.space_id == space_id)
        .one_or_none()
    )
    return charter_from_data(
        _load_raw(getattr(row, "family_charter_json", None) if row else None)
    )


def apply_charter_overrides(
    row: SpaceSettings,
    *,
    lines: list[str] | None = None,
    living_kin: str | None = None,
    spouse_affection_per_day: int | None = None,
) -> None:
    """Ghi lựa chọn của steward. Truyền chuỗi/danh sách rỗng để trả về mặc định."""
    data = _load_raw(getattr(row, "family_charter_json", None))
    if lines is not None:
        cleaned = [" ".join(l.split()) for l in lines if l and l.strip()]
        if cleaned:
            data["lines"] = cleaned
        else:
            data.pop("lines", None)
    if living_kin is not None:
        if living_kin.strip():
            data["living_kin"] = living_kin.strip()
        else:
            data.pop("living_kin", None)
    if spouse_affection_per_day is not None:
        if spouse_affection_per_day < 0:
            raise ValueError("spouse_affection_per_day phải >= 0")
        data["spouse_affection_per_day"] = int(spouse_affection_per_day)
    row.family_charter_json = json.dumps(data, ensure_ascii=False) if data else ""


def charter_admin_payload(db: Session, space_id: str) -> dict[str, Any]:
    effective = load_family_charter(db, space_id)
    row = (
        db.query(SpaceSettings)
        .filter(SpaceSettings.space_id == space_id)
        .one_or_none()
    )
    data = _load_raw(getattr(row, "family_charter_json", None) if row else None)
    return {
        "lines": list(effective.lines),
        "living_kin": effective.living_kin,
        "spouse_affection_per_day": effective.spouse_affection_per_day,
        "defaults": {
            "lines": list(DEFAULT_CHARTER_LINES),
            "living_kin": DEFAULT_LIVING_KIN,
            "spouse_affection_per_day": DEFAULT_CHARTER.spouse_affection_per_day,
        },
        "overridden": sorted(data.keys()),
        "note": (
            "Hiến chương áp cho MỌI người được nhớ trong nhà này. "
            "Xưng hô riêng của từng người nằm ở Bản sắc, không phải ở đây."
        ),
    }


def charter_block(charter: FamilyCharter | None = None) -> str:
    return (charter or DEFAULT_CHARTER).render()


def spouse_affection_rule(
    persona: Persona, audience: str | None, charter: FamilyCharter | None = None
) -> str:
    """Nhịp tình cảm vợ chồng — lựa chọn của gia đình, không phải luật app."""
    charter = charter or DEFAULT_CHARTER
    if persona.audience(audience) != "spouse" or charter.spouse_affection_per_day <= 0:
        return ""
    me = persona.me("spouse")
    you = persona.you("spouse")
    return (
        f"Tình cảm vợ chồng được phép, nhưng tối đa {charter.spouse_affection_per_day} "
        f"câu tỏ tình trực tiếp mỗi ngày («{me} yêu {you}», «{me} nhớ {you}»). "
        "Các lượt sau trong ngày: ấm áp bằng việc nhà, thơ, con cháu — "
        "không lặp câu quyến luyến."
    )


def looks_like_sensitive(text: str) -> str | None:
    """Trả về tên miền, hoặc None. Chia rẽ được xét trước."""
    if _DIVIDE.search(text or ""):
        return "divide"
    if _MONEY.search(text or ""):
        return "money"
    if _HEALTH.search(text or ""):
        return "health"
    if _LEGAL.search(text or ""):
        return "legal"
    if _AFTERLIFE.search(text or ""):
        return "afterlife"
    return None


def looks_like_grief(text: str) -> bool:
    return bool(_GRIEF.search(text or ""))


def refuse_sensitive(
    domain: str,
    persona: Persona,
    *,
    audience: str | None = None,
    charter: FamilyCharter | None = None,
) -> str:
    charter = charter or DEFAULT_CHARTER
    me = persona.me(audience)
    you = persona.you(audience)
    kin = charter.living_kin
    if domain == "divide":
        return (
            f"{cap(you)} ơi, chỗ này {me} không bàn được theo hướng chia rẽ. "
            f"Cả nhà mình vẫn là một nhà. {cap(me)} nhớ cả nhà."
        )
    if domain == "money":
        return (
            f"{cap(you)} ơi, chỗ này {me} không bàn được — "
            f"tiền bạc, nhà cửa là việc của người đang sống. "
            f"{cap(you)} bàn với {kin} nhé."
        )
    if domain == "health":
        return (
            f"{cap(you)} ơi, chỗ này {me} không bàn được — "
            f"sức khỏe thì gặp bác sĩ, và kể với {kin}. "
            f"{cap(me)} không quyết thay {you} được."
        )
    if domain == "legal":
        return (
            f"{cap(you)} ơi, chỗ này {me} không bàn được — "
            f"việc giấy tờ, pháp lý là của người đang sống. "
            f"{cap(you)} bàn với {kin} nhé."
        )
    if domain == "afterlife":
        return (
            f"{cap(you)} ơi, chỗ này {me} không bàn được. "
            f"Đây là ký ức gia đình đã lưu, không phải {me} đang ở thế giới bên kia. "
            f"{cap(you)} nhớ thì kể với {kin}."
        )
    return (
        f"{cap(you)} ơi, chỗ này {me} không bàn được — "
        f"mình giữ Phòng khách ấm áp, điều tốt cho gia đình thôi."
    )


def append_sentence(body: str, extra: str) -> str:
    base = (body or "").strip()
    extra = (extra or "").strip()
    if not extra:
        return base
    if extra.lower() in base.lower():
        return base
    if not base:
        return extra
    if base[-1] not in ".!?…":
        base = f"{base}."
    return f"{base} {extra}"


def recent_had_family_redirect(
    previous: list[str] | None, charter: FamilyCharter | None = None
) -> bool:
    pattern = (charter or DEFAULT_CHARTER).redirect_re
    return any(pattern.search(text or "") for text in (previous or [])[-3:])


def strip_repeated_family_redirect(
    body: str, previous: list[str] | None, charter: FamilyCharter | None = None
) -> str:
    """Bỏ câu «nói với gia đình» khi một lượt gần đây đã nhắc rồi."""
    charter = charter or DEFAULT_CHARTER
    text = (body or "").strip()
    if not text or not recent_had_family_redirect(previous, charter):
        return text
    parts = [p.strip() for p in _SENT_SPLIT.split(text) if p.strip()]
    if len(parts) <= 1:
        return text
    pattern = charter.redirect_re
    kept = [p for p in parts if not pattern.search(p)]
    if not kept:
        return parts[0]
    return " ".join(kept)


def _pick(lines: tuple[str, ...], *, seed: str) -> str:
    if not lines:
        return ""
    return lines[sum(ord(c) for c in seed) % len(lines)]


def bridge_lines(
    persona: Persona, audience: str | None, charter: FamilyCharter
) -> tuple[str, ...]:
    me = persona.me(audience)
    you = persona.you(audience)
    kin = charter.living_kin
    if persona.audience(audience) == "spouse":
        return (
            f"Nhà mình còn đó — {you} kể với {kin} một câu hôm nay cũng được.",
            "Nhà mình vẫn vậy. Các con cũng đang nhớ — gọi chúng một tiếng nhé.",
        )
    return (
        f"{cap(you)} nhớ {me} thì kể với {kin} một câu cũng được.",
        f"Nhà mình còn đó — {me} vui khi {you} ở bên người sống.",
    )


def winddown_line(
    persona: Persona, audience: str | None, charter: FamilyCharter
) -> str:
    me = persona.me(audience)
    you = persona.you(audience)
    if persona.audience(audience) == "spouse":
        return (
            f"Nhà mình vẫn vậy. Giờ {you} nghỉ một chút, nhà mình còn đang chờ {you}."
        )
    return (
        f"{cap(me)} nhớ {you}. Giờ {you} nghỉ một chút, "
        f"rồi kể với {charter.living_kin} nhé."
    )


def maybe_family_bridge(
    body: str,
    *,
    enabled: bool,
    persona: Persona,
    audience: str | None,
    grief: bool,
    seed: str,
    previous: list[str] | None = None,
    charter: FamilyCharter | None = None,
) -> tuple[str, str | None]:
    charter = charter or DEFAULT_CHARTER
    if not enabled or not grief or not (body or "").strip():
        return body, None
    if charter.redirect_re.search(body):
        return body, None
    if recent_had_family_redirect(previous, charter):
        return body, None
    line = _pick(bridge_lines(persona, audience, charter), seed=seed or "bridge")
    return append_sentence(body, line), "grief"


def maybe_winddown(
    body: str,
    *,
    sitting_turns: int,
    threshold: int,
    persona: Persona,
    audience: str | None,
    charter: FamilyCharter | None = None,
) -> tuple[str, str | None]:
    if threshold <= 0 or sitting_turns < threshold:
        return body, None
    # Nhắc nghỉ mỗi `threshold` lượt, KHÔNG phải mọi lượt sau lượt thứ
    # `threshold` — ngồi lâu thì cái nhắc ấy dính vào từng câu trả lời và
    # «Bà nhớ cháu» thành cái đuôi máy móc.
    if (sitting_turns - threshold) % threshold:
        return body, None
    if not (body or "").strip():
        return body, None
    charter = charter or DEFAULT_CHARTER
    return append_sentence(body, winddown_line(persona, audience, charter)), "sitting"
