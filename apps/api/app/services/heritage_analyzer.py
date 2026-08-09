"""Stage 1 — read the turn before answering it.

A single Gemini call turns the message into structured data: who is being
talked about, what kind of answer is wanted, how long it should be. The
composer then writes with that in hand. Splitting the two keeps each prompt
short, and keeps the parts that must never drift (xưng hô, giá trị) in code
rather than in whatever the model felt like this turn.

The analyzer never picks the audience when a sender profile exists — that
rule lives in heritage_chat and always wins.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date

from ..config import Settings
from ..models import FamilyEntity, Message
from .ai_usage import UsageContext
from .heritage_gemini import GeminiCall, call_gemini, parse_json_object

INTENTS = (
    "smalltalk",
    "ask_person",
    "ask_event",
    "ask_advice",
    "share_news",
    "meta",
    "grief",
)
DEPTHS = ("ack", "short", "story")
EMOTIONS = ("neutral", "warm", "sad", "proud", "worried", "playful")
AUDIENCE_HINTS = ("spouse", "child", "grandchild", "unknown")
TOPICS = (
    "vo_chong",
    "con_cai",
    "gia_dinh",
    "nghe_giao",
    "tho",
    "biet_on",
    "truyen_thong",
    "khac",
)

# life_state là thứ có thể bị thay thế về sau ("mẹ đang ở phòng ngoài"); event
# thì đứng yên một lần rồi thuộc về quá khứ.
FACT_KINDS = ("life_state", "event", "preference", "relationship")
CONFIDENCES = ("stated", "implied")

_ISO_DATE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")

# Sentence counts the composer is told to hit for each depth.
# Tuned ~70% of the first live lengths so Gọi stays chat-sized (cost + listen time).
DEPTH_RULES: dict[str, str] = {
    "ack": "Đáp gọn 1 câu ngắn, ấm áp — người ta chỉ đang báo tin vặt, không hỏi gì sâu.",
    "short": "Trả lời 1–2 câu, đúng trọng tâm câu hỏi — đừng mở rộng.",
    "story": "Kể 3–4 câu, có chi tiết cụ thể từ bằng chứng — vẫn là nhắn tin, không phải viết thư.",
}
DEPTH_TOKENS: dict[str, int] = {"ack": 128, "short": 256, "story": 512}

_SCHEMA = {
    "type": "object",
    "properties": {
        "intent": {"type": "string", "enum": list(INTENTS)},
        "depth": {"type": "string", "enum": list(DEPTHS)},
        "emotion": {"type": "string", "enum": list(EMOTIONS)},
        "audience_hint": {"type": "string", "enum": list(AUDIENCE_HINTS)},
        "entity_slugs": {"type": "array", "items": {"type": "string"}},
        "topics": {"type": "array", "items": {"type": "string", "enum": list(TOPICS)}},
        "retrieval_queries": {"type": "array", "items": {"type": "string"}},
        "new_facts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": list(FACT_KINDS)},
                    "subject_slug": {"type": "string"},
                    "statement": {"type": "string"},
                    "occurred_at": {"type": "string"},
                    "confidence": {"type": "string", "enum": list(CONFIDENCES)},
                },
                "required": ["kind", "statement", "confidence"],
            },
        },
    },
    "required": ["intent", "depth", "emotion", "topics"],
}

_SYSTEM = """\
Bạn là bộ phân tích ngữ cảnh cho app Forever. Bạn KHÔNG trả lời người dùng.
Đọc tin nhắn mới nhất trong một cuộc trò chuyện gia đình và trả về JSON mô tả nó.

- intent: smalltalk (chào hỏi, tán gẫu) | ask_person (hỏi về một người) |
  ask_event (hỏi về sự kiện, mốc đời, kỷ niệm) | ask_advice (xin lời khuyên) |
  share_news (kể chuyện mình) | meta (nói về app, kỹ thuật, thử nghiệm) |
  grief (nhớ thương, mất mát)
- depth: ack (chỉ cần đáp một câu ngắn) | short (1–2 câu) | story (3–4 câu, muốn nghe kể)
- emotion: cảm xúc của NGƯỜI GỬI
- entity_slugs: chỉ chọn trong danh sách người được cung cấp; không tự nghĩ ra slug mới
- topics: chọn trong enum
- retrieval_queries: 1–3 cụm từ khoá tiếng Việt để tra kho ký ức, dùng từ ngữ
  có khả năng xuất hiện trong tư liệu (ví dụ hỏi "cưới" thì thêm "kết hôn")
- new_facts: thông tin mới về đời sống người nhà, để rỗng nếu không có. Mỗi ý một
  bản ghi:
  · kind: life_state (trạng thái hiện tại, về sau có thể bị thay thế) |
    event (việc xảy ra một lần) | preference (sở thích, thói quen) |
    relationship (quan hệ giữa hai người)
  · subject_slug: người mà thông tin nói VỀ, chọn trong danh sách; không rõ thì để rỗng
  · statement: một câu ngắn, tự nó đủ nghĩa khi đọc rời khỏi hội thoại
  · occurred_at: YYYY-MM-DD nếu suy ra được ngày tuyệt đối; để rỗng nếu không
  · confidence: stated (người ta nói thẳng) | implied (bạn suy ra)

QUAN TRỌNG: không bao giờ ghi confidence "stated" cho điều bạn phải suy luận.

Chỉ trả JSON, không giải thích.\
"""


@dataclass
class FactRecord:
    """One thing the family said, shaped so it survives leaving the conversation."""

    statement: str
    kind: str = "event"
    subject_slug: str = ""
    occurred_at: str = ""
    confidence: str = "stated"

    def as_dict(self) -> dict:
        out = {
            "statement": self.statement,
            "kind": self.kind,
            "confidence": self.confidence,
        }
        if self.subject_slug:
            out["subject_slug"] = self.subject_slug
        if self.occurred_at:
            out["occurred_at"] = self.occurred_at
        return out


@dataclass
class ContextFrame:
    intent: str = "smalltalk"
    depth: str = "short"
    emotion: str = "neutral"
    audience_hint: str = "unknown"
    entity_slugs: list[str] = field(default_factory=list)
    topics: list[str] = field(default_factory=list)
    retrieval_queries: list[str] = field(default_factory=list)
    new_facts: list[FactRecord] = field(default_factory=list)
    source: str = "default"

    @property
    def depth_rule(self) -> str:
        return DEPTH_RULES.get(self.depth, DEPTH_RULES["short"])

    @property
    def max_output_tokens(self) -> int:
        return DEPTH_TOKENS.get(self.depth, DEPTH_TOKENS["short"])

    def as_meta(self) -> dict:
        return {
            "intent": self.intent,
            "depth": self.depth,
            "emotion": self.emotion,
            "topics": self.topics,
            "source": self.source,
        }


def _str_list(raw: object, *, allowed: tuple[str, ...] | None = None) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        value = item.strip()
        if not value or (allowed and value not in allowed):
            continue
        if value not in out:
            out.append(value)
    return out


def _enum(raw: object, allowed: tuple[str, ...], fallback: str) -> str:
    value = raw.strip() if isinstance(raw, str) else ""
    return value if value in allowed else fallback


def _fact_list(raw: object, *, known_slugs: set[str]) -> list[FactRecord]:
    """Tolerate a bare string, drop anything without a usable statement."""
    if not isinstance(raw, list):
        return []
    out: list[FactRecord] = []
    for item in raw[:5]:
        if isinstance(item, str):
            item = {"statement": item}
        if not isinstance(item, dict):
            continue
        statement = item.get("statement")
        statement = " ".join(statement.split())[:200] if isinstance(statement, str) else ""
        if not statement:
            continue
        occurred = item.get("occurred_at")
        occurred = occurred.strip() if isinstance(occurred, str) else ""
        slug = item.get("subject_slug")
        slug = slug.strip() if isinstance(slug, str) else ""
        out.append(
            FactRecord(
                statement=statement,
                kind=_enum(item.get("kind"), FACT_KINDS, "event"),
                subject_slug=slug if slug in known_slugs else "",
                occurred_at=occurred if _ISO_DATE.match(occurred) else "",
                confidence=_enum(item.get("confidence"), CONFIDENCES, "implied"),
            )
        )
    return out


def parse_frame(payload: dict | None, *, known_slugs: set[str]) -> ContextFrame | None:
    if not payload:
        return None
    return ContextFrame(
        intent=_enum(payload.get("intent"), INTENTS, "smalltalk"),
        depth=_enum(payload.get("depth"), DEPTHS, "short"),
        emotion=_enum(payload.get("emotion"), EMOTIONS, "neutral"),
        audience_hint=_enum(payload.get("audience_hint"), AUDIENCE_HINTS, "unknown"),
        entity_slugs=[
            slug for slug in _str_list(payload.get("entity_slugs")) if slug in known_slugs
        ],
        topics=_str_list(payload.get("topics"), allowed=TOPICS),
        retrieval_queries=_str_list(payload.get("retrieval_queries"))[:3],
        new_facts=_fact_list(payload.get("new_facts"), known_slugs=known_slugs),
        source="gemini",
    )


def _roster_block(entities: list[FamilyEntity]) -> str:
    if not entities:
        return "Danh sách người thân: (chưa có — để entity_slugs rỗng)"
    lines = []
    for entity in entities:
        try:
            relation = (json.loads(entity.relation_json or "{}") or {}).get(
                "to_subject", ""
            )
        except json.JSONDecodeError:
            relation = ""
        try:
            aliases = ", ".join(json.loads(entity.aliases_json or "[]"))
        except json.JSONDecodeError:
            aliases = entity.canonical_name
        lines.append(f"- {entity.slug}: {entity.canonical_name} ({relation}) — {aliases}")
    return "Danh sách người thân (chọn slug trong đây):\n" + "\n".join(lines)


_WEEKDAYS_VI = (
    "thứ Hai",
    "thứ Ba",
    "thứ Tư",
    "thứ Năm",
    "thứ Sáu",
    "thứ Bảy",
    "Chủ nhật",
)


def _today_block(today: date) -> str:
    """Without this, "cuối tuần này" gets stored verbatim and rots in a week."""
    return (
        f"Hôm nay là {today.isoformat()} ({_WEEKDAYS_VI[today.weekday()]}). "
        "Thời gian nói tương đối thì quy về ngày tuyệt đối trong occurred_at."
    )


def analyze_turn(
    settings: Settings,
    *,
    user_text: str,
    history: list[Message],
    entities: list[FamilyEntity],
    today: date | None = None,
    usage: UsageContext | None = None,
) -> ContextFrame:
    """Return a frame; fall back to safe defaults when the call fails."""
    if not user_text.strip():
        return ContextFrame()

    recent = []
    for msg in history[-6:]:
        who = "Người nhà" if msg.sender_kind == "user" else "Thực thể ký ức"
        body = (msg.body or "").strip()
        if body:
            recent.append(f"{who}: {body[:300]}")
    transcript = "\n".join(recent) or "(chưa có lượt nào trước)"

    prompt = (
        f"{_today_block(today or date.today())}\n\n"
        f"{_roster_block(entities)}\n\n"
        f"Vài lượt gần đây:\n{transcript}\n\n"
        f"Tin nhắn mới nhất cần phân tích:\n{user_text[:1200]}"
    )
    analyzer_usage = usage or UsageContext(operation="heritage_analyzer")
    if analyzer_usage.operation == "unknown":
        analyzer_usage.operation = "heritage_analyzer"
    result = call_gemini(
        settings,
        GeminiCall(
            system_prompt=_SYSTEM,
            contents=[{"role": "user", "parts": [{"text": prompt}]}],
            model=settings.analyzer_model,
            temperature=0.0,
            max_output_tokens=384,
            json_mode=True,
            response_schema=_SCHEMA,
            timeout_s=20.0,
            attempts=1,
            usage=analyzer_usage,
        ),
    )
    known = {entity.slug for entity in entities}
    frame = parse_frame(parse_json_object(result.text), known_slugs=known)
    return frame or ContextFrame(source=f"fallback:{result.error or 'unparsed'}")
