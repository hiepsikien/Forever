# Backlog — Mời vào nhà / tham gia gia đình

> Ghi nhận từ trao đổi 21/8/2026. Chưa lên lịch triển khai.

## Bối cảnh hiện tại

- Owner tạo mã mời: `POST /api/spaces/{space_id}/invites` (Cài đặt → «Tạo mã mời»).
- Người mới nhập mã: màn `/invite` → `POST /api/spaces/join` với `{ code }`.
- Mã hết hạn sau **14 ngày**; owner có thể **Thu hồi** từng mã (`/invites/{code}/revoke`).
- **Vào nhà ngay** khi mã hợp lệ — chưa có bước admin duyệt.
- **Chưa có QR**; app đã có quyền `CAMERA` (Android) và URL scheme `forever` / `forever-dev`.

## Hành vi cần sửa (nợ hiện tại)

Mỗi lần bấm «Tạo mã mời» sinh **mã mới** nhưng **không huỷ mã cũ**:

- Nhiều mã cùng space có thể còn hiệu lực song song.
- UI chỉ hiện mã vừa tạo; mã cũ vẫn join được nếu ai còn giữ.
- Thu hồi thủ công chỉ áp mã đang hiển thị trên màn hình.

**Hướng xử lý (chọn một khi làm):**

1. Tạo mã mới → tự huỷ mọi mã cũ cùng space; hoặc
2. Danh sách mã đang mở + thu hồi từng cái / thu hồi tất cả.

## Backlog tính năng

### 1. QR mời vào nhà

| | |
|---|---|
| **Mục tiêu** | Mẹ/con quét QR thay vì gõ mã 8 ký tự. |
| **Owner** | Sau khi tạo mã, hiện QR (và giữ nút copy/chia sẻ mã). |
| **Người tham gia** | Màn `/invite`: nút «Quét QR» → camera đọc mã. |
| **Payload QR** | Chỉ mã (`AB12CD34`) hoặc deep link `forever://invite?code=…` (dev: `forever-dev://…`). |
| **Backend** | Có thể giữ API join hiện tại nếu QR chỉ mang `code`. |
| **Phụ thuộc** | `expo-camera` (hoặc tương đương) + thư viện render/parse QR. |

**Lưu ý:** QR không an toàn hơn gửi mã qua Zalo — ai quét được đều có «vé». Bảo vệ thực sự nằm ở bước duyệt (mục 2) và thu hồi mã.

### 2. Admin duyệt trước khi vào nhà

| | |
|---|---|
| **Mục tiêu** | Không auto-join khi mã/QR hợp lệ; owner (hoặc moderator) duyệt từng người. |
| **Áp dụng** | Cả nhập tay lẫn quét QR — sau validate mã, tạo **yêu cầu chờ** thay vì `Membership` ngay. |
| **API (gợi ý)** | Bảng `join_requests`; `POST /join` → pending; `GET` danh sách chờ; `POST …/approve` / `…/reject`. |
| **Mobile** | Màn chờ duyệt cho người xin vào; Cài đặt (hoặc section riêng) cho owner duyệt/từ chối. |
| **Tuỳ chọn** | Thông báo in-app (push sau) khi có yêu cầu mới. |

### 3. Gắn với mục «nợ hiện tại»

Khi làm QR + duyệt, nên xử lý luôn **nhiều mã song song** (mục trên) để owner biết còn bao nhiêu «cửa» đang mở.

## Thứ tự gợi ý khi triển khai

1. Sửa hành vi mã mời (một mã active / danh sách + thu hồi).
2. Luồng join request + duyệt admin (thay instant join).
3. QR hiển thị + quét camera (client-only nếu bước 2 đã có).

## Tham chiếu code

- API: `apps/api/app/routers/spaces.py` (`create_invite`, `join_space`, `revoke_invite`)
- Model: `apps/api/app/models.py` (`Invite`)
- Mobile: `apps/mobile/app/invite.tsx`, `apps/mobile/app/settings/[spaceId].tsx`
- Client: `packages/api-client` — `createInvite`, `joinSpace`, `revokeInvite`
