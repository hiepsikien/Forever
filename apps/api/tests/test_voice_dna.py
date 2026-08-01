from io import BytesIO
from unittest.mock import patch

from fastapi.testclient import TestClient


def _login(client: TestClient, email: str, name: str) -> str:
    res = client.post(
        "/api/auth/dev-login",
        json={"email": email, "password": "forever123", "name": name},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


def _space(client: TestClient, token: str, name: str = "Nhà Voice") -> str:
    res = client.post(
        "/api/spaces",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": name},
    )
    assert res.status_code == 200, res.text
    return res.json()["id"]


def test_settings_elevenlabs_key_steward_only(client: TestClient, monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "")
    from app.config import get_settings

    get_settings.cache_clear()

    owner_token = _login(client, "voice-settings-owner@example.com", "Con")
    owner_h = {"Authorization": f"Bearer {owner_token}"}
    space_id = _space(client, owner_token)

    invite = client.post(f"/api/spaces/{space_id}/invites", headers=owner_h).json()
    member_token = _login(client, "voice-settings-member@example.com", "Mẹ")
    member_h = {"Authorization": f"Bearer {member_token}"}
    assert (
        client.post(
            "/api/spaces/join", headers=member_h, json={"code": invite["code"]}
        ).status_code
        == 200
    )

    got = client.get(f"/api/spaces/{space_id}/settings", headers=owner_h)
    assert got.status_code == 200
    assert got.json()["can_edit"] is True
    assert got.json()["elevenlabs_api_key_set"] is False

    member_view = client.get(f"/api/spaces/{space_id}/settings", headers=member_h)
    assert member_view.status_code == 200
    assert member_view.json()["can_edit"] is False

    denied = client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=member_h,
        json={"elevenlabs_api_key": "sk_member"},
    )
    assert denied.status_code == 403

    updated = client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=owner_h,
        json={"elevenlabs_api_key": "sk_test_abcd1234"},
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["elevenlabs_api_key_set"] is True
    assert body["elevenlabs_api_key_hint"].endswith("1234")
    assert "sk_test" not in body["elevenlabs_api_key_hint"]

    get_settings.cache_clear()


def test_self_voice_flow_with_mocked_elevenlabs(client: TestClient, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    from app.config import get_settings

    get_settings.cache_clear()

    token = _login(client, "voice-self@example.com", "Andy")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token, "Lab giọng tôi")

    client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=headers,
        json={"elevenlabs_api_key": "sk_lab"},
    )

    no_consent = client.post(
        f"/api/spaces/{space_id}/voices/self",
        headers=headers,
        json={"consent": False},
    )
    assert no_consent.status_code == 400

    created = client.post(
        f"/api/spaces/{space_id}/voices/self",
        headers=headers,
        json={"consent": True},
    )
    assert created.status_code == 200, created.text
    voice_id = created.json()["id"]
    assert created.json()["status"] == "draft"
    assert created.json()["subject_kind"] == "self"

    dup = client.post(
        f"/api/spaces/{space_id}/voices/self",
        headers=headers,
        json={"consent": True},
    )
    assert dup.status_code == 409

    sample = client.post(
        f"/api/voices/{voice_id}/samples",
        headers=headers,
        files={"file": ("sample.m4a", BytesIO(b"fake-audio-bytes"), "audio/mp4")},
        data={"source": "record"},
    )
    assert sample.status_code == 200, sample.text
    assert sample.json()["voice"]["sample_count"] == 1

    with patch(
        "app.routers.voice_dna.el.create_instant_voice_clone",
        return_value="el_voice_abc",
    ):
        cloned = client.post(f"/api/voices/{voice_id}/clone", headers=headers)
    assert cloned.status_code == 200, cloned.text
    assert cloned.json()["status"] == "ready"
    assert cloned.json()["provider_voice_id"] == "el_voice_abc"

    with patch(
        "app.routers.voice_dna.el.list_voices",
        return_value=[
            {
                "voice_id": "el_voice_abc",
                "name": "Forever · Con · 2026-08-01 10:00",
                "category": "cloned",
                "description": "",
                "labels": {"language": "vi"},
                "created_at_unix": 1720000000,
            }
        ],
    ):
        el_list = client.get(
            f"/api/spaces/{space_id}/elevenlabs-voices", headers=headers
        )
    assert el_list.status_code == 200, el_list.text
    assert el_list.json()["voices"][0]["voice_id"] == "el_voice_abc"

    with patch(
        "app.routers.voice_dna.el.text_to_speech",
        return_value=b"ID3fake-mp3",
    ) as mock_tts:
        tts = client.post(
            f"/api/voices/{voice_id}/tts",
            headers=headers,
            json={
                "text": "Xin chào gia đình.",
                "model_id": "eleven_v3",
                "provider_voice_id": "el_voice_abc",
                "provider_voice_name": "Forever · Con · 2026-08-01 10:00",
                "save": True,
            },
        )
    assert tts.status_code == 200, tts.text
    payload = tts.json()
    assert payload["model_id"] == "eleven_v3"
    assert payload["text"] == "Xin chào gia đình."
    assert payload["provider_voice_id"] == "el_voice_abc"
    assert payload["provider_voice_name"].startswith("Forever")
    mock_tts.assert_called_once()
    assert mock_tts.call_args.kwargs["model_id"] == "eleven_v3"
    assert mock_tts.call_args.kwargs["voice_id"] == "el_voice_abc"

    listed = client.get(f"/api/voices/{voice_id}/renders", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["renders"][0]["model_id"] == "eleven_v3"
    assert listed.json()["renders"][0]["voice_display_name"]

    space_listed = client.get(
        f"/api/spaces/{space_id}/voice-renders", headers=headers
    )
    assert space_listed.status_code == 200
    assert space_listed.json()["renders"][0]["model_id"] == "eleven_v3"

    get_settings.cache_clear()


def test_heritage_voice_steward_gate(client: TestClient, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    from app.config import get_settings

    get_settings.cache_clear()

    owner_token = _login(client, "voice-heritage-owner@example.com", "Con")
    owner_h = {"Authorization": f"Bearer {owner_token}"}
    space_id = _space(client, owner_token, "Ký ức bố")

    invite = client.post(f"/api/spaces/{space_id}/invites", headers=owner_h).json()
    member_token = _login(client, "voice-heritage-member@example.com", "Em")
    member_h = {"Authorization": f"Bearer {member_token}"}
    assert (
        client.post(
            "/api/spaces/join", headers=member_h, json={"code": invite["code"]}
        ).status_code
        == 200
    )

    denied_id = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=member_h,
        json={"display_name": "Bố", "relation_label": "Cha", "status": "remembered"},
    )
    assert denied_id.status_code == 403

    identity = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=owner_h,
        json={"display_name": "Bố", "relation_label": "Cha", "status": "remembered"},
    )
    assert identity.status_code == 200, identity.text
    identity_id = identity.json()["id"]
    assert identity.json()["heritage_thread_id"]

    denied_voice = client.post(
        f"/api/spaces/{space_id}/voices/heritage",
        headers=member_h,
        json={"identity_profile_id": identity_id, "consent": True},
    )
    assert denied_voice.status_code == 403

    voice = client.post(
        f"/api/spaces/{space_id}/voices/heritage",
        headers=owner_h,
        json={"identity_profile_id": identity_id, "consent": True},
    )
    assert voice.status_code == 200, voice.text
    assert voice.json()["subject_kind"] == "heritage"
    assert "Bố" in voice.json()["display_name"]

    # Living relative (Mẹ) via for-identity — owner creates for everyone.
    mom = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=owner_h,
        json={"display_name": "Mẹ", "relation_label": "Mẹ", "status": "living"},
    )
    assert mom.status_code == 200, mom.text
    mom_voice = client.post(
        f"/api/spaces/{space_id}/voices/for-identity",
        headers=owner_h,
        json={"identity_profile_id": mom.json()["id"], "consent": True},
    )
    assert mom_voice.status_code == 200, mom_voice.text
    assert mom_voice.json()["subject_kind"] == "person"
    assert mom_voice.json()["identity_profile_id"] == mom.json()["id"]

    identities = client.get(f"/api/spaces/{space_id}/identities", headers=owner_h)
    assert identities.status_code == 200
    me = next(
        (i for i in identities.json()["identities"] if i.get("relation_label") == "Tôi"),
        None,
    )
    assert me is not None

    renamed = client.patch(
        f"/api/spaces/{space_id}/identities/{mom.json()['id']}",
        headers=owner_h,
        json={"display_name": "Mẹ Lan", "relation_label": "Mẹ"},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["display_name"] == "Mẹ Lan"
    assert "Mẹ Lan" in (
        client.get(f"/api/voices/{mom_voice.json()['id']}", headers=owner_h).json()[
            "display_name"
        ]
    )

    threads = client.get(f"/api/spaces/{space_id}/threads", headers=owner_h).json()
    assert any(t["kind"] == "heritage" for t in threads["threads"])

    get_settings.cache_clear()


def test_owner_multi_profile_toi_then_bo(client: TestClient, tmp_path, monkeypatch):
    """Owner creates Tôi then Bố — sample → clone → TTS smoke path."""
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    from app.config import get_settings

    get_settings.cache_clear()

    token = _login(client, "voice-multi-owner@example.com", "Andy")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token, "Nhà đa hồ sơ")

    identities = client.get(f"/api/spaces/{space_id}/identities", headers=headers)
    assert identities.status_code == 200
    me = next(
        i
        for i in identities.json()["identities"]
        if i.get("relation_label") == "Tôi" or i.get("linked_user_id")
    )

    self_voice = client.post(
        f"/api/spaces/{space_id}/voices/for-identity",
        headers=headers,
        json={"identity_profile_id": me["id"], "consent": True},
    )
    assert self_voice.status_code == 200, self_voice.text
    self_id = self_voice.json()["id"]
    assert self_voice.json()["subject_kind"] == "self"
    assert self_voice.json()["identity_profile_id"] == me["id"]

    bo = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=headers,
        json={"display_name": "Hùng", "relation_label": "Bố", "status": "living"},
    )
    assert bo.status_code == 200, bo.text
    bo_voice = client.post(
        f"/api/spaces/{space_id}/voices/for-identity",
        headers=headers,
        json={"identity_profile_id": bo.json()["id"], "consent": True},
    )
    assert bo_voice.status_code == 200, bo_voice.text
    bo_id = bo_voice.json()["id"]
    assert bo_voice.json()["subject_kind"] == "person"

    sample = client.post(
        f"/api/voices/{bo_id}/samples",
        headers=headers,
        files={"file": ("bo.m4a", BytesIO(b"fake-bo-audio"), "audio/mp4")},
        data={"source": "record"},
    )
    assert sample.status_code == 200, sample.text

    with patch(
        "app.routers.voice_dna.el.create_instant_voice_clone",
        return_value="el_bo_voice",
    ):
        cloned = client.post(f"/api/voices/{bo_id}/clone", headers=headers)
    assert cloned.status_code == 200, cloned.text
    assert cloned.json()["provider_voice_id"] == "el_bo_voice"

    with patch(
        "app.routers.voice_dna.el.text_to_speech",
        return_value=b"ID3bo",
    ) as mock_tts:
        tts = client.post(
            f"/api/voices/{bo_id}/tts",
            headers=headers,
            json={
                "text": "Con nhớ bố.",
                "model_id": "eleven_v3",
                "provider_voice_id": "el_bo_voice",
                "provider_voice_name": "Forever · Hùng · test",
                "save": True,
            },
        )
    assert tts.status_code == 200, tts.text
    assert mock_tts.call_args.kwargs["voice_id"] == "el_bo_voice"
    assert tts.json()["provider_voice_id"] == "el_bo_voice"

    sample_self = client.post(
        f"/api/voices/{self_id}/samples",
        headers=headers,
        files={"file": ("me.m4a", BytesIO(b"fake-me"), "audio/mp4")},
        data={"source": "record"},
    )
    assert sample_self.status_code == 200, sample_self.text

    get_settings.cache_clear()
