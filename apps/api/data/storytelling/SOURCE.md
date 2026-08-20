# Storytelling corpus — nguồn chữ

Dùng làm **đoạn đọc** để ghi giọng người được nhớ — truyện thơ hoặc kinh Phật.

## Truyện thơ (`category: classic`)

| Tác phẩm | Tác giả | Nguồn |
|----------|---------|--------|
| Truyện Kiều | Nguyễn Du | Wikisource (PD) |
| Lục Vân Tiên | Nguyễn Đình Chiểu | Wikisource (PD) |
| Phạm Công – Cúc Hoa | Dương Minh Đức Thị | Bản quốc ngữ gia đình (đã làm sạch để đọc) |
| Lưu Bình – Dương Lễ | Khuyết danh | Chờ chữ gia đình |
| Chiêu Quân Cống Hồ | Khuyết danh | Chờ chữ gia đình |

## Kinh Phật (`category: sutra`)

Bản dịch Việt hiện đại thường còn bản quyền — **không** nhúng sẵn. Steward dán từ kinh nhà / chùa (`POST …/stories/works/{slug}/import`, form=`prose`).

| Slug | Tác phẩm | Ghi chú nghi thức |
|------|----------|-------------------|
| `kinh_a_di_da` | Kinh A Di Đà | Phổ biến nhất (Tịnh Độ) |
| `kinh_pho_mon` | Kinh Phổ Môn | Bình an, tai qua nạn khỏi |
| `bat_nha_tam_kinh` | Bát Nhã Tâm Kinh | Ngắn, dễ thuộc |
| `kinh_dia_tang` | Kinh Địa Tạng | **Đã nhập** bản HT Thích Trí Tịnh (gia đình / Đạo Tràng Liên Hoa); «N lần» → nhắc lại |
| `kinh_duoc_su` | Kinh Dược Sư | **Đã nhập** bản HT Thích Trí Quảng (gia đình); «N lần» → nhắc lại |
| `kinh_vu_lan` | Kinh Vu Lan | Tháng 7 âm, báo hiếu |

Chunk: ~10 cặp lục bát / đoạn, hoặc ~500 ký tự văn xuôi. Tái tạo từ file dòng: `./scripts/rebuild-storytelling-chunks.py`.
