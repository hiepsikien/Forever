from __future__ import annotations

from pathlib import Path


def score_voice_sample(
    *,
    duration_ms: int | None,
    file_size_bytes: int,
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

    if file_size_bytes > 0 and duration_ms and duration_ms > 0:
        # Rough bytes/sec for m4a phone recordings.
        bps = file_size_bytes / (duration_ms / 1000.0)
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
