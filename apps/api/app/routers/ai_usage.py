from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..access import require_steward_or_owner
from ..auth import get_current_user
from ..db import get_db
from ..models import FamilySpace, User
from ..services.ai_usage import aggregate_space_usage

router = APIRouter(prefix="/api/spaces", tags=["ai-usage"])


@router.get("/{space_id}/ai-usage")
def get_ai_usage(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    days: int = Query(default=30, ge=1, le=366),
):
    """Steward/owner dashboard — estimated AI spend for this family space."""
    space = db.query(FamilySpace).filter(FamilySpace.id == space_id).one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="Family space not found.")
    require_steward_or_owner(db, space_id=space_id, user=user)
    return aggregate_space_usage(db, space_id=space_id, days=days)
