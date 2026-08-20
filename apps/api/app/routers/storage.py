from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..access import require_steward_or_owner
from ..auth import get_current_user
from ..db import get_db
from ..models import FamilySpace, User
from ..services.storage_usage import summarize_storage

router = APIRouter(prefix="/api/spaces", tags=["storage"])


@router.get("/{space_id}/storage")
def get_storage(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Steward/owner dashboard — this house's files plus the uploads volume."""
    space = db.query(FamilySpace).filter(FamilySpace.id == space_id).one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="Family space not found.")
    require_steward_or_owner(db, space_id=space_id, user=user)
    return summarize_storage(space_id)
