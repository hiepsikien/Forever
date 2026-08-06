# Nói với Bố bằng giọng — voice-to-voice

> Trạng thái: **kế hoạch**, chưa code dòng nào.
> Đọc cùng `docs/PROJECT.md` §7 Phase 4 và `docs/heritage-chat-v2.plan.md`.

## 1. Vì sao

Mẹ là người nhận đầu tiên, và mẹ **không chat được**. Bàn phím tiếng Việt trên
điện thoại với người ngoài bảy mươi là một rào cản đủ cao để bà không mở app lần
thứ hai. Nhưng nói thì bà nói được, và nghe thì bà nghe được — đó cũng chính là
lý do wedge của sản phẩm là voice (§4): *nói dễ hơn viết*.

Cả kho giọng đã dựng xong cho việc này mà chưa ai dùng được để trò chuyện. Voice
DNA clone được giọng bố, màn «Tạo câu nói» chứng minh TTS chạy end-to-end, chat
đã thu âm được. Thiếu đúng ba mắt, và cả ba nằm trên **đường chat**, không phải
trong Voice DNA.

## 2. Ba chỗ đứt

**Không có STT nào cả.** `Extract/` chỉ diarize bằng pyannote — biết ai nói đoạn
nào, không ra chữ (`Extract/PROJECT.md` ghi rõ ASR ngoài scope). Nên tin nhắn
giọng không có `body`, mà toàn bộ pipeline heritage đọc `user_message.body`.

**Heritage cố tình bỏ qua tin nhắn giọng.** `heritage_chat.py`:

```python
if getattr(user_message, "kind", "text") == "voice":
    return None
```

**Reply luôn là text.** Message heritage tạo với `kind="text"`,
`media_path=None`. TTS chưa bao giờ được gọi từ chat.

## 3. Quyết định đã chốt

**STT = Gemini inline audio.** Không thêm credential nào: `gemini_api_key` đã có,
và `heritage_gemini.call_gemini` nhận `contents: list[dict]` nên audio base64 đi
qua đúng transport đã có timeout / retry / *không bao giờ raise vào đường chat*.
Một provider mới cho việc này là chi phí không đổi lấy gì.

**Auto-play chỉ trong phiên «Gọi cho Bố».** `PROJECT.md` ghi «không auto-play».
Luật đó tồn tại để không ai bị giọng người đã mất tấn công bất ngờ — và nó vẫn
đúng. Nhưng khi mẹ vừa tự bấm nói, câu trả lời là thứ bà đang chờ, không phải cú
tập kích. Nên: auto-play **chỉ** cho reply của lượt bà vừa nói, **chỉ** trong màn
gọi. Không bao giờ khi mở màn, không bao giờ trong chat chữ, không bao giờ cho
tin nhắn cũ. Luật trong docs được siết lại theo đúng phạm vi này, không bị bỏ.

**Màn riêng, thread dùng chung.** Mẹ không phải đối diện UI chat. Nhưng bên dưới
vẫn là đúng thread cũ, nên cả nhà đọc được hội thoại và `memory_candidates` vẫn
chạy bình thường — không có đường dữ liệu thứ hai để bảo trì.

## 4. Làm theo bước, mỗi bước tự đứng được

Theo nếp repo: mỗi tầng một flag trong `config.py`, tắt được riêng.

### V0 — Nghe được thành chữ

`apps/api/app/services/stt.py` — `transcribe(settings, *, path, mime) -> Transcript`
(`text`, `provider`, `model`, `latency_ms`, `error`). Gemini nhận `inline_data`
base64 + prompt «ghi lại nguyên văn tiếng Việt, không dịch, không diễn giải; nghe
không rõ thì trả về rỗng». `thinkingBudget: 0` đã sẵn trong transport nên không
mất thời gian suy nghĩ cho một việc chép chính tả.

Chạy trong background job, không trong request upload — mẹ không nên chờ thanh
tiến trình sau khi thả tay. Kết quả ghi vào `meta.stt` và điền `Message.body` khi
caption trống.

Flag: `stt_enabled`, `stt_provider="gemini"`, `stt_model=""` (rỗng thì theo
`gemini_model`). Chặn file quá lớn trước khi base64.

*Dừng ở đây vẫn có giá trị:* cả nhà đọc được mẹ nói gì, và preview thread không
còn là `[Giọng nói]`.

### V1 — Bố trả lời tin nhắn giọng

Bỏ dòng skip. Có transcript thì chạy pipeline y như text — không nhánh nào riêng,
vì lúc này voice đã là text.

**Không nghe rõ thì không đoán.** Thêm một refusal `unheard`: Bố nói thẳng «bố
chưa nghe rõ, con nói lại giúp bố». Nghe sai câu hỏi rồi trả lời trôi chảy chính
là kiểu bịa nguy hiểm nhất — nó không vi phạm grounding check nào cả, vì câu trả
lời vẫn có cứ liệu, chỉ là cho một câu hỏi không ai hỏi. Refusal đi qua nhánh đã
có nên không ghi vào trí nhớ.

### V2 — Reply có giọng

Phần lõi của route `POST /api/voices/{voice_id}/tts` (`voice_dna.py`) tách ra
thành service dùng chung, để knob provider chỉ định nghĩa một chỗ. Gọi sau
`generate_heritage_reply`, lưu bytes, đặt `kind="voice"` + `media_path`, **giữ
nguyên `body` là text** — audio đi kèm chữ, không thay chữ. `meta.tts` ghi
provider / model / voice / số ký tự / độ trễ để còn gỡ được.

Không tạo `VoiceRender`: đó là sổ của steward ở lab giọng, reply chat không nên
trộn vào. Audio phục vụ qua `GET /api/messages/{id}/media` đã có.

Giọng chưa `ready` hoặc TTS lỗi → reply vẫn là text, không phải lỗi gửi. Flag
`heritage_tts_enabled`, **mặc định tắt**. Đây cũng chính là mục «TTS trong chat»
ở `PROJECT.md` §10 — một việc, không phải hai.

### V3 — Màn «Gọi cho Bố»

Route mới trong `apps/mobile/app/`, dùng lại `useAudioRecorder` +
`VOICE_RECORDING_OPTIONS` + `RecordingLevelMeter` (bản `large`) + `playLocalAudio`
+ `fetchAuthedMediaUri` — không có hạ tầng mới nào.

Một nút tròn to giữa màn, bốn trạng thái đọc được từ xa: *Chạm để nói → Đang
nghe con → Bố đang nghĩ → Bố đang nói*. Không bàn phím, không chip, không danh
sách tin nhắn.

**Chạm/chạm, không giữ.** Hold-to-talk bắt người dùng duy trì lực ấn suốt câu
nói; tay run hay đặt điện thoại xuống là mất câu. Chạm để bắt đầu, chạm để dừng
tha thứ hơn, và giống đúng cái chat đang làm.

Auto-play chỉ khi reply đến sau tin nhắn bà vừa gửi trong phiên này — theo dõi
bằng id tin nhắn đang chờ, không phải theo thời gian mở màn.

Nhãn «Ký ức của bố» đứng thường trực trên đầu. Hard rule 2 (phân biệt rõ người
sống và thực thể ký ức) khó hơn khi UI thành audio-only, nên nhãn phải là thứ
không cuộn đi đâu được. Không nhồi lời cảnh báo vào từng đoạn audio — nghe vài
lần là thành tiếng ồn và mất luôn tác dụng.

Chữ của cả hai bên vẫn hiện, cỡ lớn, để con cháu ngồi cạnh đọc theo được.

### V4 — Vá độ trễ

Gửi voice hiện **không** bật trạng thái «đang soạn» như gửi text — mẹ sẽ nhìn một
màn hình im lặng. Thêm state đó, cộng «nghe lại», lỗi mạng, và prefetch audio
ngay khi reply về.

## 5. Chỗ đáng lo, không phải chỗ khó code

**Độ trễ.** STT ~2s + pipeline ~5–10s + TTS ~3–6s ≈ **10–18 giây**. Với ẩn dụ
cuộc gọi thì đó là rất dài. V1–V3 chấp nhận con số này nhưng phải cho mẹ tín hiệu
liên tục; đo thật rồi mới quyết có cần TTS streaming từng câu hay không. Đừng trả
giá cho streaming trước khi biết mình đang chậm ở tầng nào.

**Chi phí.** Mỗi lượt là một lần STT cộng một lần TTS tính theo ký tự. Depth
control đã giữ reply ≤6 câu; thêm ngưỡng ký tự để reply dài bất thường ở lại dạng
chữ thay vì đọc.

## 6. Chưa làm bây giờ

TTS streaming, chen ngang khi Bố đang nói, tự dừng thu khi im lặng (VAD), STT
chạy trên máy, wake word. Và chạy golden live — đã hoãn có chủ ý để hoàn thiện
vòng lặp giọng trên local trước.
