# Extract — Project Plan

> **Vai trò:** công cụ **tách giọng / thu hoạch voice sample** từ audio nhiều người nói.  
> **Ngữ cảnh sản phẩm:** module phục vụ Forever Voice DNA (nhất là **giọng ký ức** khi không còn record 1:1).  
> **Hướng gắn kết:** có thể merge vào Forever như **sub-app / worker service** (không phải sản phẩm độc lập lâu dài).  
> **Người dùng đầu:** gia đình nội bộ; ít user; không cần realtime.

---

## 1. Vấn đề

Forever cần sample giọng sạch để xây Voice DNA (self + heritage).  
Với người còn sống: record trong app.  
Với người đã mất (vd. bố): không còn buổi 1:1 — chỉ còn **băng cũ** (xe, họp mặt, Zalo, đám cưới…).

Extract giải bài toán:

1. Nhận audio nhiều người  
2. Diarization (ai nói khi nào) với `num_speakers` biết trước  
3. Cắt segment theo speaker  
4. Người nhà **duyệt tay** → chọn đoạn đúng người → đưa vào `VoiceSample` heritage  

**Không** làm: nhận diện tên người tự động tin cậy 100%, ASR (phase sau), auto-clone, auto heritage chat.

---

## 2. Nguyên tắc (hard)

1. **Máy đề xuất, người quyết** — nhất là giọng người đã mất.  
2. Không gắn segment vào heritage Voice DNA khi chưa qua review.  
3. Tôn thủ steward/owner gate của Forever cho heritage voice.  
4. Giữ provenance: segment ← file gốc (+ timestamp start/end).  
5. Label heritage rõ trong Forever; không đánh tráo với giọng sống.  
6. Privacy: audio gia đình nhạy cảm — lưu theo `space_id`, có retention.

---

## 3. Phạm vi

### In scope (v0)

- Input audio (wav/mp3/m4a/…)  
- Normalize 16 kHz mono cho diarization; clip xuất theo sample rate gốc (≤48 kHz) để clone không mất chất giọng  
- Diarization: `pyannote/speaker-diarization-community-1`  
- `--num-speakers` (hoặc tương đương API) bắt buộc theo từng file  
- Merge gap / pad / drop fragment ngắn  
- Output: `speakers/SPEAKER_xx/*.wav` + `diarization.json`  
- CLI local để dev  

### Out of scope (v0)

- ASR / transcript  
- Enrollment embedding + nhận diện lại tên  
- Denoise nâng cao (có thể thêm sau, A/B cẩn thận)  
- On-device mobile inference  
- Realtime / streaming diarization  

### Sau này

- Job API trong Forever + UI review  
- `VoiceSample.source = extract`  
- Optional enhance trước clone  
- On-device khi đủ nhẹ (roadmap, không phải ưu tiên)

---

## 4. Kiến trúc đích

Local CLI hiện tại chỉ là **bản tạm để phát triển**. Engine chạy production trên **server** (hoặc sau này device).

```text
Forever mobile / admin
        │
        ▼
   Forever API  ── tạo ExtractJob (queued)
        │
        ▼
   Extract worker  (GCE CPU, 1 job tại một thời điểm)
        │  pyannote Community-1
        ▼
   Artifacts (segments + JSON)
        │
        ▼
   Review UI (steward) → VoiceSample → (sau) Clone ElevenLabs
```

### Runtime hiện tại

| Môi trường | Vai trò |
|------------|---------|
| Dev laptop / Mac | CLI tạm, debug |
| **GCE `*-standard-2`** (2 vCPU, ~8GB, no GPU) | Worker CPU production-lite |
| Mobile | Chỉ upload + review; **không** chạy model ở v0 |

### Kỳ vọng performance (standard-2)

- Không realtime; file 10–20 phút có thể mất vài–vài chục phút  
- **Một job đồng thời** (queue)  
- Giới hạn độ dài input hợp lý (đề xuất ≤30–60 phút / file lúc đầu)  
- Ưu tiên đúng & ổn định hơn tốc độ  

Khi scale (nhiều space / file dài): xét `standard-4` hoặc GPU nhỏ — chưa cần ngay.

---

## 5. Gắn vào Forever như sub-app

### Đề xuất cấu trúc monorepo

```text
Forever/
  apps/
    api/          # FastAPI — tạo job, lưu sample, voice DNA
    mobile/       # Expo — UX upload + review
    extract/      # <-- sub-app worker/CLI (thư mục Extract/ hiện tại)
  packages/
    api-client/
```

`apps/extract` (hoặc giữ `Extract/` rồi move):

- Package Python độc lập + entrypoint worker  
- Forever API **không** chạy diarization trong request HTTP sync  
- Giao tiếp: DB job row / queue + shared storage (local disk hoặc GCS)

### Hợp đồng với Voice DNA

1. Steward mở heritage VoiceProfile (Bố)  
2. “Lấy sample từ băng cũ” → upload/chọn memory audio  
3. Nhập số người nói  
4. ExtractJob chạy trên worker  
5. UI: nghe mẫu từng `SPEAKER_xx` → chọn “Đây là bố” → tick đoạn giữ/bỏ  
6. Đoạn giữ → `POST /voices/{id}/samples` với `source=extract`  
7. Metadata: `source_asset_id`, `t_start`, `t_end`, `speaker_label`  
8. Clone ElevenLabs chỉ khi đủ sample đã duyệt  

### Việc *không* gắn

- Không auto-feed chat heritage  
- Không TTS từ segment thô  
- Không bỏ bước review

---

## 6. Model & stack

| Thành phần | Chọn |
|------------|------|
| Diarization | `pyannote/speaker-diarization-community-1` |
| Audio I/O | ffmpeg |
| Runtime | Python 3.11+, PyTorch **CPU** trên GCE |
| Device hint | `mps`/`cuda` nếu có; production GCE = `cpu` |
| Auth model | Hugging Face token + chấp nhận điều khoản model |

Case khó (xe, 5 người, ồn): coi output là **bản nháp**.  
`num_speakers` giúp ổn định hơn nhưng không thay review.

---

## 7. Lộ trình

### Phase 0 — CLI nội bộ *(done)*

- Normalize → diarize → exclusive refine → cut  
- `diarization.json` + `clean|short|mixed`  
- Test unit cho merge/pad/exclusive/purity  

### Phase 1 — Worker local / GCE *(local done)*

- Entrypoint `extract-worker` poll Forever internal API  
- Artifact dưới `uploads/{space_id}/extract/{job_id}/`  
- Status: `queued | running | needs_review | failed | done`  
- Script: `scripts/run-extract-worker.sh`  

### Phase 2 — Forever API + UI tối giản *(done v1)*

- Endpoint tạo job + list segments + accept import  
- Màn review trong Voice DNA hub (steward)  
- Import vào `VoiceSample` (`source=extract` + provenance)  

### Phase 3 — Cứng hóa product

- Retention / xóa artifact  
- Giới hạn kích thước & duration  
- Optional denoise A/B  
- Metrics đơn giản (job success, thời gian, số sample import)

### Phase 4 — (Tuỳ chọn) On-device / nhanh hơn

- Chỉ khi server trở thành nút thắt hoặc privacy đòi hỏi  

---

## 8. CLI (Phase 0)

```bash
cd Extract  # hoặc apps/extract sau khi move
python -m venv .venv && source .venv/bin/activate
pip install -e .
export HF_TOKEN=hf_xxx

extract -i car.m4a -n 5 -o ./out/car
```

Xem thêm `README.md`.

---

## 9. Success criteria

1. Từ một băng cũ nhiều người, steward lấy được **vài đoạn sạch** đúng giọng người cần (vd. bố).  
2. Các đoạn đó vào được Forever Voice DNA heritage và phục vụ clone — sau khi gia đình nghe nhận “đúng hơi”.  
3. Không có đường tắt bỏ review.  
4. Chạy ổn trên GCE standard-2 với hàng đợi 1 job.  
5. Code nằm gọn như sub-app Forever, API/mobile chỉ orchestration + UX.

---

## 10. Open questions

- Move ngay `Extract/` → `apps/extract` trong PR hiện tại, hay giữ ngoài cho đến Phase 1 worker?  
- Artifact lưu local disk trên VM hay GCS bucket?  
- Có cho phép member upload băng, hay chỉ steward?  
- Ngưỡng tối thiểu số phút / số sample trước khi cho Clone?

---

## 11. Tài liệu liên quan

- Forever canonical plan: `docs/PROJECT.md` (Phase 0 thu thập giọng + Phase 4 Voice DNA)  
- Quickstart kỹ thuật: `Extract/README.md`
