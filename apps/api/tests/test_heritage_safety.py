"""Tầng 2 — hiến chương gia đình: bộ dò, lời từ chối, nhịp cầu về người sống."""

import json
from types import SimpleNamespace

from app.services.heritage_persona import persona_for
from app.services.heritage_rules_family import (
    looks_like_grief,
    looks_like_sensitive,
    maybe_family_bridge,
    maybe_winddown,
    refuse_sensitive,
    strip_repeated_family_redirect,
)

FATHER = persona_for(
    SimpleNamespace(
        relation_label="Bố",
        display_name="Nguyễn Đình Triệu",
        address_forms_json=json.dumps(
            {
                "with_spouse": {"self": "anh", "other": "em"},
                "with_children": {"self": "bố", "other": "con"},
            },
            ensure_ascii=False,
        ),
        roles_json="",
    )
)

GRANDMOTHER = persona_for(
    SimpleNamespace(
        relation_label="Bà Nội",
        display_name="Đoàn Thị Thông",
        address_forms_json="",
        roles_json="",
    )
)


def test_sensitive_domains_and_safe_smalltalk():
    assert looks_like_sensitive("Bố nghĩ mẹ nên bán căn nhà Hoàng Mai không?") == "money"
    assert looks_like_sensitive("Mẹ uống thuốc huyết áp này có được không") == "health"
    assert looks_like_sensitive("Bố bảo mẹ làm di chúc thế nào?") == "legal"
    assert looks_like_sensitive("Bố đang ở trên thiên đường có vui không, báo mộng đi") == "afterlife"
    assert looks_like_sensitive("Các con không hiểu mẹ bằng bố") == "divide"
    assert looks_like_sensitive("Chào bố, gia đình khỏe không?") is None
    assert looks_like_sensitive("Bố ơi, con nhớ bài thơ về vợ") is None
    assert looks_like_sensitive("Bố nhớ ngày giỗ cha thế nào?") is None
    # Memory, not a decision — must not refuse the whole turn.
    assert looks_like_sensitive("Bố nhớ lần mẹ đi viện năm ấy không?") is None
    assert looks_like_sensitive("Căn nhà Hoàng Mai nhà mình hồi ấy thế nào?") is None
    assert looks_like_sensitive("Bố ơi con nhớ bố, bố kể bài thơ với con.") is None


def test_refuse_contains_charter_markers():
    for domain in ("money", "health", "legal", "afterlife", "divide"):
        child = refuse_sensitive(domain, FATHER, audience="child")
        spouse = refuse_sensitive(domain, FATHER, audience="spouse")
        assert "không bàn được" in child.lower()
        assert "không bàn được" in spouse.lower()
        assert "con ơi" in child.lower()
        assert "em ơi" in spouse.lower()


def test_grief_bridge_appends_once():
    body, kind = maybe_family_bridge(
        "Anh nhớ em.",
        enabled=True,
        persona=FATHER,
        audience="spouse",
        grief=True,
        seed="t1",
    )
    assert kind == "grief"
    assert "nhà mình còn" in body.lower() or "các con" in body.lower()
    again, kind2 = maybe_family_bridge(
        body, enabled=True, persona=FATHER, audience="spouse", grief=True, seed="t1"
    )
    assert kind2 is None
    assert again == body


def test_winddown_after_threshold():
    body, kind = maybe_winddown(
        "Con ơi bố nhớ con.",
        sitting_turns=8,
        threshold=8,
        persona=FATHER,
        audience="child",
    )
    assert kind == "sitting"
    assert "nghỉ" in body


def test_looks_like_grief():
    assert looks_like_grief("Anh ơi, em nhớ anh quá.")
    assert looks_like_grief("Con thương quá, bố ơi.")
    assert looks_like_grief("Bà ơi, cháu nhớ bà quá.")
    assert not looks_like_grief("Chào bố, gia đình khỏe không?")
    assert not looks_like_grief("Con nhớ bố, bố kể bài thơ với con.")


def test_family_bridge_skips_when_recent_turn_already_redirected():
    body, kind = maybe_family_bridge(
        "Anh nhớ em.",
        enabled=True,
        persona=FATHER,
        audience="spouse",
        grief=True,
        seed="t2",
        previous=["Nhà mình còn đó — em kể với các con một câu hôm nay cũng được."],
    )
    assert kind is None
    assert body == "Anh nhớ em."


def test_strip_repeated_family_redirect_keeps_the_memory():
    previous = ["Con nhớ bố thì kể với mẹ và anh chị một câu cũng được."]
    raw = (
        "Bố nhớ bài thơ tuổi bảy nhăm. "
        "Con hãy nói chuyện với gia đình nhé."
    )
    out = strip_repeated_family_redirect(raw, previous)
    assert "bảy nhăm" in out.lower()
    assert "nói chuyện với gia đình" not in out.lower()


def test_winddown_grandmother_does_not_say_bo():
    body, kind = maybe_winddown(
        "Cả nhà quây quần với bà một lát cho ấm cúng.",
        sitting_turns=8,
        threshold=8,
        persona=GRANDMOTHER,
        audience="child",
    )
    assert kind == "sitting"
    assert "bà nhớ con" in body.lower()
    assert "bố nhớ con" not in body.lower()


def test_refuse_grandmother_uses_ba():
    child = refuse_sensitive("money", GRANDMOTHER, audience="child")
    assert "bà không bàn được" in child.lower()
    assert "bố không bàn được" not in child.lower()


def test_grandmother_never_gets_the_spouse_register():
    """Mẹ nhắn trong phòng Bà không biến Bà thành người vợ."""
    text = refuse_sensitive("money", GRANDMOTHER, audience="spouse")
    assert "con ơi" in text.lower()
    assert "em ơi" not in text.lower()
