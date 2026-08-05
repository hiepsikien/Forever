"""Stage 5 — what this thread already said, and how not to say it twice.

Two jobs that answer the same question ("what has been said already?"):

* **Memory.** A distilled `ThreadMemory` row per thread — facts the family
  shared, threads left open, questions already asked. Cheap to read, small
  enough to sit in every prompt, and compacted by Gemini every few turns so it
  never grows past its budget.
* **Anti-repeat.** Before a reply goes out, compare it with the last few and
  with the questions already asked. A remembered father who asks "con dạo này
  thế nào?" every turn reads like a machine, and that is the exact failure this
  guards against.

Everything here degrades to a no-op: no row, no Gemini, no problem — the reply
still goes out, just without the extra context.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

from nanoid import generate
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import Message, Thread, ThreadMemory
from .heritage import normalize_text
from .heritage_gemini import GeminiCall, call_gemini, parse_json_object

# Caps keep the memory block a fixed, small share of the prompt budget.
MAX_FACTS = 12
MAX_TOPICS_OPEN = 6
MAX_ASKED = 10
MAX_ENTITIES = 12
MAX_FACT_CHARS = 160

# Two replies over this token overlap are the same reply wearing a hat.
REPEAT_THRESHOLD = 0.6
# Questions repeat more literally than prose, so they need a tighter bar.
QUESTION_THRESHOLD = 0.7
# How many previous heritage replies the guardrail compares against.
COMPARE_LAST = 3

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?…])\s+|\n+")
_TOKEN_SPLIT = re.compile(r"[^\w]+")

_COMPACT_SCHEMA = {
    "type": "object",
    "properties": {
        "topics_open": {"type": "array", "items": {"type": "string"}},
        "emotional_tone": {"type": "string"},
        "retire_statements": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["topics_open", "emotional_tone"],
}

_COMPACT_SYSTEM = """\
Bạn là bộ nén trí nhớ cho app Forever. Bạn KHÔNG trả lời người dùng.
Đọc một đoạn hội thoại gia đình và bản ghi nhớ hiện có, trả về JSON.

- topics_open: chuyện còn dang dở, đáng hỏi tiếp ở lượt sau
- emotional_tone: một cụm ngắn mô tả không khí chung của cuộc trò chuyện
- retire_statements: những câu trong facts_learned đã hết đúng vì bị thay thế bởi
  thông tin mới hơn trong hội thoại. Sao lại NGUYÊN VĂN câu cần bỏ, không sửa chữ.
  Không chắc thì để rỗng.

TUYỆT ĐỐI không viết lại nội dung một fact — bạn chỉ được đề nghị cho về hưu.

Chỉ trả JSON, không giải thích.\
"""


@dataclass
class MemoryState:
    # Each fact is a dict: statement, kind, subject_slug, occurred_at,
    # source_message_id. Only the statement is ever shown to the composer.
    facts_learned: list[dict] = field(default_factory=list)
    topics_open: list[str] = field(default_factory=list)
    already_asked: list[str] = field(default_factory=list)
    emotional_tone: str = ""
    entities_seen: list[str] = field(default_factory=list)
    turn_count: int = 0

    @property
    def is_empty(self) -> bool:
        return not (
            self.facts_learned
            or self.topics_open
            or self.already_asked
            or self.entities_seen
        )

    def as_summary(self) -> dict:
        return {
            "facts_learned": self.facts_learned,
            "topics_open": self.topics_open,
            "already_asked": self.already_asked,
            "emotional_tone": self.emotional_tone,
            "entities_seen": self.entities_seen,
        }

    def as_meta(self) -> dict:
        return {
            "turn_count": self.turn_count,
            "facts": len(self.facts_learned),
            "asked": len(self.already_asked),
        }


def _clean_list(raw: object, *, limit: int) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        value = " ".join(item.split())[:MAX_FACT_CHARS].strip()
        if value and value not in out:
            out.append(value)
    return out[-limit:]


def _clean_facts(raw: object, *, limit: int) -> list[dict]:
    """Accept the structured shape, and the plain strings written before it."""
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for item in raw:
        if isinstance(item, str):
            item = {"statement": item}
        if not isinstance(item, dict):
            continue
        statement = item.get("statement")
        if not isinstance(statement, str):
            continue
        statement = " ".join(statement.split())[:MAX_FACT_CHARS].strip()
        if not statement or statement in seen:
            continue
        seen.add(statement)
        fact = {"statement": statement}
        for key in ("kind", "subject_slug", "occurred_at", "source_message_id"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                fact[key] = value.strip()
        out.append(fact)
    return out[-limit:]


def parse_state(memory: ThreadMemory | None) -> MemoryState:
    if memory is None:
        return MemoryState()
    try:
        payload = json.loads(memory.summary_json or "{}")
    except json.JSONDecodeError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    tone = payload.get("emotional_tone")
    return MemoryState(
        facts_learned=_clean_facts(payload.get("facts_learned"), limit=MAX_FACTS),
        topics_open=_clean_list(payload.get("topics_open"), limit=MAX_TOPICS_OPEN),
        already_asked=_clean_list(payload.get("already_asked"), limit=MAX_ASKED),
        emotional_tone=tone.strip()[:120] if isinstance(tone, str) else "",
        entities_seen=_clean_list(payload.get("entities_seen"), limit=MAX_ENTITIES),
        turn_count=memory.turn_count or 0,
    )


def load_state(db: Session, thread_id: str) -> MemoryState:
    row = (
        db.query(ThreadMemory)
        .filter(ThreadMemory.thread_id == thread_id)
        .one_or_none()
    )
    return parse_state(row)


def memory_block(state: MemoryState) -> str:
    """The memory as prompt text. Empty string when there is nothing to say."""
    if state.is_empty:
        return ""
    lines: list[str] = ["\nTRÍ NHỚ CUỘC TRÒ CHUYỆN NÀY:"]
    if state.facts_learned:
        lines.append("- Đã biết (đừng hỏi lại những điều này):")
        for fact in state.facts_learned:
            when = fact.get("occurred_at")
            lines.append(
                f"  · {fact['statement']}" + (f" [{when}]" if when else "")
            )
    if state.topics_open:
        lines.append("- Chuyện còn dang dở, có thể hỏi tiếp: " + "; ".join(state.topics_open))
    if state.already_asked:
        lines.append("- Câu hỏi thăm đã dùng rồi, KHÔNG hỏi lại kiểu này:")
        lines += [f"  · {q}" for q in state.already_asked]
    if state.emotional_tone:
        lines.append(f"- Không khí chung: {state.emotional_tone}")
    lines.append(
        "Dùng trí nhớ này để nối tiếp câu chuyện, đừng mở lại từ đầu như người lạ."
    )
    return "\n".join(lines) + "\n"


def tokens(text: str) -> set[str]:
    parts = _TOKEN_SPLIT.split(normalize_text(text))
    return {p for p in parts if len(p) >= 2}


def jaccard(left: str, right: str) -> float:
    a, b = tokens(left), tokens(right)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def question_sentences(text: str) -> list[str]:
    out: list[str] = []
    for raw in _SENTENCE_SPLIT.split(text or ""):
        sentence = " ".join(raw.split())
        if sentence.endswith("?") and len(sentence) >= 6:
            out.append(sentence)
    return out


def repeated_question(reply: str, asked: list[str]) -> str | None:
    """The first question in `reply` that is a rerun of one already asked."""
    for question in question_sentences(reply):
        for previous in asked:
            if jaccard(question, previous) >= QUESTION_THRESHOLD:
                return question
    return None


def repetition_score(reply: str, previous: list[str]) -> float:
    return max((jaccard(reply, old) for old in previous if old), default=0.0)


def is_repetitive(
    reply: str,
    *,
    previous: list[str],
    asked: list[str],
    threshold: float = REPEAT_THRESHOLD,
) -> str | None:
    """Return why the reply repeats itself, or None when it is fresh."""
    if not (reply or "").strip():
        return None
    if repetition_score(reply, previous) >= threshold:
        return "similar_reply"
    if repeated_question(reply, asked):
        return "repeated_question"
    return None


def avoid_block(previous: list[str], asked: list[str]) -> str:
    """Extra instruction appended to the prompt on a regenerate."""
    lines = ["\nLƯỢT NÀY BỊ LẶP — viết lại theo hướng khác:"]
    if asked:
        lines.append("- Đã hỏi thăm những câu này rồi, chọn góc khác hoặc đừng hỏi:")
        lines += [f"  · {q}" for q in asked[-MAX_ASKED:]]
    if previous:
        lines.append("- Đã nói gần đây, đừng diễn đạt lại:")
        lines += [f"  · {old.strip()[:200]}" for old in previous if old.strip()]
    lines.append(
        "- Nói tiếp một ý mới, hoặc đáp thẳng vào điều con vừa nhắn, rồi dừng."
    )
    return "\n".join(lines) + "\n"


def recent_heritage_bodies(history: list[Message], *, limit: int = COMPARE_LAST) -> list[str]:
    bodies = [
        (msg.body or "").strip()
        for msg in history
        if msg.sender_kind == "heritage" and (msg.body or "").strip()
    ]
    return bodies[-limit:]


def _meta_list(meta: object, key: str) -> list[str]:
    if not isinstance(meta, dict):
        return []
    return _clean_list(meta.get(key), limit=MAX_FACTS)


def _stated_facts(meta: object, *, source_message_id: str) -> list[dict]:
    """Only what the family actually said becomes memory.

    An inferred fact fed back as a known one is how a remembered father starts
    making things up, so `implied` records stay in the message meta and go no
    further.
    """
    if not isinstance(meta, dict):
        return []
    kept: list[dict] = []
    for raw in meta.get("new_facts") or []:
        if isinstance(raw, str):
            raw = {"statement": raw, "confidence": "stated"}
        if not isinstance(raw, dict):
            continue
        if (raw.get("confidence") or "stated") != "stated":
            continue
        fact = dict(raw)
        fact.pop("confidence", None)
        fact["source_message_id"] = source_message_id
        kept.append(fact)
    return _clean_facts(kept, limit=MAX_FACTS)


def record_turn(
    db: Session,
    *,
    thread: Thread,
    user_message: Message,
    reply: Message,
) -> ThreadMemory:
    """Fold one exchange into the thread memory. Deterministic, no LLM.

    Facts and entities come from the reply's own meta (written by the analyzer),
    so the memory never contains anything the pipeline did not already ground.
    """
    now = datetime.now(timezone.utc)
    row = (
        db.query(ThreadMemory)
        .filter(ThreadMemory.thread_id == thread.id)
        .one_or_none()
    )
    if row is None:
        row = ThreadMemory(
            id=generate(),
            thread_id=thread.id,
            summary_json="",
            turn_count=0,
            compacted_turn=0,
            created_at=now,
            updated_at=now,
        )
        db.add(row)

    state = parse_state(row)
    try:
        meta = json.loads(reply.meta_json or "{}")
    except json.JSONDecodeError:
        meta = {}

    known = {fact["statement"] for fact in state.facts_learned}
    for fact in _stated_facts(meta, source_message_id=user_message.id):
        if fact["statement"] not in known:
            known.add(fact["statement"])
            state.facts_learned.append(fact)
    for slug in _meta_list(meta, "codex_slugs"):
        if slug not in state.entities_seen:
            state.entities_seen.append(slug)
    for question in question_sentences(reply.body or ""):
        if not any(jaccard(question, old) >= QUESTION_THRESHOLD for old in state.already_asked):
            state.already_asked.append(question)

    state.facts_learned = state.facts_learned[-MAX_FACTS:]
    state.entities_seen = state.entities_seen[-MAX_ENTITIES:]
    state.already_asked = state.already_asked[-MAX_ASKED:]

    row.summary_json = json.dumps(state.as_summary(), ensure_ascii=False)
    row.turn_count = (row.turn_count or 0) + 1
    row.last_message_id = user_message.id
    row.updated_at = now
    db.commit()
    db.refresh(row)
    return row


def compaction_due(row: ThreadMemory | None, *, every: int) -> bool:
    if row is None or every <= 0:
        return False
    return (row.turn_count or 0) - (row.compacted_turn or 0) >= every


def compact_thread_memory(
    db: Session,
    *,
    thread: Thread,
    settings: Settings,
    history: list[Message],
) -> bool:
    """Ask Gemini to merge the transcript into the stored facts. Best-effort."""
    row = (
        db.query(ThreadMemory)
        .filter(ThreadMemory.thread_id == thread.id)
        .one_or_none()
    )
    if not compaction_due(row, every=settings.heritage_memory_compact_every):
        return False
    assert row is not None

    state = parse_state(row)
    lines: list[str] = []
    for msg in history[-20:]:
        body = (msg.body or "").strip()
        if not body:
            continue
        who = "Người nhà" if msg.sender_kind == "user" else "Thực thể ký ức"
        lines.append(f"{who}: {body[:300]}")
    transcript = "\n".join(lines)
    if not transcript:
        return False

    prompt = (
        "Bản ghi nhớ hiện có:\n"
        + json.dumps(
            {
                "facts_learned": [f["statement"] for f in state.facts_learned],
                "topics_open": state.topics_open,
            },
            ensure_ascii=False,
        )
        + f"\n\nHội thoại:\n{transcript}"
    )
    result = call_gemini(
        settings,
        GeminiCall(
            system_prompt=_COMPACT_SYSTEM,
            contents=[{"role": "user", "parts": [{"text": prompt}]}],
            model=settings.analyzer_model,
            temperature=0.0,
            max_output_tokens=512,
            json_mode=True,
            response_schema=_COMPACT_SCHEMA,
            timeout_s=20.0,
            attempts=1,
        ),
    )
    payload = parse_json_object(result.text)
    if not payload:
        return False

    tone = payload.get("emotional_tone")
    state.topics_open = _clean_list(payload.get("topics_open"), limit=MAX_TOPICS_OPEN)
    if isinstance(tone, str) and tone.strip():
        state.emotional_tone = tone.strip()[:120]

    # The model may only retire a fact, never reword one: it proposes exact
    # statements and code does the matching.
    retired = {
        normalize_text(text)
        for text in _clean_list(payload.get("retire_statements"), limit=MAX_FACTS)
    }
    if retired:
        state.facts_learned = [
            fact
            for fact in state.facts_learned
            if normalize_text(fact["statement"]) not in retired
        ]

    row.summary_json = json.dumps(state.as_summary(), ensure_ascii=False)
    row.compacted_turn = row.turn_count or 0
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return True
