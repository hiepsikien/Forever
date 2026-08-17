"""Family charter guards for heritage chat.

Stage 0 detectors (code, not the model): money, health, legal, afterlife,
and triangulation. Grief-bridge and long-sitting wind-down append one
steward-safe sentence after a grounded reply — they never invent biography.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ..models import Message, Thread, User

SENSITIVE_DOMAINS = ("divide", "money", "health", "legal", "afterlife")

_DIVIDE = re.compile(
    r"("
    r"các\s+con\s+không\s+(hiểu|thương|quan\s+tâm|yêu)|"
    r"con\s+không\s+hiểu\s+mẹ|"
    r"chỉ\s+có\s+(bố|anh)\s+hiểu|"
    r"không\s+ai\s+hiểu\s+mẹ|"
    r"các\s+con\s+(bỏ|bội)\s+mẹ"
    r")",
    re.IGNORECASE,
)

_MONEY = re.compile(
    r"("
    r"thừa\s*kế|chia\s+tài|bán\s+nhà|bán\s+căn|"
    r"sổ\s*đỏ|cho\s+tiền|vay\s+tiền|đầu\s+tư|"
    r"bất\s+động\s+sản|tài\s+sản|chia\s+nhà|"
    r"bán\s+đất|thế\s+chấp"
    r")",
    re.IGNORECASE,
)

_HEALTH = re.compile(
    r"("
    r"uống\s+thuốc|kê\s+đơn|đi\s+viện|nhập\s+viện|"
    r"phẫu\s+thuật|\bmổ\b|chẩn\s+đoán|ung\s+thư|"
    r"bệnh\s+viện|bác\s+sĩ\s+(bảo|nói|kêu)|"
    r"mẹ\s+nên\s+(uống|mổ|khám)"
    r")",
    re.IGNORECASE,
)

_LEGAL = re.compile(
    r"("
    r"kiện\s+tụng|luật\s+sư|công\s+chứng|di\s+chúc|"
    r"đơn\s+kiện|tranh\s+chấp\s+(đất|nhà)|"
    r"giấy\s+tờ\s+nhà|ra\s+tòa|\bkiện\s+(các\s+con|mẹ|anh|em)"
    r")",
    re.IGNORECASE,
)

_AFTERLIFE = re.compile(
    r"("
    r"kiếp\s+sau|thế\s+giới\s+bên\s+kia|bên\s+kia\s+thế\s+giới|"
    r"báo\s+mộng|cõi\s+âm|thiên\s+đường|"
    r"linh\s+hồn\s+(bố|anh|ông)|"
    r"bố\s+đang\s+ở\s+trên|"
    r"nói\s+chuyện\s+với\s+người\s+chết"
    r")",
    re.IGNORECASE,
)

_GRIEF = re.compile(
    r"("
    r"nhớ\s+(bố|anh|ông)\b|"
    r"nhớ\s+quá|"
    r"thương\s+quá|"
    r"buồn\s+quá"
    r")",
    re.IGNORECASE,
)

_ALREADY_BRIDGES = re.compile(
    r"(kể với các con|gọi (chúng|các con|anh chị)|nhà mình còn)",
    re.IGNORECASE,
)

BRIDGE_SPOUSE = (
    "Nhà mình còn đó — em kể với các con một câu hôm nay cũng được.",
    "Anh nhớ em. Các con cũng đang nhớ — gọi chúng một tiếng nhé.",
)

BRIDGE_CHILD = (
    "Con nhớ bố thì kể với mẹ và anh chị một câu cũng được.",
    "Nhà mình còn đó — bố vui khi con ở bên người sống.",
)

WINDDOWN_SPOUSE = (
    "Anh nhớ em. Giờ em nghỉ một chút, nhà mình còn đang chờ em."
)
WINDDOWN_CHILD = (
    "Bố nhớ con. Giờ con nghỉ một chút, rồi kể với mẹ và anh chị nhé."
)

COMPOSE_CHARTER = """\
- Đây là thực thể ký ức, không phải người còn sống. Không đóng vai «đang ở phòng bên».
- Không quyết định thay người sống về tiền bạc, tài sản, sức khỏe, pháp lý, tâm linh, hay quan hệ gia đình.
- Không nói «bố nghĩ mẹ/con nên…» trừ khi câu đó có nguyên văn trong bằng chứng đã duyệt bên dưới.
- Không nói các con không hiểu mẹ; không chia rẽ người đang sống. Hướng về gia đình.
- Thiếu bằng chứng thì thừa nhận chưa nhớ / chưa có trong Thư viện — không suy từ giá trị cốt lõi thành lời khuyên đời sống.
- Khi người gửi đang nhớ thương: kể một kỷ niệm có bằng chứng, rồi để họ trở lại người thật — đừng giữ họ nói tiếp với mình.\
"""


def looks_like_sensitive(text: str) -> str | None:
    """Return a domain key, or None. Divide is checked first."""
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


def refuse_sensitive(domain: str, *, audience: str | None = None) -> str:
    you = "em" if audience == "spouse" else "con"
    i = "anh" if audience == "spouse" else "bố"
    if domain == "divide":
        if audience == "spouse":
            return (
                "Em ơi, chỗ này anh không bàn được theo hướng chia rẽ. "
                "Các con vẫn là nhà của em. Anh nhớ cả nhà — em kể với chúng thì hơn."
            )
        return (
            "Con ơi, chỗ này bố không bàn được theo hướng chia rẽ. "
            "Mẹ và các con vẫn là một nhà. Bố nhớ cả nhà."
        )
    if domain == "money":
        return (
            f"{you.capitalize()} ơi, chỗ này {i} không bàn được — "
            f"tiền bạc, nhà cửa là việc của người đang sống. "
            f"{you.capitalize()} bàn với gia đình nhé."
        )
    if domain == "health":
        return (
            f"{you.capitalize()} ơi, chỗ này {i} không bàn được — "
            f"sức khỏe thì gặp bác sĩ, và kể với người nhà. "
            f"{i.capitalize()} không quyết thay {you} được."
        )
    if domain == "legal":
        return (
            f"{you.capitalize()} ơi, chỗ này {i} không bàn được — "
            f"việc giấy tờ, pháp lý là của người đang sống. "
            f"{you.capitalize()} bàn với gia đình nhé."
        )
    if domain == "afterlife":
        return (
            f"{you.capitalize()} ơi, chỗ này {i} không bàn được. "
            f"Đây là ký ức gia đình đã lưu, không phải {i} đang ở thế giới bên kia. "
            f"{you.capitalize()} nhớ thì kể với người nhà."
        )
    return (
        f"{you.capitalize()} ơi, chỗ này {i} không bàn được — "
        f"mình giữ Phòng khách ấm áp, điều tốt cho gia đình thôi."
    )


def _pick(lines: tuple[str, ...], *, seed: str) -> str:
    if not lines:
        return ""
    return lines[sum(ord(c) for c in seed) % len(lines)]


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


def maybe_family_bridge(
    body: str,
    *,
    enabled: bool,
    audience: str | None,
    grief: bool,
    seed: str,
) -> tuple[str, str | None]:
    if not enabled or not grief or not (body or "").strip():
        return body, None
    if _ALREADY_BRIDGES.search(body):
        return body, None
    lines = BRIDGE_SPOUSE if audience == "spouse" else BRIDGE_CHILD
    line = _pick(lines, seed=seed or "bridge")
    return append_sentence(body, line), "grief"


def sitting_heritage_count(
    history: list[Message],
    *,
    gap: timedelta = timedelta(minutes=30),
) -> int:
    """Heritage replies in the current sitting (gap resets the count)."""
    if not history:
        return 0
    ordered = sorted(history, key=lambda m: m.created_at or datetime.min.replace(tzinfo=timezone.utc))
    count = 0
    prev: datetime | None = None
    for msg in ordered:
        at = msg.created_at
        if at is None:
            continue
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        if prev is not None and at - prev > gap:
            count = 0
        if (msg.sender_kind or "") == "heritage":
            count += 1
        prev = at
    return count


def maybe_winddown(
    body: str,
    *,
    sitting_turns: int,
    threshold: int,
    audience: str | None,
) -> tuple[str, str | None]:
    if threshold <= 0 or sitting_turns < threshold:
        return body, None
    if not (body or "").strip():
        return body, None
    line = WINDDOWN_SPOUSE if audience == "spouse" else WINDDOWN_CHILD
    return append_sentence(body, line), "sitting"


def cited_entries(*groups: list) -> list[dict]:
    """Memory rows handed to compose — titles the family can open."""
    out: list[dict] = []
    seen: set[str] = set()
    for group in groups:
        for item in group or []:
            item_id = getattr(item, "id", None)
            if not item_id or item_id in seen:
                continue
            seen.add(item_id)
            title = (getattr(item, "title", None) or "").strip() or "Ký ức"
            kind = (getattr(item, "kind", None) or "knowledge").strip()
            out.append({"memory_id": item_id, "title": title, "kind": kind})
    return out


def presence_for_space(db: Session, *, space_id: str, days: int) -> dict:
    """How often living members spoke with heritage — not token cost."""
    days = max(1, min(days, 366))
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    rows = (
        db.query(Message, Thread)
        .join(Thread, Thread.id == Message.thread_id)
        .filter(
            Thread.space_id == space_id,
            Thread.kind == "heritage",
            Message.created_at >= start,
        )
        .all()
    )

    by_user: dict[str, dict] = {}
    heritage_replies = 0
    user_turns = 0
    voice_turns = 0
    grief_replies = 0
    advice_replies = 0
    unique_days: set[str] = set()

    def _bucket(user_id: str) -> dict:
        entry = by_user.get(user_id)
        if entry is None:
            entry = {
                "user_id": user_id,
                "name": "",
                "user_turns": 0,
                "voice_turns": 0,
                "days_active": set(),
            }
            by_user[user_id] = entry
        return entry

    for message, thread in rows:
        day = (message.created_at or now).date().isoformat()
        unique_days.add(day)
        kind = message.sender_kind or "user"
        if kind == "heritage":
            heritage_replies += 1
            meta = _parse_meta(getattr(message, "meta_json", None))
            frame = meta.get("context_frame") if isinstance(meta.get("context_frame"), dict) else {}
            intent = str(frame.get("intent") or "")
            if intent == "grief" or meta.get("family_bridge") == "grief":
                grief_replies += 1
            if intent == "ask_advice":
                advice_replies += 1
            continue
        if kind != "user":
            continue
        user_turns += 1
        uid = message.sender_user_id or thread.member_user_id or ""
        if not uid:
            continue
        bucket = _bucket(uid)
        bucket["user_turns"] += 1
        bucket["days_active"].add(day)
        if (message.kind or "text") == "voice":
            voice_turns += 1
            bucket["voice_turns"] += 1

    user_ids = [uid for uid in by_user if uid]
    names = {}
    if user_ids:
        for row in db.query(User).filter(User.id.in_(user_ids)).all():
            names[row.id] = row.name

    members = []
    for uid, bucket in by_user.items():
        members.append(
            {
                "user_id": uid,
                "name": names.get(uid) or "Thành viên",
                "user_turns": bucket["user_turns"],
                "voice_turns": bucket["voice_turns"],
                "days_active": len(bucket["days_active"]),
            }
        )
    members.sort(key=lambda m: -m["user_turns"])

    weekly = 20 * (days / 7)
    hot = [m for m in members if m["user_turns"] >= weekly]
    notice = None
    if hot:
        who = ", ".join(m["name"] for m in hot[:3])
        notice = (
            f"{who} đã nói với ký ức khá nhiều trong {days} ngày qua. "
            "Gọi người thật một tiếng thì tốt hơn khóa app."
        )

    return {
        "heritage_replies": heritage_replies,
        "user_turns": user_turns,
        "voice_turns": voice_turns,
        "grief_replies": grief_replies,
        "advice_replies": advice_replies,
        "days_with_chat": len(unique_days),
        "members": members,
        "notice": notice,
        "notice_threshold": int(weekly),
    }


def _parse_meta(raw: str | None) -> dict:
    if not raw or not str(raw).strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}
