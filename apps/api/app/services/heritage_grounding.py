"""Stage 4 — never let the entity assert a year or a name we cannot show.

Grounded means "appears in what we handed the model, or in what the family
themselves said". Rather than re-enumerate every evidence source, the check
compares the reply against the system prompt that produced it, which stays
correct as the prompt grows.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..config import Settings
from .heritage import normalize_text
from .heritage_gemini import GeminiCall, call_gemini

YEAR_RE = re.compile(r"\b(?:18|19|20)\d{2}\b")

_LETTERS = r"A-Za-zÀ-ỹ"
_WORD_RE = re.compile(f"[{_LETTERS}]+")
# Keeps the trailing punctuation and newlines so a trimmed reply still reads.
_SENTENCE_RE = re.compile(r"[^.!?…\n]*[.!?…]*\n*")

# Vietnamese capitalizes kinship terms, weekday and month numerals all the time
# ("thứ Bảy", "Mẹ con"), so none of these can count as a fabricated name.
#
# Matched with tone marks intact, case-folded only. Folding tones away would make
# "hạ" swallow "Hà" and "bác" swallow "Bắc", which tears "Hà Nội" and "Bắc Giang"
# in half and leaves a fragment nothing can ground.
_NOT_NAMES = {
    word
    for word in (
        "bố", "ba", "mẹ", "má", "cha", "con", "cháu", "chắt",
        "anh", "chị", "em", "cô", "dì", "chú", "bác", "ông", "bà", "cụ",
        "thầy", "cô giáo", "vợ", "chồng", "dâu", "rể",
        "tôi", "ta", "mình", "họ", "ai", "người",
        "hai", "ba", "tư", "năm", "sáu", "bảy", "tám", "chín", "mười",
        "nhất", "nhì", "chủ", "nhật", "thứ", "tháng", "ngày", "giờ", "đêm",
        "sáng", "trưa", "chiều", "tối", "hôm", "mai", "nay", "qua",
        "tết", "giỗ", "xuân", "hạ", "thu", "đông",
        "trời", "đất", "nhà", "quê",
        "nhưng", "và", "nếu", "khi", "vì", "thôi", "ừ", "à", "ơi",
    )
}


@dataclass
class Ungrounded:
    years: list[str] = field(default_factory=list)
    names: list[str] = field(default_factory=list)

    @property
    def clean(self) -> bool:
        return not self.years and not self.names

    @property
    def spans(self) -> list[str]:
        return [*self.years, *self.names]

    def as_meta(self) -> dict:
        out: dict = {}
        if self.years:
            out["years"] = self.years
        if self.names:
            out["names"] = self.names
        return out


def _is_capitalized(word: str) -> bool:
    return bool(word) and word[0].isupper()


def _capitalized_runs(sentence: str) -> list[list[tuple[str, int]]]:
    """Runs of capitalized words joined by nothing but spaces.

    The separator matters: "ga Hà Nội - Bắc Giang" is two places, and merging
    them makes one phrase no evidence can ever match.
    """
    runs: list[list[tuple[str, int]]] = []
    current: list[tuple[str, int]] = []
    previous_end = 0
    for order, match in enumerate(_WORD_RE.finditer(sentence)):
        word = match.group(0)
        adjacent = sentence[previous_end : match.start()].strip(" ") == ""
        if not _is_capitalized(word) or (current and not adjacent):
            if current:
                runs.append(current)
                current = []
        if _is_capitalized(word):
            current.append((word, order))
        previous_end = match.end()
    if current:
        runs.append(current)
    return runs


def candidate_names(text: str) -> list[str]:
    """Capitalized phrases in the reply that look like a person or a place.

    A lone capitalized word opening a sentence is skipped — in Vietnamese that is
    far more often ordinary prose than a name, and a false alarm costs a rewrite.
    """
    found: list[str] = []
    for sentence in _SENTENCE_RE.findall(text):
        for run in _capitalized_runs(sentence):
            # Drop a kinship title in front of a name ("Bà Phú" → "Phú"), but keep
            # one inside it: "Quốc Anh" and "Đình Anh" are whole names, and the
            # fragment left by splitting them would ground against nothing.
            while run and run[0][0].lower() in _NOT_NAMES:
                run.pop(0)
            if not run or (len(run) == 1 and run[0][1] == 0):
                continue
            phrase = " ".join(word for word, _ in run)
            if phrase not in found:
                found.append(phrase)
    return found


def find_ungrounded(reply: str, *, corpus: str) -> Ungrounded:
    haystack = normalize_text(corpus)
    return Ungrounded(
        years=[y for y in dict.fromkeys(YEAR_RE.findall(reply)) if y not in corpus],
        names=[n for n in candidate_names(reply) if normalize_text(n) not in haystack],
    )


def drop_ungrounded_sentences(reply: str, ungrounded: Ungrounded) -> str:
    """Fallback when no rewrite is available: lose the sentence, keep the letter."""
    spans = ungrounded.spans
    if not spans:
        return reply
    kept = [
        sentence
        for sentence in _SENTENCE_RE.findall(reply)
        if not any(span in sentence for span in spans)
    ]
    return "".join(kept).strip()


_CRITIC_SYSTEM = """\
Bạn soát lại lời của một thực thể ký ức trong app Forever. Bạn KHÔNG trả lời người dùng.

Đoạn văn dưới đây có mốc thời gian hoặc tên KHÔNG có trong tư liệu gia đình.

- Bỏ hoặc nói mờ đi đúng những chi tiết được liệt kê: «năm 1975» thành «hồi ấy»,
  tên không neo được thì bỏ hẳn hoặc gọi bằng vai («cậu bạn cũ»).
- Giữ nguyên giọng, cách xưng hô, độ dài và mọi câu không liên quan.
- KHÔNG thêm bất cứ thông tin nào mới, kể cả chi tiết nghe rất hợp lý.

Trả về đúng đoạn văn đã sửa, không giải thích, không mở đầu.\
"""


def critic_rewrite(
    settings: Settings,
    *,
    reply: str,
    ungrounded: Ungrounded,
    max_output_tokens: int = 768,
) -> str | None:
    listed = "\n".join(f"- {span}" for span in ungrounded.spans)
    result = call_gemini(
        settings,
        GeminiCall(
            system_prompt=_CRITIC_SYSTEM,
            contents=[
                {
                    "role": "user",
                    "parts": [
                        {"text": f"Chi tiết không neo được:\n{listed}\n\nĐoạn văn:\n{reply}"}
                    ],
                }
            ],
            model=settings.compose_model,
            temperature=0.2,
            max_output_tokens=max_output_tokens,
            timeout_s=20.0,
            attempts=1,
        ),
    )
    text = (result.text or "").strip()
    return text or None
