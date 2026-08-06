"""Snapshots of the Identity Lock — so a change is never permanent.

Every real edit of the lock writes the previous state here first. Restoring
an older revision does the same for the live row, so undo is itself reversible.
Status, linking and archiving stay out of the snapshot: those are other doors.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from nanoid import generate
from sqlalchemy.orm import Session

from ..models import IdentityProfile, IdentityProfileRevision, User


def _parse(raw: str | None) -> Any:
    if not raw or not str(raw).strip():
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def lock_snapshot(row: IdentityProfile) -> dict[str, Any]:
    """The fields a revision remembers — name and the Identity Lock only."""
    reviewed_at = getattr(row, "profile_reviewed_at", None)
    return {
        "display_name": row.display_name,
        "relation_label": row.relation_label or "",
        "life_stage": _parse(getattr(row, "life_stage_json", None)),
        "roles": _parse(getattr(row, "roles_json", None)),
        "address_forms": _parse(getattr(row, "address_forms_json", None)),
        "speech_style": _parse(getattr(row, "speech_style_json", None)),
        "core_values": _parse(getattr(row, "core_values_json", None)),
        "philosophy": _parse(getattr(row, "philosophy_json", None)),
        "taboos": _parse(getattr(row, "taboos_json", None)),
        "poetry_quote_mode": getattr(row, "poetry_quote_mode", None) or "paraphrase",
        "dynamic_context": getattr(row, "dynamic_context", None) or "",
        "family_context_opt_in": bool(getattr(row, "family_context_opt_in", False)),
        "profile_reviewed_at": reviewed_at.isoformat() if reviewed_at else None,
        "profile_reviewed_by": getattr(row, "profile_reviewed_by", None),
    }


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def apply_lock_snapshot(row: IdentityProfile, snapshot: dict[str, Any]) -> None:
    """Write a stored revision onto the live profile."""

    def _dump(value: Any) -> str:
        if value is None:
            return ""
        return json.dumps(value, ensure_ascii=False)

    if "display_name" in snapshot and snapshot["display_name"] is not None:
        row.display_name = str(snapshot["display_name"]).strip() or row.display_name
    if "relation_label" in snapshot:
        row.relation_label = str(snapshot.get("relation_label") or "").strip()
    row.life_stage_json = _dump(snapshot.get("life_stage"))
    row.roles_json = _dump(snapshot.get("roles"))
    row.address_forms_json = _dump(snapshot.get("address_forms"))
    row.speech_style_json = _dump(snapshot.get("speech_style"))
    row.core_values_json = _dump(snapshot.get("core_values"))
    row.philosophy_json = _dump(snapshot.get("philosophy"))
    row.taboos_json = _dump(snapshot.get("taboos"))
    mode = snapshot.get("poetry_quote_mode") or "paraphrase"
    row.poetry_quote_mode = mode if mode in ("paraphrase", "verbatim") else "paraphrase"
    row.dynamic_context = str(snapshot.get("dynamic_context") or "").strip()
    row.family_context_opt_in = bool(snapshot.get("family_context_opt_in", False))

    reviewed_raw = snapshot.get("profile_reviewed_at")
    if reviewed_raw:
        try:
            row.profile_reviewed_at = datetime.fromisoformat(str(reviewed_raw))
        except ValueError:
            row.profile_reviewed_at = None
        row.profile_reviewed_by = snapshot.get("profile_reviewed_by")
    else:
        row.profile_reviewed_at = None
        row.profile_reviewed_by = None


def proposed_lock_from_body(row: IdentityProfile, body: Any) -> dict[str, Any]:
    """What the lock would look like after applying this PATCH body."""
    proposed = lock_snapshot(row)

    if getattr(body, "display_name", None) is not None:
        proposed["display_name"] = body.display_name.strip()
    if getattr(body, "relation_label", None) is not None:
        proposed["relation_label"] = body.relation_label.strip()
    if getattr(body, "life_stage", None) is not None:
        proposed["life_stage"] = body.life_stage
    if getattr(body, "roles", None) is not None:
        proposed["roles"] = body.roles
    if getattr(body, "address_forms", None) is not None:
        proposed["address_forms"] = body.address_forms
    if getattr(body, "speech_style", None) is not None:
        proposed["speech_style"] = body.speech_style
    if getattr(body, "core_values", None) is not None:
        proposed["core_values"] = body.core_values
    if getattr(body, "philosophy", None) is not None:
        proposed["philosophy"] = body.philosophy
    if getattr(body, "taboos", None) is not None:
        proposed["taboos"] = body.taboos
    if getattr(body, "poetry_quote_mode", None) is not None:
        proposed["poetry_quote_mode"] = body.poetry_quote_mode
    if getattr(body, "dynamic_context", None) is not None:
        proposed["dynamic_context"] = body.dynamic_context.strip()
    if getattr(body, "family_context_opt_in", None) is not None:
        proposed["family_context_opt_in"] = body.family_context_opt_in

    mark = getattr(body, "mark_profile_reviewed", None)
    if mark is True:
        proposed["profile_reviewed_at"] = datetime.now(timezone.utc).isoformat()
        # Actor filled in at write time; for equality we only care that review flips on.
        proposed["profile_reviewed_by"] = proposed.get("profile_reviewed_by") or "__pending__"
    elif mark is False:
        proposed["profile_reviewed_at"] = None
        proposed["profile_reviewed_by"] = None

    return proposed


def lock_would_change(row: IdentityProfile, body: Any) -> bool:
    """True when the PATCH touches name or Identity Lock content."""
    current = lock_snapshot(row)
    proposed = proposed_lock_from_body(row, body)
    # Review stamp always gets a fresh timestamp on mark=True, so compare the
    # boolean "is reviewed" rather than the exact instant.
    current_reviewed = bool(current.get("profile_reviewed_at"))
    proposed_reviewed = bool(proposed.get("profile_reviewed_at"))
    current_cmp = {**current, "profile_reviewed_at": current_reviewed, "profile_reviewed_by": None}
    proposed_cmp = {
        **proposed,
        "profile_reviewed_at": proposed_reviewed,
        "profile_reviewed_by": None,
    }
    return _canonical(current_cmp) != _canonical(proposed_cmp)


def record_revision(
    db: Session,
    *,
    row: IdentityProfile,
    user_id: str,
) -> IdentityProfileRevision:
    """Persist the live lock as a revision, before the next write lands."""
    rev = IdentityProfileRevision(
        id=generate(),
        space_id=row.space_id,
        identity_id=row.id,
        snapshot_json=json.dumps(lock_snapshot(row), ensure_ascii=False),
        created_by=user_id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(rev)
    db.flush()
    return rev


def revision_payload(db: Session, rev: IdentityProfileRevision) -> dict[str, Any]:
    author = db.query(User).filter(User.id == rev.created_by).one_or_none()
    snap: dict[str, Any] = {}
    try:
        parsed = json.loads(rev.snapshot_json or "{}")
        if isinstance(parsed, dict):
            snap = parsed
    except json.JSONDecodeError:
        snap = {}
    return {
        "id": rev.id,
        "space_id": rev.space_id,
        "identity_id": rev.identity_id,
        "created_at": rev.created_at.isoformat(),
        "created_by": rev.created_by,
        "created_by_name": author.name if author else None,
        "display_name": snap.get("display_name"),
        "relation_label": snap.get("relation_label"),
        "profile_reviewed": bool(snap.get("profile_reviewed_at")),
    }


def list_revisions(
    db: Session,
    *,
    space_id: str,
    identity_id: str,
) -> list[IdentityProfileRevision]:
    return (
        db.query(IdentityProfileRevision)
        .filter(
            IdentityProfileRevision.space_id == space_id,
            IdentityProfileRevision.identity_id == identity_id,
        )
        .order_by(IdentityProfileRevision.created_at.desc())
        .all()
    )
