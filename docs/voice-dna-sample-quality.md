# Voice DNA — chất lượng mẫu cho ElevenLabs IVC

> **Field note:** 2026-08-04  
> Quan sát khi clone Instant Voice Clone (ElevenLabs).

## Phát hiện

Chất lượng bản ghi tạo ra sự khác biệt rất lớn:

| Nguồn | Kết quả quan sát |
|-------|------------------|
| Ghi mới trên iPhone, đọc theo text (~30–60s, phòng yên) | Clone khá tốt |
| Băng cũ dài (~6 phút / ~6 MB) | Kém hơn nhiều |

Bitrate “ổn trên giấy” không đủ — băng dài, nén nhiều lần (Zalo, cuộc gọi cũ) thường nhiễu/méo và làm IVC không ổn định. **Ưu tiên đoạn ngắn sạch hơn là thu càng dài càng tốt.**

## Hệ quả sản phẩm

1. **Luồng sống (self):** Ghi mẫu đọc theo đoạn AI trên điện thoại là đường vàng.
2. **Luồng ký ức / upload:** Không đưa nguyên băng dài vào clone — cắt hoặc **Tách giọng từ băng dài**, duyệt đoạn rõ lời ~30–60s.
3. **Điểm chất lượng** (`apps/api/app/services/sample_quality.py`): trừ mạnh file >3–5 phút; tip nhắc ghi mới / cắt đoạn sạch.
4. **Gợi ý clone** vẫn xếp theo `quality_score` — mẫu dài yếu sẽ ít được đề xuất hơn.

## Liên quan

- `docs/PROJECT.md` — Phase 4 Voice DNA
- `docs/voice-dna-clone-selection.md` — chọn 1–3 mẫu để clone
- `AGENTS.md` — không auto-attach segment extract thiếu human review
