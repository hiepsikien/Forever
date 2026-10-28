# Nói với Bố bằng giọng — voice-to-voice

> Trạng thái: **V0–V4 đã code** trên `cursor/voice-to-voice`. Layout Gọi + chọn
> clone/setting chat TTS (`tts_prefs` / «Dùng cho Gọi») đã bổ sung.
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

Một nút tròn to giữa màn, bốn trạng thái đọc được từ xa: *Giữ để nói → Đang
nghe con → Bố đang nghĩ → Bố đang nói*. Không bàn phím, không chip, không danh
sách tin nhắn.

**Hold-to-talk.** Chạm/chạm để lại mic mở nếu quên tắt — với mẹ đó dễ hơn việc
giữ nút suốt câu. Giữ để ghi, thả tay để gửi; vuốt lên (Gọi) / vuốt trái (chat)
để huỷ. Nhấn nhầm dưới 0,5s bị bỏ. Tối đa 60s rồi tự gửi. Chat chữ cùng một
kiểu; ghi sample Voice DNA vẫn bấm để bắt đầu/dừng vì đoạn đọc dài.

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

## 7. Nhận người nói trên Gọi

Hướng đã khớp sản phẩm (PR nhận giọng): gallery đóng, tách khỏi clone Voice
DNA, process embed riêng cạnh Extract, giọng thắng chữ, chữ không ghi vector,
tắt `speaker-id` thì Gọi vẫn trả lời theo tài khoản. Embed chạy trước, song
song với STT. «X đây» đọc local ngay khi có chữ.

**Hai cửa, không phải một.** Xưng hô giữ cosine 0,60
(`speaker_match_threshold`) và cách người thứ hai 0,10
(`speaker_match_margin`): thà giữ tài khoản còn hơn gọi nhầm người. Dưới cửa
đó giọng không đặt `speaker_user_id`. Câu tự xưng (`reason` "words") vẫn đặt
được người được xưng hô và không bao giờ ghi dấu.

Kéo dấu giọng là cửa khác: `speaker_self_enroll_threshold` 0,45. Số này tạm,
cho đến khi dry-run in cosine thật của đoạn Gọi với từng mỏ neo. Một lượt chỉ
trộn vào dấu **đã có** của tài khoản đang đăng nhập khi clip không ngắn, không
lẫn tiếng, tài khoản đã có dấu, tài khoản là ứng viên gần nhất, và cosine ≥
0,45. Không đòi thêm cách 0,10. Không ghi sang người khác ở ngưỡng này — đoạn
của mẹ trên máy con không được kéo dấu của con. Không tạo dấu mới từ lượt Gọi.
Không ghi `VoiceSample`. Khớp chắc (`reason` "match") vẫn xưng người đó và chỉ
trộn dấu đã có của họ.

`rebuild-speaker-prints.py` không `--commit` in cosine của từng đoạn Gọi so
với từng mỏ neo (user id và điểm). Gán đoạn hạt giống dùng cùng cửa tự ghi:
đoạn chưa tin cậy vào thùng của tài khoản khi tài khoản đã có mỏ neo, mỏ neo
gần nhất là đúng người đó, và cosine ≥ 0,45, dù dưới 0,60. Gần người khác hơn
thì chỉ vào khi khớp chắc 0,60 và cách 0,10. Không bịa dấu cho tài khoản chưa
có mỏ neo.

**Cửa hai giọng.** `speaker_half_min_cosine` là 0,50. Hai nửa dưới 0,50 là lẫn
tiếng: không đổi xưng hô và không ghi dấu, kể cả tự ghi của tài khoản.

**Giọng thắng câu tự xưng «cháu».** `_detect_audience` lấy vai từ
`speaker_user_id` khi id đó khớp ra một vai, trước `_declares_grandchild`. Mẹ
nói «cháu…» mà giọng đã khớp mẹ thì vai vẫn là mẹ. «Cháu…» chỉ chọn vai cháu
khi giọng không khớp — lúc đó nó vẫn thắng chủ phòng và thắng nhãn.

**Phòng riêng: xưng hô đi theo người nói, kho ký ức thì không.** Nhận ra mẹ
trên máy con thì Bố xưng với mẹ, kể cả trong phòng riêng của con. Prompt của
lượt đó, khi `recognized_speaker_id` khác `member_user_id`, chỉ mang ký ức cả
nhà (`prompt_reader` trả `None` cho thơ, kiến thức, mốc đời, fact đã học,
`family_shared`). Hàng chờ duyệt giữ `reviewer_user_id` của chủ phòng — không
gán sang người vừa nhận giọng. Trí nhớ cuộn của phòng đang mở (`load_state`)
giữ nguyên.

**Tên trên màn.** `POST /messages/voice` trả ngay với tên tài khoản, vì nhận
diện chạy trong job nền. Màn Gọi lấy tên từ `listMessages` sau khi
`speaker_user_id` đã ghi. Kiểm «hiện tên mẹ» chỉ đúng sau lần tải lại danh sách.

**Câu hỏi cuối lượt** nằm trong `DEPTH_RULES` và câu «lượt vừa rồi đã hỏi».
Đừng thêm bước xóa câu hỏi ở cuối. Model vẫn có thể hỏi; vài lượt quan sát
không phải một đảm bảo.
