"""Số liệu hiện diện + trích dẫn cho heritage chat.

Không phải luật. Luật app ở `heritage_rules_app.py` (tầng 1), hiến chương gia
đình ở `heritage_rules_family.py` (tầng 2), xưng hô riêng ở `heritage_persona.py`
(tầng 3). File này chỉ đếm và gom — nên nó không nhắc tên đại từ của ai.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ..models import Message, Thread, User


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
