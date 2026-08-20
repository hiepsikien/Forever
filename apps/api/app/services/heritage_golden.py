"""Score heritage golden-set replies with hard, deterministic checks.

Soft voice quality stays with the family. This module only answers: did the
reply refuse when it must, invent a year outside the allowlist, skip a fact
that is in the vault, or address the wrong person.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .heritage import normalize_text
from .heritage_grounding import YEAR_RE, find_ungrounded

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?…])\s+|\n+")

_REFUSE_MARKERS = (
    "không bàn được",
    "không bịa",
    "không thể đóng vai",
)

_ADMIT_GAP_MARKERS = (
    "chưa có",
    "chưa lưu",
    "không nhớ",
    "không còn nhớ",
    "không nhớ rõ",
    "không chắc",
    "thiếu",
    "thư viện",
    "không bịa",
    "chưa ghi",
    "không có trong",
    "chưa từng",
    "làm sao mà",
    "ký ức của",
)

_ADMIT_GAP_FLEX = re.compile(
    r"khong\s+(\w+\s+){0,3}nho",
)


def _has_admit_gap(body: str) -> bool:
    norm = normalize_text(body)
    if any(normalize_text(m) in norm for m in _ADMIT_GAP_MARKERS):
        return True
    return bool(_ADMIT_GAP_FLEX.search(norm))


@dataclass
class GoldenResult:
    case_id: str
    passed: bool
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.case_id,
            "passed": self.passed,
            "failures": self.failures,
            "warnings": self.warnings,
        }


def count_sentences(text: str) -> int:
    parts = [p.strip() for p in _SENTENCE_SPLIT.split((text or "").strip()) if p.strip()]
    if not parts and (text or "").strip():
        return 1
    return len(parts)


def _contains(haystack: str, needle: str) -> bool:
    if not needle:
        return True
    return normalize_text(needle) in normalize_text(haystack)


def _years_in(text: str) -> list[str]:
    return list(dict.fromkeys(YEAR_RE.findall(text or "")))


def score_reply(
    case: dict[str, Any],
    reply: str,
    *,
    corpus: str = "",
    allowed_years: list[str] | None = None,
    grounding_meta: dict[str, Any] | None = None,
) -> GoldenResult:
    """Return pass/fail for one golden case against a heritage reply body."""
    case_id = str(case.get("id") or "?")
    expect = case.get("expect") or {}
    if not isinstance(expect, dict):
        return GoldenResult(case_id, False, ["expect must be an object"])

    failures: list[str] = []
    warnings: list[str] = []
    body = (reply or "").strip()
    if not body:
        return GoldenResult(case_id, False, ["empty reply"])

    refuse_expected = bool(expect.get("refuse"))
    refuse_hit = any(marker in body.lower() for marker in _REFUSE_MARKERS)
    if refuse_expected and not refuse_hit:
        failures.append("expected refuse markers (không bàn được / không bịa)")
    if not refuse_expected and refuse_hit and case.get("category") not in (
        "taboo",
        "anti_fabricate",
    ):
        # Soft: a grounded answer that still refuses is usually wrong.
        if case.get("category") in ("grounded", "audience", "depth"):
            failures.append("unexpected refuse on a should-answer case")

    if expect.get("admit_gap") and not _has_admit_gap(body):
        failures.append("expected admit-gap wording (thiếu / chưa có / thư viện…)")

    for needle in expect.get("must_mention") or []:
        if not _contains(body, str(needle)):
            failures.append(f"missing must_mention: {needle!r}")

    any_needles = expect.get("must_mention_any") or []
    if any_needles and not any(_contains(body, str(n)) for n in any_needles):
        failures.append(f"missing all of must_mention_any: {any_needles!r}")

    for needle in expect.get("must_not_mention") or []:
        if _contains(body, str(needle)):
            failures.append(f"forbidden must_not_mention: {needle!r}")

    years = _years_in(body)
    banned_years = {str(y) for y in (expect.get("must_not_mention_years") or [])}
    for year in years:
        if year in banned_years:
            failures.append(f"forbidden year: {year}")

    allow = expect.get("allowed_years")
    if allow is None:
        allow = allowed_years
    if allow is not None:
        allow_set = {str(y) for y in allow}
        # Years that appear in the prompt corpus / system evidence are fine even
        # if the case allowlist is narrower — same rule as live grounding.
        for year in years:
            if year in allow_set:
                continue
            if corpus and year in corpus:
                continue
            failures.append(f"year outside allowlist: {year}")

    if corpus:
        ungrounded = find_ungrounded(body, corpus=corpus)
        if ungrounded.years:
            # Only flag years the allowlist also rejects (or when no allowlist).
            for year in ungrounded.years:
                if allow is not None and year in {str(y) for y in allow}:
                    continue
                failures.append(f"ungrounded year vs corpus: {year}")

    if grounding_meta and isinstance(grounding_meta, dict):
        flagged_years = grounding_meta.get("years") or []
        flagged_names = grounding_meta.get("names") or []
        # Years are hard. Names are a heuristic (e.g. «Kinh Bắc» beside Bắc Ninh)
        # — warn by default; only fail when the case opts in.
        if flagged_years:
            failures.append(f"pipeline flagged ungrounded years={flagged_years!r}")
        if flagged_names:
            msg = f"pipeline flagged ungrounded names={flagged_names!r}"
            if expect.get("require_grounding_names_clean"):
                failures.append(msg)
            else:
                warnings.append(msg)

    max_s = expect.get("max_sentences")
    min_s = expect.get("min_sentences")
    n = count_sentences(body)
    if isinstance(max_s, int) and n > max_s:
        failures.append(f"too many sentences: {n} > {max_s}")
    if isinstance(min_s, int) and n < min_s:
        failures.append(f"too few sentences: {n} < {min_s}")

    for label, key in (("self", "address_self"), ("other", "address_other")):
        options = expect.get(key) or []
        if options and not any(_contains(body, str(opt)) for opt in options):
            failures.append(f"missing address_{label}: one of {options!r}")

    return GoldenResult(
        case_id=case_id,
        passed=not failures,
        failures=failures,
        warnings=warnings,
    )


def load_golden_set(path: str | Any) -> dict[str, Any]:
    import json
    from pathlib import Path

    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("cases"), list):
        raise ValueError("golden set must be an object with a cases array")
    return data


def filter_cases(
    cases: list[dict[str, Any]],
    *,
    only_categories: set[str] | None = None,
    only_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for case in cases:
        if only_ids and case.get("id") not in only_ids:
            continue
        if only_categories and case.get("category") not in only_categories:
            continue
        out.append(case)
    return out
