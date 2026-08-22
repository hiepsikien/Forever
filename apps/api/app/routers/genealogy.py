"""Family genealogy chart — nodes, parent/child and spouse edges (multi-spouse)."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..access import require_membership, require_moderator_or_above
from ..auth import get_current_user
from ..db import get_db
from ..models import FamilyTreeEdge, FamilyTreeNode, IdentityProfile, MemoryItem, User
from ..services.heritage import tag_tokens
from ..services.storage import (
    IMAGE_MIME,
    absolute_media_path,
    delete_media_artifacts,
    save_upload,
)

router = APIRouter(tags=["genealogy"])

GENDER_HINTS = frozenset({"male", "female", "unknown"})
PARENT_ROLES = frozenset({"father", "mother", "unknown"})
EDGE_KINDS = frozenset({"parent", "spouse"})
GIA_PHA_TAG_PREFIX = "gia-pha:"
_DEATH_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def _parse_meta(raw: str) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _dump_meta(meta: dict[str, Any] | None) -> str:
    if not meta:
        return ""
    return json.dumps(meta, ensure_ascii=False)


def _node_row(db: Session, node: FamilyTreeNode) -> dict[str, Any]:
    profile = None
    if node.identity_profile_id:
        profile = (
            db.query(IdentityProfile)
            .filter(IdentityProfile.id == node.identity_profile_id)
            .one_or_none()
        )
    return {
        "id": node.id,
        "space_id": node.space_id,
        "identity_profile_id": node.identity_profile_id,
        "display_name": node.display_name,
        "birth_year": node.birth_year,
        "death_year": node.death_year,
        "death_date": node.death_date,
        "gender_hint": node.gender_hint or "unknown",
        "birth_order": node.birth_order,
        "notes": node.notes or "",
        "con_rieng": bool(node.con_rieng),
        "has_photo": bool(node.photo_path),
        "photo_mime": node.photo_mime if node.photo_path else None,
        "identity_status": profile.status if profile else None,
        "created_at": node.created_at.isoformat(),
        "updated_at": node.updated_at.isoformat(),
    }


def _edge_row(edge: FamilyTreeEdge) -> dict[str, Any]:
    return {
        "id": edge.id,
        "space_id": edge.space_id,
        "from_node_id": edge.from_node_id,
        "to_node_id": edge.to_node_id,
        "kind": edge.kind,
        "meta": _parse_meta(edge.meta_json),
        "created_at": edge.created_at.isoformat(),
    }


def _get_node_or_404(
    db: Session, *, space_id: str, node_id: str
) -> FamilyTreeNode:
    node = (
        db.query(FamilyTreeNode)
        .filter(FamilyTreeNode.id == node_id, FamilyTreeNode.space_id == space_id)
        .one_or_none()
    )
    if not node:
        raise HTTPException(status_code=404, detail="Không tìm thấy người trong gia phả.")
    return node


def _get_edge_or_404(
    db: Session, *, space_id: str, edge_id: str
) -> FamilyTreeEdge:
    edge = (
        db.query(FamilyTreeEdge)
        .filter(FamilyTreeEdge.id == edge_id, FamilyTreeEdge.space_id == space_id)
        .one_or_none()
    )
    if not edge:
        raise HTTPException(status_code=404, detail="Không tìm thấy quan hệ.")
    return edge


def _normalize_death_date(value: str | None) -> str | None:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    match = _DEATH_DATE_RE.fullmatch(raw)
    if not match:
        raise HTTPException(
            status_code=400, detail="Ngày mất phải là YYYY-MM-DD (dương lịch)."
        )
    year, month, day = int(match.group(1)), int(match.group(2)), int(match.group(3))
    if year < 1000 or year > 2200:
        raise HTTPException(status_code=400, detail="Năm mất không hợp lệ.")
    try:
        datetime(year, month, day)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Ngày mất không hợp lệ.") from exc
    return f"{year:04d}-{month:02d}-{day:02d}"


def _apply_death_fields(
    node: FamilyTreeNode,
    *,
    death_year: int | None,
    death_date: str | None,
    clear_death_date: bool,
) -> None:
    if clear_death_date:
        node.death_date = None
        if death_year is None:
            node.death_year = None
    normalized = _normalize_death_date(death_date)
    if normalized is not None:
        node.death_date = normalized
        node.death_year = int(normalized[:4])
    elif death_year is not None:
        node.death_year = death_year


def _upsert_death_calendar(
    db: Session,
    *,
    space_id: str,
    user: User,
    node: FamilyTreeNode,
) -> None:
    """Write ngày mất onto the family calendar when a full solar date is known."""
    death_date = (node.death_date or "").strip()
    if not death_date:
        return
    occurred = datetime.fromisoformat(death_date).replace(tzinfo=timezone.utc)
    node_tag = f"{GIA_PHA_TAG_PREFIX}{node.id}"
    existing = None
    for item in (
        db.query(MemoryItem)
        .filter(MemoryItem.space_id == space_id, MemoryItem.kind == "milestone")
        .all()
    ):
        if node_tag in tag_tokens(item.tags):
            existing = item
            break

    parts = [node_tag, "lich:mat", "lich-precision:day"]
    if node.identity_profile_id:
        heritage = f"{HERITAGE_TAG_PREFIX}{node.identity_profile_id}"
        if heritage not in parts:
            parts.append(heritage)
    tags = " ".join(parts)
    title = (
        "Ngày mất"
        if node.identity_profile_id
        else f"Ngày mất · {node.display_name}"
    )
    day, month, year = death_date[8:10], death_date[5:7], death_date[:4]
    body = f"{node.display_name} mất ngày {int(day)}/{int(month)}/{year}."
    now = datetime.now(timezone.utc)
    if existing:
        existing.title = title
        existing.body = body
        existing.occurred_at = occurred
        tokens = [
            t
            for t in tag_tokens(existing.tags)
            if not t.startswith(GIA_PHA_TAG_PREFIX)
            and not t.startswith("lich:")
            and t != "lich-precision:day"
            and t != "lich-precision:year"
        ]
        existing.tags = " ".join(dict.fromkeys([*parts, *tokens]))[:500]
        return
    db.add(
        MemoryItem(
            id=generate(),
            space_id=space_id,
            created_by=user.id,
            kind="milestone",
            title=title,
            body=body,
            tags=tags,
            occurred_at=occurred,
            created_at=now,
        )
    )


def _validate_node_refs(db: Session, *, space_id: str, from_id: str, to_id: str) -> None:
    if from_id == to_id:
        raise HTTPException(status_code=400, detail="Không thể nối một người với chính họ.")
    _get_node_or_404(db, space_id=space_id, node_id=from_id)
    _get_node_or_404(db, space_id=space_id, node_id=to_id)


def _find_spouse_edge(
    db: Session, *, space_id: str, a_id: str, b_id: str
) -> FamilyTreeEdge | None:
    return (
        db.query(FamilyTreeEdge)
        .filter(
            FamilyTreeEdge.space_id == space_id,
            FamilyTreeEdge.kind == "spouse",
            (
                (
                    (FamilyTreeEdge.from_node_id == a_id)
                    & (FamilyTreeEdge.to_node_id == b_id)
                )
                | (
                    (FamilyTreeEdge.from_node_id == b_id)
                    & (FamilyTreeEdge.to_node_id == a_id)
                )
            ),
        )
        .one_or_none()
    )


class CreateNodeBody(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    identity_profile_id: str | None = None
    birth_year: int | None = Field(default=None, ge=1000, le=2200)
    death_year: int | None = Field(default=None, ge=1000, le=2200)
    death_date: str | None = Field(default=None, max_length=10)
    gender_hint: str = Field(default="unknown", max_length=16)
    birth_order: int | None = Field(default=None, ge=1, le=99)
    notes: str = Field(default="", max_length=4000)
    con_rieng: bool = False


class UpdateNodeBody(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    identity_profile_id: str | None = None
    birth_year: int | None = Field(default=None, ge=1000, le=2200)
    death_year: int | None = Field(default=None, ge=1000, le=2200)
    death_date: str | None = Field(default=None, max_length=10)
    clear_death_date: bool = False
    gender_hint: str | None = Field(default=None, max_length=16)
    birth_order: int | None = Field(default=None, ge=1, le=99)
    notes: str | None = Field(default=None, max_length=4000)
    con_rieng: bool | None = None
    clear_identity_profile_id: bool = False


class CreateEdgeBody(BaseModel):
    from_node_id: str = Field(min_length=1, max_length=32)
    to_node_id: str = Field(min_length=1, max_length=32)
    kind: str = Field(min_length=1, max_length=16)
    meta: dict[str, Any] = Field(default_factory=dict)


class UpdateEdgeBody(BaseModel):
    meta: dict[str, Any] = Field(default_factory=dict)


@router.get("/api/spaces/{space_id}/genealogy")
def get_genealogy(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    nodes = (
        db.query(FamilyTreeNode)
        .filter(FamilyTreeNode.space_id == space_id)
        .order_by(FamilyTreeNode.created_at.asc())
        .all()
    )
    edges = (
        db.query(FamilyTreeEdge)
        .filter(FamilyTreeEdge.space_id == space_id)
        .order_by(FamilyTreeEdge.created_at.asc())
        .all()
    )
    return {
        "nodes": [_node_row(db, n) for n in nodes],
        "edges": [_edge_row(e) for e in edges],
    }


@router.post("/api/spaces/{space_id}/genealogy/nodes")
def create_node(
    space_id: str,
    body: CreateNodeBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_moderator_or_above(db, space_id=space_id, user=user)
    gender = (body.gender_hint or "unknown").lower()
    if gender not in GENDER_HINTS:
        raise HTTPException(status_code=400, detail="gender_hint không hợp lệ.")

    display_name = body.display_name.strip()
    identity_profile_id = body.identity_profile_id
    if identity_profile_id:
        profile = (
            db.query(IdentityProfile)
            .filter(
                IdentityProfile.id == identity_profile_id,
                IdentityProfile.space_id == space_id,
            )
            .one_or_none()
        )
        if not profile:
            raise HTTPException(status_code=404, detail="Không tìm thấy hồ sơ trong nhà.")
        existing = (
            db.query(FamilyTreeNode)
            .filter(
                FamilyTreeNode.space_id == space_id,
                FamilyTreeNode.identity_profile_id == identity_profile_id,
            )
            .one_or_none()
        )
        if existing:
            raise HTTPException(
                status_code=400,
                detail="Hồ sơ này đã có trên gia phả.",
            )
        if not display_name:
            display_name = profile.display_name

    now = datetime.now(timezone.utc)
    node = FamilyTreeNode(
        id=generate(size=12),
        space_id=space_id,
        identity_profile_id=identity_profile_id,
        display_name=display_name,
        birth_year=body.birth_year,
        death_year=body.death_year,
        death_date=None,
        gender_hint=gender,
        birth_order=body.birth_order,
        notes=(body.notes or "").strip(),
        con_rieng=bool(body.con_rieng),
        created_by=user.id,
        created_at=now,
        updated_at=now,
    )
    _apply_death_fields(
        node,
        death_year=body.death_year,
        death_date=body.death_date,
        clear_death_date=False,
    )
    db.add(node)
    db.flush()
    _upsert_death_calendar(db, space_id=space_id, user=user, node=node)
    db.commit()
    db.refresh(node)
    return _node_row(db, node)


@router.patch("/api/spaces/{space_id}/genealogy/nodes/{node_id}")
def update_node(
    space_id: str,
    node_id: str,
    body: UpdateNodeBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_moderator_or_above(db, space_id=space_id, user=user)
    node = _get_node_or_404(db, space_id=space_id, node_id=node_id)

    if body.clear_identity_profile_id:
        node.identity_profile_id = None
    elif body.identity_profile_id is not None:
        profile = (
            db.query(IdentityProfile)
            .filter(
                IdentityProfile.id == body.identity_profile_id,
                IdentityProfile.space_id == space_id,
            )
            .one_or_none()
        )
        if not profile:
            raise HTTPException(status_code=404, detail="Không tìm thấy hồ sơ trong nhà.")
        existing = (
            db.query(FamilyTreeNode)
            .filter(
                FamilyTreeNode.space_id == space_id,
                FamilyTreeNode.identity_profile_id == body.identity_profile_id,
                FamilyTreeNode.id != node.id,
            )
            .one_or_none()
        )
        if existing:
            raise HTTPException(
                status_code=400,
                detail="Hồ sơ này đã có trên gia phả.",
            )
        node.identity_profile_id = body.identity_profile_id

    if body.display_name is not None:
        node.display_name = body.display_name.strip()
    if "birth_year" in body.model_fields_set:
        node.birth_year = body.birth_year
    _apply_death_fields(
        node,
        death_year=body.death_year,
        death_date=body.death_date,
        clear_death_date=body.clear_death_date,
    )
    if body.gender_hint is not None:
        gender = body.gender_hint.lower()
        if gender not in GENDER_HINTS:
            raise HTTPException(status_code=400, detail="gender_hint không hợp lệ.")
        node.gender_hint = gender
    if "birth_order" in body.model_fields_set:
        node.birth_order = body.birth_order
    if body.notes is not None:
        node.notes = body.notes.strip()
    if body.con_rieng is not None:
        node.con_rieng = body.con_rieng

    node.updated_at = datetime.now(timezone.utc)
    db.flush()
    _upsert_death_calendar(db, space_id=space_id, user=user, node=node)
    db.commit()
    db.refresh(node)
    return _node_row(db, node)


def _replace_node_photo(node: FamilyTreeNode, relative: str, mime: str) -> None:
    old = (node.photo_path or "").strip()
    node.photo_path = relative
    node.photo_mime = mime
    if old and old != relative:
        delete_media_artifacts(old)


@router.post("/api/spaces/{space_id}/genealogy/nodes/{node_id}/photo")
def upload_node_photo(
    space_id: str,
    node_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: Annotated[UploadFile, File()],
):
    require_moderator_or_above(db, space_id=space_id, user=user)
    node = _get_node_or_404(db, space_id=space_id, node_id=node_id)
    relative, mime = save_upload(space_id, file)
    if mime not in IMAGE_MIME:
        delete_media_artifacts(relative)
        raise HTTPException(status_code=400, detail="Ảnh mộ / bài vị phải là file ảnh.")
    _replace_node_photo(node, relative, mime)
    node.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(node)
    return _node_row(db, node)


@router.get("/api/spaces/{space_id}/genealogy/nodes/{node_id}/photo")
def get_node_photo(
    space_id: str,
    node_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    node = _get_node_or_404(db, space_id=space_id, node_id=node_id)
    if not node.photo_path:
        raise HTTPException(status_code=404, detail="Chưa có ảnh.")
    path = absolute_media_path(node.photo_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Không tìm thấy file ảnh.")
    return FileResponse(
        path,
        media_type=node.photo_mime or "application/octet-stream",
        filename=path.name,
    )


@router.delete("/api/spaces/{space_id}/genealogy/nodes/{node_id}/photo")
def delete_node_photo(
    space_id: str,
    node_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_moderator_or_above(db, space_id=space_id, user=user)
    node = _get_node_or_404(db, space_id=space_id, node_id=node_id)
    old = (node.photo_path or "").strip()
    node.photo_path = None
    node.photo_mime = None
    node.updated_at = datetime.now(timezone.utc)
    db.commit()
    if old:
        delete_media_artifacts(old)
    db.refresh(node)
    return _node_row(db, node)


@router.delete("/api/spaces/{space_id}/genealogy/nodes/{node_id}")
def delete_node(
    space_id: str,
    node_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_moderator_or_above(db, space_id=space_id, user=user)
    node = _get_node_or_404(db, space_id=space_id, node_id=node_id)
    photo = (node.photo_path or "").strip()
    db.query(FamilyTreeEdge).filter(
        FamilyTreeEdge.space_id == space_id,
        (
            (FamilyTreeEdge.from_node_id == node.id)
            | (FamilyTreeEdge.to_node_id == node.id)
        ),
    ).delete(synchronize_session=False)
    db.delete(node)
    db.commit()
    if photo:
        delete_media_artifacts(photo)
    return {"ok": True}


@router.post("/api/spaces/{space_id}/genealogy/edges")
def create_edge(
    space_id: str,
    body: CreateEdgeBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_moderator_or_above(db, space_id=space_id, user=user)
    kind = body.kind.lower()
    if kind not in EDGE_KINDS:
        raise HTTPException(status_code=400, detail="kind không hợp lệ.")

    _validate_node_refs(
        db, space_id=space_id, from_id=body.from_node_id, to_id=body.to_node_id
    )

    meta = dict(body.meta or {})
    if kind == "parent":
        role = str(meta.get("parent_role", "unknown")).lower()
        if role not in PARENT_ROLES:
            meta["parent_role"] = "unknown"
        else:
            meta["parent_role"] = role
    elif kind == "spouse":
        if _find_spouse_edge(
            db,
            space_id=space_id,
            a_id=body.from_node_id,
            b_id=body.to_node_id,
        ):
            raise HTTPException(
                status_code=400,
                detail="Hai người này đã được nối vợ/chồng.",
            )
        order = meta.get("spouse_order")
        if order is not None:
            try:
                meta["spouse_order"] = int(order)
            except (TypeError, ValueError):
                meta.pop("spouse_order", None)
        label = meta.get("spouse_label")
        if label is not None:
            meta["spouse_label"] = str(label)[:40]

    now = datetime.now(timezone.utc)
    edge = FamilyTreeEdge(
        id=generate(size=12),
        space_id=space_id,
        from_node_id=body.from_node_id,
        to_node_id=body.to_node_id,
        kind=kind,
        meta_json=_dump_meta(meta),
        created_by=user.id,
        created_at=now,
    )
    db.add(edge)
    db.commit()
    db.refresh(edge)
    return _edge_row(edge)


@router.patch("/api/spaces/{space_id}/genealogy/edges/{edge_id}")
def update_edge(
    space_id: str,
    edge_id: str,
    body: UpdateEdgeBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_moderator_or_above(db, space_id=space_id, user=user)
    edge = _get_edge_or_404(db, space_id=space_id, edge_id=edge_id)
    meta = dict(body.meta or {})
    if edge.kind == "parent":
        role = str(meta.get("parent_role", "unknown")).lower()
        if role not in PARENT_ROLES:
            meta["parent_role"] = "unknown"
        else:
            meta["parent_role"] = role
    elif edge.kind == "spouse":
        order = meta.get("spouse_order")
        if order is not None:
            try:
                meta["spouse_order"] = int(order)
            except (TypeError, ValueError):
                meta.pop("spouse_order", None)
        label = meta.get("spouse_label")
        if label is not None:
            meta["spouse_label"] = str(label)[:40]
    edge.meta_json = _dump_meta(meta)
    db.commit()
    db.refresh(edge)
    return _edge_row(edge)


@router.delete("/api/spaces/{space_id}/genealogy/edges/{edge_id}")
def delete_edge(
    space_id: str,
    edge_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_moderator_or_above(db, space_id=space_id, user=user)
    edge = _get_edge_or_404(db, space_id=space_id, edge_id=edge_id)
    db.delete(edge)
    db.commit()
    return {"ok": True}
