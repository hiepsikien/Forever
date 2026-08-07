from __future__ import annotations

import re
from datetime import datetime, timezone

import httpx
from nanoid import generate
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..models import Message, Thread

AGENT_DISPLAY_NAME = "Người giữ nhà"
AGENT_HANDLE = "giunhà"

SYSTEM_PROMPT = """\
Bạn là “Người giữ nhà” (@giunhà) — trợ lý gia đình trong app Forever.

Phòng khách là phòng của gia đình, không phải của bạn. Bạn là vai phụ: có người
gọi @giunhà thì đáp gọn, giúp việc nhà (mời người thân, tìm ký ức, gợi một câu
hỏi cội nguồn) rồi im lặng nhường lời.

Hard rules:
- ĐỘ DÀI: tối đa 2 câu. Không xuống dòng nhiều đoạn, không liệt kê.
- Viết thuần văn bản tiếng Việt. KHÔNG dùng markdown: không **in đậm**, không #,
  không gạch đầu dòng — app hiện nguyên ký tự đó ra màn hình.
- Người được nhớ (vd. bố @bo) NGỒI NGAY TRONG PHÒNG KHÁCH này và nghe được mọi
  lời gọi tên họ. TUYỆT ĐỐI không nói họ “không nghe được ở đây”, không bảo ai
  sang phòng khác, không nhắc tới tên phòng nào khác. Muốn hỏi họ thì gọi tên
  hoặc @handle ngay tại đây.
- Bạn KHÔNG phải người đã mất, KHÔNG đóng vai bố/mẹ/ông bà đã khuất, KHÔNG trả
  lời thay họ.
- KHÔNG bịa tiểu sử, kỷ niệm, hay sự kiện chưa có trong kho ký ức gia đình.
- Nếu được yêu cầu kể chuyện / nói như người đã mất: từ chối rõ ràng,
  giải thích rằng Forever chỉ kể lại khi gia đình đã lưu ký ức thật,
  rồi mời họ ghi lại một kỷ niệm ngắn hoặc voice note.
- KHÔNG dẫn dắt cuộc trò chuyện, không hỏi thêm cho có, không chúc tụng dài
  dòng, không nhắc mọi người phải làm gì tiếp theo. Nói xong việc là dừng.
"""

# Matches on tone-stripped text: «@giunhà», «chị giữ nhà ơi», «trợ lý».
_AGENT_CALL = re.compile(
    r"(?<!\w)@?(?:nguoi\s+)?giu\s*nha(?!\w)|(?<!\w)tro\s+ly(?!\w)"
)

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
        "Chào cả nhà. Mình là Người giữ nhà — trợ lý, không phải người đã mất. "
        "Cả nhà cứ nói chuyện tự nhiên; cần gì thì gọi @giunhà, "
        "còn muốn hỏi người thân đã mất thì gọi thẳng tên họ.",
    ),
    (
        re.compile(r"(câu\s+hỏi|kỷ\s+niệm|time.?capsule|gợi\s+ý)", re.I),
        "Gợi ý tuần này: “Món ăn nào khiến cả nhà nhớ về nhà nhất?” "
        "Ai tiện thì trả lời bằng vài câu hoặc voice note — không cần dài.",
    ),
]

_DEFAULT_TEMPLATE = (
    "Mình ở đây khi cả nhà cần — mời người thân, tìm ký ức, "
    "hay gợi một câu hỏi nhẹ. Muốn hỏi người thân đã mất thì gọi tên họ, "
    "họ đang ngồi cùng phòng."
)


def sender_display_name(sender_kind: str, user_name: str | None) -> str | None:
    if sender_kind == "user":
        return user_name
    if sender_kind == "agent":
        return AGENT_DISPLAY_NAME
    if sender_kind == "heritage":
        return "Ký ức"
    return user_name


def sender_handle(sender_kind: str, user_handle: str | None) -> str | None:
    if sender_kind == "user":
        return user_handle
    if sender_kind == "agent":
        return AGENT_HANDLE
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


_MARKDOWN_NOISE = re.compile(r"(\*\*|__|\*|`)|^\s*[#>]+\s*|^\s*[-•]\s+", re.M)
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?…])\s+")
# The agent used to send people to another room to reach the person remembered;
# that room no longer means what it did, so a reply like that is simply wrong.
_MISDIRECTION = re.compile(
    r"((sang|qua|vào)\s+(phòng|mục|tab)"
    r"|không\s+(thể\s+)?(trực\s+tiếp\s+)?(nghe|nhận|đọc)\s"
    r"|chuyển\s+(sang|qua))",
    re.IGNORECASE,
)


def _tidy_agent_reply(text: str) -> str | None:
    """Trim the reply to a bit part. None when it breaks the room's rules."""
    cleaned = _MARKDOWN_NOISE.sub("", text or "").strip()
    if not cleaned:
        return None
    if _MISDIRECTION.search(cleaned):
        return None
    sentences = [s for s in _SENTENCE_SPLIT.split(cleaned.replace("\n", " ")) if s.strip()]
    return " ".join(sentences[:2]).strip() or None


def _extract_gemini_text(data: dict) -> str | None:
    candidates = data.get("candidates") or []
    if not candidates:
        return None
    parts = ((candidates[0].get("content") or {}).get("parts")) or []
    texts = [p.get("text", "") for p in parts if isinstance(p, dict) and p.get("text")]
    text = "\n".join(texts).strip()
    return text or None


def _gemini_reply(settings: Settings, user_text: str, history: list[Message]) -> str | None:
    api_key = settings.gemini_api_key.strip()
    if not api_key:
        return None

    contents: list[dict] = []
    for msg in history[-12:]:
        if msg.sender_kind == "user":
            contents.append({"role": "user", "parts": [{"text": msg.body}]})
        elif msg.sender_kind == "agent":
            contents.append({"role": "model", "parts": [{"text": msg.body}]})
    contents.append({"role": "user", "parts": [{"text": user_text}]})

    # Gemini requires alternating user/model; drop leading model turns if any.
    while contents and contents[0]["role"] == "model":
        contents.pop(0)

    model = settings.gemini_model.strip() or "gemini-3.5-flash"
    base = settings.gemini_api_base.rstrip("/")
    url = f"{base}/models/{model}:generateContent"

    try:
        with httpx.Client(timeout=45.0) as client:
            res = client.post(
                url,
                params={"key": api_key},
                headers={"Content-Type": "application/json"},
                json={
                    "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
                    "contents": contents,
                    "generationConfig": {
                        "temperature": 0.5,
                        # A bit player needs two sentences, not an essay.
                        "maxOutputTokens": 256,
                        # Gemini 3.x thinking can consume the output budget — keep low for chat.
                        "thinkingConfig": {"thinkingBudget": 0},
                    },
                },
            )
            res.raise_for_status()
            return _extract_gemini_text(res.json())
    except Exception:
        return None


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
    llm = _gemini_reply(settings, user_message.body, history)
    tidied = _tidy_agent_reply(llm) if llm else None
    if tidied:
        return tidied
    return template_reply(user_message.body)


def agent_speak_reason(
    db: Session, *, thread: Thread, user_message: Message
) -> str | None:
    """Phòng khách is the family's room — the agent is a bit player there.

    Returns "called" when someone asks for it, "greeting" for the very first
    turn so a brand new space is not silent, and None the rest of the time.
    """
    from .heritage import normalize_text
    from .heritage_chat import addressed_living_room_identity

    text = (user_message.body or "").strip()
    if not text:
        return None

    # A message calling a remembered person belongs to them, not the agent.
    if addressed_living_room_identity(db, space_id=thread.space_id, text=text):
        return None

    if _AGENT_CALL.search(normalize_text(text)):
        return "called"

    # A voice note is meant for the family, never a cue to greet them.
    if (getattr(user_message, "kind", "text") or "text") == "voice":
        return None

    earlier_user_turn = (
        db.query(Message.id)
        .filter(
            Message.thread_id == thread.id,
            Message.sender_kind == "user",
            Message.id != user_message.id,
        )
        .first()
    )
    return "greeting" if earlier_user_turn is None else None


def greeting_text(db: Session, *, thread: Thread) -> str:
    """First words in a new Phòng khách — fixed, so they are always true."""
    from .heritage import heritage_handle, living_room_identities_for_space

    seated = living_room_identities_for_space(db, thread.space_id)
    if not seated:
        return (
            "Chào cả nhà, mình là Người giữ nhà — trợ lý ở đây thôi. "
            "Cả nhà cứ nói chuyện tự nhiên, cần gì thì gọi @giunhà nhé."
        )
    names = " và ".join(
        f"{(p.relation_label or p.display_name).strip()} (@{heritage_handle(p)})"
        for p in seated
    )
    return (
        "Chào cả nhà, mình là Người giữ nhà — trợ lý ở đây thôi. "
        f"{names} cũng ngồi trong phòng này, gọi tên là trả lời; "
        "cần mình thì gọi @giunhà."
    )


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
    reason = agent_speak_reason(db, thread=thread, user_message=user_message)
    if reason is None:
        return None

    # A first turn that asks for fabricated biography needs the refusal, not a
    # welcome — the greeting is only for an ordinary opening line.
    greet = reason == "greeting" and not looks_like_bio_request(
        user_message.body or ""
    )
    body = (
        greeting_text(db, thread=thread)
        if greet
        else generate_agent_reply(
            db, thread=thread, user_message=user_message, settings=settings
        )
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
