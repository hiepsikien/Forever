# Forever Pro — camera Ezviz (future)

> Trạng thái: **Chưa bắt đầu** — backlog sản phẩm, ghi nhận sau thảo luận 2026-08.
> Đọc cùng `docs/PROJECT.md`, `docs/voice-to-voice.plan.md`.

## 1. Vì sao (và vì sao không vội)

Gia đình đã **gọi video người sống bằng Zalo** — tích hợp WebRTC (Daily/LiveKit)
trong app là **nice to have**, không phải lý do mua Pro.

**Forever Pro** nên neo vào thứ Zalo không có trong bối cảnh Forever:

- Xem **camera Ezviz** (live + nói 2 chiều qua mic/loa camera) **trong cùng app**
  với Thư viện, chat Bố/Bà, Voice DNA.
- Bản **Forever** (thường): giữ scope hiện tại; **ẩn / 403** tính năng Pro bằng tier
  trên `FamilySpace` — không fork app, không xóa code.

Thiết bị tham chiếu: **Ezviz C1C**, serial dạng `G10041709` (camera trong nhà, cắm
điện, 1080p, mic + loa, Two-Way Talk trong app Ezviz).

## 2. Những gì đã chốt (không làm)

| Ý tưởng | Quyết định |
|---------|------------|
| Camera thay điện thoại làm interface Forever cho mẹ | **Không** — C1C không chạy app; mẹ vẫn cần **tablet/phone Forever** cho `/call` Bố và nhận gọi |
| Ghi cuộc gọi + STT mặc định | **Không** — chưa có use case rõ; Zalo đủ cho gọi hàng ngày |
| STT cuộc gọi Pro (Daily transcription) | **Backlog / bỏ** — nếu sau này cần lưu ký ức: **opt-in** «Lưu vào Thư viện», không auto |
| Gọi video người sống (Daily.co) | **Nice to have, ưu tiên thấp** — cả nhà dùng Zalo |
| RTSP-only làm xem từ xa | **Không đủ** — RTSP local; xem xa cần **Ezviz Open Platform** |
| API Ezviz không chính thức (pyEzviz) | **Không** production |

## 3. Kiến trúc đề xuất (khi làm)

### 3.1 Forever Pro tier

- Flag trên space (ví dụ `space_settings.pro_tier` hoặc billing sau này).
- Mobile + API: `require_pro` cho route camera; bản thường không thấy entry.

### 3.2 Ezviz — đường chính thống

```
App Forever (Pro)  →  API Forever  →  Ezviz Open Platform  →  C1C (cloud)
        ↑                                    ↑
   SDK native / H5                    AppKey + accessToken
   live view + Two-Way Audio          (tài khoản Ezviz đã link device)
```

**Open Platform** ([ezviz.com/developer](https://www.ezviz.com/developer/index)):

- Live View (HLS / FLV / SDK).
- **Two-Way Audio** (half/full duplex) — mic/loa camera, giống app Ezviz.
- Capture snapshot (tuỳ chọn).
- Free developer tier ~ **3 kênh đồng thời** — đủ 1 camera gia đình.

**Không** dùng RTSP cho Pro xem xa. RTSP (`rtsp://admin:VERIFICATION_CODE@IP:554/…`)
chỉ khi server/app **cùng LAN** với camera; bật trong app Ezviz: *Cài đặt → LAN
Live View → Local Service Settings → RTSP*.

### 3.3 Vai trò thiết bị tại nhà mẹ

| Thiết bị | Vai trò |
|----------|---------|
| **Tablet / phone Forever** | Mẹ ↔ Bố (AI) qua `/call`; interface chính |
| **C1C Ezviz** | Con (Pro) **xem live + bấm mic** nói vào phòng — passive từ phía mẹ |
| **Zalo** | Gọi video mẹ ↔ con hàng ngày — **ngoài scope Pro MVP** |

### 3.4 Latency VN

- Ezviz cloud: chấp nhận **~2–5s** (HLS) cho xem passive — không cần realtime như gọi.
- Nếu sau này làm Daily call: pin region **Singapore** (`ap-southeast-1`).

## 4. Blocker hiện tại

Chưa có quyền Ezviz từ anh trai (chủ tài khoản / camera). Cần một trong:

- Share device C1C sang tài khoản steward Forever, hoặc
- Tài khoản phụ + quyền xem/nói.

**Không cần** pass WiFi nhà. Serial tham chiếu: `G10041709`.

Có thể làm trước khi có camera: tier flag, UI placeholder, đăng ký Open Platform
(AppKey/Secret).

## 5. Phạm vi MVP Pro (khi ưu tiên)

1. `require_pro` + màn **「Camera nhà」** trên space home.
2. Link Ezviz (OAuth / token server-side) — steward only.
3. Live view + nút mic (Two-Way Talk) qua SDK hoặc embed H5.
4. Metadata log: *ai mở xem, lúc nào* — **không** ghi video mặc định.
5. Sleep mode / nhắc quyền riêng tư — mẹ đồng ý camera trong phòng khách.

**Không** trong MVP: Daily call, STT cuộc gọi, ghi hình cloud Ezviz vào Thư viện.

## 6. Quyền riêng tư (hard)

- Camera luôn bật = nhạy cảm; mẹ phải **biết và đồng ý**.
- Chỉ steward / member Pro được xem; không public link.
- Ưu tiên **xem khi cần**, không surveillance 24/7 trong UX copy.

## 7. Lộ trình gợi ý

```
P0  Forever Pro flag + ẩn tính năng bản thường
P1  Ezviz Open Platform — link account + live + mic (1× C1C)
P2  (Tuỳ chọn) snapshot → MemoryItem, opt-in
—   Gọi người sống Daily     ← nice to have, sau hoặc không
—   STT / ghi cuộc gọi       ← chỉ nếu có nút «Lưu vào ký ức»
```

## 8. Tham chiếu kỹ thuật

- Ezviz Open Platform SDK: Live View, Two-Way Audio — FAQ 428, developer index.
- C1C: RTSP supported (local); cloud protocol proprietary.
- Forever STT hiện tại (`app/services/stt.py`): dành cho **heritage / voice note**,
  không dùng cho Pro call trừ khi có opt-in ghi âm.
