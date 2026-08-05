"""Clean + reformat OCR'd Vietnamese poetry for library storage and TTS.

Goals:
- Strip page chrome (headers, page numbers, watermarks, OCR junk)
- Normalize Unicode / whitespace
- One verse line per line for `body` (literary)
- `body_tts`: same words with soft pauses so Instant Voice Clone / TTS
  does not rush lục bát into one breath
"""

from __future__ import annotations

import re
import unicodedata

# Headers / footers often leaked from book pages into OCR.
_NOISE_LINE = re.compile(
    r"(?ix)^("
    r"thơ\s+tâm\s+tình|"
    r"thơ\s+[a-zăâáàảãạ]+|"
    r"trang\s*\d+|"
    r"page\s*\d+|"
    r"\d{1,3}|"  # bare page number
    r"—+|"
    r"-{3,}"
    r")$"
)

_OCR_JUNK = re.compile(
    r"["
    r"|□■▪▫●◆◇★☆※→←↑↓"
    r"\u00ad"  # soft hyphen
    r"\ufeff"  # BOM
    r"\u200b\u200c\u200d\u2060"  # zero-width
    r"]+"
)

_MULTI_SPACE = re.compile(r"[ \t\u00a0]+")
_MULTI_NL = re.compile(r"\n{3,}")
# Broken OCR: "đèo  bòng" / "b à"
_LETTER_GAP = re.compile(r"(?<=[A-Za-zÀ-ỹ])\s(?=[A-Za-zÀ-ỹ]\s|[A-Za-zÀ-ỹ]$)")

# Ông Triệu ký ngày sáng tác dưới bài: "7/8/2014", "Ngày 21-7-2014".
_DATE_LINE = re.compile(
    r"(?ix)^(?:ngày\s*)?"
    r"(?P<d>\d{1,2})\s*[/.\-]\s*(?P<m>\d{1,2})\s*[/.\-]\s*(?P<y>\d{4})"
    r"\s*$"
)
# Verse lines already ending in an emotional stop — don't stack another period.
_TERMINAL_PUNCT = ".!?…"


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text or "")


def strip_ocr_junk(text: str) -> str:
    text = nfc(text)
    text = _OCR_JUNK.sub("", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _MULTI_SPACE.sub(" ", text)
    return text.strip()


def clean_title(title: str) -> str:
    t = strip_ocr_junk(title)
    t = re.sub(r"\s+", " ", t).strip(" .-–—|")
    # Prefer Title Case-ish display but keep ALL CAPS book titles as ALL CAPS
    return t


def _is_noise_line(line: str) -> bool:
    s = line.strip()
    if not s:
        return True
    if _NOISE_LINE.match(s):
        return True
    # Very short all-digit or punctuation-only
    if re.fullmatch(r"[\d\W_]+", s, flags=re.UNICODE) and len(s) <= 4:
        return True
    return False


def _syllable_count_approx(line: str) -> int:
    """Rough Vietnamese syllable count = whitespace-separated tokens."""
    return len([t for t in line.split() if t])


def clean_body_lines(body: str, *, meter: str = "unknown") -> list[str]:
    raw = strip_ocr_junk(body)
    lines: list[str] = []
    for ln in raw.split("\n"):
        ln = ln.strip(" |•·")
        ln = _MULTI_SPACE.sub(" ", ln).strip()
        if _is_noise_line(ln):
            continue
        # Drop trailing page numbers glued on: "… chờ. 21"
        ln = re.sub(r"\s+\d{1,3}$", "", ln).strip()
        if not ln:
            continue
        lines.append(ln)

    if meter in ("luc_bat", "song_that_luc_bat"):
        lines = _reflow_luc_bat(lines)
    return lines


def _reflow_luc_bat(lines: list[str]) -> list[str]:
    """Prefer alternating ~6 / ~8 syllable lines; split merged lines when obvious."""
    out: list[str] = []
    for ln in lines:
        n = _syllable_count_approx(ln)
        if n >= 12 and n <= 16:
            # Likely 6+8 glued on one line — split near middle by tokens
            tokens = ln.split()
            # Try split after 6 tokens (lục)
            if len(tokens) >= 8:
                a = " ".join(tokens[:6])
                b = " ".join(tokens[6:])
                if 5 <= _syllable_count_approx(a) <= 7 and 7 <= _syllable_count_approx(b) <= 9:
                    out.extend([a, b])
                    continue
        out.append(ln)
    return out


def split_composed_date(lines: list[str]) -> tuple[list[str], str | None]:
    """Pull a trailing "7/8/2014" signature line out of the verse body.

    Returns (verse_lines, iso_date). Ambiguous day/month (both ≤ 12) stays as
    written on the page — the poet wrote d/m/yyyy.
    """
    if not lines:
        return lines, None
    match = _DATE_LINE.match(lines[-1].strip())
    if not match:
        return lines, None
    day, month, year = (int(match.group(g)) for g in ("d", "m", "y"))
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return lines, None
    return lines[:-1], f"{year:04d}-{month:02d}-{day:02d}"


def format_body(lines: list[str]) -> str:
    """Literary body: one verse line per line, no trailing spaces."""
    return "\n".join(lines).strip()


def _strip_soft_pause(line: str) -> str:
    """Drop trailing comma/semicolon so we can re-punctuate, keep ! ? …"""
    return line.rstrip().rstrip(",;:").rstrip()


def _end_stop(line: str) -> str:
    if line.endswith(tuple(_TERMINAL_PUNCT)):
        return line
    return f"{line}."


def format_body_tts(lines: list[str], *, meter: str = "unknown") -> str:
    """TTS-oriented text: soft pauses between lines / couplets.

    Voice DNA TTS reads punctuation; we avoid exclamation spam and avoid
    dumping the whole poem as one run-on sentence.
    """
    if not lines:
        return ""

    chunks: list[str] = []
    if meter == "luc_bat":
        i = 0
        while i < len(lines):
            six = _strip_soft_pause(lines[i])
            if i + 1 < len(lines):
                eight = _strip_soft_pause(lines[i + 1])
                # Comma after lục, period after bát → natural breath for clone TTS
                chunks.append(f"{six}, {_end_stop(eight)}")
                i += 2
            else:
                chunks.append(_end_stop(six))
                i += 1
        # Blank line between couplets groups of ~4 for longer poems (paragraph pause)
        paired = chunks
        grouped: list[str] = []
        for j, c in enumerate(paired):
            grouped.append(c)
            if (j + 1) % 4 == 0 and j + 1 < len(paired):
                grouped.append("")
        return "\n".join(grouped).strip()

    # Default: each line ends with pause
    out = []
    for i, ln in enumerate(lines):
        base = _strip_soft_pause(ln)
        if i == len(lines) - 1:
            out.append(_end_stop(base))
        else:
            out.append(base if base.endswith(tuple(_TERMINAL_PUNCT)) else f"{base},")
    return "\n".join(out)


def enrich_poem(poem: dict) -> dict:
    """Mutate-copy a poem dict with cleaned body + body_tts."""
    meter = (poem.get("meter") or "unknown").strip()
    title = clean_title(poem.get("title") or "")
    lines = clean_body_lines(poem.get("body") or "", meter=meter)
    lines, composed_on = split_composed_date(lines)
    body = format_body(lines)
    body_tts = format_body_tts(lines, meter=meter)
    out = dict(poem)
    out["title"] = title
    out["body"] = body
    out["body_tts"] = body_tts
    out["line_count"] = len(lines)
    out["composed_on"] = composed_on or poem.get("composed_on")
    if out["composed_on"] and not out.get("year_guess"):
        out["year_guess"] = int(str(out["composed_on"])[:4])
    out["clean_version"] = 2
    return out
