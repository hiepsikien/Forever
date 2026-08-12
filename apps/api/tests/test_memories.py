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


def test_create_milestone_and_poem_from_app(client):
    token = _login(client, "mem-kinds@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id, _ = _space_and_thread(client, headers)

    mile = client.post(
        f"/api/spaces/{space_id}/memories/note",
        headers=headers,
        json={
            "kind": "milestone",
            "title": "Sinh tại Bắc Ninh",
            "body": "Sinh ngày 01/06/1940.",
            "occurred_at": "1940-06-01",
            "tags": "heritage:abc",
        },
    )
    assert mile.status_code == 200, mile.text
    assert mile.json()["kind"] == "milestone"
    assert mile.json()["occurred_at"].startswith("1940")

    poem = client.post(
        f"/api/spaces/{space_id}/memories/note",
        headers=headers,
        json={
            "kind": "poem",
            "title": "TUỔI BẢY NHĂM",
            "body": "Bảy nhăm đâu phải đã già\nCứ vui vẻ thảnh thơi",
            "tags": "heritage:abc",
        },
    )
    assert poem.status_code == 200, poem.text
    assert poem.json()["kind"] == "poem"
    assert "tho" in poem.json()["tags"]
    assert poem.json()["occurred_at"] is None

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


def test_update_milestone_date_and_photo(client):
    from io import BytesIO

    from PIL import Image

    token = _login(client, "mile-photo@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà"}).json()

    created = client.post(
        f"/api/spaces/{space['id']}/memories/note",
        headers=headers,
        json={
            "kind": "milestone",
            "title": "Sinh",
            "body": "Sinh tại Bắc Ninh",
            "occurred_at": "1940-06-01",
        },
    )
    assert created.status_code == 200, created.text
    memory_id = created.json()["id"]

    patched = client.patch(
        f"/api/memories/{memory_id}",
        headers=headers,
        json={"occurred_at": "1940-01-01"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["occurred_at"].startswith("1940-01-01")

    buf = BytesIO()
    Image.new("RGB", (4, 4), color=(10, 20, 30)).save(buf, format="JPEG")
    media = client.post(
        f"/api/memories/{memory_id}/media",
        headers=headers,
        files={"file": ("mile.jpg", buf.getvalue(), "image/jpeg")},
    )
    assert media.status_code == 200, media.text
    assert media.json()["has_media"] is True

    cleared = client.patch(
        f"/api/memories/{memory_id}",
        headers=headers,
        json={"clear_media": True},
    )
    assert cleared.status_code == 200
    assert cleared.json()["has_media"] is False


def _heritage_identity(client, headers: dict, space_id: str) -> str:
    res = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=headers,
        json={
            "display_name": "Nguyễn Đình Triệu",
            "relation_label": "Bố",
            "status": "remembered",
        },
    )
    assert res.status_code == 200, res.text
    return res.json()["id"]


_POEM = {
    "title": "LỜI MẸ DẶN",
    "body": "Mẹ già tóc bạc còng lưng\nĐêm nằm con vẫn nhớ từng bước chân",
    "meter": "luc_bat",
    "themes": ["gia_dinh", "biet_on", "khong_hop_le"],
    "composed_on": "2014-08-07",
}


def test_import_poems_tags_and_dedupes(client):
    token = _login(client, "poem-import@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà thơ"}).json()
    identity_id = _heritage_identity(client, headers, space["id"])

    payload = {"identity_id": identity_id, "poems": [_POEM]}
    res = client.post(
        f"/api/spaces/{space['id']}/memories/poems/import", headers=headers, json=payload
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["imported"] == 1
    memory = data["memories"][0]
    assert memory["kind"] == "poem"
    assert f"heritage:{identity_id}" in memory["tags"]
    assert "chu-de:gia_dinh" in memory["tags"]
    assert "khong_hop_le" not in memory["tags"]
    assert memory["occurred_at"].startswith("2014-08-07")
    # TTS variant is derived when the caller does not send one.
    assert "còng lưng, Đêm nằm" in memory["body_tts"]

    again = client.post(
        f"/api/spaces/{space['id']}/memories/poems/import", headers=headers, json=payload
    )
    assert again.status_code == 200, again.text
    assert again.json()["imported"] == 0
    assert again.json()["skipped"][0]["reason"] == "duplicate"


def test_import_poems_dry_run_writes_nothing(client):
    token = _login(client, "poem-dry@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà thử"}).json()
    identity_id = _heritage_identity(client, headers, space["id"])

    res = client.post(
        f"/api/spaces/{space['id']}/memories/poems/import",
        headers=headers,
        json={"identity_id": identity_id, "poems": [_POEM], "dry_run": True},
    )
    assert res.status_code == 200, res.text
    assert res.json()["would_import"] == 1
    listed = client.get(f"/api/spaces/{space['id']}/memories", headers=headers).json()
    assert listed["memories"] == []


def test_imported_poems_do_not_open_activate_gate(client):
    token = _login(client, "poem-gate@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà cổng"}).json()
    identity_id = _heritage_identity(client, headers, space["id"])

    poems = [dict(_POEM, title=f"Bài {i}", body=f"Câu thơ số {i}\nCâu tám của bài số {i} đây") for i in range(5)]
    res = client.post(
        f"/api/spaces/{space['id']}/memories/poems/import",
        headers=headers,
        json={"identity_id": identity_id, "poems": poems},
    )
    assert res.status_code == 200, res.text
    assert res.json()["imported"] == 5

    readiness = client.get(
        f"/api/spaces/{space['id']}/identities/{identity_id}/heritage-readiness",
        headers=headers,
    ).json()
    assert readiness["poem_count"] == 5
    assert readiness["knowledge_count"] == 0
    assert readiness["can_activate"] is False


def test_editing_poem_body_refreshes_tts(client):
    token = _login(client, "poem-edit@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà sửa"}).json()
    identity_id = _heritage_identity(client, headers, space["id"])

    created = client.post(
        f"/api/spaces/{space['id']}/memories/poems/import",
        headers=headers,
        json={"identity_id": identity_id, "poems": [_POEM]},
    ).json()["memories"][0]

    updated = client.patch(
        f"/api/memories/{created['id']}",
        headers=headers,
        json={"body": "Thương nhau chớ kể sang hèn\nMáu đào, sáng lửa tối đèn chớ quên"},
    )
    assert updated.status_code == 200, updated.text
    assert "sang hèn, Máu đào" in updated.json()["body_tts"]


def test_delete_memory(client, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    from io import BytesIO

    from app.config import get_settings

    get_settings.cache_clear()

    token = _login(client, "delete-mem@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà"}).json()

    uploaded = client.post(
        f"/api/spaces/{space['id']}/memories/upload",
        headers=headers,
        data={"kind": "video", "title": "Clip xoá"},
        files={"file": ("clip.mts", BytesIO(b"fake-mts"), "video/mp2t")},
    )
    assert uploaded.status_code == 200, uploaded.text
    memory_id = uploaded.json()["id"]

    deleted = client.delete(f"/api/memories/{memory_id}", headers=headers)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["ok"] is True

    listed = client.get(f"/api/spaces/{space['id']}/memories", headers=headers)
    assert listed.status_code == 200
    assert not any(m["id"] == memory_id for m in listed.json()["memories"])

    missing = client.delete(f"/api/memories/{memory_id}", headers=headers)
    assert missing.status_code == 404

    get_settings.cache_clear()
