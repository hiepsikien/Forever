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


def test_narrow_band_beats_duration_bonus():
    """A 16 kHz clip must not read as usable just because its length is ideal."""
    score, label, tip = score_voice_sample(
        duration_ms=45_000,
        file_size_bytes=1_440_000,
        sample_rate=16_000,
    )
    assert label in ("Yếu", "Kém")
    assert "16 kHz" in tip
    assert score < 55


def test_full_band_scores_above_narrow_band():
    wide, _, _ = score_voice_sample(
        duration_ms=45_000, file_size_bytes=4_320_000, sample_rate=48_000
    )
    narrow, _, _ = score_voice_sample(
        duration_ms=45_000, file_size_bytes=1_440_000, sample_rate=16_000
    )
    assert wide > narrow


def test_uncompressed_low_rate_gets_no_bitrate_bonus():
    """Raw bytes/sec used to hand 16 kHz PCM a top score — it must not anymore."""
    pcm_16k, _, _ = score_voice_sample(
        duration_ms=45_000, file_size_bytes=1_440_000, sample_rate=16_000
    )
    assert pcm_16k < 75
