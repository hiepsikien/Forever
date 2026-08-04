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
    assert sample.json()["voice"]["processed_count"] == 1
    assert sample.json()["voice"]["unprocessed_count"] == 0

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


def test_heritage_readiness_and_activation(client: TestClient, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    from app.config import get_settings

    get_settings.cache_clear()

    owner_token = _login(client, "heritage-ready-owner@example.com", "Con")
    owner_h = {"Authorization": f"Bearer {owner_token}"}
    space_id = _space(client, owner_token, "Thổi hồn")

    identity = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=owner_h,
        json={"display_name": "Hương", "relation_label": "Chị", "status": "remembered"},
    )
    assert identity.status_code == 200, identity.text
    identity_id = identity.json()["id"]
    thread_id = identity.json()["heritage_thread_id"]

    voice = client.post(
        f"/api/spaces/{space_id}/voices/heritage",
        headers=owner_h,
        json={"identity_profile_id": identity_id, "consent": True},
    )
    assert voice.status_code == 200, voice.text
    voice_id = voice.json()["id"]

    sample = client.post(
        f"/api/voices/{voice_id}/samples",
        headers=owner_h,
        files={"file": ("sample.m4a", BytesIO(b"fake-audio-bytes"), "audio/mp4")},
        data={"source": "record"},
    )
    assert sample.status_code == 200, sample.text

    readiness = client.get(
        f"/api/spaces/{space_id}/identities/{identity_id}/heritage-readiness",
        headers=owner_h,
    )
    assert readiness.status_code == 200, readiness.text
    body = readiness.json()
    assert body["display_name"] == "Hương"
    assert body["voice_ready"] is True
    assert body["knowledge_count"] == 0
    assert body["knowledge_target"] == 5
    assert body["chat_ready"] is False
    assert body["can_activate"] is False

    threads = client.get(f"/api/spaces/{space_id}/threads", headers=owner_h).json()
    heritage_thread = next(t for t in threads["threads"] if t["id"] == thread_id)
    assert heritage_thread["title"] == "Hương · Chị"
    assert heritage_thread["heritage"]["entity_status"] in ("dormant", "awakening")

    thread_get = client.get(f"/api/threads/{thread_id}", headers=owner_h)
    assert thread_get.status_code == 200
    assert thread_get.json()["heritage"]["identity_id"] == identity_id

    tag = f"heritage:{identity_id}"
    for i in range(5):
        note = client.post(
            f"/api/spaces/{space_id}/memories/note",
            headers=owner_h,
            json={"title": f"Ký ức {i}", "body": f"Ghi chú {i}", "tags": tag},
        )
        assert note.status_code == 200, note.text

    ready = client.get(
        f"/api/spaces/{space_id}/identities/{identity_id}/heritage-readiness",
        headers=owner_h,
    ).json()
    assert ready["knowledge_count"] == 5
    assert ready["can_activate"] is True

    denied = client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/activate-heritage",
        headers={"Authorization": f"Bearer {_login(client, 'heritage-ready-member@example.com', 'Em')}"},
    )
    assert denied.status_code in (403, 401)

    activated = client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/activate-heritage",
        headers=owner_h,
    )
    assert activated.status_code == 200, activated.text
    assert activated.json()["chat_ready"] is True
    assert activated.json()["entity_status"] == "ready"

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


def test_pipeline_stage_clone_uses_processed_only(client: TestClient, monkeypatch):
    """Extract imports are unprocessed; clone needs bulk approve to processed."""
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()

    token = _login(client, "pipeline@forever.family", "Pipeline")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token)

    created = client.post(
        f"/api/spaces/{space_id}/voices/self",
        headers=headers,
        json={"consent": True},
    )
    assert created.status_code == 200, created.text
    voice_id = created.json()["id"]

    unprocessed = client.post(
        f"/api/voices/{voice_id}/samples",
        headers=headers,
        files={"file": ("pool.wav", BytesIO(b"fake-pool"), "audio/wav")},
        data={"source": "extract"},
    )
    assert unprocessed.status_code == 200, unprocessed.text
    voice = unprocessed.json()["voice"]
    assert voice["unprocessed_count"] == 1
    assert voice["processed_count"] == 0
    sample_id = unprocessed.json()["sample_id"]

    blocked = client.post(f"/api/voices/{voice_id}/clone", headers=headers)
    assert blocked.status_code == 400
    assert "duyệt" in blocked.json()["error"].lower()

    staged = client.post(
        f"/api/voices/{voice_id}/samples/bulk-stage",
        headers=headers,
        json={"sample_ids": [sample_id], "pipeline_stage": "processed"},
    )
    assert staged.status_code == 200, staged.text
    assert staged.json()["processed_count"] == 1
    assert staged.json()["unprocessed_count"] == 0

    with patch(
        "app.routers.voice_dna.el.create_instant_voice_clone",
        return_value="el_pipeline_voice",
    ):
        cloned = client.post(f"/api/voices/{voice_id}/clone", headers=headers)
    assert cloned.status_code == 200, cloned.text
    assert cloned.json()["status"] == "ready"

    filtered = client.get(
        f"/api/spaces/{space_id}/voice-samples",
        headers=headers,
        params={"voice_id": voice_id, "stage": "processed"},
    )
    assert filtered.status_code == 200
    assert len(filtered.json()["samples"]) == 1
    assert filtered.json()["samples"][0]["pipeline_stage"] == "processed"

    get_settings.cache_clear()


def test_clone_with_selected_sample_ids(client: TestClient, monkeypatch, tmp_path):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    from app.config import get_settings

    get_settings.cache_clear()

    token = _login(client, "clone-pick@forever.family", "ClonePick")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token)

    created = client.post(
        f"/api/spaces/{space_id}/voices/self",
        headers=headers,
        json={"consent": True},
    )
    assert created.status_code == 200, created.text
    voice_id = created.json()["id"]

    sample_ids: list[str] = []
    for idx in range(4):
        res = client.post(
            f"/api/voices/{voice_id}/samples",
            headers=headers,
            files={"file": (f"s{idx}.wav", BytesIO(b"fake"), "audio/wav")},
            data={"source": "upload", "duration_ms": "30000"},
        )
        assert res.status_code == 200, res.text
        sample_ids.append(res.json()["sample_id"])

    # Without selection, >3 processed is blocked.
    blocked = client.post(f"/api/voices/{voice_id}/clone", headers=headers)
    assert blocked.status_code == 400
    assert "chọn" in blocked.json()["error"].lower()

    captured: dict = {}

    def fake_clone(**kwargs):
        captured["paths"] = kwargs["file_paths"]
        captured["remove_noise"] = kwargs["remove_background_noise"]
        return "el_picked_voice"

    with patch(
        "app.routers.voice_dna.el.create_instant_voice_clone",
        side_effect=fake_clone,
    ):
        cloned = client.post(
            f"/api/voices/{voice_id}/clone",
            headers=headers,
            json={
                "sample_ids": sample_ids[:2],
                "remove_background_noise": False,
            },
        )
    assert cloned.status_code == 200, cloned.text
    assert cloned.json()["status"] == "ready"
    assert len(captured["paths"]) == 2
    assert captured["remove_noise"] is False

    get_settings.cache_clear()


def test_combine_unprocessed_samples(client: TestClient, monkeypatch, tmp_path):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))

    def fake_combine(input_paths, output_path):
        output_path.write_bytes(b"fake-combined-wav")
        return 90_000, len(b"fake-combined-wav")

    monkeypatch.setattr(
        "app.routers.voice_dna.combine_audio_files",
        fake_combine,
    )

    token = _login(client, "combine@forever.family", "Combine")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token)

    created = client.post(
        f"/api/spaces/{space_id}/voices/self",
        headers=headers,
        json={"consent": True},
    )
    assert created.status_code == 200, created.text
    voice_id = created.json()["id"]

    sample_ids: list[str] = []
    for idx in range(3):
        res = client.post(
            f"/api/voices/{voice_id}/samples",
            headers=headers,
            files={"file": (f"seg{idx}.wav", BytesIO(b"fake-seg"), "audio/wav")},
            data={"source": "extract"},
        )
        assert res.status_code == 200, res.text
        sample_ids.append(res.json()["sample_id"])

    combined = client.post(
        f"/api/voices/{voice_id}/samples/combine",
        headers=headers,
        json={"sample_ids": sample_ids[:2]},
    )
    assert combined.status_code == 200, combined.text
    payload = combined.json()
    assert payload["sample_id"]
    voice = payload["voice"]
    assert voice["unprocessed_count"] == 4
    assert voice["processed_count"] == 0

    combined_sample = next(
        s for s in voice["samples"] if s["id"] == payload["sample_id"]
    )
    assert combined_sample["source"] == "combine"
    assert combined_sample["pipeline_stage"] == "unprocessed"
    assert combined_sample["parent_sample_ids"] == sample_ids[:2]
    assert combined_sample["duration_ms"] == 90_000

    all_unprocessed = client.get(
        f"/api/spaces/{space_id}/voice-samples",
        headers=headers,
        params={"voice_id": voice_id, "stage": "unprocessed"},
    )
    assert all_unprocessed.status_code == 200
    assert len(all_unprocessed.json()["samples"]) == 4


def test_smart_combine_unprocessed_samples(client: TestClient, monkeypatch, tmp_path):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))

    def fake_smart_combine(input_paths, output_path):
        output_path.write_bytes(b"fake-smart-combined-wav")
        return 95_000, len(b"fake-smart-combined-wav")

    monkeypatch.setattr(
        "app.routers.voice_dna.smart_combine_audio_files",
        fake_smart_combine,
    )

    token = _login(client, "smartcombine@forever.family", "SmartCombine")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token)

    created = client.post(
        f"/api/spaces/{space_id}/voices/self",
        headers=headers,
        json={"consent": True},
    )
    assert created.status_code == 200, created.text
    voice_id = created.json()["id"]

    sample_ids: list[str] = []
    for idx in range(3):
        res = client.post(
            f"/api/voices/{voice_id}/samples",
            headers=headers,
            files={"file": (f"seg{idx}.wav", BytesIO(b"fake-seg"), "audio/wav")},
            data={"source": "extract"},
        )
        assert res.status_code == 200, res.text
        sample_ids.append(res.json()["sample_id"])

    combined = client.post(
        f"/api/voices/{voice_id}/samples/smart-combine",
        headers=headers,
        json={"sample_ids": sample_ids[:2]},
    )
    assert combined.status_code == 200, combined.text
    payload = combined.json()
    assert payload["sample_id"]
    voice = payload["voice"]
    assert voice["unprocessed_count"] == 4

    combined_sample = next(
        s for s in voice["samples"] if s["id"] == payload["sample_id"]
    )
    assert combined_sample["source"] == "smart_combine"
    assert combined_sample["pipeline_stage"] == "unprocessed"
    assert combined_sample["parent_sample_ids"] == sample_ids[:2]
    assert combined_sample["duration_ms"] == 95_000
    assert combined_sample["processing_applied"]["smart_combine"] is True


def test_process_normalize_creates_derived_sample(
    client: TestClient, monkeypatch, tmp_path
):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))

    def fake_normalize(input_path, output_path):
        output_path.write_bytes(b"fake-normalized-wav")
        return 30_000, len(b"fake-normalized-wav")

    monkeypatch.setattr(
        "app.routers.voice_dna.normalize_audio_file",
        fake_normalize,
    )

    token = _login(client, "normalize@forever.family", "Normalize")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token)

    created = client.post(
        f"/api/spaces/{space_id}/voices/self",
        headers=headers,
        json={"consent": True},
    )
    voice_id = created.json()["id"]

    original = client.post(
        f"/api/voices/{voice_id}/samples",
        headers=headers,
        files={"file": ("quiet.wav", BytesIO(b"fake-quiet"), "audio/wav")},
        data={"source": "extract"},
    )
    assert original.status_code == 200, original.text
    sample_id = original.json()["sample_id"]

    processed = client.post(
        f"/api/voices/{voice_id}/samples/process",
        headers=headers,
        json={"sample_ids": [sample_id], "normalize": True},
    )
    assert processed.status_code == 200, processed.text
    payload = processed.json()
    assert len(payload["created_sample_ids"]) == 1
    assert payload["voice"]["unprocessed_count"] == 2

    new_sample = next(
        s
        for s in payload["voice"]["samples"]
        if s["id"] == payload["created_sample_ids"][0]
    )
    assert new_sample["source"] == "process"
    assert new_sample["processing_applied"]["normalize"] is True
    assert new_sample["parent_sample_ids"] == [sample_id]


def test_split_processed_sample_archives_original(
    client: TestClient, monkeypatch, tmp_path
):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))

    def fake_split(input_path, output_a, output_b, *, at_ms=None):
        output_a.write_bytes(b"fake-half-a")
        output_b.write_bytes(b"fake-half-b")
        return (70_000, len(b"fake-half-a")), (70_000, len(b"fake-half-b"))

    monkeypatch.setattr("app.routers.voice_dna.split_audio_file", fake_split)

    token = _login(client, "split@forever.family", "Split")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token)

    created = client.post(
        f"/api/spaces/{space_id}/voices/self",
        headers=headers,
        json={"consent": True},
    )
    assert created.status_code == 200, created.text
    voice_id = created.json()["id"]

    res = client.post(
        f"/api/voices/{voice_id}/samples",
        headers=headers,
        files={"file": ("long.wav", BytesIO(b"fake-long-wav"), "audio/wav")},
        data={"source": "upload", "duration_ms": "140000"},
    )
    assert res.status_code == 200, res.text
    sample_id = res.json()["sample_id"]

    split = client.post(
        f"/api/voices/{voice_id}/samples/split",
        headers=headers,
        json={"sample_id": sample_id},
    )
    assert split.status_code == 200, split.text
    payload = split.json()
    assert payload["archived_original"] is True
    assert len(payload["sample_ids"]) == 2

    voice = payload["voice"]
    assert voice["processed_count"] == 2
    halves = [s for s in voice["samples"] if s["id"] in payload["sample_ids"]]
    assert len(halves) == 2
    assert all(s["source"] == "split" for s in halves)
    assert all(s["pipeline_stage"] == "processed" for s in halves)
    assert all(s["parent_sample_ids"] == [sample_id] for s in halves)

    original = next(s for s in voice["samples"] if s["id"] == sample_id)
    assert original["pipeline_stage"] == "archived"


def test_split_rejects_short_sample(client: TestClient, monkeypatch, tmp_path):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))

    token = _login(client, "split-short@forever.family", "SplitShort")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token)

    created = client.post(
        f"/api/spaces/{space_id}/voices/self",
        headers=headers,
        json={"consent": True},
    )
    assert created.status_code == 200, created.text
    voice_id = created.json()["id"]

    res = client.post(
        f"/api/voices/{voice_id}/samples",
        headers=headers,
        files={"file": ("short.wav", BytesIO(b"fake"), "audio/wav")},
        data={"source": "upload", "duration_ms": "10000"},
    )
    assert res.status_code == 200, res.text
    sample_id = res.json()["sample_id"]

    split = client.post(
        f"/api/voices/{voice_id}/samples/split",
        headers=headers,
        json={"sample_id": sample_id},
    )
    assert split.status_code == 400
    assert "ngắn" in split.json()["error"].lower()
