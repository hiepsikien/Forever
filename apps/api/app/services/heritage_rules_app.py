"""Tầng 1 — Luật ứng dụng Forever: đúng cho MỌI người được nhớ.

Không dòng nào ở đây được viết cứng đại từ của một người. Mọi câu chữ đi ra
gia đình đều dựng từ `Persona` (tầng 3), nên thêm Bà Nội hay Ông Ngoại không
cần sửa file này. `tests/test_heritage_layers.py` canh đúng ranh giới đó.

Bộ dò ở đây soi lời NGƯỜI DÙNG gõ, nên chúng phải phủ hết từ thân tộc —
thiếu một từ là một người được nhớ mất lá chắn mà người khác có.
"""

from __future__ import annotations

import re

from .heritage_persona import Persona, cap

# Từ thân tộc mà một người được nhớ có thể tự xưng. Dùng chung cho mọi bộ dò
# để không bộ nào chỉ phủ đúng một người.
ELDER_SELF_WORDS = (
    "bố", "ba", "cha", "tía", "mẹ", "má", "mạ", "ông", "bà", "cụ",
)
KINSHIP_SELF_WORDS = ELDER_SELF_WORDS + (
    "anh", "chị", "cô", "dì", "chú", "bác", "cậu", "thím", "mợ",
)

_ELDERS = "|".join(ELDER_SELF_WORDS)
_KIN = "|".join(KINSHIP_SELF_WORDS)

_TABOO_PATTERNS = re.compile(
    r"("
    r"chính\s*trị|đảng\s*phái|bầu\s*cử|quốc\s*hội|"
    r"tình\s*dục|gợi\s*dục|sex\b|"
    r"ma\s*túy|buôn\s*lậu|giết\s*người|"
    r"đóng\s*vai.{0,20}(còn\s+sống|sống\s+lại)|"
    rf"({_ELDERS}).{{0,24}}(còn\s+sống|sống\s+lại)|"
    r"bịa.{0,16}(chuyện|kỷ\s*niệm|tiểu\s*sử)|"
    r"kể\s+(chuyện|về).{0,30}(hồi\s+còn\s+sống|khi\s+còn\s+sống)"
    r")",
    re.IGNORECASE | re.DOTALL,
)

_FABRICATION_PATTERNS = re.compile(
    r"("
    r"\bbịa\b|"
    rf"({_KIN})\s+(đoán|tưởng\s*tượng)\b|"
    r"tưởng\s*tượng\s+(ra|giúp|một)|"
    r"kể\s+(chuyện|về).{0,30}(chưa|không\s+có\s+trong)|"
    r"nhớ\s+lại.{0,30}(sự\s+kiện|chuyến\s+đi).{0,20}(chưa|không)"
    r")",
    re.IGNORECASE | re.DOTALL,
)

# Thực thể tạm dừng — câu này nói với steward, không nhập vai ai.
REFUSE_PAUSED = (
    "Thực thể ký ức đang tạm dừng. Steward có thể mở lại trong màn Thổi hồn "
    "khi gia đình sẵn sàng."
)


def looks_like_taboo(text: str) -> bool:
    return bool(_TABOO_PATTERNS.search(text or ""))


def looks_like_fabrication_request(text: str) -> bool:
    return bool(_FABRICATION_PATTERNS.search(text or ""))


def app_refusal(kind: str, persona: Persona) -> str:
    """Câu từ chối cấp ứng dụng, nói bằng giọng của chính người này."""
    me = persona.me("child")
    you = persona.you("child")
    if kind == "taboo":
        return (
            f"{cap(you)} ơi, chỗ này {me} không bàn được — mình giữ Phòng khách ấm áp, "
            f"điều tốt cho gia đình thôi. Hỏi {me} chuyện nhà, chuyện thơ, chuyện con cháu nhé."
        )
    if kind == "fabrication":
        return (
            f"{cap(me)} không bịa chuyện hay kỷ niệm chưa có trong kho ký ức gia đình. "
            f"Thiếu chỗ nào, {you} cứ ghi thêm vào Thư viện — {me} sẽ nhớ đúng hơn."
        )
    if kind == "unheard":
        return f"{cap(me)} chưa nghe rõ, {you} nói lại giúp {me} nhé."
    return (
        f"{cap(me)} nghe {you} rồi. Hỏi thêm về nhà, về thơ, hoặc về người thân — "
        f"{me} trả lời trong phạm vi ký ức gia đình đã lưu."
    )


def clarify_line(names: str, persona: Persona) -> str:
    """Hỏi lại khi một cái tên trỏ tới nhiều người."""
    me = persona.me("child")
    you = persona.you("child")
    return f"{cap(you)} nói {names} hả {you}? {cap(me)} hỏi lại cho chắc."


# Gemini mặc định lễ phép như trợ lý. Người trên trong nhà không «dạ»/«ạ».
_DEFERENCE_FIXES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^[Dd]ạ[,.\s]+"), ""),
    (re.compile(r"(?<=[.!?…]\s)[Dd]ạ[,.\s]+"), ""),
    (re.compile(r"\b[Dd]ạ\b[,.\s]*"), ""),
    (re.compile(r"\bvâng ạ\b", re.I), "vâng"),
    (re.compile(r"\sạ(?=\s|[.,!?…]|$)"), ""),
)


def strip_deference(text: str) -> str:
    out = text
    for pattern, repl in _DEFERENCE_FIXES:
        out = pattern.sub(repl, out)
    return re.sub(r" {2,}", " ", out).strip()


def _sub_keep_case(pattern: re.Pattern[str], replacement: str, text: str) -> str:
    def _apply(match: re.Match[str]) -> str:
        out = replacement
        for idx, group in enumerate(match.groups(), start=1):
            out = out.replace(f"\\{idx}", group or "")
        if match.group(0)[:1].isupper():
            return cap(out)
        return out

    return pattern.sub(_apply, text)


# Động từ đi ngay sau đại từ tự xưng — dấu hiệu người nói đang tự nhận vai.
_SELF_VERBS = (
    "nhớ", "nghe", "biết", "chưa", "sẽ", "đây", "không", "vẫn", "cũng",
    "mừng", "thương", "hiểu", "trả lời", "mong", "vui", "buồn", "đang",
)
_SELF_VERB_RE = "|".join(_SELF_VERBS)

# Động từ dặn dò đi ngay sau đại từ gọi người nghe.
_ADDRESSEE_VERBS = (
    "giữ", "nghỉ", "ăn", "ngủ", "đi", "về", "ở", "cứ", "đừng", "hãy",
    "nói", "kể", "yên tâm", "nhớ giữ", "ráng", "gắng", "chịu khó",
)
_ADDRESSEE_VERB_RE = "|".join(_ADDRESSEE_VERBS)


def fix_address_register(text: str, persona: Persona, audience: str | None) -> str:
    """Kéo câu về đúng cặp xưng hô của vai đang nói.

    Chỉ chạy với người có nhiều hơn một vai trong Bản sắc. Người chỉ có một
    cặp xưng hô thì không có gì để nhầm sang.
    """
    out = text
    for wrong_me, wrong_you in persona.other_registers(audience):
        out = _pull_back_one_register(out, persona, audience, wrong_me, wrong_you)
    return out


def _pull_back_one_register(
    text: str, persona: Persona, audience: str | None, wrong_me: str, wrong_you: str
) -> str:
    me = persona.me(audience)
    you = persona.you(audience)
    out = text
    if wrong_you and wrong_you != you:
        w = re.escape(wrong_you)
        for suffix in ("ơi", "nhé", "à", "ạ"):
            out = _sub_keep_case(
                re.compile(rf"\b{w}\s+{suffix}\b", re.I), f"{you} {suffix}", out
            )
        for verb in ("chào", "nghe", "gọi"):
            out = _sub_keep_case(
                re.compile(rf"\b{verb}\s+{w}\b", re.I), f"{verb} {you}", out
            )
        # Đầu câu, đứng trước lời dặn: đó là gọi người nghe, không phải kể về ai.
        out = _sub_keep_case(
            re.compile(
                rf"(?:(?<=^)|(?<=[.!?…]\s)|(?<=\n)){w}\s+({_ADDRESSEE_VERB_RE})\b",
                re.I,
            ),
            f"{you} \\1",
            out,
        )
    if wrong_me and wrong_me != me:
        w = re.escape(wrong_me)
        out = _sub_keep_case(
            re.compile(rf"\b{w}\s+({_SELF_VERB_RE})\b", re.I), f"{me} \\1", out
        )
        out = _sub_keep_case(re.compile(rf"\blòng\s+{w}\b", re.I), f"lòng {me}", out)
    if wrong_you and wrong_you != you:
        # «Anh đây em» → «Bố đây con»: người nghe đứng ngay sau người nói.
        out = _sub_keep_case(
            re.compile(
                rf"\b{re.escape(me)}\s+({_SELF_VERB_RE})\s+{re.escape(wrong_you)}\b",
                re.I,
            ),
            f"{me} \\1 {you}",
            out,
        )
    if persona.audience(audience) == "child" and persona.spouse_as_kin:
        kin = persona.spouse_as_kin
        for phrase in (r"người vợ", r"vợ tào khang", r"người chồng"):
            out = _sub_keep_case(re.compile(rf"\b{phrase}\b", re.I), kin, out)
    return re.sub(r" {2,}", " ", out).strip()


def fix_foreign_self_reference(
    text: str, persona: Persona, audience: str | None
) -> str:
    """Bỏ trường hợp câu trả lời tự xưng bằng vai của người khác.

    Dựng từ danh sách từ thân tộc chung, không từ vốn từ của một ai — nên nó
    bảo vệ Bà khỏi giọng Bố đúng như bảo vệ Bố khỏi giọng Ông.
    """
    me = persona.me(audience)
    # Các vai khác của chính người này đã được `fix_address_register` kéo về
    # đúng chỗ; đừng đụng lần hai kẻo sửa cả lúc họ kể VỀ người khác.
    allowed = {me, persona.you(audience)}
    for other_me, other_you in persona.other_registers(audience):
        allowed.update({other_me, other_you})
    out = text
    for word in KINSHIP_SELF_WORDS:
        if word in allowed:
            continue
        w = re.escape(word)
        # Chỉ ở đầu câu: chỗ một lượt bị nhập nhầm vai gần như luôn bắt đầu.
        out = _sub_keep_case(
            re.compile(
                rf"(?:(?<=^)|(?<=[.!?…]\s)|(?<=\n))({w})\s+({_SELF_VERB_RE})\b",
                re.I,
            ),
            f"{me} \\2",
            out,
        )
        out = _sub_keep_case(
            re.compile(rf"\bchỗ này\s+{w}\b", re.I), f"chỗ này {me}", out
        )
        out = _sub_keep_case(
            re.compile(rf"\bhỏi\s+{w}\s+chuyện\b", re.I), f"hỏi {me} chuyện", out
        )
    return re.sub(r" {2,}", " ", out).strip()


# Đuôi gọi tên đứng một mình sau dấu phẩy: «… mà nên, con.»
def _dangling_vocative_re(you: str) -> re.Pattern[str]:
    return re.compile(rf",\s*{re.escape(you)}\s*([.!?…]*)\s*$", re.I)


# Câu kết tình cảm đứng cuối bài: «Bố nhớ con.»
def _closing_affection_re(me: str, you: str) -> re.Pattern[str]:
    return re.compile(
        rf"(?:(?<=^)|(?<=[.!?…]\s)|(?<=\n))\s*{re.escape(me)}\s+(?:nhớ|thương|yêu)"
        rf"\s+{re.escape(you)}\b[^.!?…]*[.!?…]*\s*$",
        re.I,
    )


def strip_repeated_closing(
    text: str,
    persona: Persona,
    audience: str | None,
    previous: list[str] | None = None,
) -> str:
    """Bỏ câu kết đã dùng ở lượt ngay trước.

    Một lần «Bố nhớ con» là ấm; lượt nào cũng thế thì thành cái tật, và cái
    đuôi «…, con.» đọc lên nghe cụt. Chỉ cắt khi nó vừa xuất hiện ở lượt gần
    nhất — nói cách khác, luật này chống lặp chứ không cấm thương nhớ.
    """
    body = (text or "").strip()
    recent = [p for p in (previous or [])[-2:] if (p or "").strip()]
    if not body or not recent:
        return body
    me, you = persona.register(audience)
    tail = _dangling_vocative_re(you)
    if any(tail.search(p) for p in recent):
        body = tail.sub(lambda m: m.group(1) or ".", body).strip()
    affection = _closing_affection_re(me, you)
    if any(affection.search(p) for p in recent):
        # Giữ lại ít nhất một câu — thà lặp còn hơn trả lời rỗng.
        without = affection.sub("", body).strip()
        if without:
            body = without
    return body


def looks_like_direct_affection(text: str, persona: Persona) -> bool:
    """«Anh yêu em» — dựng từ cặp xưng hô của chính người này."""
    if not persona.speaks_to_spouse:
        return False
    me = re.escape(str(persona.self_peer))
    you = re.escape(str(persona.peer))
    pattern = re.compile(
        rf"\b({me}\s+(yêu|nhớ)\s+{you}|(yêu|nhớ)\s+{you}\s+(nhiều|lắm|quá))\b",
        re.I,
    )
    return bool(pattern.search(text or ""))


def soften_affection(text: str, persona: Persona) -> str:
    if not persona.speaks_to_spouse:
        return text
    me = re.escape(str(persona.self_peer))
    you = re.escape(str(persona.peer))
    out = text
    out = _sub_keep_case(
        re.compile(rf"\b{me}\s+(yêu|thương)\s+{you}\s+(nhiều|lắm|quá)\b", re.I),
        f"{persona.self_peer} vẫn bên nhà mình",
        out,
    )
    out = _sub_keep_case(
        re.compile(rf"\b{me}\s+nhớ\s+{you}\s+(nhiều|lắm|quá)\b", re.I),
        "nhà mình vẫn vậy",
        out,
    )
    out = _sub_keep_case(
        re.compile(rf"\b{me}\s+yêu\s+{you}\b", re.I),
        f"{persona.self_peer} vẫn bên nhà mình",
        out,
    )
    out = _sub_keep_case(
        re.compile(rf"\b{me}\s+nhớ\s+{you}\b", re.I), "nhà mình vẫn vậy", out
    )
    out = _sub_keep_case(
        re.compile(rf"\b(yêu|nhớ)\s+{you}\s+(nhiều|lắm|quá)\b", re.I),
        "nhà mình vẫn vậy",
        out,
    )
    return re.sub(r" {2,}", " ", out).strip()


def app_rules_block(persona: Persona, *, quote_rule: str, length_rule: str) -> str:
    """Lớp 1 trong system prompt — luật app, nói bằng đại từ của người này."""
    me = persona.me("child")
    you = persona.you("child")
    return f"""\
Lớp 1 — Ứng dụng Forever (không đàm phán):
- Trả lời chuyện nhà, thơ, người thân khi bằng chứng bên dưới đã có — đừng từ chối
  vì sợ sai. Chỉ KHÔNG bịa tiểu sử, sự kiện, năm, hay tên người khi không có trong
  Bản sắc / thơ / ký ức neo.
- Không giả vờ đang sống ở phòng bên. Bạn là {persona.display or me} và chỉ là người ấy —
  không nhập vai, không mượn giọng một người được nhớ khác trong nhà.
- Không đoán năm tương lai nếu năm đó không có trong bằng chứng. Đừng nhắc lại năm
  hỏi khi đang thừa nhận là chưa biết.
- {quote_rule}
- Đây là nhắn tin (Zalo), KHÔNG phải viết thư: {length_rule}
- Trả lời đúng ý câu hỏi trước; tránh mở đầu sáo «Chào {you}» dài.
- Đừng gắn đuôi gọi tên sau dấu phẩy ở cuối («…, {you}.») — nghe cụt. Và đừng
  lượt nào cũng đóng bằng cùng một câu thương nhớ («{cap(me)} nhớ {you}»);
  nói một lần thì ấm, nói mãi thì thành cái tật.
- Trong nhà: thân mật, từ tốn, không khách sáo. {cap(me)} KHÔNG xưng «dạ», không «vâng ạ»,
  không kết câu bằng «ạ» khi nói với con cháu — đó là cách con cháu nói với bề trên.
- Luôn kết thúc bằng câu trọn vẹn — không dừng giữa chừng."""
