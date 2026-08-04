from __future__ import annotations

from pathlib import Path

from .audio_combine import probe_sample_rate


def score_voice_sample(
    *,
    duration_ms: int | None,
    file_size_bytes: int,
    sample_rate: int | None = None,
) -> tuple[int, str, str]:
    """
    Heuristic quality score for Instant Voice Clone samples.
    Returns (score 0-100, label, tip).
    Not a lab measurement — guides which clips to keep.
    """
    score = 50
    tips: list[str] = []

    if duration_ms is None or duration_ms <= 0:
        score -= 15
        tips.append("Chưa đo được thời lượng — nghe lại để tự đánh giá.")
    else:
        seconds = duration_ms / 1000.0
        if 25 <= seconds <= 75:
            score += 30
            tips.append("Thời lượng tốt cho IVC (~30–75s).")
        elif 15 <= seconds < 25 or 75 < seconds <= 100:
            score += 15
            tips.append("Thời lượng tạm ổn; lý tưởng ~30–60s.")
        elif 100 < seconds <= 120:
            score += 0
            tips.append("Hơi dài — IVC ưu tiên đoạn sạch ngắn hơn.")
        elif seconds > 120:
            score -= 20
            tips.append("Quá dài (>2 phút) — dễ làm clone kém ổn định.")
        else:
            score -= 25
            tips.append("Quá ngắn (<15s) — khó bắt đặc trưng giọng.")

    bps = (
        file_size_bytes / (duration_ms / 1000.0)
        if file_size_bytes > 0 and duration_ms and duration_ms > 0
        else None
    )

    if sample_rate:
        # Sample rate caps the bandwidth: above ~8 kHz sits the breath, sibilance
        # and upper formants that carry age and voice identity. Losing them is
        # what makes a clone drift toward a generic, younger baseline.
        if sample_rate >= 44100:
            score += 10
        elif sample_rate >= 32000:
            score += 5
        elif sample_rate >= 22050:
            score -= 10
            tips.insert(
                0,
                f"Băng thông hẹp ({sample_rate // 1000} kHz) — clone dễ mất chất giọng.",
            )
        else:
            score -= 30
            tips.insert(
                0,
                f"Băng thông rất hẹp ({sample_rate // 1000} kHz) — clone sẽ nghe trẻ "
                "và khác người gốc. Lấy lại mẫu từ file gốc.",
            )
        # Only meaningful for compressed audio; PCM always clears this bar.
        if bps is not None and bps < 4_000:
            score -= 10
            tips.append("Bitrate thấp — ghi gần micro hơn hoặc phòng yên hơn.")
    elif bps is not None:
        if bps >= 8_000:
            score += 10
        elif bps >= 4_000:
            score += 5
        else:
            score -= 10
            tips.append("Bitrate thấp — ghi gần micro hơn hoặc phòng yên hơn.")
    elif file_size_bytes < 20_000:
        score -= 15
        tips.append("File rất nhỏ — có thể ghi lỗi / im lặng nhiều.")

    score = max(0, min(100, score))
    if score >= 75:
        label = "Tốt"
    elif score >= 55:
        label = "Tạm được"
    elif score >= 35:
        label = "Yếu"
    else:
        label = "Kém"

    tip = tips[0] if tips else "Nghe lại: rõ lời, ít ồn, một người nói."
    return score, label, tip


def score_voice_sample_file(
    path: Path | None,
    *,
    duration_ms: int | None,
    file_size_bytes: int,
) -> tuple[int, str, str]:
    """Score a sample on disk, reading its real sample rate when possible."""
    rate = probe_sample_rate(path) if path is not None and path.exists() else None
    return score_voice_sample(
        duration_ms=duration_ms,
        file_size_bytes=file_size_bytes,
        sample_rate=rate,
    )
