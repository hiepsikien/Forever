"""Ghép tài khoản với hồ sơ — saying the person in the vault is the person logging in.

Before this, `linked_user_id` was only ever set by the app's own "Tôi" mirror,
so a profile the family had already built for mẹ could never become hers. The
link carries real authority: `_can_mutate_voice` reads it, so a wrong link
hands someone else's Voice DNA away.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.test_heritage_chat import _login, _ready_heritage
from tests.test_heritage_threads import _join


def _me(client: TestClient, headers: dict) -> str:
    return client.get("/api/auth/me", headers=headers).json()["id"]


def _house(client: TestClient, slug: str):
    space_id, remembered_id, _thread, steward = _ready_heritage(
        client, email=f"{slug}-steward@example.com", name="Con"
    )
    mom_token = _login(client, f"{slug}-mom@example.com", "Mẹ")
    mom = {"Authorization": f"Bearer {mom_token}"}
    _join(client, steward, space_id, mom_token)

    living = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=steward,
        json={"display_name": "Mẹ Đinh", "relation_label": "Mẹ", "status": "living"},
    )
    assert living.status_code == 200, living.text
    return space_id, living.json()["id"], remembered_id, steward, mom


def _link(client, headers, space_id, identity_id, user_id):
    return client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/link-user",
        headers=headers,
        json={"user_id": user_id},
    )


def test_the_steward_can_seat_a_member_in_their_own_profile(client: TestClient):
    space_id, identity_id, _, steward, mom = _house(client, "link-ok")
    res = _link(client, steward, space_id, identity_id, _me(client, mom))
    assert res.status_code == 200, res.text
    assert res.json()["linked_user_id"] == _me(client, mom)


def test_a_plain_member_cannot_link_anyone(client: TestClient):
    space_id, identity_id, _, _steward, mom = _house(client, "link-plain")
    res = _link(client, mom, space_id, identity_id, _me(client, mom))
    assert res.status_code == 403


def test_a_remembered_profile_cannot_be_given_a_login(client: TestClient):
    """Nobody signs in as someone the family lost."""
    space_id, _living, remembered_id, steward, mom = _house(client, "link-remembered")
    res = _link(client, steward, space_id, remembered_id, _me(client, mom))
    assert res.status_code == 400


def test_a_stranger_cannot_be_linked(client: TestClient):
    space_id, identity_id, _, steward, _mom = _house(client, "link-stranger")
    outsider = _login(client, "link-outsider@example.com", "Người lạ")
    outsider_id = _me(client, {"Authorization": f"Bearer {outsider}"})
    res = _link(client, steward, space_id, identity_id, outsider_id)
    assert res.status_code == 403


def test_one_account_cannot_hold_two_profiles(client: TestClient):
    space_id, identity_id, _, steward, mom = _house(client, "link-twice")
    mom_id = _me(client, mom)
    assert _link(client, steward, space_id, identity_id, mom_id).status_code == 200

    other = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=steward,
        json={"display_name": "Dì Tư", "relation_label": "Dì", "status": "living"},
    )
    assert other.status_code == 200, other.text
    clash = _link(client, steward, space_id, other.json()["id"], mom_id)
    assert clash.status_code == 409


def test_relinking_needs_an_unlink_first(client: TestClient):
    space_id, identity_id, _, steward, mom = _house(client, "link-relink")
    assert _link(client, steward, space_id, identity_id, _me(client, mom)).status_code == 200

    sister_token = _login(client, "link-sister@example.com", "Chị")
    _join(client, steward, space_id, sister_token)
    sister_id = _me(client, {"Authorization": f"Bearer {sister_token}"})

    assert _link(client, steward, space_id, identity_id, sister_id).status_code == 409

    unlinked = client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/unlink-user", headers=steward
    )
    assert unlinked.status_code == 200, unlinked.text
    assert unlinked.json()["linked_user_id"] is None
    assert _link(client, steward, space_id, identity_id, sister_id).status_code == 200


def test_linking_hands_over_that_persons_voice_dna(client: TestClient):
    """The reason the link matters: mẹ becomes able to build her own voice."""
    space_id, identity_id, _, steward, mom = _house(client, "link-voice")
    voice = client.post(
        f"/api/spaces/{space_id}/voices/for-identity",
        headers=steward,
        json={"identity_profile_id": identity_id, "consent": True},
    )
    assert voice.status_code == 200, voice.text
    voice_id = voice.json()["id"]

    from io import BytesIO

    def _add_sample():
        return client.post(
            f"/api/voices/{voice_id}/samples",
            headers=mom,
            files={"file": ("m.m4a", BytesIO(b"fake-audio"), "audio/mp4")},
            data={"source": "record"},
        )

    assert _add_sample().status_code == 403
    assert _link(client, steward, space_id, identity_id, _me(client, mom)).status_code == 200
    assert _add_sample().status_code == 200
