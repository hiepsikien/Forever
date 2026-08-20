"""Tầng 3 — Bản sắc: xưng hô riêng của một người được nhớ.

Tầng 1 (luật ứng dụng) và tầng 2 (hiến chương gia đình) không được viết cứng
một đại từ nào — chúng hỏi `Persona`. Persona dựng từ Identity Lock của chính
người đó, nên sửa Bản sắc là đổi được giọng mà không cần deploy.

Bản sắc thắng: nhãn quan hệ chỉ điền vào chỗ steward bỏ trống. Chỗ nào hai bên
mâu thuẫn (Bản sắc của Bà ghi xưng «bố» vì chép từ hồ sơ khác) thì báo ra ở
`lock_conflict` để steward sửa, chứ code không tự viết lại dữ liệu của gia đình.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from ..models import IdentityProfile

NEUTRAL_SELF = "tôi"
NEUTRAL_YOUNGER = "con"

# Nhãn quan hệ → thế hệ. Giữ nguyên dấu: bỏ dấu thì «bà» và «ba» trùng nhau.
_GENERATION_LABELS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("grandmother", ("bà", "bà nội", "bà ngoại", "bà cố", "cụ bà")),
    ("grandfather", ("ông", "ông nội", "ông ngoại", "ông cố", "cụ ông")),
    ("mother", ("mẹ", "má", "mạ", "bầm", "u")),
    ("father", ("bố", "ba", "cha", "tía", "thầy")),
)

_SELF_BY_GENERATION: dict[str, str] = {
    "grandmother": "bà",
    "grandfather": "ông",
    "mother": "mẹ",
    "father": "bố",
}

# Người trên nhưng không phải cha mẹ / ông bà: tự xưng bằng chính nhãn ấy.
_ELDER_LABELS = ("bác", "chú", "cô", "dì", "cậu", "thím", "mợ")

# Cháu gọi người này là gì — mặc định của app khi Bản sắc chưa ghi ô «với cháu».
_GRANDPARENT_SELF: dict[str, str] = {
    "grandmother": "bà",
    "mother": "bà",
    "grandfather": "ông",
    "father": "ông",
}

DEFAULT_GRANDCHILD = "cháu"

# Bậc trên đời con cháu. Bác/chú/cô/dì ngang đời bố mẹ.
_GENERATION_RANK: dict[str, int] = {
    "grandmother": 2,
    "grandfather": 2,
    "mother": 1,
    "father": 1,
    "elder": 1,
}

# Khi nói với con cháu thì gọi người bạn đời của mình là gì.
_SPOUSE_AS_KIN: dict[str, str] = {
    "father": "mẹ",
    "mother": "bố",
    "grandmother": "ông",
    "grandfather": "bà",
}

_MASCULINE_SELF = ("bố", "ba", "cha", "tía", "ông", "anh", "chú", "cậu")
_FEMININE_SELF = ("mẹ", "má", "mạ", "bà", "chị", "cô", "dì", "thím", "mợ")

_FEMALE_GENERATIONS = ("grandmother", "mother")
_MALE_GENERATIONS = ("grandfather", "father")


def cap(word: str) -> str:
    word = (word or "").strip()
    return word[:1].upper() + word[1:] if word else word


AUDIENCES = ("spouse", "child", "grandchild")


@dataclass(frozen=True)
class Persona:
    """Ai đang nói, và họ gọi người nghe là gì.

    Ba vai, mỗi vai một cặp xưng hô riêng. Một cụ bà nói với con là «mẹ — con»
    nhưng với cháu là «bà — cháu»; gộp hai vai làm một là cách «Mẹ nhớ con»
    đến tay đứa cháu.
    """

    display: str = ""
    generation: str = "unknown"
    self_younger: str = NEUTRAL_SELF
    younger: str = NEUTRAL_YOUNGER
    self_peer: str | None = None
    peer: str | None = None
    self_grandchild: str | None = None
    grandchild: str | None = None
    spouse_name: str | None = None
    spouse_as_kin: str | None = None
    lock_conflict: str | None = None

    @property
    def speaks_to_spouse(self) -> bool:
        """Chỉ người có khối «with_spouse» trong Bản sắc mới có vai vợ/chồng."""
        return bool(self.self_peer and self.peer)

    @property
    def speaks_to_grandchildren(self) -> bool:
        return bool(self.self_grandchild and self.grandchild)

    @property
    def generation_rank(self) -> int | None:
        """Người này ở trên đời của người đặt nhãn mấy bậc.

        Nhãn của người được nhớ («Bố», «Bà Nội») viết từ chỗ đứng của gia đình,
        nên nó đọc thẳng ra bậc: bố mẹ 1, ông bà 2. Đây là thứ cho phép biết
        người nhắn là con hay là cháu mà không cần họ tự xưng.
        """
        return _GENERATION_RANK.get(self.generation)

    def audience(self, requested: str | None) -> str:
        """Gập một vai mà người này không thể có về «child»."""
        if requested == "spouse" and self.speaks_to_spouse:
            return "spouse"
        if requested == "grandchild" and self.speaks_to_grandchildren:
            return "grandchild"
        return "child"

    def register(self, audience: str | None) -> tuple[str, str]:
        fitted = self.audience(audience)
        if fitted == "spouse":
            return str(self.self_peer), str(self.peer)
        if fitted == "grandchild":
            return str(self.self_grandchild), str(self.grandchild)
        return self.self_younger, self.younger

    def me(self, audience: str | None = None) -> str:
        return self.register(audience)[0]

    def you(self, audience: str | None = None) -> str:
        return self.register(audience)[1]

    def other_registers(self, audience: str | None) -> tuple[tuple[str, str], ...]:
        """Các cặp xưng hô của vai KHÁC — thứ model hay trượt sang."""
        mine = self.register(audience)
        out: list[tuple[str, str]] = []
        for name in AUDIENCES:
            if self.audience(name) != name and name != "child":
                continue
            pair = self.register(name)
            if pair != mine and pair not in out:
                out.append(pair)
        return tuple(out)


NEUTRAL_PERSONA = Persona()


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _json_object(raw: object) -> dict:
    if not isinstance(raw, str) or not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _slot(block: object, key: str) -> str:
    if not isinstance(block, dict):
        return ""
    return _text(block.get(key))


def _infer_generation(label: str, name: str) -> tuple[str, str]:
    """Thế hệ + cách tự xưng mặc định, suy từ nhãn quan hệ rồi mới tới tên."""
    for haystack in (label, name):
        if not haystack:
            continue
        for generation, labels in _GENERATION_LABELS:
            if haystack in labels:
                return generation, _SELF_BY_GENERATION[generation]
        for generation, labels in _GENERATION_LABELS:
            # «Bà Nội Thông», «Bố Triệu» — nhãn có kèm tên riêng.
            if any(haystack.startswith(f"{lab} ") for lab in labels):
                return generation, _SELF_BY_GENERATION[generation]
    for haystack in (label, name):
        for elder in _ELDER_LABELS:
            if haystack == elder or haystack.startswith(f"{elder} "):
                return "elder", elder
    return "unknown", NEUTRAL_SELF


def _lock_conflict(generation: str, self_younger: str) -> str | None:
    word = (self_younger or "").lower()
    if generation in _FEMALE_GENERATIONS and word in _MASCULINE_SELF:
        return (
            f"Bản sắc ghi tự xưng «{self_younger}» nhưng quan hệ là "
            f"«{_SELF_BY_GENERATION[generation]}» — kiểm tra lại khối Xưng hô."
        )
    if generation in _MALE_GENERATIONS and word in _FEMININE_SELF:
        return (
            f"Bản sắc ghi tự xưng «{self_younger}» nhưng quan hệ là "
            f"«{_SELF_BY_GENERATION[generation]}» — kiểm tra lại khối Xưng hô."
        )
    return None


def spouse_name_from_lock(address: object, roles: object) -> str | None:
    """Tên người bạn đời, chỉ lấy từ Bản sắc của chính người này."""
    if isinstance(address, dict):
        spouse = address.get("with_spouse")
        if isinstance(spouse, dict):
            notes = _text(spouse.get("notes"))
            if notes:
                label = notes.replace("Với ", "").split("(")[0].strip()
                label = label.split("—")[0].strip()
                if label:
                    return label
    if isinstance(roles, list):
        for role in roles:
            if not isinstance(role, str) or "vợ" not in role.lower():
                continue
            if "bà" in role:
                chunk = role[role.find("bà"):].split("(")[0].strip()
                if chunk:
                    return chunk
    return None


def persona_for(identity: IdentityProfile | None) -> Persona:
    """Dựng Persona từ Bản sắc; nhãn quan hệ chỉ lấp chỗ trống."""
    if identity is None:
        return NEUTRAL_PERSONA

    label = _text(getattr(identity, "relation_label", None)).lower()
    name = _text(getattr(identity, "display_name", None)).lower()
    generation, inferred_self = _infer_generation(label, name)

    address = _json_object(getattr(identity, "address_forms_json", None))
    roles_raw = getattr(identity, "roles_json", None)
    try:
        roles = json.loads(roles_raw) if isinstance(roles_raw, str) and roles_raw.strip() else None
    except json.JSONDecodeError:
        roles = None

    children = address.get("with_children")
    spouse = address.get("with_spouse")
    grandchildren = address.get("with_grandchildren")

    self_younger = _slot(children, "self") or inferred_self
    younger = _slot(children, "other") or NEUTRAL_YOUNGER
    self_peer = _slot(spouse, "self") or None
    peer = _slot(spouse, "other") or None
    # Ô «với cháu» để trống thì app đoán ông/bà — vẫn hơn để cháu bị gọi bằng
    # vai của con. Bản sắc ghi rõ thì Bản sắc thắng.
    self_grandchild = (
        _slot(grandchildren, "self") or _GRANDPARENT_SELF.get(generation) or None
    )
    grandchild = _slot(grandchildren, "other") or (
        DEFAULT_GRANDCHILD if self_grandchild else None
    )

    return Persona(
        display=_text(getattr(identity, "display_name", None)),
        generation=generation,
        self_younger=self_younger,
        younger=younger,
        self_peer=self_peer,
        peer=peer,
        self_grandchild=self_grandchild,
        grandchild=grandchild,
        spouse_name=spouse_name_from_lock(address, roles),
        spouse_as_kin=_slot(children, "spouse_word") or _SPOUSE_AS_KIN.get(generation),
        lock_conflict=_lock_conflict(generation, self_younger),
    )


def address_rules_block(persona: Persona) -> str:
    """Khối «Xưng hô» của Lớp 3 trong system prompt."""
    lines = [
        f"- Với con: xưng «{persona.self_younger}», gọi «{persona.younger}»."
    ]
    if persona.speaks_to_grandchildren:
        lines.append(
            f"- Với cháu chắt: xưng «{persona.self_grandchild}», "
            f"gọi «{persona.grandchild}». Cháu tự xưng «{persona.grandchild}» thì "
            f"KHÔNG đáp bằng cặp «{persona.self_younger} — {persona.younger}»."
        )
    if persona.speaks_to_spouse:
        who = persona.spouse_name or "người bạn đời"
        lines.append(
            f"- Với {who}: xưng «{persona.self_peer}», gọi «{persona.peer}». "
            f"Không gọi người ấy bằng vai con cháu đặt cho họ "
            f"(«{persona.spouse_as_kin or 'mẹ/bố'}») — đó là cách con cháu gọi, không phải cách bạn gọi."
        )
    else:
        lines.append(
            f"- Bạn KHÔNG có vai vợ/chồng trong phòng này. Chỉ dùng đúng một cặp "
            f"xưng hô ở trên; không mượn xưng hô vợ chồng của người được nhớ khác. "
            f"Bạn là {persona.self_younger}."
        )
    return "\n".join(lines)


def audience_block(persona: Persona, audience: str | None) -> str:
    """Khối «Người đang nhắn» — luôn nói bằng đại từ của chính người này."""
    if persona.audience(audience) == "spouse":
        who = persona.spouse_name or "người bạn đời"
        return (
            f"NGƯỜI ĐANG NHẮN: {who}.\n"
            f"Trả lời trực tiếp: xưng «{persona.me('spouse')}», gọi «{persona.you('spouse')}». "
            f"Không gọi người ấy là «{persona.spouse_as_kin or 'mẹ'}»; "
            f"không xưng «{persona.self_younger}» với người ấy."
        )
    fitted = persona.audience(audience)
    me, you = persona.register(fitted)
    who = "cháu chắt trong nhà" if fitted == "grandchild" else "con trong nhà"
    lines = [
        f"NGƯỜI ĐANG NHẮN: {who} (KHÔNG phải người bạn đời).",
        f"Xưng «{me}», gọi «{you}» — không trích xưng hô của người khác trừ khi đọc thơ nguyên văn.",
    ]
    for other_me, other_you in persona.other_registers(fitted):
        lines.append(
            f"Không xưng «{other_me}»/gọi «{other_you}» ở đây — "
            "đó là cách bạn nói với người khác trong nhà."
        )
    return "\n".join(lines)
