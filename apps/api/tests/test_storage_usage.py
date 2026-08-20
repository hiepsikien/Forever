"""Storage volume stats for the steward dashboard."""

from __future__ import annotations

from pathlib import Path


def _login(client, email: str, name: str) -> str:
    res = client.post(
        "/api/auth/dev-login",
        json={"email": email, "password": "forever123", "name": name},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


def _space_id(client, headers: dict) -> str:
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà kho"}).json()
    return space["id"]


def _write(root: Path, relative: str, data: bytes) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def test_summarize_space_and_volume(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    from app.config import get_settings
    from app.services.storage_usage import summarize_storage

    get_settings.cache_clear()
    try:
        space_id = "house-a"
        _write(tmp_path, f"{space_id}/clip.mp4", b"v" * 1000)
        _write(tmp_path, f"{space_id}/voice.mp3", b"a" * 200)
        _write(tmp_path, f"{space_id}/extract/job1/in.wav", b"e" * 50)
        _write(tmp_path, f"{space_id}/library-ingest/j1/input.pdf", b"d" * 30)
        _write(tmp_path, "other-house/photo.jpg", b"i" * 400)

        summary = summarize_storage(space_id)
        assert summary["space"]["files"] == 4
        assert summary["space"]["bytes"] == 1280
        assert summary["uploads"]["files"] == 5
        assert summary["uploads"]["bytes"] == 1680
        kinds = {row["key"]: row for row in summary["space"]["by_kind"]}
        assert kinds["video"]["bytes"] == 1000
        assert kinds["audio"]["bytes"] == 250
        assert kinds["document"]["bytes"] == 30
        folders = {row["key"]: row for row in summary["space"]["by_folder"]}
        assert folders["extract"]["bytes"] == 50
        assert folders["library-ingest"]["bytes"] == 30
        assert folders["media"]["bytes"] == 1200
        assert summary["volume"]["used_bytes"] == summary["uploads"]["bytes"]
        assert summary["volume"]["total_bytes"] > 0
        assert 0 <= summary["volume"]["used_ratio"] <= 1
        assert "backup" not in summary
        assert "images" not in summary
    finally:
        get_settings.cache_clear()


def test_get_storage_steward(client, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    from app.config import get_settings

    get_settings.cache_clear()
    try:
        token = _login(client, "storage-steward@example.com", "Steward")
        headers = {"Authorization": f"Bearer {token}"}
        space_id = _space_id(client, headers)
        _write(tmp_path, f"{space_id}/note.jpg", b"photo-bytes")

        res = client.get(f"/api/spaces/{space_id}/storage", headers=headers)
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["space"]["files"] == 1
        assert data["space"]["bytes"] == 11
        assert data["uploads"]["bytes"] >= 11
        assert data["volume"]["used_bytes"] == data["uploads"]["bytes"]
        assert data["volume"]["free_bytes"] > 0
    finally:
        get_settings.cache_clear()


def test_get_storage_member_forbidden(client, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    from app.config import get_settings

    get_settings.cache_clear()
    try:
        owner_token = _login(client, "storage-owner@example.com", "Owner")
        owner_headers = {"Authorization": f"Bearer {owner_token}"}
        space_id = _space_id(client, owner_headers)

        member_token = _login(client, "storage-member@example.com", "Member")
        invite = client.post(
            f"/api/spaces/{space_id}/invites", headers=owner_headers
        ).json()
        join = client.post(
            "/api/spaces/join",
            headers={"Authorization": f"Bearer {member_token}"},
            json={"code": invite["code"]},
        )
        assert join.status_code == 200

        res = client.get(
            f"/api/spaces/{space_id}/storage",
            headers={"Authorization": f"Bearer {member_token}"},
        )
        assert res.status_code == 403
    finally:
        get_settings.cache_clear()
