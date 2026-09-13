# Forever — Pricing plan

> Trạng thái: **draft v1** (2026-08-18).  
> Nguyên tắc đã chốt: subscription theo **Family Space**, không credits linh hoạt trên
> đường dùng; usage chỉ là hạn mức mềm ở tầng steward.  
> Liên quan: `docs/PROJECT.md` §4 (GTM wedge), `docs/voice-to-voice.plan.md`.

---

## 1. Nguyên tắc thiết kế

| Nguyên tắc | Ý nghĩa thực thi |
|------------|------------------|
| **Thu theo gia đình, không theo người** | Một `FamilySpace` = một hóa đơn. Thêm anh chị em không tăng giá. |
| **Subscription là khung** | Chat, thư viện, trí nhớ, steward — trả đều hàng tháng/năm. |
| **Voice/AI = hạn mức, không phải ví credits** | Steward thấy «còn ~X phút gọi tháng này»; mẹ **không** thấy số dư trên `/call/`. |
| **Không cắt giữa phiên** | Hết hạn mức → cảnh báo steward; hard stop chỉ sau khi phiên kết thúc. |
| **BYOK voice** | Steward có thể gắn ElevenLabs key (đã có trong Cài đặt) → voice không ăn quota Forever. |
| **Bán hành trình, không bán API call** | Copy nói về *két sắt ký ức / di sản / phòng khách*, không «500 token Gemini». |

---

## 2. Đơn vị & ai trả tiền

- **Đơn vị billing:** `family_spaces.id` (một không gian gia đình).
- **Người trả:** thường là **steward / con** (30–50 tuổi), không phải mẹ.
- **Người dùng chính:** mẹ và cả nhà — trải nghiệm không có paywall công khai.
- **Thanh toán:** ưu tiên **theo năm** (Tết, giỗ, mừng thọ); trả tháng +20%.

---

## 3. Bảng gói (v1)

Giá VND, đã gồm VAT (nếu áp dụng). USD tham chiếu ~24.000 đ.

### 3.1 Gói recurring

| | **Essential**<br>*Ký ức* | **Heritage**<br>*Di sản* |
|---|:---:|:---:|
| **Tagline** | Phòng khách & thư viện gia đình | Trò chuyện bằng giọng với người được nhớ |
| **Tháng** | 349.000 đ | 649.000 đ |
| **Năm** (tiết kiệm ~17%) | **2.990.000 đ** (~249k/th) | **5.990.000 đ** (~499k/th) |
| Thành viên sống | Không giới hạn | Không giới hạn |
| Thư viện (ảnh, ghi chú, voice note) | 25 GB | 100 GB |
| Chat người sống | ✓ | ✓ |
| Time-capsule interview | ✓ | ✓ |
| Thực thể ký ức (text) | 1 | 3 |
| Phòng riêng 1-1 / thành viên | ✓ | ✓ |
| Duyệt ký ức (memory candidates) | ✓ | ✓ |
| Chat heritage (text) | 300 lượt AI/tháng | 800 lượt AI/tháng |
| Voice-to-voice (Gọi) | — | **120 phút/tháng** |
| Voice DNA — clone giọng | — | 1 giọng ký ức |
| Extract (tách giọng từ video/ghi âm) | — | 2 job/năm |
| Export archive ZIP | CSV metadata | Full archive |
| BYOK ElevenLabs | — | ✓ (voice không trừ quota) |

**Định nghĩa «lượt AI»:** một reply heritage hoàn chỉnh (analyzer + composer; STT/TTS tính riêng).

**Định nghĩa «phút gọi»:** thời lượng audio **đầu vào** STT trong phiên `/call/` (làm tròn 15 giây). TTS đầu ra không trừ thêm khi dùng quota Forever; BYOK thì cả hai phía do key steward.

### 3.2 Gói one-time (wedge & setup)

| Gói | Giá | Gồm | Mục đích GTM |
|-----|-----|-----|--------------|
| **Time-Capsule Gift** | 990.000 đ | 3 tháng Essential + bộ câu hỏi cội nguồn + hướng dẫn steward 1 buổi (async) | Quà Tết / mừng thọ — lối vào cảm xúc |
| **Khởi tạo Giọng** | 1.490.000 đ | 1 clone Voice DNA + 1 Extract job + **2 tháng Heritage** | Sau khi mất người thân — setup giọng một lần |
| **Extract thêm** | 490.000 đ / job | 1 job Extract (video/ghi âm ≤ 60 phút nguồn) | Gia đình có nhiều đĩa cũ |
| **Thêm thực thể** | 790.000 đ / năm / entity | +1 `IdentityProfile` heritage (text + phòng) | Ông bà, cô chú |

Gói one-time **cộng dồn** với subscription: không thay thế, chỉ bổ sung tháng hoặc quota.

### 3.3 Nạp thêm (steward only)

Không gọi là «credits». Copy: **«Gia hạn hạn mức tháng này»**.

| Add-on | Giá | Hiệu lực |
|--------|-----|----------|
| +60 phút gọi | 149.000 đ | Tháng hiện tại |
| +200 lượt AI text | 99.000 đ | Tháng hiện tại |
| +50 GB storage | 79.000 đ/tháng | Recurring add-on |

---

## 4. Hành vi hệ thống (quota & UX)

### 4.1 Phân tầng hiển thị

```
Mẹ (/call, /chat)     →  Không số dư. Chỉ thông báo nhẹ nếu steward tắt voice.
Steward (Cài đặt)     →  Thanh hạn mức + email 80% / 100%.
Owner billing         →  Hóa đơn, nâng gói, add-on.
```

### 4.2 Soft limit → hard limit

| Mức | Hành vi |
|-----|---------|
| **80%** | Email/push steward: «Còn ~24 phút gọi tháng 8». |
| **100%** | Phiên đang mở: **cho phép hoàn thành**. Phiên mới: fallback text-only heritage + banner steward «Đã hết phút gọi — nạp thêm hoặc nâng Di sản». |
| **Quá 120%** (chống lạm dụng) | Hard cap; log để review. |

### 4.3 BYOK ElevenLabs

- Heritage + key hợp lệ → **phút gọi không trừ** (Forever vẫn trừ STT + Gemini theo lượt AI).
- Clone/import sample vẫn qua provider của steward — Forever không subsizide MiniMax/ElevenLabs billing.
- Copy Cài đặt: «Dùng key riêng nếu gia đình gọi voice nhiều — Forever vẫn lo phòng chat, trí nhớ và giọng Bố trong app.»

### 4.4 Trial

| Loại | Thời gian | Giới hạn |
|------|-----------|----------|
| **Family trial** | 14 ngày Heritage | 30 phút gọi, 50 lượt AI, 5 GB — **không** cần thẻ (invite-only) |
| **Sau gift pack** | Theo gói | Không trial riêng |

Trial hết → downgrade Essential (giữ data, khóa voice) hoặc read-only 30 ngày nếu không chọn gói.

---

## 5. So sánh nhanh cho sales

**Chọn Essential khi:** gia đình mới bắt đầu thu thập; bố mẹ còn sống; chủ yếu chat chữ + thư viện + phỏng vấn time-capsule.

**Chọn Heritage khi:** có thực thể ký ức cần **giọng nói** (mẹ gọi Bố); đã có hoặc sẽ làm Voice DNA / Extract.

**Chọn Gift pack khi:** mua quà dịp lễ, chưa chắc cam kết dài — upsell Heritage sau 3 tháng.

---

## 6. Sanity check COGS (tham chiếu nội bộ)

Giả định **mẹ gọi 15 phút/ngày**, ~8 lượt/ngày, Heritage không BYOK:

| Hạng mục | Ước tính/tháng | Ghi chú |
|----------|----------------|---------|
| Gemini (STT + ~2 call/lượt) | 150.000–400.000 đ | Flash; biến theo độ dài |
| ElevenLabs TTS | 200.000–500.000 đ | ~500 ký tự/lượt |
| Storage 100 GB | ~50.000–100.000 đ | Object storage |
| Extract (phân bổ) | ~80.000 đ | 2 job/năm |
| **Tổng COGS** | **~500.000–1.000.000 đ** | |

Heritage **5.990.000 đ/năm** (~499k/th) → gross margin ~50–70% ở use case nặng; margin cao hơn khi chỉ text hoặc BYOK voice.

**Essential** margin cao (text 300 lượt ≈ COGS thấp) — dùng làm tier entry và funnel.

Điều chỉnh giá sau **≥10 gia đình trả phí** khi có số liệu thật từ `voice_renders`, Gemini logs, storage.

---

## 7. Schema billing (gợi ý kỹ thuật — chưa implement)

```
family_spaces
  plan_tier          essential | heritage
  billing_period     monthly | annual
  plan_expires_at
  storage_limit_bytes
  voice_minutes_limit_monthly
  ai_turns_limit_monthly
  voice_minutes_used_this_period   -- reset cron
  ai_turns_used_this_period
  byok_elevenlabs    bool derived from space_settings
  stripe_customer_id / subscription_id   -- hoặc cổng VN
```

Meter tại:
- `heritage_chat` dispatch → +1 ai_turn
- `stt` success trên `/call/` → +duration voice_minutes
- `voice_renders` create → log; không double-charge nếu BYOK

---

## 8. Lộ trình triển khai

| Phase | Việc | Ghi chú |
|-------|------|---------|
| **P0** | Gia đình mình — không billing | Gift nội bộ |
| **P1** | Manual invoice (chuyển khoản) + flag `plan_tier` trên space | 5–10 gia đình đầu |
| **P2** | Stripe / PayOS + trang steward «Gói & hạn mức» | Tự phục vụ |
| **P3** | Add-on tự động + email 80% | Sau khi quota code ổn |

---

## 9. Copy landing (draft)

**Essential — Ký ức**  
*Phòng khách riêng cho cả nhà. Lưu ảnh, câu chuyện, và trò chuyện với ký ức bằng chữ — an toàn, có người duyệt, không lẫn với mạng xã hội.*

**Heritage — Di sản**  
*Mẹ nói — Bố trả lời bằng giọng thật. Gồm thiết lập Voice DNA và thời gian gọi hàng tháng; con có thể dùng key ElevenLabs riêng nếu cần.*

**Time-Capsule Gift**  
*Quà Tết cho bố mẹ: một buổi kể chuyện cội nguồn bằng giọng, cả nhà nghe lại mãi.*

---

## 10. Chưa chốt (cần quyết sau pilot)

- [ ] Cổng thanh toán VN (PayOS / VNPay) vs Stripe-only.
- [ ] Free tier read-only vĩnh viễn hay không (hiện: không free — chỉ trial).
- [ ] Giá quốc tế (USD) cho diaspora — có thể ×1.5 so VND parity.
- [ ] Enterprise «nhiều chi nhánh gia phả» — ngoài scope v1.

---

*Tài liệu này là single source of truth cho pricing cho tới khi có `pricing v2` sau pilot.*
