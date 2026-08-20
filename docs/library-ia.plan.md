# Quy hoạch lại trang Ký ức

> **Trạng thái (2026-08):** Hub hai tầng đã ship — Thư viện chung (Lịch gia đình +
> người nhà) và không gian riêng người đã mất; `@handle` trên mọi `IdentityProfile`.
> Đọc cùng `docs/PROJECT.md` §10.
> Bối cảnh gốc: Thư viện của "Nhà tôi ở Đền Lừ" từng có 48 món trên một dòng chảy phẳng.

## 1. Trang này từng sai ở đâu

Không phải sai vì thiếu tính năng. Sai vì **một dòng chảy phẳng** phải chở bốn
loại nội dung đọc theo bốn cách khác nhau — và sau bước C–E, **Lịch gia đình bị
nhân bản** trên mọi trang người đã mất dù đó là tầng nhà.

## 2. Nguyên tắc

**Cấu trúc suy ra từ dữ liệu** — không album, không thư mục tự do. `kind`,
`tags`, `occurred_at` đủ để chia kệ.

**Hai tầng rõ:**

| Tầng | Nội dung |
|------|----------|
| Thư viện chung | Lịch gia đình (mọi `milestone` `visibility=family`), tìm, «Chưa neo ai», lối vào người |
| Không gian người đã mất | Thơ / hiện vật / điều nghe được + **chỉ** mốc đời có `heritage:{id}` |
| Trang nhẹ người sống | Hồ sơ + `@handle` + món đã neo về họ |

**`@handle`** là lớp người dùng; lưu vẫn `heritage:{uuid}`. Handle unique theo
`(space_id, handle)`. Người sống linked đồng bộ `User.handle`.

**Người mất đọc thư viện nhà:** chat đã dùng `family_milestones`; thêm
`family_shared_for_identities` khi Codex match người khác (không private).

## 3. Hình dung hub

```
Lịch gia đình     14 ngày · sắp tới…
Người được nhớ
  Bố Triệu @bo_trieu   18 thơ · 7 hiện vật · 9 điều nghe · 3 mốc đời
  …
Người nhà
  Tôi @me              2 món đã neo
  …
Chưa neo ai
```

## 4. Đã làm

**A–E** — lọc/kệ/hub theo người/Thêm/Điều nghe được. ✅

**F — Tách lịch + hub chung + @handle** ✅

- Hub luôn là cửa chính (không skip 1 người).
- Person shelf: `life` = mốc neo về người đó («Mốc đời»), không lặp lịch nhà.
- `IdentityProfile.handle` + `GET …/handles/{handle}` + sync User.
- Composer `@` gợi ý; tap `@handle` trên tin nhắn → trang nhẹ / memorial.
- Heritage: `meta.family_library_ids` khi cite món không mang `heritage:{self}`.

## 5. Chưa làm bây giờ

Tìm kiếm embedding. Album / thư mục tự do. Nhật ký riêng per-member sharing lists.
