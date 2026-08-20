"""Evidence retrieval for heritage chat — Stage 2 of the v2 pipeline.

Milestones live in the library as MemoryItem(kind="milestone") with an
occurred_at, so a question about a year or a place can be answered from a
steward-approved row instead of the model's imagination.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from ..models import MemoryItem
from .heritage import HERITAGE_TAG_PREFIX, normalize_text, tag_tokens
from .memory_scope import readable_by

MILESTONE_KIND = "milestone"

_YEAR = re.compile(r"\b(1[89]\d{2}|20\d{2})\b")
_STOPWORDS = {
    "cua", "khong", "duoc", "nhung", "voi", "cho", "the", "nay", "roi", "lam",
    "nhu", "cung", "khi", "vao", "tren", "duoi", "moi", "hay", "bao",
    "gio", "day", "kia", "sao",
    # Kinship words appear in almost every milestone summary, so matching on
    # them retrieves the whole life story for a message like "con chào bố".
    "con", "chau", "bo", "ba", "ong", "anh", "chi", "chong", "nguoi", "nha",
}


@dataclass
class EvidenceItem:
    id: str
    kind: str  # entity | poem | milestone | knowledge
    title: str
    text: str
    score: float = 0.0

    def render(self) -> str:
        head = f"— [{self.kind}:{self.id}] {self.title}".rstrip()
        return f"{head}\n{self.text}" if self.text else head


@dataclass
class EvidencePack:
    items: list[EvidenceItem] = field(default_factory=list)

    def of_kind(self, kind: str) -> list[EvidenceItem]:
        return [item for item in self.items if item.kind == kind]

    def render(self) -> str:
        return "\n\n".join(item.render() for item in self.items)

    def ids(self) -> list[str]:
        return [item.id for item in self.items]


def query_tokens(text: str) -> set[str]:
    norm = normalize_text(text)
    parts = re.split(r"[^\w]+", norm)
    return {p for p in parts if len(p) >= 3 and p not in _STOPWORDS}


def milestones_for_identity(
    db: Session, *, space_id: str, identity_id: str, reader: str | None = None
) -> list[MemoryItem]:
    needle = f"{HERITAGE_TAG_PREFIX}{identity_id}"
    items = (
        db.query(MemoryItem)
        .filter(
            MemoryItem.space_id == space_id,
            MemoryItem.kind == MILESTONE_KIND,
            readable_by(reader),
        )
        .order_by(MemoryItem.occurred_at.asc().nullslast())
        .all()
    )
    return [item for item in items if needle in tag_tokens(item.tags)]


def family_milestones(
    db: Session, *, space_id: str, reader: str | None = None
) -> list[MemoryItem]:
    """Every readable family date in the space — not only one person's biography."""
    return (
        db.query(MemoryItem)
        .filter(
            MemoryItem.space_id == space_id,
            MemoryItem.kind == MILESTONE_KIND,
            readable_by(reader),
        )
        .order_by(MemoryItem.occurred_at.asc().nullslast())
        .all()
    )


# One title word, or three body words, or a year. Anything weaker pulls in the
# whole life story on a message like "bố cưới mẹ năm nào".
MIN_MILESTONE_SCORE = 6.0


def score_milestone(milestone: MemoryItem, query: str) -> float:
    """Year hits are the strongest signal; whole-word overlap breaks ties."""
    score = 0.0
    tokens = query_tokens(query)
    title_tokens = query_tokens(milestone.title or "")
    body_tokens = query_tokens((milestone.body or "")[:800])
    for token in tokens:
        if token in title_tokens:
            score += 6
        elif token in body_tokens:
            score += 2

    asked_years = set(_YEAR.findall(query))
    if asked_years:
        haystack = f"{milestone.title} {milestone.body}"
        for year in asked_years:
            if year in haystack:
                score += 12
            elif milestone.occurred_at and str(milestone.occurred_at.year) == year:
                score += 12
    return score


def retrieve_milestones(
    milestones: list[MemoryItem], *, query: str, limit: int = 3
) -> list[MemoryItem]:
    scored = [(score_milestone(m, query), m) for m in milestones]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [m for score, m in scored if score >= MIN_MILESTONE_SCORE][:limit]


# Facts the family told the chat, once a human approved them.
LEARNED_KIND = "knowledge"


def learned_facts_for_identity(
    db: Session, *, space_id: str, identity_id: str, reader: str | None = None
) -> list[MemoryItem]:
    needle = f"{HERITAGE_TAG_PREFIX}{identity_id}"
    items = (
        db.query(MemoryItem)
        .filter(
            MemoryItem.space_id == space_id,
            MemoryItem.kind == LEARNED_KIND,
            readable_by(reader),
        )
        .order_by(MemoryItem.created_at.desc())
        .all()
    )
    return [item for item in items if needle in tag_tokens(item.tags)]


# Shared vault kinds a remembered person may cite when the family asks about
# someone else in the Codex — never private, never the speaker's own shelf
# (that already arrives via knowledge / learned).
_FAMILY_SHARED_KINDS = ("knowledge", "note", "poem")


def family_shared_for_identities(
    db: Session,
    *,
    space_id: str,
    identity_ids: list[str],
    exclude_identity_id: str,
    reader: str | None = None,
    limit_scan: int = 120,
) -> list[MemoryItem]:
    """Family-visible library rows tagged to other people the turn just named.

    Private items are already excluded by `readable_by` when reader is None
    (family thread). The speaker's own `heritage:{id}` shelf is excluded so we
    do not double-count with `_knowledge_snippets` / `learned_facts_for_identity`.
    """
    needles = [
        f"{HERITAGE_TAG_PREFIX}{iid}"
        for iid in identity_ids
        if iid and iid != exclude_identity_id
    ]
    if not needles:
        return []
    self_needle = f"{HERITAGE_TAG_PREFIX}{exclude_identity_id}"
    items = (
        db.query(MemoryItem)
        .filter(
            MemoryItem.space_id == space_id,
            MemoryItem.kind.in_(_FAMILY_SHARED_KINDS),
            readable_by(reader),
        )
        .order_by(MemoryItem.created_at.desc())
        .limit(limit_scan)
        .all()
    )
    out: list[MemoryItem] = []
    for item in items:
        tokens = tag_tokens(item.tags)
        if self_needle in tokens:
            continue
        if any(n in tokens for n in needles):
            out.append(item)
    return out


def retrieve_learned(
    facts: list[MemoryItem], *, query: str, limit: int = 3
) -> list[MemoryItem]:
    """Relevance-gated, never "the newest three".

    Approved facts are short and plentiful. Feeding recent ones unconditionally
    would push the curated biography out of the evidence budget with trivia.
    """
    scored = [(score_milestone(f, query), f) for f in facts]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [f for score, f in scored if score >= MIN_MILESTONE_SCORE][:limit]


def _truncate(text: str, limit: int) -> str:
    body = (text or "").strip()
    return body if len(body) <= limit else body[:limit].rstrip() + "…"


def build_evidence_pack(
    *,
    entity_lines: list[str],
    poems: list[MemoryItem],
    milestones: list[MemoryItem],
    knowledge: list[MemoryItem],
    char_budget: int = 7200,
    photo: MemoryItem | None = None,
) -> EvidencePack:
    """Assemble evidence in trust order, stopping at the budget.

    Entities first because getting the person wrong poisons everything after
    it; poems last because they are the longest and the least factual.
    """
    pack = EvidencePack()
    used = 0

    def add(item: EvidenceItem) -> bool:
        nonlocal used
        size = len(item.render())
        if used + size > char_budget:
            return False
        pack.items.append(item)
        used += size
        return True

    if entity_lines:
        add(
            EvidenceItem(
                id="codex",
                kind="entity",
                title="Người được nhắc tới",
                text="\n".join(entity_lines),
            )
        )
    if photo is not None:
        year = ""
        if photo.occurred_at:
            year = str(photo.occurred_at.year)
        caption = _truncate(photo.body or photo.title or "", 400)
        text = caption if not year else f"{caption}\nNăm (từ chú thích album): {year}"
        add(
            EvidenceItem(
                id=photo.id,
                kind="photo",
                title=photo.title or "Ảnh kỷ niệm",
                text=text,
            )
        )
    for item in milestones:
        if not add(
            EvidenceItem(
                id=item.id,
                kind="milestone",
                title=item.title or "Ngày gia đình",
                text=_truncate(item.body, 400),
            )
        ):
            break
    for item in knowledge:
        if not add(
            EvidenceItem(
                id=item.id,
                kind="knowledge",
                title=item.title or "Ký ức",
                text=_truncate(item.body, 500),
            )
        ):
            break
    for item in poems:
        if not add(
            EvidenceItem(
                id=item.id,
                kind="poem",
                title=item.title or "Thơ",
                text=_truncate(item.body, 900),
            )
        ):
            break
    return pack
