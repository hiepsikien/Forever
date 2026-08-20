"""Storytelling shelf — Voice DNA TTS cache; optional human upload still works."""

from __future__ import annotations

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


def _space(client: TestClient, token: str) -> str:
    res = client.post(
        "/api/spaces",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Nhà test kể chuyện"},
    )
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _identity(client: TestClient, token: str, space_id: str) -> str:
    res = client.get(
        f"/api/spaces/{space_id}/identities",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    create = client.post(
        f"/api/spaces/{space_id}/identities",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "display_name": "Bà Nội",
            "relation_label": "Bà Nội",
            "status": "remembered",
        },
    )
    if create.status_code == 200:
        return create.json()["id"]
    ids = res.json().get("identities") or []
    assert ids, "need an identity"
    return ids[0]["id"]


def test_storytelling_listen_needs_voice_or_cache(client: TestClient):
    token = _login(client, "story@forever.family", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token)
    identity_id = _identity(client, token, space_id)

    shelf = client.get(
        f"/api/spaces/{space_id}/identities/{identity_id}/stories",
        headers=headers,
    )
    assert shelf.status_code == 200, shelf.text
    works = shelf.json()["works"]
    slugs = {w["slug"] for w in works}
    assert {
        "kieu",
        "luc_van_tien",
        "pham_cong_cuc_hoa",
        "luu_binh_duong_le",
        "chieu_quan_cong_ho",
        "kinh_a_di_da",
        "kinh_pho_mon",
        "bat_nha_tam_kinh",
        "kinh_dia_tang",
        "kinh_duoc_su",
        "kinh_vu_lan",
    } <= slugs
    sutras = [w for w in works if w["category"] == "sutra"]
    assert len(sutras) >= 6
    assert sutras[0]["slug"] == "kinh_a_di_da"
    assert all(
        w["chunk_count"] > 0
        for w in works
        if w["slug"] in {"kieu", "luc_van_tien", "pham_cong_cuc_hoa"}
    )

    # No work enabled → nothing to hear
    listen0 = client.get(
        f"/api/spaces/{space_id}/identities/{identity_id}/stories/next-to-listen",
        headers=headers,
    )
    assert listen0.status_code == 404

    en = client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/stories/works/kieu/enable",
        headers=headers,
    )
    assert en.status_code == 200, en.text

    # Enabled but no Voice DNA → 409 (cannot synthesize)
    listen_tts = client.get(
        f"/api/spaces/{space_id}/identities/{identity_id}/stories/next-to-listen?work=kieu",
        headers=headers,
    )
    assert listen_tts.status_code == 409, listen_tts.text

    # Human upload still accepted as a cache (legacy)
    nxt = client.get(
        f"/api/spaces/{space_id}/identities/{identity_id}/stories/next-to-record?work=kieu",
        headers=headers,
    )
    assert nxt.status_code == 200, nxt.text
    chunk = nxt.json()["chunk"]
    assert chunk["body"].strip()

    audio = BytesIO(b"fake-audio-bytes-for-story")
    up = client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/stories/chunks/{chunk['id']}/record",
        headers=headers,
        files={"file": ("take.m4a", audio, "audio/mp4")},
        data={"duration_ms": "12000"},
    )
    assert up.status_code == 200, up.text
    recording_id = up.json()["recording"]["id"]

    listen = client.get(
        f"/api/spaces/{space_id}/identities/{identity_id}/stories/next-to-listen?work=kieu",
        headers=headers,
    )
    assert listen.status_code == 200, listen.text
    assert listen.json()["recording"]["id"] == recording_id
    assert listen.json()["chunk"]["id"] == chunk["id"]

    media = client.get(
        f"/api/story-recordings/{recording_id}/media",
        headers=headers,
    )
    assert media.status_code == 200
    assert media.content == b"fake-audio-bytes-for-story"


def test_storytelling_tts_caches_and_reuses(client: TestClient):
    token = _login(client, "story-tts@forever.family", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token)
    identity_id = _identity(client, token, space_id)
    assert (
        client.post(
            f"/api/spaces/{space_id}/identities/{identity_id}/stories/works/kieu/enable",
            headers=headers,
        ).status_code
        == 200
    )

    fake_voice = type(
        "V",
        (),
        {
            "id": "voice1",
            "provider_voice_id": "pv1",
            "status": "ready",
            "tts_prefs_json": "",
            "provider": "elevenlabs",
        },
    )()

    with (
        patch(
            "app.services.heritage.voice_for_identity",
            return_value=fake_voice,
        ),
        patch(
            "app.services.poem_recite.voice_can_recite",
            return_value=True,
        ),
        patch(
            "app.services.poem_recite.recite_fingerprint",
            return_value="fp-test-1",
        ),
        patch(
            "app.services.heritage_tts.synthesize_poem_audio",
            return_value=b"tts-bytes-kieu",
        ) as synth,
    ):
        first = client.get(
            f"/api/spaces/{space_id}/identities/{identity_id}/stories/next-to-listen?work=kieu",
            headers=headers,
        )
        assert first.status_code == 200, first.text
        assert first.json()["recording"]["source"] == "tts"
        rid = first.json()["recording"]["id"]
        chunk_id = first.json()["chunk"]["id"]
        assert synth.call_count == 1

        # Same chunk again via synthesize — must reuse cache
        again = client.post(
            f"/api/spaces/{space_id}/identities/{identity_id}/stories/chunks/{chunk_id}/synthesize",
            headers=headers,
        )
        assert again.status_code == 200, again.text
        assert again.json()["recording"]["id"] == rid
        assert synth.call_count == 1

        media = client.get(f"/api/story-recordings/{rid}/media", headers=headers)
        assert media.status_code == 200
        assert media.content == b"tts-bytes-kieu"


def test_import_luu_binh_prose_then_record(client: TestClient):
    token = _login(client, "story-import@forever.family", "Steward")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token)
    identity_id = _identity(client, token, space_id)

    prose = (
        "Ngày xưa, có hai người kết bạn với nhau rất thân, một người tên là Lưu Bình, "
        "một người tên là Dương Lễ. Dương Lễ nhà nghèo, Lưu Bình nhà giàu có bèn đưa bạn "
        "về nhà ở, ăn cùng mâm, học cùng đèn.\n\n"
        "Đến khoa thi, Lưu Bình thi hỏng, Dương Lễ đỗ cao, được bổ nhiệm đi làm quan. "
        "Lưu Bình tìm đến hỏi thăm, Dương Lễ lẩn mặt, sai lính dọn đãi lưng cơm hẩm với "
        "đĩa cà thâm để khích chí bạn.\n\n"
        "Sau đó Dương Lễ sai Châu Long đi nuôi Lưu Bình ăn học. Lưu Bình đỗ đạt, mới biết "
        "ân tình của bạn cũ và của nàng Châu Long."
    )
    imp = client.post(
        f"/api/spaces/{space_id}/stories/works/luu_binh_duong_le/import",
        headers=headers,
        json={"text": prose, "form": "prose"},
    )
    assert imp.status_code == 200, imp.text
    assert imp.json()["chunk_count"] >= 1

    en = client.post(
        f"/api/spaces/{space_id}/identities/{identity_id}/stories/works/luu_binh_duong_le/enable",
        headers=headers,
    )
    assert en.status_code == 200, en.text

    nxt = client.get(
        f"/api/spaces/{space_id}/identities/{identity_id}/stories/next-to-record?work=luu_binh_duong_le",
        headers=headers,
    )
    assert nxt.status_code == 200, nxt.text
    assert "Lưu Bình" in nxt.json()["chunk"]["body"]


def test_kinh_duoc_su_seeded_with_expanded_repeats(client: TestClient):
    token = _login(client, "duocsu@forever.family", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token)
    identity_id = _identity(client, token, space_id)

    shelf = client.get(
        f"/api/spaces/{space_id}/identities/{identity_id}/stories",
        headers=headers,
    )
    assert shelf.status_code == 200
    work = next(w for w in shelf.json()["works"] if w["slug"] == "kinh_duoc_su")
    assert work["chunk_count"] >= 20
    assert work["category"] == "sutra"

    chunks = client.get(
        f"/api/spaces/{space_id}/identities/{identity_id}/stories/works/kinh_duoc_su/chunks",
        headers=headers,
    )
    assert chunks.status_code == 200
    bodies = "\n".join(
        client.get(
            f"/api/spaces/{space_id}/identities/{identity_id}/stories/chunks/{c['id']}",
            headers=headers,
        ).json()["chunk"]["body"]
        for c in chunks.json()["chunks"][:5]
    )
    assert "3 lần" not in bodies
    assert "1 lạy" not in bodies
    assert bodies.count("NAM MÔ HƯƠNG CÚNG DƯỜNG BỒ TÁT MA HA TÁT") >= 3


def test_import_tam_kinh_sutra(client: TestClient):
    token = _login(client, "sutra@import.forever", "Steward")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token)

    text = (
        "Quán Tự Tại Bồ Tát hành thâm Bát Nhã Ba La Mật Đa thời, chiếu kiến ngũ uẩn đều không, "
        "độ nhất thiết khổ ách. Xá Lợi Tử, sắc bất dị không, không bất dị sắc; sắc tức thị không, "
        "không tức thị sắc. Thọ tưởng hành thức diệc phục như thị."
    )
    imp = client.post(
        f"/api/spaces/{space_id}/stories/works/bat_nha_tam_kinh/import",
        headers=headers,
        json={"text": text, "form": "prose"},
    )
    assert imp.status_code == 200, imp.text
    assert imp.json()["chunk_count"] >= 1
    assert imp.json()["work"]["category"] == "sutra"
