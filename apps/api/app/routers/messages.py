from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import FileResponse
from nanoid import generate
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..access import require_thread_access
from ..auth import get_current_user
from ..config import get_settings
from ..db import SessionLocal, get_db
from ..models import IdentityProfile, Message, Thread, User
from ..services.agent import maybe_reply, sender_display_name, sender_handle
from ..services.audio_combine import probe_duration_ms
from ..services.heritage_chat import (
    heritage_awaiting_reply,
    heritage_display_name,
    identity_for_heritage_thread,
    maybe_heritage_reply,
)
from ..services.heritage import heritage_handle, living_room_identity_for_space
from ..services.storage import absolute_media_path, save_upload
from ..services.stt import transcribe
from ..services.usage_quota import (
    assert_can_spend_turn,
    get_policy,
    record_heritage_turn,
)

router = APIRouter(prefix="/api/threads", tags=["messages"])
media_router = APIRouter(prefix="/api/messages", tags=["messages"])

logger = logging.getLogger(__name__)


class SendMessageBody(BaseModel):
    body: str = Field(min_length=1, max_length=8000)


def _identity_for_heritage_message(
    db: Session, thread: Thread, message: Message | None = None
) -> IdentityProfile | None:
    if thread.kind == "heritage":
        return identity_for_heritage_thread(db, thread.id)
    if message is not None:
        raw = getattr(message, "meta_json", None) or ""
        if raw.strip():
            try:
                meta = json.loads(raw)
            except json.JSONDecodeError:
                meta = None
            if isinstance(meta, dict):
                identity_id = meta.get("heritage_identity_id")
                if identity_id:
                    return (
                        db.query(IdentityProfile)
                        .filter(IdentityProfile.id == identity_id)
                        .one_or_none()
                    )
    if thread.kind == "family":
        # Replies carry heritage_identity_id; this only covers rows written
        # before Phòng khách could seat more than one remembered person.
        return living_room_identity_for_space(db, thread.space_id)
    return None


def _heritage_sender_name(
    db: Session, thread: Thread, sender_kind: str, message: Message | None = None
) -> str | None:
    if sender_kind != "heritage":
        return None
    identity = _identity_for_heritage_message(db, thread, message)
    if not identity:
        return "Ký ức"
    return heritage_display_name(identity)


def _heritage_sender_handle(
    db: Session, thread: Thread, sender_kind: str, message: Message | None = None
) -> str | None:
    if sender_kind != "heritage":
        return None
    identity = _identity_for_heritage_message(db, thread, message)
    if not identity:
        return None
    return heritage_handle(identity)


def _apply_stt(db: Session, message: Message) -> None:
    """Fill Message.body from audio when caption is empty. Never raises."""
    settings = get_settings()
    if not settings.stt_enabled:
        return
    if (message.kind or "") != "voice":
        return
    if not message.media_path:
        return
    if (message.body or "").strip():
        return

    path = absolute_media_path(message.media_path)
    transcript = transcribe(
        settings, path=path, mime=getattr(message, "media_mime", None)
    )
    meta: dict = {}
    raw = getattr(message, "meta_json", None) or ""
    if raw.strip():
        try:
            loaded = json.loads(raw)
            if isinstance(loaded, dict):
                meta = loaded
        except json.JSONDecodeError:
            meta = {}
    meta["stt"] = transcript.as_meta()
    if transcript.ok:
        message.body = transcript.text.strip()[:8000]
    message.meta_json = json.dumps(meta, ensure_ascii=False)
    db.add(message)
    db.commit()
    db.refresh(message)


def _heritage_reply_job(thread_id: str, message_id: str) -> None:
    """Run the heritage pipeline on its own session, after the response is sent.

    FastAPI closes the request-scoped session before background tasks run, so
    this reloads the rows it needs. Errors stay here: a failed reply must never
    surface as a failed send.
    """
    db = SessionLocal()
    try:
        thread = db.query(Thread).filter(Thread.id == thread_id).one_or_none()
        message = db.query(Message).filter(Message.id == message_id).one_or_none()
        if thread and message:
            if (message.kind or "") == "voice":
                _apply_stt(db, message)
            if thread.kind == "family":
                # Phòng khách: whoever was called — a remembered person first,
                # then Người giữ nhà. Nobody called means nobody answers.
                if maybe_heritage_reply(db, thread=thread, user_message=message) is None:
                    maybe_reply(db, thread=thread, user_message=message)
            else:
                maybe_heritage_reply(db, thread=thread, user_message=message)
    except Exception:
        logger.exception("heritage reply failed for message %s", message_id)
    finally:
        db.close()


def _voice_message_job(thread_id: str, message_id: str) -> None:
    """STT a voice note, then run the usual auto-reply path for that thread."""
    db = SessionLocal()
    try:
        thread = db.query(Thread).filter(Thread.id == thread_id).one_or_none()
        message = db.query(Message).filter(Message.id == message_id).one_or_none()
        if not thread or not message:
            return
        _apply_stt(db, message)
        if thread.kind == "heritage":
            maybe_heritage_reply(db, thread=thread, user_message=message)
        elif thread.kind == "family":
            if maybe_heritage_reply(db, thread=thread, user_message=message) is None:
                maybe_reply(db, thread=thread, user_message=message)
        else:
            maybe_reply(db, thread=thread, user_message=message)
    except Exception:
        logger.exception("voice message job failed for message %s", message_id)
    finally:
        db.close()


def _dispatch_auto_reply(
    db: Session,
    *,
    thread: Thread,
    user_message: Message,
    background: BackgroundTasks | None = None,
) -> None:
    settings = get_settings()
    if thread.kind == "heritage":
        if background is not None and settings.heritage_async_reply:
            background.add_task(_heritage_reply_job, thread.id, user_message.id)
            return
        if (user_message.kind or "") == "voice":
            _apply_stt(db, user_message)
        maybe_heritage_reply(db, thread=thread, user_message=user_message)
        return

    if thread.kind == "family":
        # Async path covers both bố and agent so the HTTP send stays fast.
        if background is not None and settings.heritage_async_reply:
            background.add_task(_heritage_reply_job, thread.id, user_message.id)
            return
        if maybe_heritage_reply(db, thread=thread, user_message=user_message) is None:
            maybe_reply(db, thread=thread, user_message=user_message)
        return

    maybe_reply(db, thread=thread, user_message=user_message)


def _dispatch_voice_message(
    db: Session,
    *,
    thread: Thread,
    user_message: Message,
    background: BackgroundTasks | None = None,
) -> None:
    """Voice notes always STT before any reply so heritage reads a real body."""
    settings = get_settings()
    async_ok = background is not None and (
        thread.kind != "heritage" or settings.heritage_async_reply
    )
    if async_ok:
        background.add_task(_voice_message_job, thread.id, user_message.id)
        return
    _apply_stt(db, user_message)
    if thread.kind == "heritage":
        maybe_heritage_reply(db, thread=thread, user_message=user_message)
    elif thread.kind == "family":
        if maybe_heritage_reply(db, thread=thread, user_message=user_message) is None:
            maybe_reply(db, thread=thread, user_message=user_message)
    else:
        maybe_reply(db, thread=thread, user_message=user_message)


def _message_payload(
    message: Message,
    *,
    sender_name: str | None,
    handle: str | None,
) -> dict:
    kind = getattr(message, "kind", None) or "text"
    meta_raw = getattr(message, "meta_json", None) or ""
    meta = None
    if meta_raw.strip():
        try:
            meta = json.loads(meta_raw)
        except json.JSONDecodeError:
            meta = None
    return {
        "id": message.id,
        "thread_id": message.thread_id,
        "sender_user_id": message.sender_user_id,
        "sender_kind": message.sender_kind,
        "sender_name": sender_name,
        "sender_handle": handle,
        "kind": kind,
        "body": message.body,
        "has_media": bool(getattr(message, "media_path", None)),
        "media_mime": getattr(message, "media_mime", None),
        "meta": meta,
        "created_at": message.created_at.isoformat(),
    }


def preview_body(message: Message) -> str:
    kind = getattr(message, "kind", None) or "text"
    text = (message.body or "").strip()
    if kind == "voice":
        return text or "[Giọng nói]"
    return text


def _assert_heritage_quota(db: Session, *, thread: Thread, user: User) -> None:
    if (thread.kind or "") != "heritage":
        return
    assert_can_spend_turn(db, space_id=thread.space_id, user_id=user.id)


def _record_heritage_quota(db: Session, *, thread: Thread, user: User) -> None:
    if (thread.kind or "") != "heritage":
        return
    record_heritage_turn(db, space_id=thread.space_id, user_id=user.id)


def _reject_oversized_utterance(
    db: Session, *, thread: Thread, relative_path: str
) -> None:
    """Hard-cap voice length on heritage threads (client should already have cut)."""
    if (thread.kind or "") != "heritage":
        return
    policy = get_policy(db, thread.space_id)
    limit_ms = policy.max_utterance_sec * 1000 + 5_000
    path = absolute_media_path(relative_path)
    duration_ms = probe_duration_ms(path)
    if duration_ms is None:
        return
    if duration_ms > limit_ms:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Đoạn ghi quá dài (tối đa {policy.max_utterance_sec} giây). "
                "Hãy nói ngắn hơn rồi gửi lại."
            ),
        )


@router.get("/{thread_id}/messages")
def list_messages(
    thread_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(default=50, ge=1, le=200),
    before: str | None = None,
):
    thread = db.query(Thread).filter(Thread.id == thread_id).one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")
    require_thread_access(db, thread=thread, user=user)

    query = db.query(Message).filter(Message.thread_id == thread_id)
    if before:
        anchor = db.query(Message).filter(Message.id == before).one_or_none()
        if anchor:
            query = query.filter(Message.created_at < anchor.created_at)
    messages = query.order_by(Message.created_at.desc()).limit(limit).all()
    messages.reverse()

    user_ids = {m.sender_user_id for m in messages if m.sender_user_id}
    profiles: dict[str, User] = {}
    if user_ids:
        for row in db.query(User).filter(User.id.in_(user_ids)).all():
            profiles[row.id] = row

    return {
        "messages": [
            _message_payload(
                m,
                sender_name=(
                    _heritage_sender_name(db, thread, m.sender_kind, m)
                    if m.sender_kind == "heritage"
                    else sender_display_name(
                        m.sender_kind,
                        profiles[m.sender_user_id].name
                        if m.sender_user_id in profiles
                        else None,
                    )
                ),
                handle=(
                    _heritage_sender_handle(db, thread, m.sender_kind, m)
                    if m.sender_kind == "heritage"
                    else sender_handle(
                        m.sender_kind,
                        profiles[m.sender_user_id].handle
                        if m.sender_user_id in profiles
                        else None,
                    )
                ),
            )
            for m in messages
        ]
    }


@router.post("/{thread_id}/messages")
def send_message(
    thread_id: str,
    body: SendMessageBody,
    background: BackgroundTasks,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    thread = db.query(Thread).filter(Thread.id == thread_id).one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")
    require_thread_access(db, thread=thread, user=user)

    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    _assert_heritage_quota(db, thread=thread, user=user)

    message = Message(
        id=generate(),
        thread_id=thread_id,
        sender_user_id=user.id,
        sender_kind="user",
        kind="text",
        body=text,
        media_path=None,
        media_mime=None,
        created_at=datetime.now(timezone.utc),
    )
    db.add(message)
    _record_heritage_quota(db, thread=thread, user=user)
    db.commit()
    db.refresh(message)

    _dispatch_auto_reply(db, thread=thread, user_message=message, background=background)

    payload = _message_payload(
        message,
        sender_name=user.name,
        handle=user.handle,
    )
    payload["heritage_awaiting_reply"] = heritage_awaiting_reply(
        db, thread=thread, user_text=text
    )
    return payload


@router.post("/{thread_id}/messages/voice")
async def send_voice_message(
    thread_id: str,
    background: BackgroundTasks,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    file: UploadFile = File(...),
    body: str = Form(default=""),
):
    thread = db.query(Thread).filter(Thread.id == thread_id).one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")
    require_thread_access(db, thread=thread, user=user)

    _assert_heritage_quota(db, thread=thread, user=user)

    relative, mime = save_upload(thread.space_id, file)
    if not mime.startswith("audio/"):
        raise HTTPException(status_code=400, detail="Voice message must be an audio file.")

    _reject_oversized_utterance(db, thread=thread, relative_path=relative)

    caption = (body or "").strip()[:8000]
    message = Message(
        id=generate(),
        thread_id=thread_id,
        sender_user_id=user.id,
        sender_kind="user",
        kind="voice",
        body=caption,
        media_path=relative,
        media_mime=mime,
        created_at=datetime.now(timezone.utc),
    )
    db.add(message)
    _record_heritage_quota(db, thread=thread, user=user)
    db.commit()
    db.refresh(message)

    _dispatch_voice_message(
        db, thread=thread, user_message=message, background=background
    )

    payload = _message_payload(
        message,
        sender_name=user.name,
        handle=user.handle,
    )
    # STT runs async, so an empty caption cannot say who was called. In their own
    # room a reply is certain; in Phòng khách it depends on the words, and a
    # spinner that usually resolves to silence is worse than none.
    awaiting = heritage_awaiting_reply(db, thread=thread, user_text=caption)
    if not caption and thread.kind == "heritage":
        awaiting = True
    payload["heritage_awaiting_reply"] = awaiting
    return payload


@media_router.get("/{message_id}/media")
def get_message_media(
    message_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    message = db.query(Message).filter(Message.id == message_id).one_or_none()
    if not message or not message.media_path:
        raise HTTPException(status_code=404, detail="Media not found.")
    thread = db.query(Thread).filter(Thread.id == message.thread_id).one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")
    require_thread_access(db, thread=thread, user=user)
    path = absolute_media_path(message.media_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Media file missing.")
    return FileResponse(
        path,
        media_type=message.media_mime or "application/octet-stream",
        filename=path.name,
    )
