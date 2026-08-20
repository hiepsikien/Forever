"""Family-shared library retrieval for heritage chat."""

from __future__ import annotations

from datetime import datetime, timezone

from app.models import MemoryItem
from app.services.heritage_retrieval import family_shared_for_identities
from app.db import SessionLocal
from nanoid import generate


def test_family_shared_excludes_speaker_and_private(client):
    """Uses the live DB session the same way retrieval does in production."""
    login = client.post(
        "/api/auth/dev-login",
        json={
            "email": "fam-shared@example.com",
            "password": "forever123",
            "name": "Steward",
        },
    )
    assert login.status_code == 200
    token = login.json()["token"]
    user_id = login.json()["user"]["id"]
    headers = {"Authorization": f"Bearer {token}"}

    spaces = client.get("/api/spaces", headers=headers)
    created = client.post(
        "/api/spaces", headers=headers, json={"name": "Nhà shared"}
    )
    assert created.status_code == 200, created.text
    space_id = created.json()["id"]

    speaker = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=headers,
        json={
            "display_name": "Bố",
            "relation_label": "Bố",
            "status": "remembered",
            "handle": "bo_shared",
        },
    ).json()
    other = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=headers,
        json={
            "display_name": "Hương",
            "relation_label": "Con",
            "status": "living",
            "handle": "huong_shared",
        },
    ).json()

    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        shared = MemoryItem(
            id=generate(),
            space_id=space_id,
            created_by=user_id,
            kind="knowledge",
            title="Về Hương",
            body="Hương thích học toán.",
            tags=f"heritage:{other['id']}",
            visibility="family",
            created_at=now,
        )
        own = MemoryItem(
            id=generate(),
            space_id=space_id,
            created_by=user_id,
            kind="knowledge",
            title="Về bố",
            body="Bố dạy học.",
            tags=f"heritage:{speaker['id']}",
            visibility="family",
            created_at=now,
        )
        private = MemoryItem(
            id=generate(),
            space_id=space_id,
            created_by=user_id,
            kind="note",
            title="Riêng",
            body="Không kể.",
            tags=f"heritage:{other['id']}",
            visibility="private",
            created_at=now,
        )
        db.add_all([shared, own, private])
        db.commit()

        found = family_shared_for_identities(
            db,
            space_id=space_id,
            identity_ids=[other["id"]],
            exclude_identity_id=speaker["id"],
            reader=None,
        )
        ids = {item.id for item in found}
        assert shared.id in ids
        assert own.id not in ids
        assert private.id not in ids
    finally:
        db.close()
