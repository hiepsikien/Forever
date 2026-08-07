# Hạn mức lượt nói với ký ức (Quota)

> Trạng thái: **V1 đã code**. Đọc cùng `docs/PROJECT.md` (anchor, không opioid)
> và `docs/voice-to-voice.plan.md` (màn Gọi).

## Vì sao

Mẹ (và mọi thành viên) cần được neo bởi ký ức — không bị giam trong cuộc nói
dài bất tận. Steward quản trị trần lượt; hệ thống còn đếm token ước tính để thấy
tiêu hao. Mỗi lần ghi âm có trần giây để không quên tắt micro.

## Luật V1

- **1 lượt** = một tin nhắn user trên thread `heritage` (text hoặc voice).
- **Trần mặc định:** 20 lượt / thành viên / ngày (`Asia/Ho_Chi_Minh`).
- Hết trần → **429** `quota_exhausted`, không STT / heritage / TTS.
- Nhắc khi `remaining ≤ heritage_warn_remaining` (mặc định 3).
- **Giây tối đa mỗi lần ghi:** `heritage_max_utterance_sec` (mặc định 60). Client
  tự dừng; server từ chối file dài hơn trần + 5s.
- Chat người sống ↔ người sống **không** tính.
- `heritage_daily_turn_limit = 0` tắt hạn mức.
- Token ước tính chỉ là meter Steward — không chặn.

## Steward

Cài đặt → Nhà → **Hạn mức nói với ký ức**: chỉnh 3 số + xem bảng hôm nay
(lượt + token ước tính theo người).

## Code

| Lớp | Chỗ |
|---|---|
| Policy + counter | `SpaceSettings`, `UsageCounter`, `services/usage_quota.py` |
| Enforce | `routers/messages.py` trước khi commit tin heritage |
| API | `GET …/usage/me`, `GET …/usage`, PATCH settings |
| Meter token | `maybe_heritage_reply` → `estimate_turn_tokens` / `add_tokens` |
| Mobile | `lib/usageQuota.ts`, Gọi / chat heritage, Settings |

## Không làm (V1)

Soft-only, hạn phút/token cứng, override từng người, VAD silence-stop, quota
Extract / Voice DNA lab / interview.
