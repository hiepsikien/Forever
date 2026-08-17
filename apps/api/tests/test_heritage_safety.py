from app.services.heritage_safety import (
    looks_like_grief,
    looks_like_sensitive,
    maybe_family_bridge,
    maybe_winddown,
    refuse_sensitive,
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


def test_refuse_contains_charter_markers():
    for domain in ("money", "health", "legal", "afterlife", "divide"):
        child = refuse_sensitive(domain, audience="child")
        spouse = refuse_sensitive(domain, audience="spouse")
        assert "không bàn được" in child.lower()
        assert "không bàn được" in spouse.lower()
        assert "con ơi" in child.lower()
        assert "em ơi" in spouse.lower()


def test_grief_bridge_appends_once():
    body, kind = maybe_family_bridge(
        "Anh nhớ em.",
        enabled=True,
        audience="spouse",
        grief=True,
        seed="t1",
    )
    assert kind == "grief"
    assert "nhà mình còn" in body.lower() or "các con" in body.lower()
    again, kind2 = maybe_family_bridge(
        body, enabled=True, audience="spouse", grief=True, seed="t1"
    )
    assert kind2 is None
    assert again == body


def test_winddown_after_threshold():
    body, kind = maybe_winddown(
        "Con ơi bố nhớ con.",
        sitting_turns=8,
        threshold=8,
        audience="child",
    )
    assert kind == "sitting"
    assert "nghỉ" in body


def test_looks_like_grief():
    assert looks_like_grief("Anh ơi, em nhớ anh quá.")
    assert not looks_like_grief("Chào bố, gia đình khỏe không?")
