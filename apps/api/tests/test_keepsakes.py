from __future__ import annotations

from io import BytesIO

from tests.test_heritage_chat import _login, _ready_heritage
from tests.test_heritage_threads import _join

# Minimal JPEG (1×1) — storage only checks image/* mime.
_JPEG = (
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    b"\xff\xdb\x00C\x00" + bytes([8] * 64)
    + b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00"
    b"\xff\xc4\x00\x14\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x08"
    b"\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xd2\xcf \xff\xd9"
)


def _photo(client, headers, space_id, *, title="Tháng 10-1966", body="Thời kỳ mới cưới"):
    res = client.post(
        f"/api/spaces/{space_id}/memories/upload",
        headers=headers,
        files={"file": ("album.jpg", BytesIO(_JPEG), "image/jpeg")},
        data={
            "kind": "photo",
            "title": title,
            "body": body,
            "tags": "",
            "occurred_at": "1966-10-01",
        },
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_today_open_skip_uses_family_heritage_thread(client):
    space_id, identity_id, thread_id, headers = _ready_heritage(
        client, email="keep@example.com", name="Andy"
    )
    photo = _photo(client, headers, space_id)
    made = client.post(
        f"/api/spaces/{space_id}/keepsakes/from-memory",
        headers=headers,
        json={
            "identity_id": identity_id,
            "memory_id": photo["id"],
            "status": "ready",
        },
    )
    assert made.status_code == 200, made.text
    kid = made.json()["keepsake"]["id"]
    assert made.json()["keepsake"]["opener"]

    today = client.get(f"/api/spaces/{space_id}/keepsake/today", headers=headers)
    assert today.status_code == 200, today.text
    card = today.json()["keepsake"]
    assert card["id"] == kid
    assert card["thread_id"] == thread_id
    assert card["can_skip"] is True
    assert card["kind"] == "photo"

    opened = client.post(f"/api/keepsakes/{kid}/open", headers=headers)
    assert opened.status_code == 200, opened.text
    assert opened.json()["thread_id"] == thread_id
    message_id = opened.json()["message_id"]

    messages = client.get(f"/api/threads/{thread_id}/messages", headers=headers)
    assert messages.status_code == 200
    rows = messages.json()["messages"]
    heritage = [m for m in rows if m["id"] == message_id]
    assert len(heritage) == 1
    assert heritage[0]["sender_kind"] == "heritage"
    assert heritage[0]["has_media"] is True
    assert (heritage[0].get("media_mime") or "").startswith("image/")
    assert heritage[0]["meta"]["keepsake_id"] == kid

    again = client.post(f"/api/keepsakes/{kid}/open", headers=headers)
    assert again.json()["message_id"] == message_id

    skipped = client.post(f"/api/keepsakes/{kid}/skip", headers=headers)
    assert skipped.status_code == 200, skipped.text
    assert skipped.json()["keepsake"]["status"] == "skipped"

    empty = client.get(f"/api/spaces/{space_id}/keepsake/today", headers=headers)
    assert empty.json()["keepsake"] is None


def test_heard_photo_stays_today_until_tomorrow_or_skip(client):
    from datetime import datetime, timedelta, timezone

    from app.db import SessionLocal
    from app.models import Keepsake
    from app.services.keepsakes import mark_heard

    space_id, identity_id, _, headers = _ready_heritage(
        client, email="keep-heard@example.com", name="Andy"
    )
    first = _photo(client, headers, space_id, title="Tấm một")
    second = _photo(client, headers, space_id, title="Tấm hai")
    a = client.post(
        f"/api/spaces/{space_id}/keepsakes/from-memory",
        headers=headers,
        json={"identity_id": identity_id, "memory_id": first["id"], "status": "ready"},
    ).json()["keepsake"]["id"]
    b = client.post(
        f"/api/spaces/{space_id}/keepsakes/from-memory",
        headers=headers,
        json={"identity_id": identity_id, "memory_id": second["id"], "status": "ready"},
    ).json()["keepsake"]["id"]

    assert client.post(f"/api/keepsakes/{a}/open", headers=headers).status_code == 200
    db = SessionLocal()
    try:
        row = db.query(Keepsake).filter(Keepsake.id == a).one()
        mark_heard(row)
        db.commit()
    finally:
        db.close()

    today = client.get(f"/api/spaces/{space_id}/keepsake/today", headers=headers)
    card = today.json()["keepsake"]
    assert card["id"] == a
    assert card["heard"] is True
    assert card["status"] == "heard"

    db = SessionLocal()
    try:
        row = db.query(Keepsake).filter(Keepsake.id == a).one()
        row.last_opened_at = datetime.now(timezone.utc) - timedelta(days=1, hours=2)
        db.commit()
    finally:
        db.close()

    nxt = client.get(f"/api/spaces/{space_id}/keepsake/today", headers=headers)
    assert nxt.json()["keepsake"]["id"] == b
    assert nxt.json()["keepsake"]["heard"] is False


def test_at_most_two_photos_a_day_with_a_gap(client):
    from datetime import datetime, timedelta, timezone

    from app.db import SessionLocal
    from app.models import Keepsake

    space_id, identity_id, _, headers = _ready_heritage(
        client, email="keep-pace@example.com", name="Andy"
    )
    titles = ["Một", "Hai", "Ba"]
    ids = []
    for title in titles:
        photo = _photo(client, headers, space_id, title=title)
        ids.append(
            client.post(
                f"/api/spaces/{space_id}/keepsakes/from-memory",
                headers=headers,
                json={
                    "identity_id": identity_id,
                    "memory_id": photo["id"],
                    "status": "ready",
                },
            ).json()["keepsake"]["id"]
        )

    assert client.post(f"/api/keepsakes/{ids[0]}/open", headers=headers).status_code == 200
    skipped = client.post(f"/api/keepsakes/{ids[0]}/skip", headers=headers)
    assert skipped.status_code == 200
    waiting = client.get(f"/api/spaces/{space_id}/keepsake/today", headers=headers)
    assert waiting.json()["keepsake"] is None

    db = SessionLocal()
    try:
        row = db.query(Keepsake).filter(Keepsake.id == ids[0]).one()
        row.last_opened_at = datetime.now(timezone.utc) - timedelta(hours=4)
        row.updated_at = datetime.now(timezone.utc) - timedelta(hours=4)
        db.commit()
    finally:
        db.close()

    second = client.get(f"/api/spaces/{space_id}/keepsake/today", headers=headers)
    assert second.json()["keepsake"]["id"] == ids[1]
    assert client.post(f"/api/keepsakes/{ids[1]}/open", headers=headers).status_code == 200
    client.post(f"/api/keepsakes/{ids[1]}/skip", headers=headers)
    db = SessionLocal()
    try:
        row = db.query(Keepsake).filter(Keepsake.id == ids[1]).one()
        row.last_opened_at = datetime.now(timezone.utc) - timedelta(hours=4)
        row.updated_at = datetime.now(timezone.utc) - timedelta(hours=4)
        db.commit()
    finally:
        db.close()

    capped = client.get(f"/api/spaces/{space_id}/keepsake/today", headers=headers)
    assert capped.json()["keepsake"] is None


def test_open_attaches_cloned_voice_on_opener(client):
    from unittest.mock import patch

    from app.services.heritage_tts import ChatTtsResult
    from app.services.storage import save_bytes

    space_id, identity_id, thread_id, headers = _ready_heritage(
        client, email="keep-tts@example.com", name="Andy"
    )
    photo = _photo(client, headers, space_id)
    made = client.post(
        f"/api/spaces/{space_id}/keepsakes/from-memory",
        headers=headers,
        json={
            "identity_id": identity_id,
            "memory_id": photo["id"],
            "status": "ready",
        },
    )
    assert made.status_code == 200, made.text
    kid = made.json()["keepsake"]["id"]
    relative = save_bytes(space_id, b"fake-opener-mp3", ext=".mp3")
    tts = ChatTtsResult(
        media_path=relative,
        media_mime="audio/mpeg",
        meta={"provider": "elevenlabs"},
    )
    with patch(
        "app.services.heritage_tts.synthesize_chat_reply", return_value=tts
    ):
        opened = client.post(f"/api/keepsakes/{kid}/open", headers=headers)
    assert opened.status_code == 200, opened.text
    message_id = opened.json()["message_id"]

    messages = client.get(f"/api/threads/{thread_id}/messages", headers=headers)
    row = next(m for m in messages.json()["messages"] if m["id"] == message_id)
    assert (row.get("media_mime") or "").startswith("image/")
    assert row["meta"]["tts"]["media_path"] == relative

    audio = client.get(f"/api/messages/{message_id}/tts", headers=headers)
    assert audio.status_code == 200, audio.text
    assert audio.content == b"fake-opener-mp3"

    photo_media = client.get(f"/api/messages/{message_id}/media", headers=headers)
    assert photo_media.status_code == 200
    assert photo_media.headers["content-type"].startswith("image/")


def test_poem_keepsake_cannot_open_a_chat(client):
    space_id, identity_id, _, headers = _ready_heritage(
        client, email="poemkeep@example.com", name="Andy"
    )
    poem = client.post(
        f"/api/spaces/{space_id}/memories/note",
        headers=headers,
        json={
            "kind": "poem",
            "title": "TUỔI BẢY NHĂM",
            "body": "Bảy nhăm đâu phải đã già\nVẫn còn sức khỏe để mà yêu thương",
            "tags": f"heritage:{identity_id}",
        },
    )
    assert poem.status_code == 200, poem.text
    made = client.post(
        f"/api/spaces/{space_id}/keepsakes/from-memory",
        headers=headers,
        json={
            "identity_id": identity_id,
            "memory_id": poem.json()["id"],
            "status": "ready",
        },
    )
    assert made.status_code == 200, made.text
    assert made.json()["keepsake"]["kind"] == "poem"
    opened = client.post(
        f"/api/keepsakes/{made.json()['keepsake']['id']}/open", headers=headers
    )
    assert opened.status_code == 400


def test_member_cannot_skip(client):
    space_id, identity_id, _, headers = _ready_heritage(
        client, email="stewkeep@example.com", name="Steward"
    )
    photo = _photo(client, headers, space_id)
    made = client.post(
        f"/api/spaces/{space_id}/keepsakes/from-memory",
        headers=headers,
        json={"identity_id": identity_id, "memory_id": photo["id"], "status": "ready"},
    )
    kid = made.json()["keepsake"]["id"]

    other = _login(client, "memberkeep@example.com", "Mẹ")
    _join(client, headers, space_id, other)
    skipped = client.post(
        f"/api/keepsakes/{kid}/skip",
        headers={"Authorization": f"Bearer {other}"},
    )
    assert skipped.status_code == 403


def test_approve_can_edit_the_statement(client):
    from datetime import datetime, timezone

    from nanoid import generate

    from app.db import SessionLocal
    from app.models import MemoryCandidate
    from app.services.heritage_candidates import approve
    from tests.test_heritage_candidates import _scene

    db = SessionLocal()
    try:
        space, identity, thread, message, steward, _ = _scene(db, scope="family")
        row = MemoryCandidate(
            id=generate(),
            space_id=space.id,
            identity_id=identity.id,
            thread_id=thread.id,
            source_message_id=message.id,
            reviewer_user_id=steward.id,
            statement="Mẹ chụp ảnh cưới năm 1965",
            fact_kind="event",
            status="pending",
            created_at=datetime.now(timezone.utc),
        )
        db.add(row)
        db.commit()
        item = approve(
            db,
            candidate=row,
            user_id=steward.id,
            statement="Mẹ chụp ảnh cưới năm 1966",
        )
        assert item.body == "Mẹ chụp ảnh cưới năm 1966"
        db.refresh(row)
        assert row.statement == "Mẹ chụp ảnh cưới năm 1966"
        assert row.status == "approved"
    finally:
        db.close()


def test_answering_photo_queues_dieu_nghe_duoc(client):
    from datetime import datetime, timezone

    from nanoid import generate

    from app.db import SessionLocal
    from app.models import IdentityProfile, Message, Thread
    from app.services.heritage_candidates import enqueue_facts
    from app.services.keepsakes import story_facts_from_turn

    space_id, identity_id, thread_id, headers = _ready_heritage(
        client, email="keep-story@example.com", name="Andy"
    )
    photo = _photo(client, headers, space_id, title="Sân nhà bà nội")
    made = client.post(
        f"/api/spaces/{space_id}/keepsakes/from-memory",
        headers=headers,
        json={
            "identity_id": identity_id,
            "memory_id": photo["id"],
            "status": "ready",
        },
    )
    assert made.status_code == 200, made.text
    opened = client.post(
        f"/api/keepsakes/{made.json()['keepsake']['id']}/open", headers=headers
    )
    assert opened.status_code == 200, opened.text

    db = SessionLocal()
    try:
        thread = db.query(Thread).filter(Thread.id == thread_id).one()
        identity = (
            db.query(IdentityProfile).filter(IdentityProfile.id == identity_id).one()
        )
        spoken = Message(
            id=generate(),
            thread_id=thread_id,
            sender_kind="user",
            kind="voice",
            body="Đó là hôm bố mẹ cưới, chụp ở sân nhà bà nội.",
            created_at=datetime.now(timezone.utc),
        )
        db.add(spoken)
        db.commit()
        facts = story_facts_from_turn(db, thread=thread, user_message=spoken)
        queued = enqueue_facts(
            db, thread=thread, identity=identity, user_message=spoken, facts=facts
        )
        assert len(queued) == 1
        assert "Sân nhà bà nội" in queued[0].statement
        assert "cưới" in queued[0].statement
    finally:
        db.close()

    today = client.get(f"/api/spaces/{space_id}/keepsake/today", headers=headers)
    assert today.status_code == 200, today.text
    assert today.json()["keepsake"]["heard"] is True

    listed = client.get(f"/api/spaces/{space_id}/memory-candidates", headers=headers)
    assert listed.status_code == 200, listed.text
    statements = [c["statement"] for c in listed.json()["candidates"]]
    assert any("cưới" in s for s in statements)
