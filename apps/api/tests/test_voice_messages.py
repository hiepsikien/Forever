import io

from app.config import get_settings


def _login(client, email: str, name: str) -> str:
    res = client.post(
        "/api/auth/dev-login",
        json={"email": email, "password": "forever123", "name": name},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


def _space_and_thread(client, headers: dict) -> tuple[str, str]:
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà nhớ"}).json()
    threads = client.get(f"/api/spaces/{space['id']}/threads", headers=headers).json()
    return space["id"], threads["threads"][0]["id"]


def _tiny_m4a() -> bytes:
    # Minimal non-empty payload; MIME comes from content_type / filename.
    return b"\x00\x00\x00\x1cftypM4A " + b"\x00" * 32


def test_send_voice_message_list_and_media(client, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    get_settings.cache_clear()

    token = _login(client, "voice@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id, thread_id = _space_and_thread(client, headers)

    send = client.post(
        f"/api/threads/{thread_id}/messages/voice",
        headers=headers,
        files={"file": ("note.m4a", io.BytesIO(_tiny_m4a()), "audio/mp4")},
        data={"body": "Chào mẹ"},
    )
    assert send.status_code == 200, send.text
    message = send.json()
    assert message["kind"] == "voice"
    assert message["has_media"] is True
    assert message["media_mime"] == "audio/mp4"
    assert message["body"] == "Chào mẹ"
    message_id = message["id"]

    listed = client.get(f"/api/threads/{thread_id}/messages", headers=headers)
    assert listed.status_code == 200
    msgs = listed.json()["messages"]
    voice_msgs = [m for m in msgs if m["id"] == message_id]
    assert len(voice_msgs) == 1
    assert voice_msgs[0]["kind"] == "voice"

    media = client.get(f"/api/messages/{message_id}/media", headers=headers)
    assert media.status_code == 200
    assert media.content

    no_auth = client.get(f"/api/messages/{message_id}/media")
    assert no_auth.status_code in (401, 403)

    threads = client.get(f"/api/spaces/{space_id}/threads", headers=headers).json()
    family = next(t for t in threads["threads"] if t["id"] == thread_id)
    assert family["last_message"]["kind"] == "voice"
    assert family["last_message"]["body"] == "Chào mẹ"

    get_settings.cache_clear()


def test_voice_message_skips_agent_reply(client, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    get_settings.cache_clear()

    token = _login(client, "voice-agent@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    _, thread_id = _space_and_thread(client, headers)

    send = client.post(
        f"/api/threads/{thread_id}/messages/voice",
        headers=headers,
        files={"file": ("note.m4a", io.BytesIO(_tiny_m4a()), "audio/mp4")},
    )
    assert send.status_code == 200, send.text

    msgs = client.get(f"/api/threads/{thread_id}/messages", headers=headers).json()["messages"]
    assert len(msgs) == 1
    assert msgs[0]["kind"] == "voice"
    assert msgs[0]["sender_kind"] == "user"

    get_settings.cache_clear()


def test_memory_from_voice_message(client, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    get_settings.cache_clear()

    token = _login(client, "voice-mem@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id, thread_id = _space_and_thread(client, headers)

    send = client.post(
        f"/api/threads/{thread_id}/messages/voice",
        headers=headers,
        files={"file": ("note.m4a", io.BytesIO(_tiny_m4a()), "audio/mp4")},
    )
    assert send.status_code == 200, send.text
    message_id = send.json()["id"]

    saved = client.post(
        f"/api/spaces/{space_id}/memories/from-message",
        headers=headers,
        json={"message_id": message_id},
    )
    assert saved.status_code == 200, saved.text
    memory = saved.json()
    assert memory["kind"] == "voice"
    assert memory["has_media"] is True
    assert memory["source_message_id"] == message_id
    assert memory["tags"] == "from-chat"

    media = client.get(f"/api/memories/{memory['id']}/media", headers=headers)
    assert media.status_code == 200

    get_settings.cache_clear()


def test_reject_non_audio_voice_upload(client, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    get_settings.cache_clear()

    token = _login(client, "voice-bad@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    _, thread_id = _space_and_thread(client, headers)

    send = client.post(
        f"/api/threads/{thread_id}/messages/voice",
        headers=headers,
        files={"file": ("pic.png", io.BytesIO(b"\x89PNG\r\n\x1a\n"), "image/png")},
    )
    assert send.status_code == 400

    get_settings.cache_clear()
