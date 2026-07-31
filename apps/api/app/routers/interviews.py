from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..access import require_membership
from ..auth import get_current_user
from ..db import get_db
from ..models import InterviewAnswer, InterviewPrompt, MemoryItem, User
from ..services.storage import save_upload

router = APIRouter(tags=["interviews"])


class TextAnswerBody(BaseModel):
    body: str = Field(min_length=1, max_length=8000)
    title: str = Field(default="", max_length=200)


def _prompt_payload(prompt: InterviewPrompt, answered: bool, memory_id: str | None) -> dict:
    return {
        "id": prompt.id,
        "body": prompt.body,
        "sort_order": prompt.sort_order,
        "answered": answered,
        "memory_item_id": memory_id,
    }


@router.get("/api/spaces/{space_id}/interview/prompts")
def list_prompts(
    space_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    prompts = (
        db.query(InterviewPrompt)
        .filter(
            InterviewPrompt.active.is_(True),
            or_(InterviewPrompt.space_id.is_(None), InterviewPrompt.space_id == space_id),
        )
        .order_by(InterviewPrompt.sort_order.asc(), InterviewPrompt.created_at.asc())
        .all()
    )
    answers = (
        db.query(InterviewAnswer)
        .filter(
            InterviewAnswer.space_id == space_id,
            InterviewAnswer.user_id == user.id,
        )
        .all()
    )
    by_prompt = {a.prompt_id: a for a in answers}
    return {
        "prompts": [
            _prompt_payload(
                p,
                p.id in by_prompt,
                by_prompt[p.id].memory_item_id if p.id in by_prompt else None,
            )
            for p in prompts
        ]
    }


def _create_answer(
    *,
    db: Session,
    space_id: str,
    prompt: InterviewPrompt,
    user: User,
    kind: str,
    title: str,
    body: str,
    media_path: str | None,
    media_mime: str | None,
) -> dict:
    existing = (
        db.query(InterviewAnswer)
        .filter(
            InterviewAnswer.prompt_id == prompt.id,
            InterviewAnswer.space_id == space_id,
            InterviewAnswer.user_id == user.id,
        )
        .one_or_none()
    )
    if existing:
        raise HTTPException(status_code=409, detail="You already answered this prompt.")

    now = datetime.now(timezone.utc)
    memory = MemoryItem(
        id=generate(),
        space_id=space_id,
        created_by=user.id,
        kind=kind,
        title=title.strip() or "Time-Capsule",
        body=body.strip(),
        media_path=media_path,
        media_mime=media_mime,
        source_message_id=None,
        tags="time-capsule",
        occurred_at=now,
        created_at=now,
    )
    db.add(memory)
    db.flush()

    answer = InterviewAnswer(
        id=generate(),
        prompt_id=prompt.id,
        space_id=space_id,
        user_id=user.id,
        memory_item_id=memory.id,
        created_at=now,
    )
    db.add(answer)
    db.commit()
    db.refresh(memory)
    return {
        "answer_id": answer.id,
        "prompt_id": prompt.id,
        "memory": {
            "id": memory.id,
            "space_id": memory.space_id,
            "created_by": memory.created_by,
            "creator_name": user.name,
            "kind": memory.kind,
            "title": memory.title,
            "body": memory.body,
            "has_media": bool(memory.media_path),
            "media_mime": memory.media_mime,
            "source_message_id": memory.source_message_id,
            "tags": memory.tags,
            "occurred_at": memory.occurred_at.isoformat() if memory.occurred_at else None,
            "created_at": memory.created_at.isoformat(),
        },
    }


@router.post("/api/spaces/{space_id}/interview/prompts/{prompt_id}/answers")
def answer_prompt_text(
    space_id: str,
    prompt_id: str,
    body: TextAnswerBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    require_membership(db, space_id=space_id, user=user)
    prompt = db.query(InterviewPrompt).filter(InterviewPrompt.id == prompt_id).one_or_none()
    if not prompt or not prompt.active:
        raise HTTPException(status_code=404, detail="Prompt not found.")
    if prompt.space_id is not None and prompt.space_id != space_id:
        raise HTTPException(status_code=404, detail="Prompt not found.")

    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Answer cannot be empty.")

    return _create_answer(
        db=db,
        space_id=space_id,
        prompt=prompt,
        user=user,
        kind="note",
        title=(body.title or "").strip() or "Trả lời Time-Capsule",
        body=text,
        media_path=None,
        media_mime=None,
    )


@router.post("/api/spaces/{space_id}/interview/prompts/{prompt_id}/answers/voice")
async def answer_prompt_voice(
    space_id: str,
    prompt_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
    title: str = Form(default=""),
    body: str = Form(default=""),
):
    require_membership(db, space_id=space_id, user=user)
    prompt = db.query(InterviewPrompt).filter(InterviewPrompt.id == prompt_id).one_or_none()
    if not prompt or not prompt.active:
        raise HTTPException(status_code=404, detail="Prompt not found.")
    if prompt.space_id is not None and prompt.space_id != space_id:
        raise HTTPException(status_code=404, detail="Prompt not found.")

    relative, mime = save_upload(space_id, file)
    if not mime.startswith("audio/"):
        raise HTTPException(status_code=400, detail="Voice answer must be an audio file.")

    caption = (body or "").strip() or prompt.body
    return _create_answer(
        db=db,
        space_id=space_id,
        prompt=prompt,
        user=user,
        kind="voice",
        title=(title or "").strip() or "Voice Time-Capsule",
        body=caption,
        media_path=relative,
        media_mime=mime,
    )
