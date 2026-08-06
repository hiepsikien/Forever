from __future__ import annotations

from unittest.mock import patch

from app.config import Settings
from app.services.heritage_chat import _enforce_grounding
from app.services.heritage_gemini import GeminiResult
from app.services.heritage_grounding import (
    Ungrounded,
    candidate_names,
    critic_rewrite,
    drop_ungrounded_sentences,
    find_ungrounded,
)


# --- reading names out of a reply ---

def test_kinship_title_in_front_of_a_name_is_dropped():
    assert candidate_names("Hôm ấy bà Phú sang chơi với Mẹ Định.") == ["Phú", "Định"]


def test_a_kinship_word_inside_a_name_is_kept():
    """Splitting "Đình Anh" leaves a fragment no evidence can match."""
    assert candidate_names("Bố nhớ thằng Đình Anh và nghệ sĩ Quốc Anh.") == [
        "Đình Anh",
        "Quốc Anh",
    ]


def test_names_are_not_merged_across_a_separator():
    names = candidate_names("Chuyến tàu ga Hà Nội - Bắc Giang, rồi về Nam Định.")
    assert names == ["Hà Nội", "Bắc Giang", "Nam Định"]


def test_place_names_survive_the_kinship_stoplist():
    """Folding tones would let "hạ" swallow "Hà" and "bác" swallow "Bắc"."""
    assert candidate_names("Quê ở Bắc Ninh, sau ra Hà Nội.") == ["Bắc Ninh", "Hà Nội"]


def test_weekday_and_month_numerals_are_never_names():
    assert candidate_names("Thứ Bảy này con về, tháng Ba bố lại nhớ.") == []


def test_a_lone_capital_opening_a_sentence_is_not_a_name():
    assert candidate_names("Bố nhớ con. Nền nhà cũ vẫn thế.") == []
    # Mid-sentence, the same word is a strong signal.
    assert candidate_names("Bà lo cho cô Nền ăn học.") == ["Nền"]


# --- grounding ---

def test_a_year_the_evidence_never_mentions_is_ungrounded():
    found = find_ungrounded(
        "Năm 1975 bố về dạy ở trường làng.",
        corpus="Bố dạy học ở trường làng suốt những năm khó khăn.",
    )
    assert found.years == ["1975"]
    assert not found.clean


def test_a_year_the_evidence_states_is_grounded():
    found = find_ungrounded(
        "Năm 1975 bố về dạy ở trường làng.",
        corpus="Mốc: 1975 — chuyển về dạy trường làng.",
    )
    assert found.clean


def test_grounding_ignores_tone_and_case_in_the_evidence():
    found = find_ungrounded(
        "Bố vẫn nhớ phố Hàng Da.", corpus="ky tuc xa pho HANG DA nam ay"
    )
    assert found.clean


def test_a_name_outside_the_evidence_is_ungrounded():
    found = find_ungrounded(
        "Bố dạy cùng thầy Trần Văn Bảo.", corpus="Bố là thầy giáo dạy Hóa."
    )
    assert found.names == ["Trần Văn Bảo"]


# --- deterministic trim ---

def test_trim_drops_only_the_offending_sentence():
    reply = "Bố nghe con rồi. Năm 1975 bố về trường làng. Con giữ sức khoẻ nhé."
    trimmed = drop_ungrounded_sentences(reply, Ungrounded(years=["1975"]))
    assert "1975" not in trimmed
    assert "Bố nghe con rồi." in trimmed
    assert "Con giữ sức khoẻ nhé." in trimmed


def test_trim_returns_empty_when_every_sentence_is_tainted():
    reply = "Năm 1975 bố về trường làng."
    assert drop_ungrounded_sentences(reply, Ungrounded(years=["1975"])) == ""


# --- critic ---

def _settings(**kwargs) -> Settings:
    return Settings(gemini_api_key="test-key", seed_demo=False, **kwargs)


def test_critic_is_told_exactly_what_to_remove():
    captured = {}

    def fake_call(settings, call):
        captured["text"] = call.contents[0]["parts"][0]["text"]
        return GeminiResult(text="Hồi ấy bố về trường làng.")

    with patch("app.services.heritage_grounding.call_gemini", side_effect=fake_call):
        out = critic_rewrite(
            _settings(),
            reply="Năm 1975 bố về trường làng.",
            ungrounded=Ungrounded(years=["1975"], names=["Trần Văn Bảo"]),
        )
    assert out == "Hồi ấy bố về trường làng."
    assert "1975" in captured["text"]
    assert "Trần Văn Bảo" in captured["text"]


# --- the guard as the pipeline uses it ---

CORPUS = "Bố là thầy giáo dạy Hóa, nhà ở Hà Nội."
DIRTY = "Bố nghe con rồi. Năm 1975 bố dạy ở trường làng."


def test_guard_trims_ungrounded_years_even_when_critic_is_off():
    """Years are digits we trust; names stay flag-only until the critic is on."""
    body, info = _enforce_grounding(
        _settings(heritage_critic_enabled=False),
        body=DIRTY,
        corpus=CORPUS,
        audience="child",
        max_output_tokens=512,
    )
    assert "1975" not in body
    assert info["action"] == "trimmed_years"
    assert info["years"] == ["1975"]


def test_guard_only_flags_ungrounded_names_when_critic_is_off():
    body, info = _enforce_grounding(
        _settings(heritage_critic_enabled=False),
        body="Bố nhớ thầy Trần Văn Bảo lắm.",
        corpus=CORPUS,
        audience="child",
        max_output_tokens=512,
    )
    assert "Trần Văn Bảo" in body
    assert info == {"names": ["Trần Văn Bảo"], "action": "flagged"}


def test_year_in_the_user_turn_does_not_ground_the_reply():
    """«Năm 2030…» in the question must not launder a future assertion."""
    found = find_ungrounded(
        "Đến năm 2030 các cháu đã lớn.",
        corpus="Lock…\nĐến năm 2030 gia đình thế nào?",
        year_corpus="Lock…",
    )
    assert found.years == ["2030"]


def test_year_only_in_prior_chat_does_not_ground_the_reply():
    """A earlier turn asking about 2030 must not authorize echoing it later."""
    found = find_ungrounded(
        "Bố không đoán năm 2030 đâu.",
        corpus="Lock…\nBố nghĩ năm 2030 thế nào?\nBố không đoán năm 2030 đâu.",
        year_corpus="Lock và mốc 1966.",
    )
    assert found.years == ["2030"]


def test_guard_trims_echoed_future_year_while_refusing():
    body, info = _enforce_grounding(
        _settings(heritage_critic_enabled=False),
        body=(
            "Bố không đoán trước được chuyện tương lai như năm 2030 đâu con. "
            "Bố chỉ mong các con luôn bình an."
        ),
        corpus="Lock…\nBố nghĩ năm 2030 gia đình thế nào?",
        year_corpus="Lock… neo tuổi 2015.",
        audience="child",
        max_output_tokens=512,
    )
    assert "2030" not in body
    assert "bình an" in body.lower() or "Bố" in body
    assert info["action"] == "trimmed_years"


def test_guard_keeps_a_clean_reply_untouched():
    body, info = _enforce_grounding(
        _settings(heritage_critic_enabled=True),
        body="Bố nghe con rồi.",
        corpus=CORPUS,
        audience="child",
        max_output_tokens=512,
    )
    assert body == "Bố nghe con rồi."
    assert info is None


def test_guard_takes_a_rewrite_that_comes_back_clean():
    with patch(
        "app.services.heritage_chat.critic_rewrite",
        return_value="Bố nghe con rồi. Hồi ấy bố dạy ở trường làng.",
    ):
        body, info = _enforce_grounding(
            _settings(heritage_critic_enabled=True),
            body=DIRTY,
            corpus=CORPUS,
            audience="child",
            max_output_tokens=512,
        )
    assert "1975" not in body
    assert info["action"] == "rewritten"


def test_guard_trims_when_the_rewrite_is_still_ungrounded():
    with patch(
        "app.services.heritage_chat.critic_rewrite",
        return_value="Bố nghe con rồi. Năm 1975 vẫn thế.",
    ):
        body, info = _enforce_grounding(
            _settings(heritage_critic_enabled=True),
            body=DIRTY,
            corpus=CORPUS,
            audience="child",
            max_output_tokens=512,
        )
    assert body == "Bố nghe con rồi."
    assert info["action"] == "trimmed"


def test_guard_falls_back_to_the_neutral_line_when_nothing_survives():
    with patch("app.services.heritage_chat.critic_rewrite", return_value=None):
        body, info = _enforce_grounding(
            _settings(heritage_critic_enabled=True),
            body="Năm 1975 bố dạy ở trường làng.",
            corpus=CORPUS,
            audience="child",
            max_output_tokens=512,
        )
    assert "1975" not in body
    assert info["action"] == "replaced"


def test_guard_is_a_no_op_when_the_flag_is_off():
    body, info = _enforce_grounding(
        _settings(heritage_grounding_enabled=False),
        body=DIRTY,
        corpus=CORPUS,
        audience="child",
        max_output_tokens=512,
    )
    assert body == DIRTY
    assert info is None
