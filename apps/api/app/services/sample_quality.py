from __future__ import annotations


def score_voice_sample(
    *,
    duration_ms: int | None,
    file_size_bytes: int,
    source: str | None = None,
) -> tuple[int, str, str]:
    """
    Heuristic quality score for Instant Voice Clone samples.
    Returns (score 0-100, label, tip).
    Not a lab measurement — guides which clips to keep.

    Field note (2026-08): ElevenLabs IVC is highly sensitive to capture quality.
    A fresh ~30–60s phone recording reading a script usually clones far better
    than a long archival file (e.g. ~6 min / ~6 MB Zalo or old call tape), even
    when the old file's bitrate looks acceptable on paper.
    """
    score = 50
    tips: list[str] = []
    src = (source or "").strip().lower()

    if duration_ms is None or duration_ms <= 0:
        score -= 15
        tips.append("Chưa đo được thời lượng — nghe lại để tự đánh giá.")
    else:
        seconds = duration_ms / 1000.0
        if 25 <= seconds <= 75:
            score += 30
            if src == "record":
                tips.append(
                    "Thời lượng tốt (~30–75s) — kiểu ghi điện thoại đọc text "
                    "thường cho IVC ổn định."
                )
            else:
                tips.append(
                    "Thời lượng tốt cho IVC (~30–75s). Ưu tiên đoạn sạch, "
                    "một người, ít ồn."
                )
        elif 15 <= seconds < 25 or 75 < seconds <= 100:
            score += 15
            tips.append("Thời lượng tạm ổn; lý tưởng ~30–60s đọc rõ trên điện thoại.")
        elif 100 < seconds <= 180:
            score -= 10
            tips.append(
                "Hơi dài (>1,5–3 phút) — IVC ưu tiên đoạn ngắn sạch hơn "
                "băng dài nén nhiều lần."
            )
        elif 180 < seconds <= 300:
            score -= 25
            tips.append(
                "Quá dài (>3 phút) — dễ làm clone kém ổn định. Cắt đoạn rõ lời "
                "~30–60s hoặc ghi mới đọc text trên điện thoại."
            )
        elif seconds > 300:
            # e.g. ~6 phút / ~6 MB: bitrate may look fine, clone quality often poor.
            score -= 35
            tips.append(
                "Băng dài (>5 phút) thường clone kém hơn nhiều so với đoạn ngắn "
                "sạch — ưu tiên ghi mới đọc text trên iPhone/~điện thoại "
                "(~30–60s), hoặc tách/cắt đoạn rõ lời."
            )
        else:
            score -= 25
            tips.append("Quá ngắn (<15s) — khó bắt đặc trưng giọng.")

    if file_size_bytes > 0 and duration_ms and duration_ms > 0:
        # Rough bytes/sec for m4a phone recordings.
        bps = file_size_bytes / (duration_ms / 1000.0)
        seconds = duration_ms / 1000.0
        if bps >= 8_000:
            score += 10
        elif bps >= 4_000:
            score += 5
        else:
            score -= 10
            tips.append("Bitrate thấp — ghi gần micro hơn hoặc phòng yên hơn.")
        # Long + modest bitrate often = multi-gen compression (Zalo, old calls).
        if seconds > 180 and bps < 20_000:
            score -= 5
            tips.append(
                "File dài, nén vừa phải — nghe lại: nếu ồn/méo, đừng đưa thẳng "
                "vào clone; cắt đoạn sạch hoặc ghi mới."
            )
    elif file_size_bytes < 20_000:
        score -= 15
        tips.append("File rất nhỏ — có thể ghi lỗi / im lặng nhiều.")

    if src in ("upload", "memory") and duration_ms and duration_ms > 120_000:
        tips.append(
            "File cũ tải lên: ElevenLabs nhạy với nhiễu và nén — mẫu ghi mới "
            "đọc text thường vượt xa băng dài."
        )

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
