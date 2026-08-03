import shutil


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


def test_create_note_and_list_memories(client):
    token = _login(client, "mem@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id, _ = _space_and_thread(client, headers)

    created = client.post(
        f"/api/spaces/{space_id}/memories/note",
        headers=headers,
        json={"title": "Kỷ niệm", "body": "Món canh chua của mẹ"},
    )
    assert created.status_code == 200, created.text
    memory = created.json()
    assert memory["kind"] == "note"
    assert memory["body"] == "Món canh chua của mẹ"
    assert memory["creator_name"] == "Con"

    listed = client.get(f"/api/spaces/{space_id}/memories", headers=headers)
    assert listed.status_code == 200
    memories = listed.json()["memories"]
    assert len(memories) == 1
    assert memories[0]["id"] == memory["id"]


def test_memory_from_message(client):
    token = _login(client, "chatmem@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id, thread_id = _space_and_thread(client, headers)

    send = client.post(
        f"/api/threads/{thread_id}/messages",
        headers=headers,
        json={"body": "Lưu tin này vào thư viện nhé"},
    )
    assert send.status_code == 200
    message_id = send.json()["id"]

    saved = client.post(
        f"/api/spaces/{space_id}/memories/from-message",
        headers=headers,
        json={"message_id": message_id, "title": "Từ chat"},
    )
    assert saved.status_code == 200, saved.text
    memory = saved.json()
    assert memory["source_message_id"] == message_id
    assert memory["body"] == "Lưu tin này vào thư viện nhé"
    assert memory["tags"] == "from-chat"


def test_upload_video_memory(client, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    from app.config import get_settings

    get_settings.cache_clear()

    token = _login(client, "vidmem@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà video"}).json()

    from io import BytesIO

    uploaded = client.post(
        f"/api/spaces/{space['id']}/memories/upload",
        headers=headers,
        data={"kind": "video", "title": "Máy quay bố"},
        files={"file": ("clip.mts", BytesIO(b"fake-mts"), "video/mp2t")},
    )
    assert uploaded.status_code == 200, uploaded.text
    memory = uploaded.json()
    assert memory["kind"] == "video"
    assert memory["media_mime"] == "video/mp2t"
    assert memory["has_media"] is True

    get_settings.cache_clear()


def test_memory_playback_endpoint(client, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    from io import BytesIO

    from app.config import get_settings

    get_settings.cache_clear()

    token = _login(client, "playback@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space = client.post("/api/spaces", headers=headers, json={"name": "Playback"}).json()

    uploaded = client.post(
        f"/api/spaces/{space['id']}/memories/upload",
        headers=headers,
        data={"kind": "video", "title": "Clip"},
        files={"file": ("clip.mts", BytesIO(b"fake-mts"), "video/mp2t")},
    )
    assert uploaded.status_code == 200, uploaded.text
    memory_id = uploaded.json()["id"]

    res = client.get(f"/api/memories/{memory_id}/playback", headers=headers)
    if shutil.which("ffmpeg"):
        assert res.status_code in (200, 503), res.text
    else:
        assert res.status_code == 503

    note = client.post(
        f"/api/spaces/{space['id']}/memories/note",
        headers=headers,
        json={"body": "ghi chú"},
    )
    assert note.status_code == 200
    bad = client.get(f"/api/memories/{note.json()['id']}/playback", headers=headers)
    assert bad.status_code == 404

    get_settings.cache_clear()


def test_update_memory(client):
    token = _login(client, "update-mem@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà"}).json()

    created = client.post(
        f"/api/spaces/{space['id']}/memories/note",
        headers=headers,
        json={"title": "Tạm", "body": "old body"},
    )
    memory_id = created.json()["id"]

    updated = client.patch(
        f"/api/memories/{memory_id}",
        headers=headers,
        json={
            "title": "Tết 2015",
            "body": "Bố quay cả nhà ăn cơm",
            "tags": "heritage:fake-id,from-chat",
        },
    )
    assert updated.status_code == 200, updated.text
    data = updated.json()
    assert data["title"] == "Tết 2015"
    assert data["body"] == "Bố quay cả nhà ăn cơm"
    assert "heritage:fake-id" in data["tags"]
    assert "from-chat" in data["tags"]
