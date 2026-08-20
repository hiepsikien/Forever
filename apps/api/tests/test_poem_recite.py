from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

from app.config import get_settings
from app.db import SessionLocal
from app.models import VoiceProfile
from app.services.heritage_tts import chunk_tts_text
from tests.test_memories import _POEM, _heritage_identity, _login, _space_and_thread


def test_chunk_tts_text_keeps_short_poem():
    text = "Mẹ già tóc bạc còng lưng, Đêm nằm con vẫn nhớ từng bước chân."
    assert chunk_tts_text(text, 900) == [text]


def test_chunk_tts_text_splits_stanzas():
    a = "a" * 200
    b = "b" * 200
    chunks = chunk_tts_text(f"{a}\n\n{b}", 250)
    assert len(chunks) == 2
    assert chunks[0] == a
    assert chunks[1] == b


def test_chunk_tts_text_verse_lines_stay_single_spaced():
    """Blank lines between every lục/bát made some voices stop mid-passage."""
    lines = [
        "Trăm năm trong cõi người ta,",
        "Chữ tài chữ mệnh khéo là ghét nhau.",
        "Trải qua một cuộc bể dâu,",
        "Những điều trông thấy mà đau đớn lòng.",
        "Lạ gì bỉ sắc tư phong,",
        "Trời xanh quen thói má hồng đánh ghen.",
        "Cảo thơm lần giở trước đèn,",
        "Phong tình cổ lục còn truyền sử xanh.",
        "Rằng năm Gia Tĩnh triều Minh,",
        "Bốn phương phẳng lặng, hai kinh vững vàng.",
    ]
    pieces = chunk_tts_text("\n".join(lines), 280)
    assert len(pieces) >= 2
    assert pieces[0].endswith("Phong tình cổ lục còn truyền sử xanh.")
    assert "\n\n" not in pieces[0]
    assert pieces[1].startswith("Rằng năm Gia Tĩnh")


def test_merge_mp3_parts_single_passthrough():
    from app.services.heritage_tts import _merge_mp3_parts

    assert _merge_mp3_parts([b"ID3fake"]) == b"ID3fake"
    assert _merge_mp3_parts([]) == b""


def _mark_voice_ready(identity_id: str) -> None:
    db = SessionLocal()
    try:
        row = (
            db.query(VoiceProfile)
            .filter(VoiceProfile.identity_profile_id == identity_id)
            .one()
        )
        row.status = "ready"
        row.provider_voice_id = "el_poem_voice"
        row.updated_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()


def test_recite_poem_requires_poem_kind(client):
    token = _login(client, "recite-note@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id, _ = _space_and_thread(client, headers)
    note = client.post(
        f"/api/spaces/{space_id}/memories/note",
        headers=headers,
        json={"title": "Ghi", "body": "Không phải thơ"},
    ).json()
    res = client.post(f"/api/memories/{note['id']}/recite", headers=headers)
    assert res.status_code == 400


def test_recite_poem_needs_ready_voice(client):
    token = _login(client, "recite-novoice@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà thơ"}).json()
    identity_id = _heritage_identity(client, headers, space["id"])
    imported = client.post(
        f"/api/spaces/{space['id']}/memories/poems/import",
        headers=headers,
        json={"identity_id": identity_id, "poems": [_POEM]},
    )
    assert imported.status_code == 200, imported.text
    memory_id = imported.json()["memories"][0]["id"]
    res = client.post(
        f"/api/memories/{memory_id}/recite",
        headers=headers,
        params={"identity_id": identity_id},
    )
    assert res.status_code == 409


def test_recite_poem_caches_audio(client, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-el-key")
    get_settings.cache_clear()
    token = _login(client, "recite-ok@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà thơ"}).json()
    identity_id = _heritage_identity(client, headers, space["id"])
    voice = client.post(
        f"/api/spaces/{space['id']}/voices/heritage",
        headers=headers,
        json={"identity_profile_id": identity_id, "consent": True},
    )
    assert voice.status_code == 200, voice.text
    _mark_voice_ready(identity_id)
    imported = client.post(
        f"/api/spaces/{space['id']}/memories/poems/import",
        headers=headers,
        json={"identity_id": identity_id, "poems": [_POEM]},
    )
    assert imported.status_code == 200, imported.text
    memory_id = imported.json()["memories"][0]["id"]

    with patch(
        "app.services.heritage_tts.vp.text_to_speech",
        return_value=b"ID3poem-audio",
    ) as mock_tts:
        first = client.post(
            f"/api/memories/{memory_id}/recite",
            headers=headers,
            params={"identity_id": identity_id},
        )
        second = client.post(
            f"/api/memories/{memory_id}/recite",
            headers=headers,
            params={"identity_id": identity_id},
        )
    assert first.status_code == 200, first.text
    assert first.content == b"ID3poem-audio"
    assert second.status_code == 200
    assert second.content == b"ID3poem-audio"
    assert mock_tts.call_count == 1

    edited = client.patch(
        f"/api/memories/{memory_id}",
        headers=headers,
        json={"body": "Mẹ già tóc bạc còng lưng\nĐêm nằm con nhớ từng câu dặn dò"},
    )
    assert edited.status_code == 200, edited.text
    with patch(
        "app.services.heritage_tts.vp.text_to_speech",
        return_value=b"ID3poem-v2",
    ) as mock_again:
        third = client.post(
            f"/api/memories/{memory_id}/recite",
            headers=headers,
            params={"identity_id": identity_id},
        )
    assert third.status_code == 200, third.text
    assert third.content == b"ID3poem-v2"
    assert mock_again.call_count == 1
    get_settings.cache_clear()
