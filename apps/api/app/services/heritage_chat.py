from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone

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
    is_own_poem,
    normalize_text,
    tag_tokens,
    voice_for_identity,
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
from .keepsakes import active_photo_keepsake, mark_heard, story_facts_from_turn
from .heritage_pipeline import load_heritage_pipeline
from .heritage_persona import (
    Persona,
    address_rules_block,
    audience_block,
    persona_for,
)
from .heritage_rules_app import (
    REFUSE_PAUSED,
    app_refusal,
    app_rules_block,
    clarify_line,
    fix_address_register,
    fix_foreign_self_reference,
    looks_like_direct_affection,
    looks_like_fabrication_request,
    looks_like_taboo,
    soften_affection,
    strip_deference,
    strip_repeated_closing,
)
from .heritage_rules_family import (
    DEFAULT_CHARTER,
    FamilyCharter,
    charter_block,
    load_family_charter,
    spouse_affection_rule,
    looks_like_grief,
    looks_like_sensitive,
    maybe_family_bridge,
    maybe_winddown,
    refuse_sensitive,
    strip_repeated_family_redirect,
)
from .heritage_safety import cited_entries, sitting_heritage_count
from .heritage_memory import (
    MemoryState,
    avoid_block,
    compact_thread_memory,
    is_repetitive,
    load_state,
    memory_block,
    recent_heritage_bodies,
    heritage_bodies_today,
    record_turn,
    repetition_score,
    stated_facts,
)
from .heritage_retrieval import (
    MILESTONE_KIND,
    build_evidence_pack,
    learned_facts_for_identity,
    family_milestones,
    family_shared_for_identities,
    retrieve_learned,
    retrieve_milestones,
)
from .heritage_values import select_value_lens, value_lens_block
from .ai_usage import UsageContext
from .heritage_gemini import GeminiCall, call_gemini
from .memory_scope import readable_by, reader_for_thread
from .poem_recite import PoemReciteError, get_or_create_recite_audio
from .storage import save_bytes
from .storytelling import (
    StoryTtsError,
    enabled_readable_works,
    ensure_story_tts_recording,
    pick_next_chunk_for_recite,
    pick_work_for_recite,
    score_work_for_recite,
)

logger = logging.getLogger(__name__)

# Theme tags on imported poems (see memories.ALLOWED_POEM_THEMES).
# Chỉ từ chung của chủ đề — tên người thân đến từ Family Codex của chính người
# được nhớ, không nằm cứng ở đây.
THEME_QUERY_HINTS: dict[str, tuple[str, ...]] = {
    "vo_chong": ("vợ", "chồng", "tình", "nhau"),
    "con_cai": ("con", "gái", "trai", "nhớ con"),
    "gia_dinh": ("gia đình", "nhà", "cháu", "ông", "bà", "cả nhà"),
    "nghe_giao": ("thầy", "giáo", "dạy", "trò", "hưu"),
    "tho": ("thơ", "lục bát", "vần", "câu thơ"),
    "biet_on": ("biết ơn", "giỗ", "cha", "mẹ", "tổ", "hiếu"),
    "truyen_thong": ("truyền thống", "anh em", "họ", "tổ tiên"),
}


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


def _is_spouse_profile(profile: IdentityProfile) -> bool:
    """Người bạn đời của người được nhớ — nhận theo nhãn quan hệ, không theo tên."""
    rel = _normalize_text(profile.relation_label or "")
    name = _normalize_text(profile.display_name or "")
    if rel in ("me", "mẹ", "vo", "vợ", "chong", "chồng"):
        return True
    # Bản sao người sống hiển thị «Mẹ» gắn với tài khoản vợ.
    if name == "me" and rel in ("me", "mẹ", "to", "toi"):
        return True
    return False


def _is_grandchild_profile(profile: IdentityProfile) -> bool:
    """Cháu / chắt — vai riêng, không gộp vào con.

    Một cụ bà xưng «mẹ» với con nhưng «bà» với cháu; gộp hai vai là cách
    «Mẹ nhớ con» đến tay đứa cháu.
    """
    rel = _normalize_text(profile.relation_label or "")
    if _is_spouse_profile(profile):
        return False
    return rel in ("chau", "cháu", "chat", "chắt") or rel.startswith(
        ("chau ", "chat ")
    )


def _is_child_profile(profile: IdentityProfile) -> bool:
    rel = _normalize_text(profile.relation_label or "")
    if _is_spouse_profile(profile) or _is_grandchild_profile(profile):
        return False
    if rel in ("con", "chi", "chị", "anh", "em"):
        return True
    if rel.startswith("con "):  # «Con trai», «Con gái»
        return True
    # Bản sao của steward/owner «Tôi» — là con cháu, không phải bạn đời.
    if rel in ("to", "toi"):
        return True
    return False


# «Cháu chào bà», «cháu nhớ bà quá» — tự xưng, không phải kể về một đứa cháu.
# Đòi có động từ ngay sau để «Cháu Hương Ly mới đi học» không lọt.
# Cho phép sau lời gọi («Bà ơi cháu nhớ bà quá») — đó là nhịp nói thường ngày.
_GRANDCHILD_SELF = re.compile(
    r"(^|[.!?…]\s+|\boi[,\s]+)(chau|chat)\s+"
    r"(dang|day|oi|noi|chat|nho|hoi|muon|xin|thua|chao|cam|khong|co|moi|vua|se|cung|van)\b"
)


def _declares_grandchild(text: str) -> bool:
    return bool(_GRANDCHILD_SELF.search(_normalize_text(text)))


def _infer_audience_from_message(text: str) -> str | None:
    norm = _normalize_text(text)
    # Người Việt tự xưng đúng vai của mình, nên «cháu» là tín hiệu chắc chắn
    # hơn mọi suy đoán từ nhãn quan hệ (vốn neo vào một người trong nhà).
    if re.search(r"\b(chau|chat)\s+(dang|day|oi|noi|chat|nho|hoi|muon|xin|thua)\b", norm):
        return "grandchild"
    if re.search(r"^(chau|chat)\b", norm):
        return "grandchild"
    if re.search(r"\bcon\s+(dang|day|oi|noi|chat)\b", norm):
        return "child"
    if re.search(r"^con\b", norm):
        return "child"
    if re.search(r"\b(em|vo)\s+(dang|day|oi|nho|yeu|doi)\b", norm):
        return "spouse"
    if re.search(r"\bnho\s+anh\b", norm):
        return "spouse"
    return None


# Nhãn của người sống ghi theo người được nhớ mà gia đình neo vào: «Vợ của
# Bố», «Con của Bố». Con số là số bậc người ấy đứng DƯỚI người neo.
_LIVING_OFFSET: dict[str, int] = {
    "vo": 0, "chong": 0, "me": 0, "bo": 0,
    "con": 1, "con dau": 1, "con re": 1, "dau": 1, "re": 1,
    "chau": 2, "chau noi": 2, "chau ngoai": 2,
    "chat": 3,
}


def _living_offset(rel: str) -> int | None:
    if rel in _LIVING_OFFSET:
        return _LIVING_OFFSET[rel]
    for word, offset in _LIVING_OFFSET.items():
        if rel.startswith(f"{word} "):  # «Con trai», «Cháu nội đích tôn»
            return offset
    return None


def _anchor_generation_rank(db: Session, space_id: str) -> int | None:
    """Bậc của người được nhớ mà nhãn người sống neo vào.

    Màn tạo hồ sơ hỏi «Với {người được nhớ đầu tiên}, người này là …», nên chỗ
    neo là hồ sơ được nhớ cũ nhất còn hiện.
    """
    rows = (
        db.query(IdentityProfile)
        .filter(
            IdentityProfile.space_id == space_id,
            IdentityProfile.status == "remembered",
            IdentityProfile.archived_at.is_(None),
        )
        .order_by(IdentityProfile.created_at.asc())
        .all()
    )
    for row in rows:
        rank = persona_for(row).generation_rank
        if rank is not None:
            return rank
    return None


def _audience_by_generation(
    db: Session, *, space_id: str, profile: IdentityProfile, persona: Persona
) -> str | None:
    """Đếm bậc giữa người đang nói và người đang nghe.

    Nhãn một mình không đủ: «Con trai» là con của Bố nhưng là cháu của Bà, và
    bản sao đăng nhập chỉ ghi «Tôi». Đếm bậc trả lời được cả hai phòng bằng
    cùng một phép tính, nên gia đình không phải sửa nhãn cho từng người.
    """
    rank = persona.generation_rank
    if rank is None:
        return None
    rel = _normalize_text(profile.relation_label or "")
    if rel in ("to", "toi"):
        # Bản sao đăng nhập: chính người đặt nhãn, tức đời gốc.
        listener = 0
    else:
        offset = _living_offset(rel)
        anchor = _anchor_generation_rank(db, space_id)
        if offset is None or anchor is None:
            return None
        listener = anchor - offset
    gap = rank - listener
    if gap <= 0:
        return "spouse" if _is_spouse_profile(profile) else None
    if gap == 1:
        return "child"
    return "grandchild"


def _audience_for_user(
    db: Session,
    *,
    space_id: str,
    user_id: str | None,
    persona: Persona | None = None,
) -> str | None:
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
    if persona is not None:
        counted = _audience_by_generation(
            db, space_id=space_id, profile=profile, persona=persona
        )
        if counted:
            return counted
    if _is_spouse_profile(profile):
        return "spouse"
    if _is_grandchild_profile(profile):
        return "grandchild"
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
    persona: Persona | None = None,
) -> str:
    """spouse | child | grandchild — mặc định child khi không rõ.

    Persona chốt lần cuối: người không có vai vợ/chồng trong Bản sắc thì không
    thể có người nhắn là vợ/chồng, dù người gửi là ai.
    """
    def _fit(value: str) -> str:
        return persona.audience(value) if persona else value

    # Nhãn quan hệ trên hồ sơ neo vào một người trong nhà («Con trai» là con của
    # Bố, nhưng là cháu của Bà). Khi người nhắn tự xưng «cháu», chính họ đã nói
    # rõ thế hệ của mình với người đang nghe — tin họ trước nhãn.
    if _declares_grandchild(user_text):
        return _fit("grandchild")

    # Phòng riêng đã nêu đích danh thành viên, không cần suy từ chữ nghĩa —
    # chỗ ấy chính là nơi sinh ra câu «chào em» gửi nhầm cho con trai.
    if thread is not None and getattr(thread, "audience_scope", "family") == "direct":
        member_id = thread.member_user_id or sender_user_id
        return _fit(
            _audience_for_user(
                db, space_id=space_id, user_id=member_id, persona=persona
            )
            or "child"
        )
    # Phòng chung: ai đang nói thắng chữ nghĩa («con mới về» do mẹ nhắn không
    # được lật người được nhớ sang nói với con).
    from_profile = _audience_for_user(
        db, space_id=space_id, user_id=sender_user_id, persona=persona
    )
    if from_profile:
        return _fit(from_profile)
    hinted = _infer_audience_from_message(user_text)
    if hinted:
        return _fit(hinted)
    return "child"


def _identity_taboos(taboos: object | None) -> object | None:
    """Bản sắc keeps personal hard limits; app/family rules live in other layers."""
    if not isinstance(taboos, dict):
        return taboos
    out = dict(taboos)
    out.pop("heritage_rules", None)
    return out


def heritage_display_name(identity: IdentityProfile) -> str:
    return heritage_thread_title(identity.display_name, identity.relation_label)


def identity_for_heritage_thread(db: Session, thread_id: str) -> IdentityProfile | None:
    thread = db.query(Thread).filter(Thread.id == thread_id).one_or_none()
    return identity_for_thread(db, thread) if thread else None


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
    return [item for item in items if needle in tag_tokens(item.tags) and is_own_poem(item.tags)]


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


_RECITE_HINT = re.compile(
    r"("
    r"\bdoc\s+tho\b|"
    r"\bngam\s+tho\b|"
    r"\bnghe\b.{0,24}\bdoc\b|"
    r"\bdoc\s+bai\b|"
    r"\bdoc\b.{0,12}\b(tho|bai)\b"
    r")",
    re.I,
)

_RECITE_FILLER = {
    "doc", "ngam", "nghe", "tho", "bai", "bo", "anh", "giup", "voi", "ho",
    "di", "nhe", "nha", "cho", "lai", "mot", "nua", "giup", "minh", "ho",
    "oi", "a", "nhe", "di", "con", "noi",
}

# Verbs / phrases that mean «please read aloud» for kinh + truyện thơ.
_STORY_READ_HINT = re.compile(
    r"("
    r"\bdoc\s+kinh\b|"
    r"\bniem\s+kinh\b|"
    r"\btung\s+kinh\b|"
    r"\bdoc\s+truyen\b|"
    r"\bke\s+chuyen\b|"
    r"\bnghe\b.{0,28}\b(doc|kinh|truyen)\b|"
    r"\bdoc\b.{0,24}\b(kinh|truyen)\b|"
    r"\b(niem|tung)\s+(kinh|phat)\b|"
    r"\b(doc|ngam)\b"
    r")",
    re.I,
)

# «Niệm» and «tụng» only mean chanting next to kinh / Phật. Standing alone they
# swallow «kỷ niệm» and «niềm vui» — and a request to invent a memory then came
# back as a sutra instead of a refusal.
_STORY_CATEGORY_SUTRA = re.compile(r"\bkinh\b|\b(niem|tung)\s+(kinh|phat)\b")
_STORY_CATEGORY_CLASSIC = re.compile(r"\btruyen\b")
# «Kể Phạm Công Cúc Hoa» is a request to hear the whole story, but «kể» is also
# ordinary family talk — it only counts when the ask names a work clearly.
_STORY_TELL_HINT = re.compile(r"\bke\b")
_STORY_TITLE_SCORE = 12
# «Kể» must land on the whole title or slug (50–60 points), not on one shared
# word — «cô Hoa» scores on Phạm Công – Cúc Hoa twice over.
_STORY_TITLE_SCORE_TELL = 50


def looks_like_poem_recite_request(text: str) -> bool:
    return bool(_RECITE_HINT.search(_normalize_text(text)))


def looks_like_story_recite_request(
    text: str,
    works: list | None = None,
) -> bool:
    """True when they asked to hear a kinh / truyện — or named an enabled work."""
    norm = _normalize_text(text)
    read_verb = bool(_STORY_READ_HINT.search(norm))
    tell_verb = bool(_STORY_TELL_HINT.search(norm))
    if not read_verb and not tell_verb:
        return False
    if read_verb and (
        _STORY_CATEGORY_SUTRA.search(norm) or _STORY_CATEGORY_CLASSIC.search(norm)
    ):
        return True
    # «Bà đọc Kiều» / «đọc Dược Sư» — verb + title, no generic kinh/truyện word.
    # «Kể …» must name the work more fully: one shared word like «Hoa» is a
    # granddaughter, not a request for Phạm Công – Cúc Hoa.
    need = _STORY_TITLE_SCORE if read_verb else _STORY_TITLE_SCORE_TELL
    if works:
        return any(score_work_for_recite(w, text) >= need for w in works)
    return False


def _recite_remainder(query: str) -> str:
    tokens = [
        tok
        for tok in re.split(r"[^\w]+", _normalize_text(query))
        if tok and tok not in _RECITE_FILLER and len(tok) >= 2
    ]
    return " ".join(tokens)


def pick_poem_for_recite(poems: list[MemoryItem], query: str) -> MemoryItem | None:
    """Match a library poem the family asked to hear — title over body."""
    remainder = _recite_remainder(query)
    query_norm = _normalize_text(query)
    if not remainder:
        return None
    best: MemoryItem | None = None
    best_score = 0
    for poem in poems:
        title_norm = _normalize_text(poem.title or "")
        if not title_norm:
            continue
        score = 0
        if remainder in title_norm:
            score += 50
        if title_norm in query_norm:
            score += 40
        for tok in remainder.split():
            if tok in title_norm:
                score += 10
        if score > best_score:
            best_score = score
            best = poem
    return best if best_score >= 10 else None


def _recite_body(lead: str, passage: str) -> tuple[str, int]:
    """Reply text, and where the recording starts inside it.

    A recitation is cached per poem or per passage and shared with the library
    and the Nghe đọc shelf, so the audio never contains the lead line. The call
    screen needs to know that, or the follow-along highlight spreads the voice
    over the lead too and trails it by seconds.
    """
    if not passage:
        return lead, 0
    return f"{lead}\n\n{passage}".strip(), len(lead) + 2


def try_poem_recite_reply(
    db: Session,
    *,
    thread: Thread,
    identity: IdentityProfile,
    user_message: Message,
    settings: Settings | None = None,
) -> tuple[str, dict, str | None, str | None] | None:
    """If they asked to hear a poem, attach the cached Voice DNA recitation."""
    user_text = (user_message.body or "").strip()
    if not looks_like_poem_recite_request(user_text):
        return None
    persona = persona_for(identity)
    reader = reader_for_thread(thread)
    poems = _poems_for_identity(
        db, space_id=thread.space_id, identity_id=identity.id, reader=reader
    )
    poem = pick_poem_for_recite(poems, user_text)
    if poem is None:
        return None
    try:
        audio = get_or_create_recite_audio(
            db,
            poem,
            user_id=user_message.sender_user_id,
            preferred_identity_id=identity.id,
        )
    except PoemReciteError as exc:
        logger.info("heritage poem recite skipped: %s", exc.detail)
        return None
    except Exception:
        logger.exception("heritage poem recite failed")
        return None
    if not audio:
        return None
    relative = save_bytes(thread.space_id, audio, ext=".mp3")
    audience = _detect_audience(
        db,
        space_id=thread.space_id,
        sender_user_id=user_message.sender_user_id,
        user_text=user_text,
        thread=thread,
        persona=persona,
    )
    title = (poem.title or "thơ").strip()
    lead = f"Bài «{title}» của {persona.me(audience)} đây {persona.you(audience)}."
    body, spoken_from = _recite_body(lead, (poem.body or "").strip())
    meta = {
        "audience": audience,
        "poem_recite": True,
        "spoken_from": spoken_from,
        "cited": [{"memory_id": poem.id, "title": title, "kind": "poem"}],
    }
    return body, meta, relative, "audio/mpeg"


def try_story_recite_reply(
    db: Session,
    *,
    thread: Thread,
    identity: IdentityProfile,
    user_message: Message,
    settings: Settings | None = None,
) -> tuple[str, dict, str | None, str | None] | None:
    """If they asked for a kinh / truyện, read the next passage (TTS or cache).

    Bypasses Gemini DEPTH and the short chat-TTS char guard — audio comes from
    the storytelling path (chunked Voice DNA), same as the Nghe đọc shelf.
    """
    user_text = (user_message.body or "").strip()
    works = enabled_readable_works(db, identity_id=identity.id)
    if not looks_like_story_recite_request(user_text, works):
        return None
    persona = persona_for(identity)
    audience = _detect_audience(
        db,
        space_id=thread.space_id,
        sender_user_id=user_message.sender_user_id,
        user_text=user_text,
        thread=thread,
        persona=persona,
    )
    me = persona.me(audience)
    you = persona.you(audience)

    if not works:
        body = (
            f"{me} chưa mở kệ nghe đọc trong thư viện — "
            f"nhờ người giữ nhà bật kinh hoặc truyện giúp {you}."
        )
        return body, {"audience": audience, "story_recite": False, "story_recite_empty": True}, None, None

    work = pick_work_for_recite(works, user_text)
    if work is None:
        norm = _normalize_text(user_text)
        if _STORY_CATEGORY_SUTRA.search(norm) or _STORY_CATEGORY_CLASSIC.search(norm):
            kind_label = "kinh" if _STORY_CATEGORY_SUTRA.search(norm) else "truyện"
            body = (
                f"Trên kệ của {me} chưa có {kind_label} mở sẵn để đọc — "
                f"nhờ người giữ nhà bật giúp {you}."
            )
            return (
                body,
                {"audience": audience, "story_recite": False, "story_recite_empty": True},
                None,
                None,
            )
        return None

    chunk = pick_next_chunk_for_recite(
        db, identity_id=identity.id, work_id=work.id
    )
    if chunk is None:
        body = f"«{work.title}» chưa có chữ để {me} đọc cho {you}."
        return (
            body,
            {
                "audience": audience,
                "story_recite": False,
                "story_work_slug": work.slug,
                "story_recite_empty": True,
            },
            None,
            None,
        )

    sender = user_message.sender_user_id
    if not sender:
        return None
    try:
        recording = ensure_story_tts_recording(
            db, identity=identity, chunk=chunk, user_id=sender
        )
    except StoryTtsError as exc:
        logger.info("heritage story recite skipped: %s", exc.detail)
        body = f"{me} chưa đọc được «{work.title}» lúc này {you}. {exc.detail}"
        return (
            body,
            {
                "audience": audience,
                "story_recite": False,
                "story_work_slug": work.slug,
                "story_chunk_id": chunk.id,
                "story_recite_error": exc.detail,
            },
            None,
            None,
        )
    except Exception:
        logger.exception("heritage story recite failed")
        return None

    title = (work.title or work.slug).strip()
    label = (chunk.label or "").strip()
    if label:
        lead = f"{me} đọc «{title}» — {label} đây {you}."
    else:
        lead = f"{me} đọc «{title}» đây {you}."
    body, spoken_from = _recite_body(lead, (chunk.body or "").strip())
    meta = {
        "audience": audience,
        "story_recite": True,
        "spoken_from": spoken_from,
        "story_work_slug": work.slug,
        "story_work_title": title,
        "story_work_category": work.category or "classic",
        "story_chunk_id": chunk.id,
        "story_recording_id": recording.id,
        "cited": [
            {
                "kind": "story_chunk",
                "work_slug": work.slug,
                "title": title,
                "chunk_id": chunk.id,
            }
        ],
    }
    return body, meta, recording.media_path, recording.media_mime or "audio/mpeg"


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
    keepsake_photo: MemoryItem | None = None,
    persona: Persona | None = None,
    charter: FamilyCharter | None = None,
) -> str:
    display = heritage_display_name(identity)
    quote_mode = (quote_mode or "paraphrase").strip().lower()
    life_stage = _json_loads(getattr(identity, "life_stage_json", None) or "")
    roles = _json_loads(getattr(identity, "roles_json", None) or "")
    address = _json_loads(getattr(identity, "address_forms_json", None) or "")
    speech = _json_loads(getattr(identity, "speech_style_json", None) or "")
    values = _json_loads(getattr(identity, "core_values_json", None) or "")
    philosophy = _json_loads(getattr(identity, "philosophy_json", None) or "")
    taboos = _identity_taboos(_json_loads(getattr(identity, "taboos_json", None) or ""))

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
        photo=keepsake_photo,
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
    persona = persona or persona_for(identity)
    address_rules = address_rules_block(persona)
    audience_section = audience_block(persona, audience)
    affection_rule = spouse_affection_rule(persona, audience, charter)
    if affection_rule:
        audience_section = f"{audience_section}\n{affection_rule}"
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
    keepsake_section = ""
    if keepsake_photo is not None:
        keepsake_section = (
            "\nHIỆN VẬT ẢNH đang mở trong phòng chat này:\n"
            "- Chỉ được khẳng định điều có trong chú thích ảnh (bằng chứng kind=photo) "
            "hoặc ký ức đã duyệt khác.\n"
            "- Không mô tả chi tiết nhìn thấy trong ảnh (quần áo, phông nền, số người, "
            "cử chỉ) nếu chú thích không ghi.\n"
            "- Mời người nhà kể hôm ấy; thiếu thì thừa nhận chưa nhớ — không bịa.\n"
        )

    return f"""\
Bạn là thực thể ký ức {display} trong app Forever — KHÔNG phải người còn sống,
KHÔNG phải “Người giữ nhà”, KHÔNG phải chatbot chung.

{app_rules_block(persona, quote_rule=quote_rule, length_rule=length_rule)}

Lớp 2 — Hiến chương gia đình:
{charter_block(charter)}

Lớp 3 — Bản sắc của {display}:
- Xưng hô và khẩu khí theo khối bên dưới.
{address_rules}
- Từ chối nhẹ nhàng các điều cấm cứng của người này (chính trị, tình dục, trái pháp luật…).
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
{_lock_section("Điều cấm riêng", taboos)}
{context_section}
{memory_section}
{keepsake_section}
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
_CLAUSE_END = re.compile(r"[,;:—–]\s")
TRUNCATED_FINISH = ("MAX_TOKENS", "LENGTH")


def _finalize_reply_text(text: str, finish_reason: str | None = None) -> str:
    """Không bao giờ đưa ra một mẩu câu dở.

    Suy nghĩ ẩn của model cũng tính vào hạn mức token, nên một câu ngắn vẫn có
    thể bị chặn ngang. Ba nấc: câu đã trọn thì để nguyên; còn câu trọn vẹn phía
    trước thì lùi về đó; không còn câu nào thì lùi về vế trọn vẹn rồi đóng lại —
    «… trĩu nặng thương xót, nhưng» thành «… trĩu nặng thương xót.».
    """
    cleaned = text.strip()
    if not cleaned:
        return cleaned
    # Model có thể viết xong câu rồi mới bị chặn; cắt tiếp là vứt đi một câu tốt.
    if _SENTENCE_END.search(cleaned):
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
    clause = None
    for match in _CLAUSE_END.finditer(cleaned):
        if match.start() >= 20:
            clause = match.start()
    if clause is not None:
        return f"{cleaned[:clause].rstrip()}."
    return cleaned


def _looks_complete(text: str | None) -> bool:
    return bool(text and _SENTENCE_END.search(text.strip()))


def _label_user_turn(text: str, speaker: str | None) -> str:
    body = (text or "").strip()
    name = (speaker or "").strip()
    if name:
        return f"{name}: {body}"
    return body


def _speaker_names_for_messages(db: Session, messages: list[Message]) -> dict[str, str]:
    ids = {m.sender_user_id for m in messages if m.sender_user_id}
    if not ids:
        return {}
    rows = db.query(User.id, User.name).filter(User.id.in_(ids)).all()
    return {uid: name for uid, name in rows if name}


def _gemini_heritage_reply(
    settings: Settings,
    *,
    system_prompt: str,
    user_text: str,
    history: list[Message],
    max_output_tokens: int = 768,
    usage: UsageContext | None = None,
    model: str | None = None,
    speaker_names: dict[str, str] | None = None,
    current_speaker: str | None = None,
) -> tuple[str | None, str | None]:
    names = speaker_names or {}
    contents: list[dict] = []
    for msg in history[-12:]:
        if msg.sender_kind == "user":
            speaker = names.get(msg.sender_user_id or "")
            contents.append(
                {
                    "role": "user",
                    "parts": [{"text": _label_user_turn(msg.body, speaker)}],
                }
            )
        elif msg.sender_kind in ("heritage", "agent"):
            contents.append({"role": "model", "parts": [{"text": msg.body}]})
    contents.append(
        {
            "role": "user",
            "parts": [{"text": _label_user_turn(user_text, current_speaker)}],
        }
    )

    while contents and contents[0]["role"] == "model":
        contents.pop(0)

    def _ask(budget: int):
        return call_gemini(
            settings,
            GeminiCall(
                system_prompt=system_prompt,
                contents=contents,
                model=(model or "").strip() or settings.compose_model,
                temperature=0.5,
                max_output_tokens=budget,
                timeout_s=60.0,
                attempts=2,
                usage=usage,
            ),
        )

    result = _ask(max_output_tokens)
    if not result.text:
        return None, result.finish_reason

    body = _finalize_reply_text(result.text, result.finish_reason)
    # Bị chặn ngang: hỏi lại một lần với chỗ rộng hơn. Cắt về câu trọn vẹn thì
    # đọc xuôi nhưng vẫn mất phần người ấy đang định nói, nên chỉ dùng bản cắt
    # khi lượt hỏi lại cũng không xong. Độ dài do luật trong prompt giữ, hạn mức
    # chỉ là lưới an toàn — nới ra không làm câu dài thêm, chỉ thôi cắt ngang.
    if result.finish_reason in TRUNCATED_FINISH and not _looks_complete(result.text):
        wider = _ask(min(max_output_tokens * 3, 2048))
        if wider.text:
            retry_body = _finalize_reply_text(wider.text, wider.finish_reason)
            if _looks_complete(retry_body):
                return retry_body, wider.finish_reason
    return body, result.finish_reason


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


def post_process_reply(
    reply: str,
    *,
    persona: Persona,
    audience: str | None = None,
    previous: list[str] | None = None,
    previous_today: list[str] | None = None,
    charter: FamilyCharter | None = None,
) -> str:
    """Kéo câu về đúng giọng người này, rồi mới áp hiến chương của nhà."""
    if looks_like_taboo(reply):
        return app_refusal("taboo", persona)
    cleaned = reply.strip() or app_refusal("fallback", persona)
    cleaned = fix_address_register(cleaned, persona, audience)
    cleaned = fix_foreign_self_reference(cleaned, persona, audience)
    per_day = (charter or DEFAULT_CHARTER).spouse_affection_per_day
    if persona.audience(audience) == "spouse" and per_day > 0:
        used_today = sum(
            1 for p in (previous_today or []) if looks_like_direct_affection(p, persona)
        )
        if used_today >= per_day:
            cleaned = soften_affection(cleaned, persona)
    cleaned = strip_deference(cleaned)
    cleaned = strip_repeated_closing(cleaned, persona, audience, previous)
    cleaned = strip_repeated_family_redirect(cleaned, previous, charter)
    return cleaned or app_refusal("fallback", persona)


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
    usage: UsageContext | None = None,
    model: str | None = None,
    speaker_names: dict[str, str] | None = None,
    current_speaker: str | None = None,
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

    repeat_usage = UsageContext(
        space_id=usage.space_id if usage else None,
        thread_id=usage.thread_id if usage else None,
        message_id=usage.message_id if usage else None,
        user_id=usage.user_id if usage else None,
        operation="heritage_repeat",
    )
    retry, retry_finish = _gemini_heritage_reply(
        settings,
        system_prompt=system_prompt + avoid_block(previous, asked),
        user_text=user_text,
        history=history,
        max_output_tokens=max_output_tokens,
        usage=repeat_usage,
        model=model,
        speaker_names=speaker_names,
        current_speaker=current_speaker,
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
    usage: UsageContext | None = None,
    grounding_enabled: bool | None = None,
    critic_enabled: bool | None = None,
    critic_model: str | None = None,
    persona: Persona,
    charter: FamilyCharter | None = None,
) -> tuple[str, dict | None]:
    """Rewrite, trim, or replace a reply that asserts something we cannot show."""
    if grounding_enabled is None:
        grounding_enabled = settings.heritage_grounding_enabled
    if critic_enabled is None:
        critic_enabled = settings.heritage_critic_enabled
    if not grounding_enabled:
        return body, None
    found = find_ungrounded(body, corpus=corpus, year_corpus=year_corpus)
    if found.clean:
        return body, None

    info = found.as_meta()
    if not critic_enabled:
        # Names are a heuristic — flag only. Years are reliable digits: drop the
        # sentence even with the critic off, so a user-asked «2030» cannot stay
        # in the letter just because critic is disabled.
        if found.years:
            trimmed = drop_ungrounded_sentences(
                body, Ungrounded(years=list(found.years), names=[])
            )
            if trimmed:
                fixed = post_process_reply(
                    trimmed, persona=persona, audience=audience, charter=charter
                )
                leftover = find_ungrounded(
                    fixed, corpus=corpus, year_corpus=year_corpus
                )
                out = leftover.as_meta()
                out["action"] = "trimmed_years"
                if found.years:
                    out["years"] = list(found.years)
                return fixed, out
            info["action"] = "replaced"
            return app_refusal("fallback", persona), info
        info["action"] = "flagged"
        return body, info

    rewritten = critic_rewrite(
        settings,
        reply=body,
        ungrounded=found,
        max_output_tokens=max_output_tokens,
        usage=usage,
        model=critic_model,
    )
    if rewritten:
        fixed = post_process_reply(
            rewritten, persona=persona, audience=audience, charter=charter
        )
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
    return app_refusal("fallback", persona), info


def generate_heritage_reply(
    db: Session,
    *,
    thread: Thread,
    identity: IdentityProfile,
    user_message: Message,
    settings: Settings | None = None,
) -> tuple[str, dict]:
    settings = settings or get_settings()
    pipeline = load_heritage_pipeline(db, thread.space_id, settings=settings)
    user_text = (user_message.body or "").strip()
    persona = persona_for(identity)
    charter = load_family_charter(db, thread.space_id)
    audience = _detect_audience(
        db,
        space_id=thread.space_id,
        sender_user_id=user_message.sender_user_id,
        user_text=user_text,
        thread=thread,
        persona=persona,
    )

    def _refusal_meta(kind: str, **extra: object) -> dict:
        meta: dict = {"heritage_refusal": kind, "audience": audience, **extra}
        if persona.lock_conflict:
            meta["persona_conflict"] = persona.lock_conflict
        return meta

    if looks_like_taboo(user_text):
        body = post_process_reply(
            app_refusal("taboo", persona),
            persona=persona,
            audience=audience,
            charter=charter,
        )
        return body, _refusal_meta("taboo")
    if looks_like_fabrication_request(user_text):
        body = post_process_reply(
            app_refusal("fabrication", persona),
            persona=persona,
            audience=audience,
            charter=charter,
        )
        return body, _refusal_meta("fabrication")

    sensitive = looks_like_sensitive(user_text)
    if sensitive:
        body = post_process_reply(
            refuse_sensitive(
                sensitive, persona, audience=audience, charter=charter
            ),
            persona=persona,
            audience=audience,
            charter=charter,
        )
        return body, _refusal_meta("sensitive", sensitive_domain=sensitive)

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
    usage = UsageContext(
        space_id=thread.space_id,
        thread_id=thread.id,
        message_id=user_message.id,
        user_id=user_message.sender_user_id,
        operation="heritage_compose",
    )
    if pipeline.analyzer:
        frame = analyze_turn(
            settings,
            user_text=user_text,
            history=history,
            entities=entities,
            model=pipeline.analyzer_model,
            usage=UsageContext(
                space_id=thread.space_id,
                thread_id=thread.id,
                message_id=user_message.id,
                user_id=user_message.sender_user_id,
                operation="heritage_analyzer",
            ),
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

    matches = resolve_mentions(user_text, entities) if entities else []
    matches += _matches_from_slugs(entities, frame.entity_slugs, seen=matches)
    codex_lines = entity_lines(matches)
    clarify_names = clarify_question(matches)
    clarify = clarify_line(clarify_names, persona) if clarify_names else None

    milestones = retrieve_milestones(
        family_milestones(db, space_id=thread.space_id, reader=reader),
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

    # Shared family vault rows tagged to people this turn named (Codex), so the
    # remembered person can answer about the house — never private, never own shelf.
    codex_identity_ids = [
        e.identity_profile_id
        for match in matches
        for e in match.entities
        if e.identity_profile_id
    ]
    family_shared = retrieve_learned(
        family_shared_for_identities(
            db,
            space_id=thread.space_id,
            identity_ids=codex_identity_ids,
            exclude_identity_id=identity.id,
            reader=reader,
        ),
        query=search_text,
        limit=3,
    )

    memory = (
        load_state(db, thread.id) if settings.heritage_memory_enabled else MemoryState()
    )

    keepsake_photo = None
    if settings.heritage_keepsake_enabled:
        active = active_photo_keepsake(db, thread)
        if active:
            keepsake_photo = (
                db.query(MemoryItem)
                .filter(MemoryItem.id == active.memory_item_id)
                .one_or_none()
            )

    system_prompt = build_system_prompt(
        identity,
        signature_poems=signature,
        retrieved_poems=retrieved,
        knowledge=[*knowledge, *learned, *family_shared],
        live_context=live_context,
        quote_mode=quote_mode,
        audience=audience,
        milestones=milestones,
        codex_lines=codex_lines,
        clarify=clarify,
        frame=frame,
        memory=memory,
        keepsake_photo=keepsake_photo,
        persona=persona,
        charter=charter,
    )

    speaker_names = _speaker_names_for_messages(db, [*history, user_message])
    current_speaker = speaker_names.get(user_message.sender_user_id or "")

    llm, finish_reason = _gemini_heritage_reply(
        settings,
        system_prompt=system_prompt,
        user_text=user_text,
        history=history,
        max_output_tokens=frame.max_output_tokens,
        usage=usage,
        model=pipeline.compose_model,
        speaker_names=speaker_names,
        current_speaker=current_speaker,
    )

    repeat_reason = None
    if pipeline.anti_repeat and llm:
        llm, finish_reason, repeat_reason = _retry_if_repetitive(
            settings,
            reply=llm,
            finish_reason=finish_reason,
            system_prompt=system_prompt,
            user_text=user_text,
            history=history,
            memory=memory,
            max_output_tokens=frame.max_output_tokens,
            usage=usage,
            model=pipeline.compose_model,
            speaker_names=speaker_names,
            current_speaker=current_speaker,
        )

    previous_bodies = recent_heritage_bodies(history)
    previous_today = heritage_bodies_today(history)
    body = post_process_reply(
        llm or app_refusal("fallback", persona),
        persona=persona,
        audience=audience,
        previous=previous_bodies,
        previous_today=previous_today,
        charter=charter,
    )

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
        usage=usage,
        persona=persona,
        charter=charter,
        grounding_enabled=pipeline.grounding,
        critic_enabled=pipeline.critic,
        critic_model=pipeline.critic_model,
    )

    grief = frame.intent == "grief" or looks_like_grief(user_text)
    sitting = sitting_heritage_count(history) + 1
    winddown_n = int(getattr(settings, "heritage_session_winddown_turns", 8) or 0)
    bridge_kind = None
    body, wind_kind = maybe_winddown(
        body,
        sitting_turns=sitting,
        threshold=winddown_n,
        persona=persona,
        audience=audience,
        charter=charter,
    )
    if wind_kind:
        bridge_kind = wind_kind
    else:
        body, bridge_kind = maybe_family_bridge(
            body,
            enabled=pipeline.family_bridge,
            persona=persona,
            audience=audience,
            grief=grief,
            seed=f"{thread.id}:{user_message.id}",
            previous=previous_bodies,
            charter=charter,
        )
    if bridge_kind:
        body = post_process_reply(
            body,
            persona=persona,
            audience=audience,
            previous=previous_bodies,
            previous_today=previous_today,
            charter=charter,
        )

    all_poems = signature + retrieved
    citations = _detect_citations(body, all_poems, quote_mode=quote_mode)
    cited = cited_entries(
        signature,
        retrieved,
        milestones,
        learned,
        family_shared,
        [keepsake_photo] if keepsake_photo is not None else [],
    )
    meta: dict = {
        "heritage_identity_id": identity.id,
        "quote_mode": quote_mode,
        "poem_ids": [p.id for p in all_poems],
    }
    if audience:
        meta["audience"] = audience
        # Cặp xưng hô đã dùng — chỗ để soi khi giọng nghe lệch mà không rõ vì sao.
        meta["persona_register"] = " — ".join(persona.register(audience))
    if persona.lock_conflict:
        meta["persona_conflict"] = persona.lock_conflict
    if finish_reason:
        meta["finish_reason"] = finish_reason
    if citations:
        meta["citations"] = citations
    if cited:
        meta["cited"] = cited
    if milestones:
        meta["milestone_ids"] = [m.id for m in milestones]
    if learned:
        meta["learned_ids"] = [item.id for item in learned]
    if family_shared:
        meta["family_library_ids"] = [item.id for item in family_shared]
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
    if bridge_kind:
        meta["family_bridge"] = bridge_kind
        meta["sitting_turns"] = sitting
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

    identity = identity_for_heritage_thread(db, thread.id)
    if not identity:
        return None

    entity_status = getattr(identity, "heritage_entity_status", None) or "dormant"
    user_kind = getattr(user_message, "kind", "text") or "text"
    user_text = (user_message.body or "").strip()

    kind = "text"
    media_path = None
    media_mime = None
    recited = False

    if entity_status == "paused":
        body = REFUSE_PAUSED
        meta: dict = {"heritage_refusal": "paused"}
    elif entity_status != "ready":
        return None
    elif user_kind == "voice" and not user_text:
        # STT empty or missing — refuse rather than invent an answer.
        body = app_refusal("unheard", persona_for(identity))
        meta = {"heritage_refusal": "unheard"}
    else:
        # Story/sutra before library poems — «đọc Kiều» must not fall through to Gemini.
        recited_pack = try_story_recite_reply(
            db,
            thread=thread,
            identity=identity,
            user_message=user_message,
            settings=settings,
        )
        if recited_pack is None:
            recited_pack = try_poem_recite_reply(
                db,
                thread=thread,
                identity=identity,
                user_message=user_message,
                settings=settings,
            )
        if recited_pack is not None:
            body, meta, media_path, media_mime = recited_pack
            if media_path:
                kind = "voice"
            recited = True
        else:
            body, meta = generate_heritage_reply(
                db,
                thread=thread,
                identity=identity,
                user_message=user_message,
                settings=settings,
            )

    pipeline = load_heritage_pipeline(db, thread.space_id, settings=settings)
    # MiniMax/ElevenLabs only when the member spoke. Typed chat is Gemini text;
    # synthesizing every keyboard turn is the bulk of the TTS bill and nobody
    # auto-plays those replies. Poem recitation already attached audio.
    if (
        not recited
        and pipeline.tts
        and user_kind == "voice"
        and (body or "").strip()
        and meta.get("heritage_refusal") is None
    ):
        from .heritage_tts import synthesize_chat_reply

        voice = voice_for_identity(db, identity)
        if voice is not None:
            tts = synthesize_chat_reply(
                db, voice=voice, text=body, settings=settings
            )
            if tts is not None:
                kind = "voice"
                media_path = tts.media_path
                media_mime = tts.media_mime
                meta = {**meta, "tts": tts.meta}

    heritage_message = Message(
        id=generate(),
        thread_id=thread.id,
        sender_user_id=None,
        sender_kind="heritage",
        kind=kind,
        body=body,
        media_path=media_path,
        media_mime=media_mime,
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
            facts = stated_facts(
                _json_loads(reply.meta_json or ""),
                source_message_id=user_message.id,
            )
            queued = enqueue_facts(
                db,
                thread=thread,
                identity=identity,
                user_message=user_message,
                facts=facts,
            )
            extra = story_facts_from_turn(
                db, thread=thread, user_message=user_message
            )
            if extra:
                active = active_photo_keepsake(db, thread)
                if active:
                    mark_heard(active)
                    db.commit()
            if not queued:
                enqueue_facts(
                    db,
                    thread=thread,
                    identity=identity,
                    user_message=user_message,
                    facts=extra,
                )
        history = (
            db.query(Message)
            .filter(Message.thread_id == thread.id)
            .order_by(Message.created_at.asc())
            .all()
        )
        compact_thread_memory(
            db,
            thread=thread,
            settings=settings,
            history=history,
            usage=UsageContext(
                space_id=thread.space_id,
                thread_id=thread.id,
                operation="heritage_compact",
            ),
        )
    except Exception:  # noqa: BLE001 — never fail a delivered reply
        db.rollback()
