# Quy hoạch lại trang Ký ức

> Trạng thái: **A–E đã ship** (mobile hub + kệ + Thêm + duyệt trong kệ).
> Tiếp: thời gian/dẫn chứng Điều nghe được; mốc đời + ảnh; Nhập tài liệu (Approve);
> lối vào Thư viện trang trọng trên Nhà; profile living đơn giản.
> Đọc cùng `docs/PROJECT.md` §10.
> Bối cảnh: Thư viện của "Nhà tôi ở Đền Lừ" đang có 48 món và đã khó dùng.

## 1. Trang này đang sai ở đâu

Không phải sai vì thiếu tính năng. Sai vì **một dòng chảy phẳng** phải chở bốn
loại nội dung đọc theo bốn cách khác nhau.

Đo trên dữ liệu thật:

| Loại | Số món | Có `occurred_at` | Thân bài trung bình |
|---|---|---|---|
| Thơ | 18 | 2 | 479 ký tự |
| Mốc đời | 14 | 12 | 91 ký tự |
| Điều nghe được | 9 | 0 | 114 ký tự |
| Video | 7 | 7 | 12 ký tự |

Ba hệ quả cụ thể:

**Thơ bị chôn xuống đáy.** Danh sách sắp theo `occurred_at desc` rồi mới tới
`created_at`, mà 16/18 bài thơ không có ngày. Nên thứ tự thực tế là: video 2026,
mốc đời lùi dần về 1940, rồi *toàn bộ* thơ và điều nghe được nằm cuối theo thứ tự
import. Phần nhiều giá trị nhất của bố lại là phần khó thấy nhất.

**Hai trục thời gian bị trộn làm một.** "Năm 1975 việc ấy xảy ra" và "hôm nay tôi
lưu món này" là hai chuyện khác nhau. Một bài thơ viết 2014 rơi vào giữa hai mốc
đời, và không có cách nào đọc 14 mốc đời liền mạch như một cuộc đời.

**Đã neo người nhưng không vào được bằng người.** Cả 48 món đều mang thẻ
`heritage:...`, nhưng không có màn nào theo người — thẻ là giàn giáo vô hình. Nhà
này đã có 6 identity; mỗi người thêm vào là dòng chảy phẳng thêm một lần rối.

Còn hai chỗ nữa, nhỏ hơn nhưng đáng ghi: không có tìm kiếm, và thẻ chủ đề
(`chu-de:gia_dinh`, `meter:luc_bat`) đã có trong dữ liệu mà chưa ai lọc được.

## 2. Nguyên tắc trước khi bàn màn hình

**Cấu trúc phải suy ra được từ dữ liệu, không bắt người dùng bảo trì.** Không
album, không thư mục, không tag tự do. Mẹ sẽ không dọn thư viện; `kind`,
`tags`, `occurred_at` đã đủ để tự chia kệ.

**Mỗi loại có một cách đọc riêng.** Mốc đời đọc dọc theo thời gian. Thơ đọc như
một tập. Ảnh/video xem theo lưới. Điều nghe được đọc như những dòng ngắn.

**Không thêm bước nào giữa người và ký ức.** Mỗi lớp điều hướng mới là một lần mẹ
có thể bỏ giữa đường.

## 3. Hình dung sau khi quy hoạch

Trang Ký ức thành một **hub theo người**, mỗi người một hàng có số đếm thật:

```
Bố Triệu    14 mốc đời · 18 bài thơ · 7 video · 9 điều nghe được
Mẹ Định     2 video
Chưa neo ai 0
```

Vào một người thì thấy **bốn kệ**, mỗi kệ một cách đọc:

1. **Dòng đời** — mốc đời xếp *tăng dần* theo `occurred_at`, nhóm theo thập kỷ.
   Đây là xương sống tiểu sử, và cũng chính là thứ chat truy hồi. Món thiếu ngày
   nằm cuối trong khu "chưa rõ năm", nhìn thấy được để còn bổ sung.
2. **Thơ** — lọc theo `chu-de:` và `meter:`, hiện tiêu đề cùng hai câu đầu.
3. **Hiện vật** — lưới ảnh/video/giọng, đã có thumbnail sẵn.
4. **Điều nghe được** — fact đã duyệt, đứng cùng hàng đợi chờ duyệt, vì chúng là
   một vòng đời. Nhóm theo tháng được thêm.

Thẻ ký ức đổi theo loại: mốc đời hiện năm to; thơ hiện hai câu đầu + thể thơ;
hiện vật hiện thumbnail; fact hiện một dòng + câu gốc trong hội thoại.

## 4. Làm theo bước, mỗi bước tự đứng được

**Bước A — lọc, tìm, và thẻ theo loại.** ✅ Chip lọc theo kệ, ô tìm, `MemoryKindCard` theo loại.

**Bước B — tách hai trục thời gian.** ✅ Dòng đời `occurred_at` asc + thập kỷ; kệ khác `created_at` desc (`libraryShelves.ts`).

**Bước C — hub theo người.** ✅ `library/[spaceId]/index` + `person/[identityId]`; hàng «Chưa neo ai».

**Bước D — thêm mốc đời và thêm thơ từ trong app.** ✅ Một nút Thêm → sheet; `POST …/memories/note` nhận `kind=milestone|poem`.

**Bước E — gộp hàng đợi duyệt vào kệ Điều nghe được**, chip «Chỉ mình tôi». ✅

## 5. Chưa làm bây giờ

Tìm kiếm bằng embedding. 48 món thì tìm theo chữ là đủ, và `retrieve_learned` cho
thấy chấm điểm theo từ vẫn đang làm tốt việc của nó. Chờ tới lúc thật sự tìm không
ra thì hãy trả giá cho vector store.
