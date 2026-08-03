from app.services.elevenlabs import soften_sentence_pacing


def test_soften_sentence_pacing_v3_inserts_short_pause():
    text = "Con nhớ bố lắm. Bố ơi con đây. Nhớ về nhà nhé."
    out = soften_sentence_pacing(text, model_id="eleven_v3")
    assert "[short pause]" in out
    assert out.count("[short pause]") == 2
    assert "Con nhớ bố lắm." in out
    assert "Nhớ về nhà nhé." in out


def test_soften_sentence_pacing_non_v3_uses_ssml_break():
    text = "Xin chào. Bạn khỏe không?"
    out = soften_sentence_pacing(text, model_id="eleven_turbo_v2_5")
    assert '<break time="0.45s" />' in out
    assert "[short pause]" not in out


def test_soften_sentence_pacing_skips_when_tags_present():
    text = "Chờ một chút. [short pause] Được rồi."
    assert soften_sentence_pacing(text, model_id="eleven_v3") == text.strip()


def test_soften_sentence_pacing_single_sentence_unchanged():
    text = "Con nhớ bố lắm."
    assert soften_sentence_pacing(text, model_id="eleven_v3") == text


def test_soften_sentence_pacing_caps_inserts():
    parts = [f"Câu số {i}." for i in range(1, 20)]
    text = " ".join(parts)
    out = soften_sentence_pacing(text, model_id="eleven_v3")
    assert out.count("[short pause]") == 8
