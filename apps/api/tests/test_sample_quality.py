from app.services.sample_quality import score_voice_sample


def test_score_sweet_spot():
    score, label, tip = score_voice_sample(duration_ms=45_000, file_size_bytes=500_000)
    assert score >= 75
    assert label == "Tốt"
    assert "30–75s" in tip or "Thời lượng tốt" in tip


def test_score_record_source_affirms_phone_script():
    score, label, tip = score_voice_sample(
        duration_ms=40_000,
        file_size_bytes=480_000,
        source="record",
    )
    assert score >= 75
    assert label == "Tốt"
    assert "điện thoại" in tip.lower() or "đọc text" in tip.lower()


def test_score_too_short():
    score, label, _ = score_voice_sample(duration_ms=8_000, file_size_bytes=80_000)
    assert score < 55
    assert label in ("Yếu", "Kém")


def test_score_too_long():
    score, label, tip = score_voice_sample(duration_ms=180_000, file_size_bytes=2_000_000)
    assert score < 75
    assert "dài" in tip.lower() or label in ("Yếu", "Kém", "Tạm được")


def test_score_old_long_archival_six_min_six_mb():
    """Field finding: ~6 min / ~6 MB archival often clones much worse than fresh phone reads."""
    score, label, tip = score_voice_sample(
        duration_ms=6 * 60_000,
        file_size_bytes=6 * 1024 * 1024,
        source="upload",
    )
    assert score < 45
    assert label in ("Yếu", "Kém")
    assert "dài" in tip.lower() or "ghi mới" in tip.lower() or "30–60" in tip
