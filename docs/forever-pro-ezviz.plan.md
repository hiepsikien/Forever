# Forever Pro — Phòng Xem nhà (Ezviz)

> Trạng thái: **Phase 1 xong** (2026-08-25) — xem live HLS qua Ezviz Open Platform.
> Phase 2 (mic 2 chiều qua loa camera) chưa bắt đầu.
> Đọc cùng `docs/PROJECT.md`, `docs/voice-to-voice.plan.md`.

## 1. Vì sao (và vì sao không vội Phase 2)

Gia đình đã **gọi video người sống bằng Zalo** — tích hợp WebRTC (Daily/LiveKit)
trong app là **nice to have**, không phải lý do mua Pro.

**Forever Pro · Phòng Xem nhà** neo vào thứ Zalo không có trong bối cảnh Forever:

- Xem **camera Ezviz** (live; sau này + nói 2 chiều qua mic/loa camera) **trong cùng app**
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
| Phòng Xem nhà là thread chat | **Không** — tiện ích cấp space, không heritage / memory candidates |

## 3. Kiến trúc (đã triển khai Phase 1)

### 3.1 Forever Pro tier

- `space_settings.pro_tier` — steward bật trong Cài đặt → AI.
- `require_pro()` trên API stream; tile space home chỉ hiện khi `pro_tier`.

### 3.2 Ezviz — đường chính thống

```
App Forever (Pro)  →  API Forever  →  Ezviz Open Platform  →  C1C (cloud)
        ↑                                    ↑
   expo-video HLS                    AppKey + accessToken (env)
   /view-home/{spaceId}             + device serial (settings)
```

**Open Platform** ([ezviz.com/developer](https://www.ezviz.com/developer/index)):

- Live View HLS (`protocol=2` qua `/api/lapp/v2/live/address/get`).
- **Two-Way Audio** (Phase 2) — cần native SDK, không làm bằng HLS thuần.
- Free developer tier ~ **3 kênh đồng thời** — đủ 1 camera gia đình.

**Env server** (production):

- `EZVIZ_APP_KEY`, `EZVIZ_APP_SECRET` — từ Open Platform.
- `HOME_CAMERA_ENABLED=true` (mặc định bật; tắt = 404 toàn route).

**Cấu hình theo nhà** (`space_settings.home_camera_json`, steward PATCH settings):

| Trường | Ý nghĩa |
|--------|---------|
| `enabled` | Bật xem live |
| `device_serial` | Serial C1C |
| `channel_no` | Kênh (thường 1) |
| `verify_code` | Mã trên máy — **không** trả về client |
| `room_label` | Nhãn UI («Phòng mẹ») |
| `consent_at` / `consent_by` | Steward xác nhận mẹ đồng ý |

### 3.3 Routes

| Layer | Path |
|-------|------|
| Mobile | `/view-home/[spaceId]` — player HLS |
| Space home | Tile **Phòng Xem nhà** (khi Pro) |
| API status | `GET /api/spaces/{id}/home-camera` |
| API stream | `GET /api/spaces/{id}/home-camera/stream` → `{ url, expires_at }` |
| Audit | Bảng `home_camera_view_logs` — ai mở, lúc nào (không ghi video) |

### 3.4 Vai trò thiết bị tại nhà mẹ

| Thiết bị | Vai trò |
|----------|---------|
| **Tablet / phone Forever** | Mẹ ↔ Bố (AI) qua `/call`; interface chính |
| **C1C Ezviz** | Con (Pro) **xem live** phòng mẹ — passive; Phase 2: bấm mic nói vào phòng |
| **Zalo** | Gọi video mẹ ↔ con hàng ngày — **ngoài scope Pro MVP** |

### 3.5 Latency VN

- Ezviz cloud HLS: chấp nhận **~2–5s** cho xem passive — không cần realtime như gọi.

## 4. Blocker vận hành (chưa có trên prod)

Chưa có quyền Ezviz từ anh trai (chủ tài khoản / camera). Cần một trong:

- Share device C1C sang tài khoản đã đăng ký Open Platform, hoặc
- Tài khoản phụ + quyền xem trên cloud Ezviz.

**Không cần** pass WiFi nhà. Serial tham chiếu: `G10041709`.

**Steward checklist sau deploy:**

1. Đặt `EZVIZ_APP_KEY` / `EZVIZ_APP_SECRET` trên API.
2. Cài đặt → AI → bật **Forever Pro**.
3. Nhập serial + mã xác minh C1C, nhãn phòng.
4. Bấm **Xác nhận mẹ đồng ý camera**.
5. Bật **Bật xem live** → thử `/view-home`.

## 5. Phạm vi đã ship (Phase 1)

1. `pro_tier` + `home_camera_json` trên `SpaceSettings`.
2. Tile **Phòng Xem nhà** trên space home (Pro).
3. Màn `/view-home` — HLS qua `expo-video`.
4. API proxy Ezviz token + live URL server-side.
5. Audit metadata xem.
6. Cài đặt steward: Pro toggle, camera, consent.

**Chưa ship:** Two-Way Talk, PiP trên `/call`, snapshot → Thư viện.

## 6. Quyền riêng tư (hard)

- Camera luôn bật = nhạy cảm; mẹ phải **biết và đồng ý** (`consent_at` bắt buộc trước stream).
- Chỉ member Pro space được xem; không public link.
- Ưu tiên **xem khi cần**, không surveillance 24/7 trong UX copy.

## 7. Lộ trình tiếp theo

```
✓  P1  Ezviz Open Platform — link device + live HLS (1× C1C)
P2  Two-Way Talk — native SDK, dev build
P3  (Tuỳ chọn) PiP trên /call; snapshot opt-in → MemoryItem
—   Gọi người sống Daily     ← nice to have, sau hoặc không
```

## 8. Tham chiếu kỹ thuật

- Code: `apps/api/app/routers/home_camera.py`, `services/home_camera_ezviz.py`,
  `services/home_camera_config.py`, `apps/mobile/app/view-home/[spaceId].tsx`.
- Tests: `apps/api/tests/test_home_camera.py`.
- Ezviz: `POST /api/lapp/token/get`, `POST /api/lapp/v2/live/address/get` (protocol 2 = HLS).
- C1C: RTSP supported (local only); cloud = Open Platform.
