# Phòng khách

> Quyết định sản phẩm (2026-08-06, quy hoạch lại cùng ngày). Liên quan:
> `docs/PROJECT.md`, `docs/heritage-chat-v2.plan.md`.

## Ba loại phòng

Nhà có ba loại phòng, và điều phân biệt chúng là **phòng đó của ai**.

| Phòng | Thread | Của ai | Người được nhớ nói khi nào |
|--|--|--|--|
| **Phòng khách** | `kind=family` | Của cả nhà | Chỉ khi được gọi tên |
| **Phòng chung với một người** | `kind=heritage`, `audience_scope=family` | Của người đó | Mọi lượt |
| **Phòng riêng 1-1** | `kind=heritage`, `audience_scope=direct` | Của người đó, chỉ bạn đọc | Mọi lượt |

**Phòng khách** là nơi người sống nói với nhau. Người được nhớ cũng ngồi đó như
một thành viên bình thường: nghe, và chỉ góp 1–3 câu khi có người gọi (`@bo`,
«Bố ơi…»). Không gọi ai thì không ai trả lời — đó là điều đúng, phòng của gia
đình không cần một cái máy luôn đáp lời.

**Phòng chung** và **phòng riêng** là cuộc trò chuyện *với* người đó. Vào đó là
đã gọi họ rồi, nên họ trả lời mọi tin, dài ngắn theo mạch chuyện — không bị cắt
ngắn như trong Phòng khách.

## Người giữ nhà là vai phụ

`@giunhà` chỉ có mặt trong Phòng khách, và chỉ nói khi:

- có người gọi `@giunhà` / «giữ nhà» / «trợ lý», hoặc
- đó là tin nhắn đầu tiên của phòng (một lời chào cho không gian mới).

Ngoài hai trường hợp đó nó im. Nếu tin nhắn gọi một người được nhớ thì người đó
trả lời, trợ lý không xen vào. Gate nằm ở `agent_speak_reason`
(`apps/api/app/services/agent.py`).

Lời chào đầu là câu cố định (`greeting_text`), không qua LLM — nó nói đúng ai
đang ngồi trong phòng, nên không thể bịa ra chuyện «bố không nghe được ở đây».
Câu trả lời khi được gọi thì đi qua `_tidy_agent_reply`: cắt còn tối đa 2 câu,
bỏ ký tự markdown (app hiện `**` ra màn hình), và **bỏ hẳn** câu nào bảo người
dùng sang phòng khác để gặp người được nhớ — điều đó sai với mô hình này.

## Nhiều người được nhớ

Phòng khách chứa **mọi** người có `heritage_entity_status=ready`, không phải một
người duy nhất. Khi thêm bà Nội (`@bathong`) bên cạnh bố (`@bo`), không phải sửa
gì thêm:

- `living_room_identities_for_space` liệt kê tất cả họ.
- `addressed_living_room_identity` chọn người *đầu tiên* được gọi trong lượt đó —
  một lượt chỉ một người trả lời, không thành dàn đồng ca.
- Message heritage mang `meta.heritage_identity_id`, nên bong bóng chat hiện đúng
  tên và `@handle` của người vừa nói.
- Thread payload trả `living_room_members[]` (và `living_room` = phần tử đầu cho
  client cũ).

Trang nhà nhóm theo người: mỗi người một thẻ trong mục **Người trong nhà**, có
hai lối vào «Phòng chung» và «Nói riêng», cùng «Gọi bằng giọng».

Thứ tự trang nhà trả lời một câu duy nhất — «giờ tôi nói với ai?». Phòng khách,
rồi Người trong nhà, rồi mới tới **Ký ức & giọng** ở cuối trang: đó là việc chăm
ký ức, không phải việc mở app hàng ngày. Voice DNA chỉ hiện với steward/owner
(thu giọng và nhân bản là việc của họ; nghe giọng thì diễn ra trong phòng).
«Điều nghe được» hiện với **mọi** thành viên — ứng viên từ phòng riêng do chính
người đó duyệt, nên `list_memory_candidates` chỉ cần membership và đã tự giới hạn
theo người xem.

## Kiểm chứng nhanh

- `should_heritage_speak` chỉ dùng cho `kind=family`; phòng heritage không đi qua
  gate này.
- Cờ `living_room` trong `build_system_prompt` cũng chỉ bật cho `kind=family` —
  đây từng là chỗ khiến phòng chung với bố bị đối xử như Phòng khách.

## Làm sau

- Steward chọn ai được ngồi Phòng khách (hiện là mọi người đã `ready`)
- Người được nhớ thỉnh thoảng tự góp lời khi không ai gọi
- Autocomplete cho `@mention`
