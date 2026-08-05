from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime, timezone

import httpx
from nanoid import generate
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..models import IdentityProfile, MemoryItem, Message, Thread
from .heritage import (
    HERITAGE_TAG_PREFIX,
    KNOWLEDGE_KINDS,
    POEM_KIND,
    heritage_thread_title,
    tag_tokens,
)

# Theme tags on imported poems (see memories.ALLOWED_POEM_THEMES).
THEME_QUERY_HINTS: dict[str, tuple[str, ...]] = {
    "vo_chong": ("vợ", "chồng", "tình", "nhau", "em", "anh", "định"),
    "con_cai": ("con", "gái", "trai", "phương", "vỹ", "đình anh", "nhớ con"),
    "gia_dinh": ("gia đình", "nhà", "cháu", "ông", "bà", "cả nhà"),
    "nghe_giao": ("thầy", "giáo", "dạy", "trò", "hưu", "gs", "khoa học"),
    "tho": ("thơ", "lục bát", "vần", "câu thơ"),
    "biet_on": ("biết ơn", "giỗ", "cha", "mẹ", "tổ", "hiếu"),
    "truyen_thong": ("truyền thống", "anh em", "họ", "tổ tiên"),
}

_TABOO_PATTERNS = re.compile(
    r"("
    r"chính\s*trị|đảng\s*phái|bầu\s*cử|quốc\s*hội|"
    r"tình\s*dục|gợi\s*dục|sex\b|"
    r"ma\s*túy|buôn\s*lậu|giết\s*người|"
    r"đóng\s*vai.{0,20}(còn\s+sống|sống\s+lại)|"
    r"(bố|ba|má|mẹ|ông|bà).{0,24}(còn\s+sống|sống\s+lại)|"
    r"bịa.{0,16}(chuyện|kỷ\s*niệm|tiểu\s*sử)|"
    r"kể\s+(chuyện|về).{0,30}(hồi\s+còn\s+sống|khi\s+còn\s+sống)"
    r")",
    re.IGNORECASE | re.DOTALL,
)

_FABRICATION_PATTERNS = re.compile(
    r"("
    r"bịa|đoán|tưởng\s*tượng|"
    r"kể\s+(chuyện|về).{0,30}(chưa|không\s+có\s+trong)|"
    r"nhớ\s+lại.{0,30}(sự\s+kiện|chuyến\s+đi).{0,20}(chưa|không)"
    r")",
    re.IGNORECASE | re.DOTALL,
)

_REFUSE_TABOO = (
    "Con ơi, chỗ này bố không bàn được — mình giữ Phòng khách ấm áp, "
    "điều tốt cho gia đình thôi. Hỏi bố chuyện nhà, chuyện thơ, chuyện con cháu nhé."
)

_REFUSE_FABRICATION = (
    "Bố không bịa chuyện hay kỷ niệm chưa có trong kho ký ức gia đình. "
    "Thiếu chỗ nào, con cứ ghi thêm vào Thư viện — bố sẽ nhớ đúng hơn."
)

_REFUSE_PAUSED = (
    "Thực thể ký ức đang tạm dừng. Steward có thể mở lại trong màn Thổi hồn "
    "khi gia đình sẵn sàng."
)

_FALLBACK = (
    "Bố nghe con rồi. Hỏi thêm về nhà, về thơ, hoặc về người thân — "
    "bố trả lời trong phạm vi ký ức gia đình đã lưu."
)


def _json_loads(raw: str | None) -> object | None:
    if not raw or not str(raw).strip():
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _normalize_text(text: str) -> str:
    folded = unicodedata.normalize("NFD", text.lower())
    return "".join(ch for ch in folded if unicodedata.category(ch) != "Mn")


def _query_tokens(text: str) -> set[str]:
    norm = _normalize_text(text)
    parts = re.split(r"[^\w]+", norm)
    return {p for p in parts if len(p) >= 2}


def heritage_display_name(identity: IdentityProfile) -> str:
    return heritage_thread_title(identity.display_name, identity.relation_label)


def identity_for_heritage_thread(db: Session, thread_id: str) -> IdentityProfile | None:
    return (
        db.query(IdentityProfile)
        .filter(IdentityProfile.heritage_thread_id == thread_id)
        .one_or_none()
    )


def looks_like_taboo(text: str) -> bool:
    return bool(_TABOO_PATTERNS.search(text))


def looks_like_fabrication_request(text: str) -> bool:
    return bool(_FABRICATION_PATTERNS.search(text))


def signature_poem_titles(identity: IdentityProfile) -> list[str]:
    philosophy = _json_loads(getattr(identity, "philosophy_json", None) or "")
    if not isinstance(philosophy, dict):
        return []
    raw = philosophy.get("signature_poems")
    if not isinstance(raw, list):
        return []
    titles: list[str] = []
    for item in raw:
        if isinstance(item, dict):
            title = (item.get("title") or "").strip()
            if title:
                titles.append(title)
        elif isinstance(item, str) and item.strip():
            titles.append(item.strip())
    return titles


def _title_matches(poem_title: str, target: str) -> bool:
    a = _normalize_text(poem_title)
    b = _normalize_text(target)
    return a == b or b in a or a in b


def _poems_for_identity(
    db: Session, *, space_id: str, identity_id: str
) -> list[MemoryItem]:
    needle = f"{HERITAGE_TAG_PREFIX}{identity_id}"
    items = (
        db.query(MemoryItem)
        .filter(MemoryItem.space_id == space_id, MemoryItem.kind == POEM_KIND)
        .order_by(MemoryItem.created_at.asc())
        .all()
    )
    return [item for item in items if needle in tag_tokens(item.tags)]


def _themes_from_tags(tags: str | None) -> set[str]:
    out: set[str] = set()
    for token in tag_tokens(tags):
        if token.startswith("chu-de:"):
            out.add(token.split(":", 1)[1])
    return out


def _score_poem(poem: MemoryItem, query: str) -> int:
    tokens = _query_tokens(query)
    query_norm = _normalize_text(query)
    if not tokens:
        return 0
    title_norm = _normalize_text(poem.title or "")
    body_norm = _normalize_text((poem.body or "")[:1200])
    score = 0
    for token in tokens:
        if token in title_norm:
            score += 8
        if token in body_norm:
            score += 2
    for theme, hints in THEME_QUERY_HINTS.items():
        if theme not in _themes_from_tags(poem.tags):
            continue
        if any(_normalize_text(h) in query_norm for h in hints):
            score += 5
    return score


def retrieve_poems(
    poems: list[MemoryItem],
    *,
    query: str,
    signature_titles: list[str],
    max_retrieved: int = 6,
) -> tuple[list[MemoryItem], list[MemoryItem]]:
    signature: list[MemoryItem] = []
    used_ids: set[str] = set()
    for title in signature_titles:
        for poem in poems:
            if poem.id in used_ids:
                continue
            if _title_matches(poem.title or "", title):
                signature.append(poem)
                used_ids.add(poem.id)
                break

    scored = [
        (_score_poem(poem, query), poem)
        for poem in poems
        if poem.id not in used_ids
    ]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    positive = [poem for score, poem in scored if score > 0][:max_retrieved]
    if positive:
        retrieved = positive
    else:
        retrieved = [poem for _, poem in scored[: min(3, max_retrieved)]]
    return signature, retrieved


def _knowledge_snippets(
    db: Session, *, space_id: str, identity_id: str, limit: int = 3
) -> list[MemoryItem]:
    needle = f"{HERITAGE_TAG_PREFIX}{identity_id}"
    items = (
        db.query(MemoryItem)
        .filter(
            MemoryItem.space_id == space_id,
            MemoryItem.kind.in_(KNOWLEDGE_KINDS),
        )
        .order_by(MemoryItem.created_at.desc())
        .limit(20)
        .all()
    )
    matched = [item for item in items if needle in tag_tokens(item.tags)]
    return matched[:limit]


def _family_context_snippet(db: Session, *, space_id: str) -> str | None:
    family = (
        db.query(Thread)
        .filter(Thread.space_id == space_id, Thread.kind == "family")
        .order_by(Thread.created_at.asc())
        .first()
    )
    if not family:
        return None
    recent = (
        db.query(Message)
        .filter(
            Message.thread_id == family.id,
            Message.sender_kind == "user",
            Message.kind == "text",
        )
        .order_by(Message.created_at.desc())
        .limit(12)
        .all()
    )
    recent.reverse()
    snippets: list[str] = []
    for msg in recent:
        text = (msg.body or "").strip()
        if not text or looks_like_taboo(text):
            continue
        snippets.append(text[:160])
        if len(snippets) >= 3:
            break
    if not snippets:
        return None
    joined = " · ".join(snippets)
    return f"Gia đình vừa trao đổi trong Phòng khách (tóm tắt): {joined[:420]}"


def _lock_section(label: str, payload: object | None) -> str:
    if payload is None:
        return ""
    if isinstance(payload, (dict, list)) and not payload:
        return ""
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    return f"\n{label}:\n{text}\n"


def _format_poem_block(poem: MemoryItem) -> str:
    body = (poem.body or "").strip()
    if len(body) > 900:
        body = body[:900] + "…"
    return f"— {poem.title} (id={poem.id})\n{body}"


def build_system_prompt(
    identity: IdentityProfile,
    *,
    signature_poems: list[MemoryItem],
    retrieved_poems: list[MemoryItem],
    knowledge: list[MemoryItem],
    live_context: str | None,
    quote_mode: str,
) -> str:
    display = heritage_display_name(identity)
    quote_mode = (quote_mode or "paraphrase").strip().lower()
    life_stage = _json_loads(getattr(identity, "life_stage_json", None) or "")
    roles = _json_loads(getattr(identity, "roles_json", None) or "")
    address = _json_loads(getattr(identity, "address_forms_json", None) or "")
    speech = _json_loads(getattr(identity, "speech_style_json", None) or "")
    values = _json_loads(getattr(identity, "core_values_json", None) or "")
    philosophy = _json_loads(getattr(identity, "philosophy_json", None) or "")
    taboos = _json_loads(getattr(identity, "taboos_json", None) or "")

    poem_blocks: list[str] = []
    seen: set[str] = set()
    for poem in signature_poems + retrieved_poems:
        if poem.id in seen:
            continue
        seen.add(poem.id)
        poem_blocks.append(_format_poem_block(poem))

    knowledge_blocks = []
    for item in knowledge:
        body = (item.body or "").strip()
        if not body:
            continue
        knowledge_blocks.append(f"— {item.title}: {body[:500]}")

    quote_rule = (
        "Chỉ trích nguyên văn lục bát khi thật sự cần; ghi rõ tên bài."
        if quote_mode == "verbatim"
        else "Ưu tiên diễn đạt lại (paraphrase) — không trích nguyên văn dài trừ khi được hỏi rõ."
    )

    dynamic = (getattr(identity, "dynamic_context", None) or "").strip()
    context_bits = [bit for bit in (dynamic, live_context) if bit]
    context_section = "\n".join(context_bits) if context_bits else ""
    poem_section = (
        "\nThơ tham chiếu:\n" + "\n\n".join(poem_blocks) if poem_blocks else ""
    )
    knowledge_section = (
        "\nKý ức neo:\n" + "\n".join(knowledge_blocks) if knowledge_blocks else ""
    )

    return f"""\
Bạn là thực thể ký ức {display} trong app Forever — KHÔNG phải người còn sống,
KHÔNG phải “Người giữ nhà”, KHÔNG phải chatbot chung.

Hard rules:
- Xưng hô và khẩu khí theo Bản sắc (Identity Lock) bên dưới.
- Chỉ dựa vào Lock, thơ, và ký ức neo đã cung cấp — KHÔNG bịa tiểu sử hay sự kiện.
- Từ chối nhẹ nhàng: chính trị, tình dục, trái pháp luật, nội dung trái đạo đức.
- Không giả vờ còn sống; không đóng vai “bố/mẹ còn ở đây”.
- Thiếu dữ liệu thì thừa nhận, mời gia đình bổ sung ký ức thật.
- {quote_rule}
- Trả lời tiếng Việt, ấm áp, 1–3 đoạn ngắn; tránh sáo rỗng và tiểu thuyết dài.
{_lock_section("Neo tuổi / giai đoạn", life_stage)}
{_lock_section("Vai trò", roles)}
{_lock_section("Xưng hô", address)}
{_lock_section("Giọng nói / câu mẫu", speech)}
{_lock_section("Giá trị cốt lõi", values)}
{_lock_section("Triết lý", philosophy)}
{_lock_section("Điều cấm", taboos)}
{context_section}
{poem_section}
{knowledge_section}
"""


def _extract_gemini_text(data: dict) -> str | None:
    candidates = data.get("candidates") or []
    if not candidates:
        return None
    parts = ((candidates[0].get("content") or {}).get("parts")) or []
    texts = [p.get("text", "") for p in parts if isinstance(p, dict) and p.get("text")]
    text = "\n".join(texts).strip()
    return text or None


def _gemini_heritage_reply(
    settings: Settings,
    *,
    system_prompt: str,
    user_text: str,
    history: list[Message],
) -> str | None:
    api_key = settings.gemini_api_key.strip()
    if not api_key:
        return None

    contents: list[dict] = []
    for msg in history[-12:]:
        if msg.sender_kind == "user":
            contents.append({"role": "user", "parts": [{"text": msg.body}]})
        elif msg.sender_kind in ("heritage", "agent"):
            contents.append({"role": "model", "parts": [{"text": msg.body}]})
    contents.append({"role": "user", "parts": [{"text": user_text}]})

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
                    "systemInstruction": {"parts": [{"text": system_prompt}]},
                    "contents": contents,
                    "generationConfig": {
                        "temperature": 0.55,
                        "maxOutputTokens": 2048,
                        "thinkingConfig": {"thinkingBudget": 0},
                    },
                },
            )
            res.raise_for_status()
            return _extract_gemini_text(res.json())
    except Exception:
        return None


def _detect_citations(
    reply: str,
    poems: list[MemoryItem],
    *,
    quote_mode: str,
) -> list[dict]:
    if quote_mode != "verbatim":
        return []
    citations: list[dict] = []
    norm_reply = _normalize_text(reply)
    for poem in poems:
        title = (poem.title or "").strip()
        if not title:
            continue
        if _normalize_text(title) in norm_reply:
            citations.append(
                {"memory_id": poem.id, "title": title, "kind": "poem"}
            )
            continue
        sample = _normalize_text((poem.body or "")[:80])
        if len(sample) >= 24 and sample in norm_reply:
            citations.append(
                {"memory_id": poem.id, "title": title, "kind": "poem"}
            )
    return citations


def post_process_reply(reply: str) -> str:
    if looks_like_taboo(reply):
        return _REFUSE_TABOO
    return reply.strip() or _FALLBACK


def generate_heritage_reply(
    db: Session,
    *,
    thread: Thread,
    identity: IdentityProfile,
    user_message: Message,
    settings: Settings | None = None,
) -> tuple[str, dict]:
    settings = settings or get_settings()
    user_text = (user_message.body or "").strip()

    if looks_like_taboo(user_text) or looks_like_fabrication_request(user_text):
        return _REFUSE_TABOO, {"heritage_refusal": "taboo_or_fabrication"}

    quote_mode = (getattr(identity, "poetry_quote_mode", None) or "paraphrase").strip()
    signature_titles = signature_poem_titles(identity)
    poems = _poems_for_identity(db, space_id=thread.space_id, identity_id=identity.id)
    signature, retrieved = retrieve_poems(
        poems, query=user_text, signature_titles=signature_titles
    )
    knowledge = _knowledge_snippets(
        db, space_id=thread.space_id, identity_id=identity.id
    )

    live_context = None
    if getattr(identity, "family_context_opt_in", False):
        live_context = _family_context_snippet(db, space_id=thread.space_id)

    system_prompt = build_system_prompt(
        identity,
        signature_poems=signature,
        retrieved_poems=retrieved,
        knowledge=knowledge,
        live_context=live_context,
        quote_mode=quote_mode,
    )

    history = (
        db.query(Message)
        .filter(Message.thread_id == thread.id, Message.id != user_message.id)
        .order_by(Message.created_at.asc())
        .all()
    )

    llm = _gemini_heritage_reply(
        settings,
        system_prompt=system_prompt,
        user_text=user_text,
        history=history,
    )
    body = post_process_reply(llm or _FALLBACK)

    all_poems = signature + retrieved
    citations = _detect_citations(body, all_poems, quote_mode=quote_mode)
    meta: dict = {
        "heritage_identity_id": identity.id,
        "quote_mode": quote_mode,
        "poem_ids": [p.id for p in all_poems],
    }
    if citations:
        meta["citations"] = citations
    return body, meta


def maybe_heritage_reply(
    db: Session,
    *,
    thread: Thread,
    user_message: Message,
    settings: Settings | None = None,
) -> Message | None:
    settings = settings or get_settings()
    if not settings.agent_enabled:
        return None
    if thread.kind != "heritage":
        return None
    if getattr(user_message, "kind", "text") == "voice":
        return None

    identity = identity_for_heritage_thread(db, thread.id)
    if not identity:
        return None

    entity_status = getattr(identity, "heritage_entity_status", None) or "dormant"
    if entity_status == "paused":
        body = _REFUSE_PAUSED
        meta = {"heritage_refusal": "paused"}
    elif entity_status != "ready":
        return None
    else:
        body, meta = generate_heritage_reply(
            db,
            thread=thread,
            identity=identity,
            user_message=user_message,
            settings=settings,
        )

    heritage_message = Message(
        id=generate(),
        thread_id=thread.id,
        sender_user_id=None,
        sender_kind="heritage",
        kind="text",
        body=body,
        media_path=None,
        media_mime=None,
        meta_json=json.dumps(meta, ensure_ascii=False),
        created_at=datetime.now(timezone.utc),
    )
    db.add(heritage_message)
    db.commit()
    db.refresh(heritage_message)
    return heritage_message
