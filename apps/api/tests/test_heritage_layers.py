"""Ranh giới ba tầng: Ứng dụng · Gia đình · Cá nhân.

Luật riêng của một người không được tự động áp cho người khác. Prompt đã chia
ba lớp từ lâu, nhưng code thì chưa — nên Bà Nội thừa hưởng giọng Bố. Bộ test
này giữ ranh giới đó bằng máy, để lần sau một bản vá riêng rơi vào đường chung
sẽ hỏng ở đây chứ không hỏng trong phòng chat của gia đình.
"""

from __future__ import annotations

import inspect
import json
import re
from types import SimpleNamespace

import pytest

from app.services import heritage_rules_app as app_rules
from app.services import heritage_rules_family as family_rules
from app.services.heritage_persona import Persona, persona_for
from app.services.heritage_rules_app import (
    app_refusal,
    app_rules_block,
    clarify_line,
    fix_address_register,
    fix_foreign_self_reference,
    strip_dismissal,
    strip_repeated_closing,
)
from app.services.heritage_rules_family import (
    DEFAULT_CHARTER,
    SENSITIVE_DOMAINS,
    looks_like_grief,
    looks_like_sensitive,
    maybe_family_bridge,
    maybe_winddown,
    refuse_sensitive,
)


def _identity(relation: str, name: str, address: dict | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        relation_label=relation,
        display_name=name,
        address_forms_json=json.dumps(address, ensure_ascii=False) if address else "",
        roles_json="",
    )


FATHER = persona_for(
    _identity(
        "Bố",
        "Nguyễn Đình Triệu",
        {
            "with_spouse": {"self": "anh", "other": "em", "notes": "Vợ — bà Lê Thị Định"},
            "with_children": {"self": "bố", "other": "con"},
        },
    )
)
GRANDMOTHER = persona_for(_identity("Bà Nội", "Trần Thị Thông"))
GRANDFATHER = persona_for(_identity("Ông Ngoại", "Lê Văn Bình"))
MOTHER = persona_for(_identity("Mẹ", "Lê Thị Định"))
AUNT = persona_for(_identity("Bác", "Nguyễn Thị Hoa"))

EVERYONE = (FATHER, GRANDMOTHER, GRANDFATHER, MOTHER, AUNT)

# Từ tự xưng của người khác — không được rơi vào lời của người này.
_ALL_SELF_WORDS = ("bố", "ba", "mẹ", "má", "ông", "bà", "anh", "chị", "bác", "chú")


def _foreign_words(persona: Persona) -> list[str]:
    mine = {
        persona.self_younger,
        persona.younger,
        persona.self_peer or "",
        persona.peer or "",
        persona.spouse_as_kin or "",
    }
    return [w for w in _ALL_SELF_WORDS if w not in mine]


def _assert_no_foreign_pronoun(text: str, persona: Persona, where: str) -> None:
    lowered = (text or "").lower()
    for word in _foreign_words(persona):
        # «con cháu», «ông bà» là danh từ chung, không phải tự xưng.
        assert not re.search(rf"\b{re.escape(word)}\s+(nhớ|nghe|đây|không bàn|chưa)\b", lowered), (
            f"{where}: {persona.generation} đang nói bằng vai «{word}» — {text}"
        )


# --- Tầng 1: luật ứng dụng không được biết đại từ của riêng ai ---

def test_app_refusals_speak_as_each_person():
    for persona in EVERYONE:
        for kind in ("taboo", "fabrication", "unheard", "fallback"):
            text = app_refusal(kind, persona)
            assert persona.self_younger in text.lower()
            _assert_no_foreign_pronoun(text, persona, f"app_refusal/{kind}")


def test_app_rules_block_speaks_as_each_person():
    for persona in EVERYONE:
        block = app_rules_block(persona, quote_rule="Q", length_rule="L")
        assert f"«Chào {persona.younger}»" in block
        _assert_no_foreign_pronoun(block, persona, "app_rules_block")


def test_clarify_line_is_not_fixed_to_one_person():
    assert "Bà hỏi lại" in clarify_line("Hương (con gái)", GRANDMOTHER)
    assert "Bố hỏi lại" in clarify_line("Hương (con gái)", FATHER)


def test_layer_one_source_has_no_hardcoded_self_reference():
    """Câu chữ đi ra gia đình phải dựng từ Persona, không viết cứng đại từ."""
    for module in (app_rules, family_rules):
        source = inspect.getsource(module)
        # Bỏ phần khai báo từ vựng thân tộc — đó là chỗ duy nhất được liệt kê.
        source = re.sub(r"KINSHIP_SELF_WORDS = .*?\)", "", source, flags=re.S)
        source = re.sub(r"ELDER_SELF_WORDS = .*?\)", "", source, flags=re.S)
        source = re.sub(r"_GENERATION_LABELS.*?\)\n", "", source, flags=re.S)
        for line in source.splitlines():
            stripped = line.strip()
            if not stripped.startswith(('f"', '"', "f'", "'", "return f\"", "-")):
                continue
            for word in ("«bố»", "«mẹ»", "«anh»", "«em»", "«bà»", "«ông»"):
                assert word not in stripped, (
                    f"{module.__name__} viết cứng đại từ {word}: {stripped}"
                )


# --- Tầng 2: hiến chương chung, nhưng nói bằng giọng từng người ---

def test_sensitive_refusals_speak_as_each_person():
    for persona in EVERYONE:
        for domain in SENSITIVE_DOMAINS:
            text = refuse_sensitive(domain, persona, audience="child")
            assert f"{persona.self_younger} không bàn được" in text.lower()
            _assert_no_foreign_pronoun(text, persona, f"refuse/{domain}")


def test_detectors_cover_every_generation_not_just_father():
    for word in ("bố", "mẹ", "bà", "ông", "chị"):
        assert looks_like_grief(f"Con nhớ {word} quá"), word
        assert looks_like_sensitive(f"Linh hồn {word} có nghe con không") == "afterlife", word


def test_bridge_and_winddown_never_borrow_another_voice():
    for persona in EVERYONE:
        body, kind = maybe_winddown(
            "Nhà mình vẫn thế.",
            sitting_turns=8,
            threshold=8,
            persona=persona,
            audience="child",
        )
        assert kind == "sitting"
        assert f"{persona.self_younger} nhớ {persona.younger}" in body.lower()
        _assert_no_foreign_pronoun(body, persona, "winddown")

        bridged, bkind = maybe_family_bridge(
            "Nghe con nói vậy thương lắm.",
            enabled=True,
            persona=persona,
            audience="child",
            grief=True,
            seed="seed",
        )
        assert bkind == "grief"
        _assert_no_foreign_pronoun(bridged, persona, "bridge")


def test_charter_is_family_wide_not_person_specific():
    rendered = DEFAULT_CHARTER.render().lower()
    for word in ("bố", "mẹ", "bà", "ông", "anh", "em"):
        assert not re.search(rf"\b{word}\b", rendered), f"{word} in {rendered}"


# --- Tầng 3: Bản sắc thắng, và nó quyết ai có vai vợ/chồng ---

def test_lock_beats_inference():
    persona = persona_for(
        _identity("Bà Nội", "Trần Thị Thông", {"with_children": {"self": "u", "other": "cháu"}})
    )
    assert persona.self_younger == "u"
    assert persona.younger == "cháu"


def test_lock_conflict_is_reported_not_silently_rewritten():
    persona = persona_for(
        _identity("Bà Nội", "Trần Thị Thông", {"with_children": {"self": "bố", "other": "con"}})
    )
    assert persona.self_younger == "bố"  # dữ liệu của gia đình, code không tự sửa
    assert persona.lock_conflict and "bà" in persona.lock_conflict


def test_only_a_lock_with_spouse_can_have_a_spouse_audience():
    assert FATHER.speaks_to_spouse
    assert FATHER.audience("spouse") == "spouse"
    for persona in (GRANDMOTHER, GRANDFATHER, MOTHER, AUNT):
        assert not persona.speaks_to_spouse
        assert persona.audience("spouse") == "child"


@pytest.mark.parametrize(
    "relation,expected",
    [
        ("Bà Nội", "bà"),
        ("Bà ngoại", "bà"),
        ("Ông Nội", "ông"),
        ("Mẹ", "mẹ"),
        ("Bác", "bác"),
        ("Cụ bà", "bà"),
        ("", "tôi"),
    ],
)
def test_relation_label_fills_a_blank_lock(relation, expected):
    assert persona_for(_identity(relation, "Người thân")).self_younger == expected


# --- Chỗ rò cũ: giọng Bố lọt vào lượt của Bà ---

def test_fathers_voice_is_pulled_back_to_the_speaker():
    slipped = "Bố nhớ con lắm. Chỗ này bố không bàn được đâu."
    fixed = fix_foreign_self_reference(slipped, GRANDMOTHER, "child")
    assert "bà nhớ con" in fixed.lower()
    assert "chỗ này bà" in fixed.lower()
    assert "bố nhớ" not in fixed.lower()


def test_speaker_keeps_their_own_words():
    kept = "Bố nhớ con lắm."
    assert fix_foreign_self_reference(kept, FATHER, "child") == kept


def test_talking_about_someone_is_not_a_slip():
    """«Mẹ con vừa gọi» là kể về người khác, không phải tự nhận vai."""
    text = "Mẹ con vừa gọi điện hỏi thăm."
    assert fix_foreign_self_reference(text, GRANDMOTHER, "child") == text


# --- Vai cháu: cụ bà xưng «mẹ» với con nhưng «bà» với cháu ---

# Bản sắc đúng như hồ sơ thật lúc phát hiện lỗi: chỉ có ô vợ chồng + con cái.
GRANDMOTHER_CHILD_ONLY = persona_for(
    _identity(
        "Bà Nội",
        "Đoàn Thị Thông",
        {"with_children": {"self": "mẹ", "other": "con"}},
    )
)


def test_grandchild_gets_their_own_register():
    assert GRANDMOTHER_CHILD_ONLY.register("child") == ("mẹ", "con")
    assert GRANDMOTHER_CHILD_ONLY.register("grandchild") == ("bà", "cháu")


def test_blank_grandchild_slot_falls_back_to_ong_ba_not_to_the_child_pair():
    for persona, expected in ((GRANDMOTHER, "bà"), (GRANDFATHER, "ông"), (FATHER, "ông")):
        assert persona.speaks_to_grandchildren
        assert persona.me("grandchild") == expected
        assert persona.you("grandchild") == "cháu"


def test_lock_beats_the_ong_ba_default_for_grandchildren():
    persona = persona_for(
        _identity(
            "Bà Nội",
            "Đoàn Thị Thông",
            {"with_grandchildren": {"self": "bà nội", "other": "cu"}},
        )
    )
    assert persona.register("grandchild") == ("bà nội", "cu")


def test_the_child_pair_never_reaches_a_grandchild():
    """Chỗ «Mẹ nhớ con» từng đến tay đứa cháu."""
    persona = GRANDMOTHER_CHILD_ONLY
    body, kind = maybe_winddown(
        "Nhà mình vẫn thế.",
        sitting_turns=8,
        threshold=8,
        persona=persona,
        audience="grandchild",
    )
    assert kind == "sitting"
    assert "bà nhớ cháu" in body.lower()
    assert "mẹ nhớ con" not in body.lower()

    refused = refuse_sensitive("money", persona, audience="grandchild")
    assert "bà không bàn được" in refused.lower()
    assert "cháu ơi" in refused.lower()

    fixed = fix_address_register(
        "Mẹ nhớ con lắm. Con giữ sức nhé.", persona, "grandchild"
    )
    assert "bà nhớ cháu" in fixed.lower()
    assert "cháu giữ sức" in fixed.lower()


# --- Câu kết: một lần thì ấm, lượt nào cũng thế thì thành tật ---


def test_winddown_nudges_once_per_sitting_not_every_window():
    """Nhắc lại mỗi cửa sổ từng để câu tiễn nằm trong lịch sử và bị chép lại."""
    fired = [
        n
        for n in range(1, 25)
        if maybe_winddown(
            "Nhà mình vẫn thế.",
            sitting_turns=n,
            threshold=8,
            persona=GRANDMOTHER,
            audience="child",
        )[1]
    ]
    assert fired == [8]


def test_repeated_affection_closing_is_dropped_but_the_first_one_stays():
    persona = GRANDMOTHER_CHILD_ONLY
    body = "Thấy các cháu đùm bọc nhau là bà mừng lắm. Bà nhớ Cháu."
    said_before = ["Chuyện ấy bà còn nhớ. Bà nhớ cháu."]

    assert strip_repeated_closing(body, persona, "grandchild", said_before) == (
        "Thấy các cháu đùm bọc nhau là bà mừng lắm."
    )
    # Chưa ai nói câu ấy thì được nói.
    assert strip_repeated_closing(body, persona, "grandchild", []) == body


def test_repeated_vocative_tail_is_dropped():
    body = "Kỷ niệm gian khó của nhà mình đều từ những ngày ấy mà nên, con."
    said_before = ["Nhà mình hồi ấy nghèo mà vui, con."]
    assert strip_repeated_closing(body, FATHER, "child", said_before) == (
        "Kỷ niệm gian khó của nhà mình đều từ những ngày ấy mà nên."
    )
    assert strip_repeated_closing(body, FATHER, "child", []) == body


def test_a_real_sentence_is_never_mistaken_for_a_tail():
    """«Bố thương con lắm» là câu, không phải cái đuôi."""
    body = "Bố thương con lắm. Con giữ sức nhé."
    said_before = ["Bố vẫn nhớ ngày ấy, con.", "Chuyện cũ bố nhớ con."]
    assert strip_repeated_closing(body, FATHER, "child", said_before) == body


def test_stripping_never_empties_a_reply():
    body = "Bà nhớ cháu."
    said_before = ["Bà nhớ cháu."]
    assert strip_repeated_closing(
        body, GRANDMOTHER_CHILD_ONLY, "grandchild", said_before
    )


def test_spouse_winddown_does_not_send_her_away():
    body, kind = maybe_winddown(
        "Nhà mình vẫn thế.",
        sitting_turns=8,
        threshold=8,
        persona=FATHER,
        audience="spouse",
    )
    assert kind == "sitting"
    lowered = body.lower()
    assert "em" in lowered and "anh" in lowered
    assert "nghỉ" not in lowered
    assert "chờ" not in lowered
    assert "kể tiếp" in lowered


def test_dismissal_closing_is_cut_and_the_story_stays():
    raw = (
        "Bố nhớ bài thơ tuổi bảy nhăm. "
        "Em nghỉ đi, cả nhà vẫn chờ em nhiều quá."
    )
    out = strip_dismissal(raw, FATHER, "spouse")
    assert "bảy nhăm" in out.lower()
    assert "nghỉ" not in out.lower()
    assert "chờ" not in out.lower()
    assert "kể tiếp" not in out.lower()


def test_a_reply_that_is_only_a_dismissal_stays_in_the_conversation():
    out = strip_dismissal(
        "Em nghỉ đi, cả nhà vẫn chờ em nhiều quá.", FATHER, "spouse"
    )
    assert "kể tiếp" in out.lower()
    assert "nghỉ" not in out.lower()
    assert "chờ" not in out.lower()


def test_story_clause_survives_wherever_the_sendaway_sits():
    """Câu kể đứng trước, đứng sau, hoặc nối bằng «và» / gạch — không bị thay bằng câu đệm."""
    cases = (
        "Em nghỉ đi, bố nhớ bài thơ tuổi bảy nhăm.",
        "Bố nhớ em nhiều, em nghỉ đi.",
        "Bố nhớ bài thơ tuổi bảy nhăm và em nghỉ đi.",
        "Bố nhớ bài thơ tuổi bảy nhăm — em nghỉ đi.",
        "Bố nhớ bài thơ tuổi bảy nhăm, em nghỉ đi.",
    )
    for raw in cases:
        out = strip_dismissal(raw, FATHER, "spouse")
        assert "kể tiếp" not in out.lower(), raw
        assert "nghỉ đi" not in out.lower(), raw
        assert "nhớ" in out.lower(), raw


def test_a_memory_of_waiting_or_resting_is_not_a_dismissal():
    memories = (
        "Cả nhà chờ con về ăn cơm hôm ấy.",
        "Hôm ấy cả nhà đang chờ con về ăn cơm.",
        "Cả nhà chờ con rồi mới ăn cơm.",
        "Bố nhớ hồi con nghỉ đã lâu.",
        "Người nhà chờ con quá lâu mới gặp được.",
    )
    for text in memories:
        assert strip_dismissal(text, FATHER, "child") == text, text


def test_sendaway_without_the_old_glue_is_still_cut():
    cases = (
        "Nhà đang chờ em.",
        "Em nghỉ ngơi đi, cả nhà đang chờ.",
    )
    for raw in cases:
        out = strip_dismissal(raw, FATHER, "spouse")
        assert "kể tiếp" in out.lower(), raw
        assert "nghỉ" not in out.lower(), raw
        assert "chờ" not in out.lower(), raw


def test_talking_about_a_daughter_is_left_alone():
    text = "Con gái của mẹ ngày ấy hay khóc lắm."
    assert fix_address_register(text, GRANDMOTHER_CHILD_ONLY, "grandchild") == text


def test_spouse_register_never_reaches_a_person_without_one():
    text = "Anh nhớ em nhiều."
    # Bà không có vai vợ/chồng, nên «anh» là vai của người khác.
    assert "bà nhớ" in fix_foreign_self_reference(text, GRANDMOTHER, "child").lower()
    # Bố có, và đang nói với con — kéo về vai bố.
    assert "bố nhớ" in fix_address_register(text, FATHER, "child").lower()
