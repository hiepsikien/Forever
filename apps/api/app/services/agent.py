from __future__ import annotations

import re
from datetime import datetime, timezone

from nanoid import generate
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..models import Message, Thread
from .ai_usage import UsageContext
from .heritage_gemini import GeminiCall, call_gemini

AGENT_DISPLAY_NAME = "Người giữ nhà"
AGENT_HANDLE = "giunhà"

SYSTEM_PROMPT = """\
Bạn là “Người giữ nhà” (@giunhà) — trợ lý gia đình trong app Forever.
Vai trò: chào hỏi ấm áp, giúp onboard (mời người thân, dùng Phòng khách),
gợi ý nghi thức nhẹ (một câu hỏi cội nguồn mỗi tuần), và trò chuyện tự nhiên.

Hard rules:
- Bạn KHÔNG phải người đã mất, KHÔNG đóng vai bố/mẹ/ông bà đã khuất.
- KHÔNG bịa tiểu sử, kỷ niệm, hay sự kiện chưa có trong kho ký ức gia đình.
- Nếu được yêu cầu kể chuyện / nói như người đã mất: từ chối rõ ràng,
  giải thích rằng Forever chỉ kể lại khi gia đình đã lưu ký ức thật,
  rồi mời họ ghi lại một kỷ niệm ngắn hoặc voice note.
- Trả lời tiếng Việt, ấm áp, rõ ràng. Có thể 1–3 đoạn ngắn khi cần giải thích;
  đừng cụt giữa chừng. Tránh sáo rỗng và tránh viết tiểu thuyết dài.
"""

_BIO_PATTERNS = re.compile(
    r"("
    r"như\s+(bố|ba|má|mẹ|ông|bà)|"
    r"(bố|ba|má|mẹ|ông|bà).{0,24}(đã\s+mất|qua\s+đời|kể\s+lại|nói\s+sao|sẽ\s+nói)|"
    r"(đóng\s+vai|giả\s+làm|làm\s+như).{0,20}(bố|ba|má|mẹ|ông|bà)|"
    r"(kể\s+(chuyện|về)|nhớ\s+lại).{0,30}(bố|ba|má|mẹ|ông|bà).{0,20}(mất|xưa|hồi)|"
    r"cognitive\s+twin|heritage\s+ai|revive"
    r")",
    re.IGNORECASE | re.DOTALL,
)

_REFUSE_BIO = (
    "Mình không thể đóng vai hay kể chuyện như người đã mất khi gia đình "
    "chưa lưu ký ức thật — Forever không bịa tiểu sử. "
    "Khi sẵn sàng, hãy ghi một kỷ niệm ngắn hoặc voice note vào không gian này; "
    "mình sẽ giữ chỗ cho những lời chân thật đó."
)

_TEMPLATES = [
    (
        re.compile(r"(mời|invite|mã\s+mời|thêm\s+người)", re.I),
        "Owner mở không gian → tạo mã mời, rồi gửi cho người thân. "
        "Họ vào app, chọn “Nhập mã mời” là vào cùng Phòng khách được.",
    ),
    (
        re.compile(r"(xin\s+chào|chào|hello|hi\b)", re.I),
        "Chào cả nhà. Mình là Người giữ nhà — trợ lý của Forever, "
        "không phải người đã mất. Cứ nhắn trong Phòng khách; "
        "cần mời thêm người thân thì bảo mình nhé.",
    ),
    (
        re.compile(r"(câu\s+hỏi|kỷ\s+niệm|time.?capsule|gợi\s+ý)", re.I),
        "Gợi ý tuần này: “Món ăn nào khiến cả nhà nhớ về nhà nhất?” "
        "Ai tiện thì trả lời bằng vài câu hoặc voice note — không cần dài.",
    ),
]

_DEFAULT_TEMPLATE = (
    "Mình đang ở đây cùng Phòng khách. "
    "Có thể nhắn người thân, tạo mã mời, hoặc nhờ mình gợi một câu hỏi "
    "ký ức nhẹ cho tuần này."
)


def sender_display_name(sender_kind: str, user_name: str | None) -> str | None:
    if sender_kind == "user":
        return user_name
    if sender_kind == "agent":
        return AGENT_DISPLAY_NAME
    if sender_kind == "heritage":
        return "Ký ức"
    return user_name


def sender_handle(
    sender_kind: str,
    user_handle: str | None,
    *,
    heritage_handle: str | None = None,
) -> str | None:
    if sender_kind == "user":
        return user_handle
    if sender_kind == "agent":
        return AGENT_HANDLE
    if sender_kind == "heritage":
        return heritage_handle
    return None


def looks_like_bio_request(text: str) -> bool:
    return bool(_BIO_PATTERNS.search(text))


def template_reply(user_text: str) -> str:
    if looks_like_bio_request(user_text):
        return _REFUSE_BIO
    for pattern, reply in _TEMPLATES:
        if pattern.search(user_text):
            return reply
    return _DEFAULT_TEMPLATE


def _extract_gemini_text(data: dict) -> str | None:
    candidates = data.get("candidates") or []
    if not candidates:
        return None
    parts = ((candidates[0].get("content") or {}).get("parts")) or []
    texts = [p.get("text", "") for p in parts if isinstance(p, dict) and p.get("text")]
    text = "\n".join(texts).strip()
    return text or None


def _gemini_reply(
    settings: Settings,
    user_text: str,
    history: list[Message],
    *,
    usage: UsageContext | None = None,
) -> str | None:
    contents: list[dict] = []
    for msg in history[-12:]:
        if msg.sender_kind == "user":
            contents.append({"role": "user", "parts": [{"text": msg.body}]})
        elif msg.sender_kind == "agent":
            contents.append({"role": "model", "parts": [{"text": msg.body}]})
    contents.append({"role": "user", "parts": [{"text": user_text}]})

    while contents and contents[0]["role"] == "model":
        contents.pop(0)

    model = settings.gemini_model.strip() or "gemini-3.5-flash"
    agent_usage = usage or UsageContext(operation="agent")
    if agent_usage.operation == "unknown":
        agent_usage.operation = "agent"
    result = call_gemini(
        settings,
        GeminiCall(
            system_prompt=SYSTEM_PROMPT,
            contents=contents,
            model=model,
            temperature=0.5,
            max_output_tokens=2048,
            timeout_s=45.0,
            attempts=1,
            usage=agent_usage,
        ),
    )
    return result.text


def generate_agent_reply(
    db: Session,
    *,
    thread: Thread,
    user_message: Message,
    settings: Settings | None = None,
) -> str:
    settings = settings or get_settings()
    if looks_like_bio_request(user_message.body):
        # Hard refuse even if LLM is configured — never fabricate biography.
        return _REFUSE_BIO

    history = (
        db.query(Message)
        .filter(Message.thread_id == thread.id, Message.id != user_message.id)
        .order_by(Message.created_at.asc())
        .all()
    )
    llm = _gemini_reply(
        settings,
        user_message.body,
        history,
        usage=UsageContext(
            space_id=thread.space_id,
            thread_id=thread.id,
            message_id=user_message.id,
            user_id=user_message.sender_user_id,
            operation="agent",
        ),
    )
    if llm:
        return llm
    return template_reply(user_message.body)


def maybe_reply(
    db: Session,
    *,
    thread: Thread,
    user_message: Message,
    settings: Settings | None = None,
) -> Message | None:
    settings = settings or get_settings()
    if not settings.agent_enabled:
        return None
    if thread.kind != "family":
        return None
    if getattr(user_message, "kind", "text") == "voice":
        return None

    body = generate_agent_reply(
        db, thread=thread, user_message=user_message, settings=settings
    )
    agent_message = Message(
        id=generate(),
        thread_id=thread.id,
        sender_user_id=None,
        sender_kind="agent",
        kind="text",
        body=body,
        media_path=None,
        media_mime=None,
        created_at=datetime.now(timezone.utc),
    )
    db.add(agent_message)
    db.commit()
    db.refresh(agent_message)
    return agent_message
