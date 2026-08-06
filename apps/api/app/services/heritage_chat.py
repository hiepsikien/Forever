from __future__ import annotations

import json
import re
from datetime import datetime, timezone

import httpx
from nanoid import generate
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..models import FamilyEntity, IdentityProfile, MemoryItem, Message, Thread, User
from .heritage import (
    HERITAGE_TAG_PREFIX,
    KNOWLEDGE_KINDS,
    POEM_KIND,
    heritage_thread_title,
    identity_for_thread,
    normalize_text,
    tag_tokens,
)
from .heritage_analyzer import ContextFrame, analyze_turn
from .heritage_codex import (
    CodexMatch,
    clarify_question,
    codex_entities,
    entity_lines,
    resolve_mentions,
)
from .heritage_grounding import (
    Ungrounded,
    critic_rewrite,
    drop_ungrounded_sentences,
    find_ungrounded,
)
from .heritage_candidates import enqueue_facts
from .heritage_memory import (
    MemoryState,
    avoid_block,
    compact_thread_memory,
    is_repetitive,
    load_state,
    memory_block,
    recent_heritage_bodies,
    record_turn,
    repetition_score,
    stated_facts,
)
from .heritage_retrieval import (
    MILESTONE_KIND,
    build_evidence_pack,
    learned_facts_for_identity,
    milestones_for_identity,
    retrieve_learned,
    retrieve_milestones,
)
from .heritage_values import select_value_lens, value_lens_block
from .memory_scope import readable_by, reader_for_thread

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


_normalize_text = normalize_text


def _query_tokens(text: str) -> set[str]:
    norm = _normalize_text(text)
    parts = re.split(r"[^\w]+", norm)
    return {p for p in parts if len(p) >= 2}


def _spouse_name_from_lock(address: object | None, roles: object | None) -> str | None:
    if isinstance(address, dict):
        spouse = address.get("with_spouse")
        if isinstance(spouse, dict):
            notes = (spouse.get("notes") or "").strip()
            if notes:
                label = notes.replace("Với ", "").split("(")[0].strip()
                if label:
                    return label
    if isinstance(roles, list):
        for role in roles:
            if not isinstance(role, str):
                continue
            if "vợ" in role.lower() or "Lê Thị Định" in role:
                if "bà" in role:
                    start = role.find("bà")
                    chunk = role[start:].split("(")[0].strip()
                    return chunk or None
    return None


def _address_rules_block(address: object | None, roles: object | None) -> str:
    lines: list[str] = []
    if isinstance(address, dict):
        spouse = address.get("with_spouse")
        if isinstance(spouse, dict):
            self_x = (spouse.get("self") or "anh").strip()
            other_x = (spouse.get("other") or "em").strip()
            spouse_name = _spouse_name_from_lock(address, roles) or "vợ (bà Lê Thị Định)"
            lines.append(
                f"- Với {spouse_name}: xưng «{self_x}», gọi vợ là «{other_x}». "
                "TUYỆT ĐỐI không gọi vợ là «mẹ» — dù app hay con cháu hay gọi bà là mẹ/bà ngoại."
            )
        children = address.get("with_children")
        if isinstance(children, dict):
            self_x = (children.get("self") or "bố").strip()
            other_x = (children.get("other") or "con").strip()
            lines.append(f"- Với con: xưng «{self_x}», gọi «{other_x}».")
    return "\n".join(lines)


def _is_spouse_profile(profile: IdentityProfile) -> bool:
    """Wife profile only — not any name containing 'đinh'."""
    rel = _normalize_text(profile.relation_label or "")
    name = _normalize_text(profile.display_name or "")
    if name in ("dinh", "me", "le thi dinh", "ba le thi dinh"):
        return True
    if "le thi dinh" in name:
        return True
    # Demo/living mirror: display «Mẹ» linked to wife account.
    if name == "me" and rel in ("me", "mẹ", "to", "toi"):
        return True
    if rel in ("me", "mẹ", "vo", "vợ") and name == "dinh":
        return True
    return False


def _is_child_profile(profile: IdentityProfile) -> bool:
    rel = _normalize_text(profile.relation_label or "")
    name = _normalize_text(profile.display_name or "")
    if _is_spouse_profile(profile):
        return False
    if rel in ("con", "chi", "chị", "anh", "chau", "cháu", "em"):
        return True
    if name in ("huong", "vy", "vi", "dinh anh"):
        return True
    # Steward / owner «Tôi» mirror — child of Bố, not wife.
    if rel in ("to", "toi") and not _is_spouse_profile(profile):
        return True
    return False


def _infer_audience_from_message(text: str) -> str | None:
    norm = _normalize_text(text)
    if re.search(r"\b(con|chau)\s+(dang|day|oi|noi|chat)\b", norm):
        return "child"
    if re.search(r"^con\b", norm):
        return "child"
    if re.search(r"\b(em|vo)\s+(dang|day|oi|nho|yeu|doi)\b", norm):
        return "spouse"
    if re.search(r"\bnho\s+anh\b", norm):
        return "spouse"
    return None


def _audience_for_user(db: Session, *, space_id: str, user_id: str | None) -> str | None:
    if not user_id:
        return None
    profile = (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.space_id == space_id,
            IdentityProfile.linked_user_id == user_id,
        )
        .one_or_none()
    )
    if not profile:
        return None
    if _is_spouse_profile(profile):
        return "spouse"
    if _is_child_profile(profile):
        return "child"
    return None


def _detect_audience(
    db: Session,
    *,
    space_id: str,
    sender_user_id: str | None,
    user_text: str = "",
    thread: Thread | None = None,
) -> str:
    """Return spouse | child — default child when unknown (safer than guessing wife)."""
    # A direct thread already names the member, so nothing has to be inferred
    # from wording — which is where the "chào em" to a son came from.
    if thread is not None and getattr(thread, "audience_scope", "family") == "direct":
        member_id = thread.member_user_id or sender_user_id
        return _audience_for_user(db, space_id=space_id, user_id=member_id) or "child"
    hinted = _infer_audience_from_message(user_text)
    if hinted:
        return hinted
    return _audience_for_user(db, space_id=space_id, user_id=sender_user_id) or "child"


def _audience_context_block(audience: str | None, spouse_name: str | None) -> str:
    if audience == "spouse":
        who = spouse_name or "vợ (bà Lê Thị Định)"
        return (
            f"NGƯỜI ĐANG NHẮN: {who} — vợ của anh.\n"
            "Trả lời trực tiếp cho vợ: xưng «anh», gọi «em». "
            "Không gọi em là «mẹ»; không xưng «bố» với em."
        )
    return (
        "NGƯỜI ĐANG NHẮN: con trong gia đình (KHÔNG phải vợ).\n"
        "Xưng «bố», gọi «con» — không xưng «anh»/gọi «em» trừ khi trích thơ nguyên văn."
    )


_SPOUSE_VOCATIVE_FIXES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bmẹ ơi\b", re.I), "em ơi"),
    (re.compile(r"\bchào mẹ\b", re.I), "chào em"),
    (re.compile(r"\bnghe mẹ\b", re.I), "nghe em"),
    (re.compile(r"\bmẹ nhé\b", re.I), "em nhé"),
    (re.compile(r"\bmẹ à\b", re.I), "em à"),
    (re.compile(r"\bmẹ ạ\b", re.I), "em ạ"),
    (re.compile(r"\bbố chào mẹ\b", re.I), "anh chào em"),
    (re.compile(r"\blòng bố\b", re.I), "lòng anh"),
    (re.compile(r"\bbố nghe\b", re.I), "anh nghe"),
    (re.compile(r"\bbố cũng\b", re.I), "anh cũng"),
    (re.compile(r"\bbố vẫn\b", re.I), "anh vẫn"),
    (re.compile(r"\bbố luôn\b", re.I), "anh luôn"),
)


def _fix_spouse_address(text: str) -> str:
    out = text
    for pattern, repl in _SPOUSE_VOCATIVE_FIXES:
        out = pattern.sub(repl, out)
    return out


_CHILD_ADDRESS_FIXES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^Chào em,", re.I), "Con ơi,"),
    (re.compile(r"^chào em,", re.I), "Con ơi,"),
    (re.compile(r"\bAnh đây em\b", re.I), "Bố đây con"),
    (re.compile(r"\banh đây em\b", re.I), "bố đây con"),
    (re.compile(r"\bngười vợ\b", re.I), "mẹ"),
    (re.compile(r"\bvợ tào khang\b", re.I), "mẹ"),
    (re.compile(r"\btình nghĩa vợ chồng\b", re.I), "tình cảm gia đình"),
)


def _fix_child_address(text: str) -> str:
    out = text
    for pattern, repl in _CHILD_ADDRESS_FIXES:
        out = pattern.sub(repl, out)
    return out


def heritage_display_name(identity: IdentityProfile) -> str:
    return heritage_thread_title(identity.display_name, identity.relation_label)


def identity_for_heritage_thread(db: Session, thread_id: str) -> IdentityProfile | None:
    thread = db.query(Thread).filter(Thread.id == thread_id).one_or_none()
    return identity_for_thread(db, thread) if thread else None


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
    db: Session, *, space_id: str, identity_id: str, reader: str | None = None
) -> list[MemoryItem]:
    needle = f"{HERITAGE_TAG_PREFIX}{identity_id}"
    items = (
        db.query(MemoryItem)
        .filter(
            MemoryItem.space_id == space_id,
            MemoryItem.kind == POEM_KIND,
            readable_by(reader),
        )
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
    db: Session,
    *,
    space_id: str,
    identity_id: str,
    limit: int = 3,
    reader: str | None = None,
) -> list[MemoryItem]:
    needle = f"{HERITAGE_TAG_PREFIX}{identity_id}"
    # Milestones count as knowledge for the activate gate, but the chat pulls
    # them separately by relevance — including them here would duplicate them.
    kinds = [k for k in KNOWLEDGE_KINDS if k != MILESTONE_KIND]
    items = (
        db.query(MemoryItem)
        .filter(
            MemoryItem.space_id == space_id,
            MemoryItem.kind.in_(kinds),
            readable_by(reader),
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


def build_system_prompt(
    identity: IdentityProfile,
    *,
    signature_poems: list[MemoryItem],
    retrieved_poems: list[MemoryItem],
    knowledge: list[MemoryItem],
    live_context: str | None,
    quote_mode: str,
    audience: str | None = None,
    milestones: list[MemoryItem] | None = None,
    codex_lines: list[str] | None = None,
    clarify: str | None = None,
    frame: ContextFrame | None = None,
    memory: MemoryState | None = None,
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

    ordered_poems: list[MemoryItem] = []
    seen: set[str] = set()
    for poem in signature_poems + retrieved_poems:
        if poem.id in seen:
            continue
        seen.add(poem.id)
        ordered_poems.append(poem)

    pack = build_evidence_pack(
        entity_lines=codex_lines or [],
        poems=ordered_poems,
        milestones=milestones or [],
        knowledge=[item for item in knowledge if (item.body or "").strip()],
    )

    quote_rule = (
        "Chỉ trích nguyên văn lục bát khi thật sự cần; ghi rõ tên bài."
        if quote_mode == "verbatim"
        else "Ưu tiên diễn đạt lại (paraphrase) — không trích nguyên văn dài trừ khi được hỏi rõ."
    )

    dynamic = (getattr(identity, "dynamic_context", None) or "").strip()
    context_bits = [bit for bit in (dynamic, live_context) if bit]
    context_section = "\n".join(context_bits) if context_bits else ""
    evidence_section = (
        "\nBằng chứng được phép dùng (chỉ khẳng định điều có ở đây):\n" + pack.render()
        if pack.items
        else ""
    )
    spouse_name = _spouse_name_from_lock(address, roles)
    address_rules = _address_rules_block(address, roles)
    audience_section = _audience_context_block(audience, spouse_name)
    clarify_section = (
        f"\nCHƯA RÕ NGƯỜI ĐƯỢC NHẮC: hỏi lại ngắn gọn, đại ý «{clarify}» — "
        "đừng đoán bừa rồi kể tiếp.\n"
        if clarify
        else ""
    )
    lens_section = value_lens_block(
        select_value_lens(
            values,
            intent=frame.intent if frame else "smalltalk",
            topics=frame.topics if frame else [],
        )
    )
    length_rule = (
        frame.depth_rule
        if frame
        else "Kiểu chat nhắn tin (Zalo): 2–4 câu, tối đa 2 đoạn ngắn."
    )
    mood_rule = (
        f"Người gửi đang có tâm trạng «{frame.emotion}» — đáp cho hợp, đừng lệch nhịp."
        if frame and frame.emotion != "neutral"
        else ""
    )
    memory_section = memory_block(memory) if memory else ""

    return f"""\
Bạn là thực thể ký ức {display} trong app Forever — KHÔNG phải người còn sống,
KHÔNG phải “Người giữ nhà”, KHÔNG phải chatbot chung.

Hard rules:
- Xưng hô và khẩu khí theo Bản sắc (Identity Lock) bên dưới.
{address_rules}
- Chỉ dựa vào Lock, thơ, và ký ức neo đã cung cấp — KHÔNG bịa tiểu sử hay sự kiện.
- Từ chối nhẹ nhàng: chính trị, tình dục, trái pháp luật, nội dung trái đạo đức.
- Không giả vờ còn sống; không đóng vai “bố/mẹ còn ở đây”.
- Thiếu dữ liệu thì thừa nhận rõ (chưa nhớ / chưa có trong ký ức), rồi mời gia đình
  ghi thêm vào Thư viện — một câu ngắn là đủ. Không đoán cho xong.
- Không đoán năm tương lai, kể cả năm người hỏi vừa nêu, nếu năm đó không có trong
  bằng chứng bên dưới. Đừng nhắc lại năm hỏi khi đang thừa nhận là chưa biết.
- Không bịa tên người (bạn học, đồng nghiệp…) khi bằng chứng không nêu tên.
- {quote_rule}
- Đây là nhắn tin (Zalo), KHÔNG phải viết thư: {length_rule}
- Trả lời đúng ý câu hỏi trước; tránh mở đầu sáo «Chào em/con» dài.
- Luôn kết thúc bằng câu trọn vẹn — không dừng giữa chừng.
{audience_section}
{mood_rule}
{lens_section}
{clarify_section}
{_lock_section("Neo tuổi / giai đoạn", life_stage)}
{_lock_section("Vai trò", roles)}
{_lock_section("Xưng hô", address)}
{_lock_section("Giọng nói / câu mẫu", speech)}
{_lock_section("Giá trị cốt lõi", values)}
{_lock_section("Triết lý", philosophy)}
{_lock_section("Điều cấm", taboos)}
{context_section}
{memory_section}
{evidence_section}
"""


def _extract_gemini_text(data: dict) -> tuple[str | None, str | None]:
    candidates = data.get("candidates") or []
    if not candidates:
        return None, None
    candidate = candidates[0]
    finish_reason = candidate.get("finishReason")
    parts = ((candidate.get("content") or {}).get("parts")) or []
    texts: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        # Gemini 2.5/3 may return thought parts — never surface those as chat text.
        if part.get("thought"):
            continue
        chunk = part.get("text")
        if chunk:
            texts.append(chunk)
    text = "\n".join(texts).strip()
    return text or None, finish_reason


_SENTENCE_END = re.compile(r'[.!?…]["\'\)\]]*\s*$')


def _finalize_reply_text(text: str, finish_reason: str | None = None) -> str:
    """Drop a dangling tail when the model hit token limits mid-sentence."""
    cleaned = text.strip()
    if not cleaned:
        return cleaned
    truncated = finish_reason in ("MAX_TOKENS", "LENGTH")
    if not truncated and _SENTENCE_END.search(cleaned):
        return cleaned
    best = ""
    for sep in (". ", "! ", "? ", "… ", ".\n", "!\n", "?\n"):
        idx = cleaned.rfind(sep)
        if idx >= 15:
            candidate = cleaned[: idx + 1].strip()
            if len(candidate) > len(best):
                best = candidate
    if best:
        return best
    return cleaned


def _gemini_heritage_reply(
    settings: Settings,
    *,
    system_prompt: str,
    user_text: str,
    history: list[Message],
    max_output_tokens: int = 768,
) -> tuple[str | None, str | None]:
    api_key = settings.gemini_api_key.strip()
    if not api_key:
        return None, None

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
        with httpx.Client(timeout=60.0) as client:
            res = client.post(
                url,
                params={"key": api_key},
                headers={"Content-Type": "application/json"},
                json={
                    "systemInstruction": {"parts": [{"text": system_prompt}]},
                    "contents": contents,
                    "generationConfig": {
                        "temperature": 0.5,
                        "maxOutputTokens": max_output_tokens,
                        "thinkingConfig": {"thinkingBudget": 0},
                    },
                },
            )
            res.raise_for_status()
            text, finish_reason = _extract_gemini_text(res.json())
            if not text:
                return None, finish_reason
            return _finalize_reply_text(text, finish_reason), finish_reason
    except Exception:
        return None, None


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


def post_process_reply(reply: str, *, audience: str | None = None) -> str:
    if looks_like_taboo(reply):
        return _REFUSE_TABOO
    cleaned = reply.strip() or _FALLBACK
    if audience == "spouse":
        cleaned = _fix_spouse_address(cleaned)
    elif audience == "child":
        cleaned = _fix_child_address(cleaned)
    return cleaned


def _matches_from_slugs(
    entities: list[FamilyEntity], slugs: list[str], *, seen: list[CodexMatch]
) -> list[CodexMatch]:
    """People the analyzer spotted that a literal alias scan would miss.

    Covers indirect references — "con gái đầu của bố" names nobody, but the
    analyzer can still resolve it to a slug.
    """
    if not slugs:
        return []
    already = {entity.id for match in seen for entity in match.entities}
    by_slug = {entity.slug: entity for entity in entities}
    extra: list[CodexMatch] = []
    for slug in slugs:
        entity = by_slug.get(slug)
        if entity and entity.id not in already:
            already.add(entity.id)
            extra.append(
                CodexMatch(mention=entity.canonical_name, entities=[entity])
            )
    return extra


def _retry_if_repetitive(
    settings: Settings,
    *,
    reply: str,
    finish_reason: str | None,
    system_prompt: str,
    user_text: str,
    history: list[Message],
    memory: MemoryState,
    max_output_tokens: int,
) -> tuple[str, str | None, str | None]:
    """Rewrite once when the reply echoes a recent one. Keeps the fresher of the two."""
    previous = recent_heritage_bodies(history)
    asked = memory.already_asked
    reason = is_repetitive(
        reply,
        previous=previous,
        asked=asked,
        threshold=settings.heritage_repeat_threshold,
    )
    if not reason:
        return reply, finish_reason, None

    retry, retry_finish = _gemini_heritage_reply(
        settings,
        system_prompt=system_prompt + avoid_block(previous, asked),
        user_text=user_text,
        history=history,
        max_output_tokens=max_output_tokens,
    )
    if not retry:
        return reply, finish_reason, reason
    if repetition_score(retry, previous) < repetition_score(reply, previous):
        return retry, retry_finish, reason
    return reply, finish_reason, reason


def _enforce_grounding(
    settings: Settings,
    *,
    body: str,
    corpus: str,
    audience: str | None,
    max_output_tokens: int,
    year_corpus: str | None = None,
) -> tuple[str, dict | None]:
    """Rewrite, trim, or replace a reply that asserts something we cannot show."""
    if not settings.heritage_grounding_enabled:
        return body, None
    found = find_ungrounded(body, corpus=corpus, year_corpus=year_corpus)
    if found.clean:
        return body, None

    info = found.as_meta()
    if not settings.heritage_critic_enabled:
        # Names are a heuristic — flag only. Years are reliable digits: drop the
        # sentence even with the critic off, so a user-asked «2030» cannot stay
        # in the letter just because critic is disabled.
        if found.years:
            trimmed = drop_ungrounded_sentences(
                body, Ungrounded(years=list(found.years), names=[])
            )
            if trimmed:
                fixed = post_process_reply(trimmed, audience=audience)
                leftover = find_ungrounded(
                    fixed, corpus=corpus, year_corpus=year_corpus
                )
                out = leftover.as_meta()
                out["action"] = "trimmed_years"
                if found.years:
                    out["years"] = list(found.years)
                return fixed, out
            info["action"] = "replaced"
            return _FALLBACK, info
        info["action"] = "flagged"
        return body, info

    rewritten = critic_rewrite(
        settings,
        reply=body,
        ungrounded=found,
        max_output_tokens=max_output_tokens,
    )
    if rewritten:
        fixed = post_process_reply(rewritten, audience=audience)
        if find_ungrounded(fixed, corpus=corpus, year_corpus=year_corpus).clean:
            info["action"] = "rewritten"
            return fixed, info

    trimmed = drop_ungrounded_sentences(body, found)
    if trimmed:
        info["action"] = "trimmed"
        return trimmed, info
    # Nothing survived. Saying less is the whole point of the hard rule, so the
    # family gets the neutral line instead of an invented life.
    info["action"] = "replaced"
    return _FALLBACK, info


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
    history = (
        db.query(Message)
        .filter(Message.thread_id == thread.id, Message.id != user_message.id)
        .order_by(Message.created_at.asc())
        .all()
    )

    entities = (
        codex_entities(db, space_id=thread.space_id, subject_identity_id=identity.id)
        if settings.heritage_codex_enabled
        else []
    )

    frame = ContextFrame()
    if settings.heritage_analyzer_enabled:
        frame = analyze_turn(
            settings, user_text=user_text, history=history, entities=entities
        )

    # The analyzer proposes wording the library is more likely to contain
    # ("kết hôn" for "cưới"), so retrieval searches both.
    search_text = " ".join([user_text, *frame.retrieval_queries])

    # A private memory belongs to its owner's own room and nowhere else.
    reader = reader_for_thread(thread)

    signature_titles = signature_poem_titles(identity)
    poems = _poems_for_identity(
        db, space_id=thread.space_id, identity_id=identity.id, reader=reader
    )
    signature, retrieved = retrieve_poems(
        poems, query=search_text, signature_titles=signature_titles
    )
    knowledge = _knowledge_snippets(
        db, space_id=thread.space_id, identity_id=identity.id, reader=reader
    )

    live_context = None
    if getattr(identity, "family_context_opt_in", False):
        live_context = _family_context_snippet(db, space_id=thread.space_id)

    audience = _detect_audience(
        db,
        space_id=thread.space_id,
        sender_user_id=user_message.sender_user_id,
        user_text=user_text,
        thread=thread,
    )

    matches = resolve_mentions(user_text, entities) if entities else []
    matches += _matches_from_slugs(entities, frame.entity_slugs, seen=matches)
    codex_lines = entity_lines(matches)
    clarify = clarify_question(matches)

    milestones = retrieve_milestones(
        milestones_for_identity(
            db, space_id=thread.space_id, identity_id=identity.id, reader=reader
        ),
        query=search_text,
    )

    # What the family told the chat before and a human approved. Joining the
    # knowledge slot means it is quotable evidence and counts as grounded.
    learned = retrieve_learned(
        learned_facts_for_identity(
            db, space_id=thread.space_id, identity_id=identity.id, reader=reader
        ),
        query=search_text,
    )

    memory = (
        load_state(db, thread.id) if settings.heritage_memory_enabled else MemoryState()
    )

    system_prompt = build_system_prompt(
        identity,
        signature_poems=signature,
        retrieved_poems=retrieved,
        knowledge=[*knowledge, *learned],
        live_context=live_context,
        quote_mode=quote_mode,
        audience=audience,
        milestones=milestones,
        codex_lines=codex_lines,
        clarify=clarify,
        frame=frame,
        memory=memory,
    )

    llm, finish_reason = _gemini_heritage_reply(
        settings,
        system_prompt=system_prompt,
        user_text=user_text,
        history=history,
        max_output_tokens=frame.max_output_tokens,
    )

    repeat_reason = None
    if settings.heritage_anti_repeat_enabled and llm:
        llm, finish_reason, repeat_reason = _retry_if_repetitive(
            settings,
            reply=llm,
            finish_reason=finish_reason,
            system_prompt=system_prompt,
            user_text=user_text,
            history=history,
            memory=memory,
            max_output_tokens=frame.max_output_tokens,
        )

    body = post_process_reply(llm or _FALLBACK, audience=audience)

    # Years must appear in Lock + evidence the model was given — never in chat
    # turns. A question like «năm 2030…» (this turn or an earlier one on the
    # same thread) must not launder that year into an allowed assertion.
    name_corpus = "\n".join(
        part
        for part in (
            system_prompt,
            user_text,
            *(m.body or "" for m in history if m.sender_kind == "user"),
        )
        if part
    )
    body, grounding = _enforce_grounding(
        settings,
        body=body,
        corpus=name_corpus,
        year_corpus=system_prompt,
        audience=audience,
        max_output_tokens=frame.max_output_tokens,
    )

    all_poems = signature + retrieved
    citations = _detect_citations(body, all_poems, quote_mode=quote_mode)
    meta: dict = {
        "heritage_identity_id": identity.id,
        "quote_mode": quote_mode,
        "poem_ids": [p.id for p in all_poems],
    }
    if audience:
        meta["audience"] = audience
    if finish_reason:
        meta["finish_reason"] = finish_reason
    if citations:
        meta["citations"] = citations
    if milestones:
        meta["milestone_ids"] = [m.id for m in milestones]
    if learned:
        meta["learned_ids"] = [item.id for item in learned]
    if codex_lines:
        meta["codex_hits"] = codex_lines
        meta["codex_slugs"] = [
            entity.slug for match in matches for entity in match.entities
        ]
    if clarify:
        meta["clarify_prompted"] = True
    if frame.source != "default":
        meta["context_frame"] = frame.as_meta()
    if frame.new_facts:
        meta["new_facts"] = [fact.as_dict() for fact in frame.new_facts]
    if repeat_reason:
        meta["repeat_guard"] = repeat_reason
    if grounding:
        meta["grounding"] = grounding
    if not memory.is_empty:
        meta["thread_memory"] = memory.as_meta()
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

    if settings.heritage_memory_enabled and meta.get("heritage_refusal") is None:
        _write_back_memory(
            db, thread=thread, user_message=user_message, reply=heritage_message,
            settings=settings,
        )
    return heritage_message


def _write_back_memory(
    db: Session,
    *,
    thread: Thread,
    user_message: Message,
    reply: Message,
    settings: Settings,
) -> None:
    """Stage 5. Runs after the reply is saved — a memory failure must not lose it."""
    try:
        record_turn(db, thread=thread, user_message=user_message, reply=reply)
        identity = identity_for_thread(db, thread)
        if identity and settings.heritage_candidates_enabled:
            enqueue_facts(
                db,
                thread=thread,
                identity=identity,
                user_message=user_message,
                facts=stated_facts(
                    _json_loads(reply.meta_json or ""),
                    source_message_id=user_message.id,
                ),
            )
        history = (
            db.query(Message)
            .filter(Message.thread_id == thread.id)
            .order_by(Message.created_at.asc())
            .all()
        )
        compact_thread_memory(
            db, thread=thread, settings=settings, history=history
        )
    except Exception:  # noqa: BLE001 — never fail a delivered reply
        db.rollback()
