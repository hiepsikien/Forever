# Voice DNA — chọn mẫu để clone (đề xuất, chưa implement)

> **Trạng thái:** draft — để test & nghĩ thêm. Chưa sửa code.
> **Ngày:** 2026-08-03
> **Bối cảnh:** Tab "Sẵn sàng clone" gây hiểu nhầm (không có nút Clone trong đó), và kho mẫu đã duyệt bị chặn cứng ở 3 mẫu vì clone lấy toàn bộ `processed`.
> **Use case thúc đẩy:** một người có cả video bố ~20 năm trước và video 1–2 tháng trước → nhiều mẫu tốt thuộc hai "kỷ nguyên giọng", nhưng mỗi lần clone chỉ dùng 1–3 mẫu.

## 1. Quyết định hướng đi

**Chốt: 2 tab, chọn mẫu ngay trong tab 2 để clone.** Không thêm tab thứ 3.

| Tab | Tên | Vai trò |
|-----|-----|---------|
| 1 | **Chưa xử lý** | Inbox: nghe, normalize, ghép, duyệt |
| 2 | **Đã duyệt** | Kho mẫu tốt (không giới hạn) + chọn 1–3 → **Clone** |

Lý do không làm tab 3 ("đội hình clone"):

- Màn Mẫu giọng đã có checkbox multi-select — chỉ cần thêm nút clone.
- Ít bước hơn, phù hợp mobile-first (mẹ là người dùng đầu).
- Quy mô gia đình vài chục mẫu, chưa cần quản lý nhiều "bộ clone" song song.
- Tab 3 gần như duplicate tab 2 nếu chỉ là danh sách + nút Clone.

Tab 3 chỉ đáng làm nếu sau này cần lưu và chuyển qua lại nhiều lineup có tên (vd. "giọng trẻ 2006" vs "giọng gần đây"). Hiện tại dùng ghi chú + badge trên từng mẫu là đủ.

## 2. Luồng hiện tại (đọc từ code)

### Stage

`VoiceSample.pipeline_stage` ∈ `unprocessed` | `processed` | `archived`.
`_effective_stage()` coi null/không hợp lệ là `processed` (legacy data).

### Stage vào theo nguồn

`apps/api/app/routers/voice_dna.py` — `add_sample`:

```python
pipeline_stage = "unprocessed" if source == "extract" else "processed"
```

| Nguồn | Stage vào |
|-------|-----------|
| `record` | `processed` |
| `upload` | `processed` |
| `memory` | `processed` |
| `extract` | `unprocessed` |
| `combine` (ghép) | `unprocessed` |
| `process` (normalize) | `unprocessed` |

### Điều kiện unlock action

| Action | Endpoint | Điều kiện |
|--------|----------|-----------|
| Xử lý (normalize) | `POST /samples/process` | ≥1 chọn · toggle normalize bật · tất cả `unprocessed` |
| Ghép | `POST /samples/combine` | ≥2 chọn · tất cả `unprocessed` · tổng ≤10 phút · output ≤25MB |
| Duyệt | `PATCH /samples/{id}` · `POST /samples/bulk-stage` | ≥1 chọn ở tab `unprocessed` |
| Loại | `POST /samples/bulk-stage` | ≥1 chọn |
| **Clone** | `POST /voices/{id}/clone` | `processed_count` 1–3 · tổng ≤150s · có API key · voice ≠ `paused` |

Hằng số: `CLONE_MAX_SAMPLES = 3`, `CLONE_TARGET_DURATION_MS = 120_000`, `CLONE_MAX_DURATION_MS = 150_000`.

### Clone lấy mẫu nào

`clone_voice` **không nhận danh sách** — lấy toàn bộ mẫu `processed`:

```python
processed = [s for s in samples if _effective_stage(s) == "processed"]
if len(processed) > CLONE_MAX_SAMPLES:
    raise HTTPException(400, "IVC tốt nhất với 1–3 mẫu sạch … Loại bớt mẫu kém hoặc archive trước khi clone.")
```

### Stepper ở hub

`STEP_LABELS = ["Thu thập", "Duyệt", "Clone", "Nói"]`

`stepDone = [có ≥1 sample, processed ≥ 1, status === "ready", status === "ready"]`

## 3. Vấn đề phát hiện

1. **`processed` gánh hai nghĩa** — vừa là "kho mẫu tốt", vừa là "input lần clone". Vì clone lấy hết `processed`, cả kho bị chặn ở 3 mẫu / 2,5 phút. Message lỗi bảo người dùng *archive mẫu tốt* để clone được → churn archive/unarchive.

2. **`upload` / `memory` bỏ qua bước duyệt** — vào thẳng `processed`, nên step "Duyệt" ở stepper tự sáng ✓ ngay sau upload, và file chưa nghe lại đã chiếm slot trong 3 mẫu.

3. **`archived` là đường một chiều** — không tab nào hiển thị mẫu đã loại, `sample_count` cũng loại ra. Archive để lách giới hạn 3 = mẫu tốt biến mất khỏi UI.

4. **Mọi thay đổi hạ `ready` → `draft`** — `_invalidate_clone_if_ready` chạy khi đổi stage, xóa sample, hoặc thêm sample mới. Thêm một mẫu tốt vào kho là bị đòi clone lại, dù bộ mẫu đã clone không đổi.

5. **Sẽ có hai entry point clone** sau khi thêm nút ở tab 2 (hub + Mẫu giọng) → cần định nghĩa rõ nút hub làm gì.

## 4. Phương án

**Ý tưởng trung tâm: `clone` nhận `sample_ids` tường minh.** Khi đó `processed` trở lại đúng nghĩa "Đã duyệt" (kho không giới hạn), còn cap 3 mẫu / 2,5 phút chỉ áp lên **lựa chọn của lần clone này**.

### 4.1 Backend

- `CloneBody` thêm `sample_ids: list[str] | None`.
  - Có truyền: mọi id phải thuộc voice, stage `processed`, số lượng 1–`CLONE_MAX_SAMPLES`, tổng ≤ `CLONE_MAX_DURATION_MS`.
  - Không truyền: fallback `last_clone_sample_ids` (lọc id còn tồn tại + còn `processed`); nếu chưa có mà `processed ≤ 3` thì giữ hành vi cũ; ngược lại 400 kèm hướng dẫn "vào Mẫu giọng → Đã duyệt → chọn 1–3 mẫu".
- Thêm `VoiceProfile.last_clone_sample_ids` (TEXT, JSON array) + `last_cloned_at`; cập nhật sau clone thành công.
- Migration qua `apps/api/app/schema_patch.py::ensure_schema()` (repo chưa dùng Alembic).
- **Thu hẹp `_invalidate_clone_if_ready`**: chỉ hạ `ready` khi sample bị ảnh hưởng nằm trong `last_clone_sample_ids`. Thêm mẫu mới không còn phá clone đang dùng. *(behavior change — cần test)*
- `_voice_payload` trả thêm: `last_clone_sample_ids`, `clone_max_samples`, `clone_max_duration_ms` (để mobile không hardcode số 3).
- Đổi stage vào của `upload` / `memory` → `unprocessed`. `record` giữ `processed` (đã đọc theo script gợi ý).

### 4.2 `packages/api-client`

- `VoiceProfile`: thêm `last_clone_sample_ids?`, `last_cloned_at?`, `clone_max_samples?`, `clone_max_duration_ms?`.
- `cloneVoice(voiceId, { sample_ids?, remove_background_noise? })`.

### 4.3 Mobile — `samples.tsx`

- Tab 2 đổi tên **"Đã duyệt"** (bỏ "Sẵn sàng clone"); nút bulk tab 1 → "Duyệt → Đã duyệt".
- Tab 2 thêm nút **"Clone giọng (N mẫu)"**: bật khi chọn 1–3 mẫu và tổng ≤2,5 phút.
- Quá giới hạn → disable + dòng giải thích inline ("Chọn tối đa 3 mẫu · tổng ≤2,5 phút"), **không** dùng `Alert`.
- Badge "Đã dùng clone" cho mẫu ∈ `last_clone_sample_ids` — đây là chỗ phân biệt bộ giọng trẻ vs giọng gần đây.
- Thêm action "Trả về Chưa xử lý" ở tab 2 (hiện không có đường về để normalize lại mẫu đã duyệt).

### 4.4 Mobile — `index.tsx` (hub)

- `canClone`: bỏ chặn trên, chỉ cần `processedCount >= 1`.
- Nút hub → "Clone lại bộ lần trước" khi có `last_clone_sample_ids`; chưa có thì primary action = "Chọn mẫu để clone" → điều hướng tab Đã duyệt.
- Gỡ nhánh "Giảm số mẫu" trong `primaryAction` và câu "giữ tối đa 3 trước khi clone" trong `statusSummary` — không còn đúng.
- `goStep(2)`: đi tới tab Đã duyệt thay vì clone mù.

## 5. Mặc định đã chốt (chỉnh được)

| Điểm | Quyết định | Lý do |
|------|-----------|-------|
| Upload / Thư viện vào stage nào | `unprocessed` | Chất lượng dao động nhiều nhất (băng cũ, video 20 năm trước) → bước duyệt có giá trị thật |
| Nút Clone ở hub | "Clone lại bộ lần trước" (`last_clone_sample_ids`); chưa có → điều hướng | Giữ one-tap re-clone mà không mơ hồ "clone cái gì" |
| Xem lại mẫu `archived` | Để sau | Khi clone nhận `sample_ids`, archive không còn là công cụ lách giới hạn → độ gấp giảm |

## 6. Thứ tự implement

1. Backend: `sample_ids` + `last_clone_sample_ids` + thu hẹp invalidate (tương thích ngược, app cũ vẫn chạy).
2. `packages/api-client`: type + `cloneVoice`.
3. `samples.tsx`: copy + nút clone tab 2 + badge.
4. `index.tsx`: gỡ gate cũ, sửa primary action + stepper.
5. Cuối cùng: đổi stage vào của `upload` / `memory` — chạm dữ liệu đang có.

## 7. Checklist test

- [ ] Clone với 1 / 2 / 3 mẫu chọn → thành công; 4 mẫu → 400 rõ nghĩa
- [ ] Tổng >2,5 phút → chặn, message nói đúng con số
- [ ] Kho `processed` 10 mẫu, chọn 2 → clone được (trước đây bị chặn)
- [ ] Clone không truyền `sample_ids` + có lineup cũ → dùng lại lineup
- [ ] Clone không truyền `sample_ids` + chưa có lineup + `processed ≤ 3` → hành vi cũ
- [ ] Thêm sample mới khi voice `ready` → **không** hạ về `draft`
- [ ] Xóa / archive mẫu **trong** lineup → hạ về `draft`
- [ ] Legacy sample (`pipeline_stage` null) vẫn được coi là `processed`
- [ ] Mẫu `unprocessed` bị từ chối nếu truyền vào `sample_ids`
- [ ] Badge "Đã dùng clone" hiện đúng sau clone
- [ ] Stepper: upload xong step "Duyệt" **chưa** sáng ✓ (sau khi đổi stage vào)

## 8. Còn để mở

- Có cần đặt tên cho lineup (vd. "giọng trẻ ~2006") thay vì chỉ ghi chú từng mẫu?
- Có nên lưu lịch sử clone local (hiện `clones.tsx` đọc từ ElevenLabs, không có bảng local) để biết bộ mẫu nào tạo ra bản clone nào?
- Ngưỡng 3 mẫu / 2,5 phút có nên đọc từ config theo space thay vì hằng số?

## Liên quan

- `docs/PROJECT.md` — Phase 4 Voice DNA
- `Extract/README.md` — nguồn mẫu từ băng dài (diarization → segment review)
- `AGENTS.md` — không auto-attach segment vào heritage Voice DNA mà thiếu human review
