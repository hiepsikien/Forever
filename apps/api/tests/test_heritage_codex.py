from __future__ import annotations

import json
from datetime import datetime, timezone

from app.models import FamilyEntity, MemoryItem
from app.services.heritage_codex import (
    aliases_for,
    clarify_question,
    entity_lines,
    parse_roles,
    resolve_mentions,
    slugify,
)
from app.services.heritage_retrieval import (
    build_evidence_pack,
    retrieve_milestones,
    score_milestone,
)

LOCK_ROLES = [
    "Người chồng của bà Lê Thị Định (xưng hô Anh — Em)",
    "Người cha của Nguyễn Lê Hương, Nguyễn Anh Vỹ, Nguyễn Đình Anh",
    "Con rể: Đặng Xuân Hải; con dâu: Phùng Lan Hương, Phạm Thị Ly Ly",
    "Ông của các cháu: Đình Long, Hương Ly, Xuân Nam, Mai Lan, Đình Vượng",
    "Nhà giáo — GS.TSKH, Nhà giáo Ưu tú, Hóa học",
]


def _entity(name: str, relation: str, *, disambiguation: str = "") -> FamilyEntity:
    return FamilyEntity(
        id=slugify(name),
        space_id="s",
        slug=slugify(name),
        canonical_name=name,
        aliases_json=json.dumps(aliases_for(name), ensure_ascii=False),
        relation_json=json.dumps({"to_subject": relation}, ensure_ascii=False),
        disambiguation=disambiguation,
        status="approved",
        created_by="u",
    )


def _milestone(title: str, body: str, year: int | None) -> MemoryItem:
    return MemoryItem(
        id=slugify(title),
        space_id="s",
        created_by="u",
        kind="milestone",
        title=title,
        body=body,
        tags="heritage:id1",
        occurred_at=datetime(year, 1, 1, tzinfo=timezone.utc) if year else None,
        created_at=datetime.now(timezone.utc),
    )


# --- role parsing ---

def test_parse_roles_splits_multi_clause_line():
    people = parse_roles(LOCK_ROLES)
    by_name = {p["name"]: p["relation"] for p in people}
    assert by_name["Lê Thị Định"] == "vợ"
    assert by_name["Nguyễn Lê Hương"] == "con"
    assert by_name["Đặng Xuân Hải"] == "con rể"
    assert by_name["Phùng Lan Hương"] == "con dâu"
    assert by_name["Đình Vượng"] == "cháu"


def test_parse_roles_ignores_non_person_roles():
    names = {p["name"] for p in parse_roles(LOCK_ROLES)}
    assert not any("Nhà giáo" in n for n in names)
    # 1 vợ + 3 con + 1 rể + 2 dâu + 5 cháu
    assert len(names) == 12


def test_aliases_skip_kinship_words():
    # "Anh" alone would match half the messages in the thread.
    assert aliases_for("Nguyễn Đình Anh") == ["Nguyễn Đình Anh", "Đình Anh"]
    assert "Hương" in aliases_for("Nguyễn Lê Hương")


# --- mention resolution ---

def test_resolve_mention_finds_child():
    entities = [_entity("Nguyễn Lê Hương", "con gái")]
    matches = resolve_mentions("Bố ơi, chị Hương dạo này thế nào?", entities)
    assert len(matches) == 1
    assert matches[0].entity is not None
    assert matches[0].entity.canonical_name == "Nguyễn Lê Hương"
    assert clarify_question(matches) is None


def test_resolve_mention_flags_ambiguous_name():
    entities = [
        _entity("Nguyễn Lê Hương", "con gái"),
        _entity("Phùng Lan Hương", "con dâu"),
    ]
    matches = resolve_mentions("Hương có khỏe không bố?", entities)
    assert matches[0].ambiguous
    question = clarify_question(matches)
    assert question and "con dâu" in question


def test_longer_alias_wins_over_shorter():
    entities = [_entity("Hương Ly", "cháu"), _entity("Phạm Thị Ly Ly", "con dâu")]
    matches = resolve_mentions("Cháu Hương Ly mới đi học về", entities)
    names = {m.entity.canonical_name for m in matches if m.entity}
    assert names == {"Hương Ly"}


def test_no_mention_returns_empty():
    entities = [_entity("Nguyễn Lê Hương", "con gái")]
    assert resolve_mentions("Con đang chat với bố trên server local ạ.", entities) == []


def test_entity_lines_include_disambiguation():
    entities = [_entity("Xuân Nam", "cháu", disambiguation="Khác Xuân bên cô Tâm")]
    lines = entity_lines(resolve_mentions("Xuân Nam đâu rồi bố?", entities))
    assert lines and "Khác Xuân bên cô Tâm" in lines[0]


# --- milestones ---

def test_score_milestone_prefers_year_match():
    marriage = _milestone("Kết hôn với bà Lê Thị Định", "Ông 26 tuổi.", 1966)
    retirement = _milestone("Về hưu — bắt đầu mùa thơ", "Nghỉ hưu.", 2005)
    assert score_milestone(marriage, "Bố cưới mẹ năm 1966 à?") > score_milestone(
        retirement, "Bố cưới mẹ năm 1966 à?"
    )


def test_retrieve_milestones_skips_irrelevant():
    items = [
        _milestone("Sống khu tập thể Cảm Hội", "Tầng 3, nhà A, phố Cảm Hội.", 1973),
        _milestone("Về hưu — bắt đầu mùa thơ", "Nghỉ hưu.", 2005),
    ]
    hits = retrieve_milestones(items, query="Nhà Cảm Hội hồi con nhỏ thế nào bố?")
    assert [m.title for m in hits] == ["Sống khu tập thể Cảm Hội"]


def test_retrieve_milestones_empty_for_smalltalk():
    items = [_milestone("Về hưu", "Nghỉ hưu.", 2005)]
    assert retrieve_milestones(items, query="Con chào bố ạ") == []


# --- evidence pack ---

def test_evidence_pack_orders_entity_first_and_respects_budget():
    poem = MemoryItem(
        id="p1",
        space_id="s",
        created_by="u",
        kind="poem",
        title="TUỔI BẢY NHĂM",
        body="Bảy nhăm đâu phải đã già " * 40,
        tags="heritage:id1",
        created_at=datetime.now(timezone.utc),
    )
    pack = build_evidence_pack(
        entity_lines=["- «Hương» → Nguyễn Lê Hương (con gái)"],
        poems=[poem],
        milestones=[_milestone("Về hưu", "Nghỉ hưu 2005.", 2005)],
        knowledge=[],
        char_budget=300,
    )
    kinds = [item.kind for item in pack.items]
    assert kinds[0] == "entity"
    assert "poem" not in kinds  # budget ran out before the long poem
    assert "entity:codex" in pack.render()
