from __future__ import annotations

from ..config import Settings
from .ai_usage import UsageContext
from .heritage_gemini import GeminiCall, call_gemini

SCRIPT_SYSTEM = """\
Bạn giúp Forever thu sample Voice DNA (Instant Voice Clone).
Viết MỘT đoạn văn tiếng Việt để người dùng đọc to vào micro.

Yêu cầu cứng:
- Độ dài khoảng 80–140 từ (đọc khoảng 35–55 giây).
- Phủ nhiều thanh điệu tiếng Việt (ngang, huyền, hỏi, ngã, sắc, nặng).
- Câu ngắn–trung bình, dễ đọc to, tự nhiên như kể chuyện gia đình ấm áp.
- Không emoji, không đánh số danh sách, không tiêu đề, không lời dẫn “đọc đoạn sau”.
- Chỉ trả về đúng đoạn văn cần đọc, không giải thích thêm.
"""

_FALLBACK_SCRIPTS = [
    (
        "Buổi sáng nhà mình thường dậy sớm. Mẹ pha một ấm trà đặc, "
        "bố ngồi đọc báo cạnh cửa sổ có nắng len qua lá. "
        "Tôi nhớ mùi cơm cháy nhẹ dưới đáy nồi, tiếng cười khi ai đó "
        "kể chuyện quê cũ, và lời dặn dịu dàng: sống thật thà, "
        "thương người thân, đừng vội vàng đến mức quên nhìn lại. "
        "Những điều nhỏ ấy theo tôi đi xa, vẫn ấm như lúc ngồi bên bàn ăn."
    ),
    (
        "Hôm ấy trời se lạnh, cả nhà ngồi quây quanh mâm cơm tối. "
        "Có tiếng đũa chạm bát, có câu hỏi giản dị về ngày làm việc, "
        "và một lời chúc ngủ ngon trước khi tắt đèn. "
        "Tôi muốn giữ lại giọng nói ấy — chậm rãi, rõ ràng, đầy thương yêu — "
        "để mai này khi nhớ nhà, vẫn nghe được sự bình yên của người thân. "
        "Xin hãy nói thật tự nhiên, như đang kể cho con cháu nghe."
    ),
    (
        "Mỗi dịp Tết, sân trước lại đầy tiếng bước chân và hương bánh chưng. "
        "Người lớn bàn chuyện năm cũ, trẻ con chạy theo những cánh diều. "
        "Có lúc ai đó ngân nga vài câu dân ca, có lúc cả nhà im lặng nhìn "
        "ánh đèn vàng trên bàn thờ. Tôi học được rằng hạnh phúc không ồn ào; "
        "nó nằm trong lời hỏi thăm, trong cái nắm tay, và trong cách "
        "ta gọi tên nhau thật gần gũi giữa bộn bề cuộc sống."
    ),
]


def _fallback_script(seed: int = 0) -> str:
    return _FALLBACK_SCRIPTS[seed % len(_FALLBACK_SCRIPTS)]


def generate_voice_sample_script(
    settings: Settings,
    *,
    theme: str | None = None,
    seed: int = 0,
    space_id: str | None = None,
    user_id: str | None = None,
) -> tuple[str, str]:
    """
    Returns (script, source) where source is 'gemini' | 'fallback'.
    """
    user_prompt = (
        "Hãy viết một đoạn đọc to cho sample Voice DNA."
        + (f" Chủ đề gợi ý: {theme.strip()}." if theme and theme.strip() else "")
    )

    if settings.gemini_api_key.strip():
        model = settings.gemini_model.strip() or "gemini-3.5-flash"
        result = call_gemini(
            settings,
            GeminiCall(
                system_prompt=SCRIPT_SYSTEM,
                contents=[{"role": "user", "parts": [{"text": user_prompt}]}],
                model=model,
                temperature=0.85,
                max_output_tokens=1024,
                timeout_s=45.0,
                attempts=1,
                usage=UsageContext(
                    space_id=space_id,
                    user_id=user_id,
                    operation="voice_script",
                ),
            ),
        )
        if result.text:
            cleaned = _clean_script(result.text)
            if cleaned:
                return cleaned, "gemini"

    return _fallback_script(seed), "fallback"


def _clean_script(text: str) -> str:
    lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
    filtered = []
    for ln in lines:
        lower = ln.lower()
        if lower.startswith(("đây là", "bạn hãy", "hãy đọc", "đoạn văn")):
            continue
        filtered.append(ln)
    body = " ".join(filtered) if filtered else text.strip()
    body = " ".join(body.split())
    return body[:1200]
