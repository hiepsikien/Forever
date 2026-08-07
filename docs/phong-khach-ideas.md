# Phòng khách — ý tưởng tăng hữu dụng

> Ghi chú suy nghĩ (2026-08-06). Không phải roadmap cam kết.
> Concept gốc: `docs/phong-khach.md`.

## Giữ nguyên trục

Phòng khách là **phòng của người sống**. Người được nhớ ngồi cùng như thành viên
bình thường — chỉ lên tiếng khi được gọi. Người giữ nhà là vai phụ. Không biến
phòng này thành chatbot thứ hai, không đẩy người dùng sang phòng khác với lý do
sai («bố không nghe được ở đây»).

Ba loại phòng vẫn tách bạch:

| Phòng | Vai trò |
|--|--|
| Phòng khách | Cả nhà nói với nhau; ký ức góp lời khi được gọi |
| Phòng chung với một người | Cuộc trò chuyện với họ — luôn trả lời |
| Phòng riêng 1-1 | Như trên, chỉ mình bạn đọc |

---

## 1. Hiện diện — «ai đang ngồi»

- Hàng ghế / avatar nhỏ trên đầu chat: bố `@bo`, bà `@bathong`, giữ nhà
  `@giunhà` (mờ hơn).
- Autocomplete `@` khi gõ, và gợi ý khi gõ «bố» / «bà».
- Chip «Gọi @…» đã có — giữ là lối gọi chính trong phòng này.
- Bubble heritage ngắn (1–3 câu) gắn rõ handle để cả nhà biết ai vừa góp lời.

**Vì sao:** concept «họ cũng ngồi đây» chỉ hữu dụng khi mắt thấy được ghế ngồi,
không chỉ đọc được dòng hint dưới composer.

---

## 2. Nghi thức gia đình — không phải bot dẫn chuyện

- Thẻ nhẹ (không spam vào dòng chat): «Câu hỏi tuần này» / Time-Capsule — cả nhà
  trả lời trong Phòng khách; ký ức chỉ góp khi được gọi.
- Chủ nhật một lần (tuỳ chọn): tóm tắt ngắn «Cả nhà đã nhắc gì tuần này» — chỉ
  từ tin người sống + ký ức đã lưu / đã duyệt. Không bịa.

**Vì sao:** Phòng khách cần lý do mở hàng tuần kể cả khi không ai «gọi bố».
Nghi thức là của gia đình, không phải của trợ lý.

---

## 3. Cầu nối mềm sang phòng của người đó

- Sau vài tin *nhắc* bố mà không gọi tên: gợi ý nhỏ dưới composer
  «Nói riêng với bố →» / «Phòng chung với bố →».
- Không nói «bố không nghe được ở đây». Không bắt chuyển phòng.
- Chip «Gọi @bo» vẫn là lối chính *trong* Phòng khách.

**Vì sao:** phòng chung / riêng vẫn là nơi nói chuyện dài với người đó. Cầu nối
đúng hướng — mời, không đẩy sai.

---

## 4. Hữu dụng khi không có AI

- Ảnh, voice giữa người sống (không auto-reply).
- Ghim tin quan trọng: lịch giỗ, mã mời, địa chỉ.
- Badge chưa đọc trên hero trang nhà (đã có «Tin mới ↓» trong chat).

**Vì sao:** nếu phòng chỉ «sống» khi có LLM trả lời thì concept thất bại — đây
phải là phòng gia đình trước, AI sau.

---

## 5. Ký ức thỉnh thoảng tự góp (sau này, cẩn thận)

- Rất thưa, chỉ khi mạch chuyện khớp neo / ký ức đã duyệt.
- Luôn gắn nhãn heritage rõ; steward bật/tắt.
- **Không** làm mặc định lúc này — dễ phá «chỉ khi được gọi».

**Vì sao:** ấm hơn, nhưng rủi ro cao. Để sau khi (1)–(4) đã ổn.

---

## 6. Nhiều người được nhớ

- Gọi hai người trong một tin: lần lượt trả lời ngắn, hoặc chỉ người được `@`
  trước (hiện tại: một lượt một người — người khớp đầu tiên).
- Hero Phòng khách liệt kê ghế ngồi rõ hơn khi thêm bà Nội, ông Nội…
- Trang nhà «Người trong nhà» đã nhóm theo người — giữ hướng đó.

---

## Ưu tiên nếu chỉ làm vài việc

1. **Hiện diện + autocomplete `@`** — làm concept nhìn thấy được.
2. **Nghi thức tuần không spam** — lý do mở phòng hàng tuần.
3. **Cầu nối mềm sang phòng riêng/chung** — không phá mô hình ba phòng.

Ba hướng đó tăng giá trị sống hàng ngày mà không đổi kiến trúc đã chốt.

---

## Không làm (trong khuôn khổ concept này)

- Agent trả lời mọi tin trong Phòng khách.
- Heritage luôn trả lời trong Phòng khách (đó là việc của phòng chung/riêng).
- Đẩy người dùng sang phòng khác vì «ở đây không nghe được».
- Spontaneous góp lời mặc định khi chưa có gate steward + neo đã duyệt.
