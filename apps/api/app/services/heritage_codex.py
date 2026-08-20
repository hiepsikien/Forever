"""Family Codex — who the heritage entity is being asked about.

The Identity Lock lists relatives as prose ("Người cha của Nguyễn Lê Hương,
Nguyễn Anh Vỹ, Nguyễn Đình Anh"). That reads well for a human but gives the
model nothing to resolve a mention against, which is how "Hương" ends up
answered as if it were the wife. This module turns those roles into rows with
aliases, then resolves mentions in a message back to them.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone

from nanoid import generate
from sqlalchemy.orm import Session

from ..models import FamilyEntity, IdentityProfile
from .heritage import normalize_text

# Vietnamese kinship words that are titles, not names — never seed them alone
# and never treat them as a short alias.
_TITLE_WORDS = {
    "ba", "bo", "me", "ong", "cu", "co", "chu", "bac", "di", "cau", "mo",
    "thim", "anh", "chi", "em", "con", "chau", "vo", "chong", "nguoi",
}

_ROLE_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^người chồng của\s+(.+)$", re.I), "vợ"),
    (re.compile(r"^người vợ của\s+(.+)$", re.I), "chồng"),
    (re.compile(r"^người cha của\s+(.+)$", re.I), "con"),
    (re.compile(r"^người mẹ của\s+(.+)$", re.I), "con"),
    (re.compile(r"^ông của các cháu:\s*(.+)$", re.I), "cháu"),
    (re.compile(r"^bà của các cháu:\s*(.+)$", re.I), "cháu"),
    (re.compile(r"^con rể:\s*(.+)$", re.I), "con rể"),
    (re.compile(r"^con dâu:\s*(.+)$", re.I), "con dâu"),
)

# One role line can carry several clauses: "Con rể: X; con dâu: Y, Z".
_CLAUSE_SPLIT = re.compile(r"\s*;\s*")
_NAME_SPLIT = re.compile(r"\s*,\s*|\s+và\s+")
_PAREN = re.compile(r"\([^)]*\)")


@dataclass
class CodexMatch:
    mention: str
    entities: list[FamilyEntity]

    @property
    def ambiguous(self) -> bool:
        return len(self.entities) > 1

    @property
    def entity(self) -> FamilyEntity | None:
        return self.entities[0] if len(self.entities) == 1 else None


def _json_list(raw: str | None) -> list:
    if not raw or not raw.strip():
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def _json_dict(raw: str | None) -> dict:
    if not raw or not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def slugify(name: str) -> str:
    norm = normalize_text(name)
    slug = re.sub(r"[^a-z0-9]+", "_", norm).strip("_")
    return slug[:60] or "nguoi"


def aliases_for(full_name: str) -> list[str]:
    """Full name plus the shorter forms a family actually says out loud.

    The given name (last token in Vietnamese order) is what gets used at home,
    but it is also where collisions live — «Hương» is both a daughter and a
    daughter-in-law. Emitting both and letting resolution flag the ambiguity is
    better than silently picking one.
    """
    name = full_name.strip()
    aliases = [name]
    tokens = name.split()
    if len(tokens) >= 2:
        given = tokens[-1]
        if normalize_text(given) not in _TITLE_WORDS:
            aliases.append(given)
        if len(tokens) >= 3:
            aliases.append(" ".join(tokens[-2:]))
    seen: set[str] = set()
    out: list[str] = []
    for alias in aliases:
        key = normalize_text(alias)
        if key and key not in seen:
            seen.add(key)
            out.append(alias)
    return out


def _clean_person_name(raw: str) -> str:
    name = _PAREN.sub("", raw).strip(" .—-–")
    # Drop a leading kinship title: "bà Lê Thị Định" → "Lê Thị Định".
    tokens = name.split()
    while tokens and normalize_text(tokens[0]) in _TITLE_WORDS:
        tokens = tokens[1:]
    return " ".join(tokens).strip()


def parse_roles(roles: object | None) -> list[dict]:
    """Extract {name, relation} pairs from Identity Lock role sentences."""
    if not isinstance(roles, list):
        return []
    found: list[dict] = []
    seen: set[str] = set()
    for role in roles:
        if not isinstance(role, str):
            continue
        for clause in _CLAUSE_SPLIT.split(role.strip()):
            for pattern, relation in _ROLE_PATTERNS:
                match = pattern.match(clause.strip())
                if not match:
                    continue
                for chunk in _NAME_SPLIT.split(match.group(1)):
                    name = _clean_person_name(chunk)
                    if not name or len(name) < 2:
                        continue
                    key = normalize_text(name)
                    if key in seen:
                        continue
                    seen.add(key)
                    found.append({"name": name, "relation": relation})
                break
    return found


def seed_entities_from_lock(
    db: Session,
    *,
    identity: IdentityProfile,
    created_by: str,
    status: str = "draft",
) -> list[FamilyEntity]:
    """Create missing codex rows from the Lock. Existing rows are left alone."""
    try:
        roles = json.loads(identity.roles_json or "[]")
    except json.JSONDecodeError:
        roles = []
    parsed = parse_roles(roles)
    if not parsed:
        return []

    existing = {
        row.slug
        for row in db.query(FamilyEntity)
        .filter(FamilyEntity.space_id == identity.space_id)
        .all()
    }
    now = datetime.now(timezone.utc)
    created: list[FamilyEntity] = []
    for person in parsed:
        slug = slugify(person["name"])
        if slug in existing:
            continue
        existing.add(slug)
        row = FamilyEntity(
            id=generate(),
            space_id=identity.space_id,
            slug=slug,
            subject_identity_id=identity.id,
            canonical_name=person["name"],
            aliases_json=json.dumps(
                aliases_for(person["name"]), ensure_ascii=False
            ),
            relation_json=json.dumps(
                {"to_subject": person["relation"]}, ensure_ascii=False
            ),
            status=status,
            source="lock",
            created_by=created_by,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        created.append(row)
    return created


def codex_entities(
    db: Session,
    *,
    space_id: str,
    subject_identity_id: str | None = None,
    approved_only: bool = True,
) -> list[FamilyEntity]:
    query = db.query(FamilyEntity).filter(FamilyEntity.space_id == space_id)
    if approved_only:
        query = query.filter(FamilyEntity.status == "approved")
    rows = query.order_by(FamilyEntity.canonical_name.asc()).all()
    if subject_identity_id:
        rows = [
            r
            for r in rows
            if r.subject_identity_id in (None, subject_identity_id)
        ]
    return rows


def resolve_mentions(text: str, entities: list[FamilyEntity]) -> list[CodexMatch]:
    """Find codex people named in a message, longest alias first."""
    norm_text = normalize_text(text)
    if not norm_text:
        return []

    pairs: list[tuple[str, str, FamilyEntity]] = []
    for entity in entities:
        for alias in _json_list(entity.aliases_json):
            if not isinstance(alias, str) or not alias.strip():
                continue
            key = normalize_text(alias)
            if len(key) < 2:
                continue
            pairs.append((key, alias, entity))
    pairs.sort(key=lambda p: len(p[0]), reverse=True)

    by_mention: dict[str, CodexMatch] = {}
    consumed: list[tuple[int, int]] = []
    for key, alias, entity in pairs:
        for found in re.finditer(rf"(?<![\w]){re.escape(key)}(?![\w])", norm_text):
            span = (found.start(), found.end())
            # A longer alias already claimed this text ("Hương Ly" beats "Ly").
            if any(span[0] >= s and span[1] <= e for s, e in consumed):
                continue
            consumed.append(span)
            match = by_mention.setdefault(key, CodexMatch(mention=alias, entities=[]))
            if entity not in match.entities:
                match.entities.append(entity)
            break
        else:
            # Same alias may map to several people; record them all.
            match = by_mention.get(key)
            if match and entity not in match.entities:
                match.entities.append(entity)
    return list(by_mention.values())


def entity_lines(matches: list[CodexMatch]) -> list[str]:
    lines: list[str] = []
    for match in matches:
        for entity in match.entities:
            relation = _json_dict(entity.relation_json).get("to_subject") or "người thân"
            line = f"- «{match.mention}» → {entity.canonical_name} ({relation})"
            if entity.disambiguation:
                line += f" — {entity.disambiguation}"
            lines.append(line)
    return lines


def clarify_question(matches: list[CodexMatch]) -> str | None:
    """Ai đang bị nhắc tới, khi một cái tên trỏ tới nhiều người.

    Chỉ trả về phần tên. Câu hỏi lại được dựng ở tầng 1 bằng xưng hô của người
    đang nói (`heritage_rules_app.clarify_line`) — codex không biết ai đang nói.
    """
    for match in matches:
        if not match.ambiguous:
            continue
        return " hay ".join(
            f"{e.canonical_name} ({_json_dict(e.relation_json).get('to_subject') or 'người thân'})"
            for e in match.entities[:3]
        )
    return None
