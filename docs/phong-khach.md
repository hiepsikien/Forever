# Phòng khách

> Quyết định sản phẩm (2026-08-06). Liên quan: `docs/PROJECT.md`, `docs/heritage-chat-v2.plan.md`.

## Định vị

**Phòng khách** là phòng cả nhà nói chuyện với nhau.

Người được nhớ (MVP: Bố) **nghe** cuộc nói chuyện và **thỉnh thoảng** góp vài câu — giống ngồi chung phòng thật, không phải chatbot trả lời mọi tin.

Không nhầm với thread `kind=family` + «Người giữ nhà» (onboard / trợ lý) — đó không còn là phòng chính của gia đình.

## Gần đây (MVP mẹ)

Hero «Phòng khách» trên trang nhà chỉ là **một link** mở thẳng phòng chat **Cả nhà** với Bố:

- thread `kind=heritage`, `audience_scope=family`, đã `chat_ready`
- tap → `/chat/{threadId}` của phòng đó

Chưa đổi pipeline chat, chưa cho Bố tự nghe / tự nói trong phòng chung, chưa đổi backend hay copy agent.

## Làm sau

- Bố (heritage) nghe context cả nhà; chỉ reply thưa thớt / khi được gọi
- Copy agent, seed, title API cho khớp metaphor
- Nhiều người được nhớ: steward chọn ai «ngồi» Phòng khách
