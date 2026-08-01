from app.services.sample_quality import score_voice_sample


def test_score_sweet_spot():
    score, label, tip = score_voice_sample(duration_ms=45_000, file_size_bytes=500_000)
    assert score >= 75
    assert label == "Tốt"
    assert "Thời lượng tốt" in tip


def test_score_too_short():
    score, label, _ = score_voice_sample(duration_ms=8_000, file_size_bytes=80_000)
    assert score < 55
    assert label in ("Yếu", "Kém")


def test_score_too_long():
    score, label, tip = score_voice_sample(duration_ms=180_000, file_size_bytes=2_000_000)
    assert score < 75
    assert "dài" in tip.lower() or label in ("Yếu", "Kém", "Tạm được")
