from io import BytesIO
from pathlib import Path

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
        json={"name": "Nhà Extract"},
    )
    assert res.status_code == 200, res.text
    return res.json()["id"]


def _heritage_voice(client: TestClient, headers: dict, space_id: str) -> str:
    ident = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=headers,
        json={
            "display_name": "Bố",
            "relation_label": "Bố",
            "status": "remembered",
        },
    )
    assert ident.status_code == 200, ident.text
    identity_id = ident.json()["id"]
    voice = client.post(
        f"/api/spaces/{space_id}/voices/for-identity",
        headers=headers,
        json={"identity_profile_id": identity_id, "consent": True},
    )
    assert voice.status_code == 200, voice.text
    return voice.json()["id"]


def test_extract_job_worker_review_import(client: TestClient, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    monkeypatch.setenv("EXTRACT_WORKER_TOKEN", "test-worker-token")
    from app.config import get_settings

    get_settings.cache_clear()

    token = _login(client, "extract-owner@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token)
    voice_id = _heritage_voice(client, headers, space_id)

    # Member cannot create extract jobs.
    invite = client.post(f"/api/spaces/{space_id}/invites", headers=headers).json()
    member_token = _login(client, "extract-member@example.com", "Mẹ")
    member_h = {"Authorization": f"Bearer {member_token}"}
    assert (
        client.post(
            "/api/spaces/join", headers=member_h, json={"code": invite["code"]}
        ).status_code
        == 200
    )
    denied = client.post(
        f"/api/spaces/{space_id}/extract/jobs",
        headers=member_h,
        data={"voice_profile_id": voice_id, "num_speakers": "2"},
        files={"file": ("tape.wav", BytesIO(b"RIFFxxxxWAVE"), "audio/wav")},
    )
    assert denied.status_code == 403

    created = client.post(
        f"/api/spaces/{space_id}/extract/jobs",
        headers=headers,
        data={"voice_profile_id": voice_id, "num_speakers": "2"},
        files={"file": ("tape.wav", BytesIO(b"RIFFxxxxWAVEdata"), "audio/wav")},
    )
    assert created.status_code == 200, created.text
    job = created.json()
    assert job["status"] == "queued"
    assert job["num_speakers"] == 2
    job_id = job["id"]

    # Bad worker token rejected.
    bad = client.post("/api/internal/extract/claim", headers={"X-Extract-Worker-Token": "nope"})
    assert bad.status_code == 401

    claim = client.post(
        "/api/internal/extract/claim",
        headers={"X-Extract-Worker-Token": "test-worker-token"},
    )
    assert claim.status_code == 200, claim.text
    body = claim.json()
    assert body["job"]["id"] == job_id
    assert Path(body["input_absolute_path"]).exists()
    artifact = Path(body["artifact_dir_absolute"])
    artifact.mkdir(parents=True, exist_ok=True)

    # Fake exclusive clips as the worker would write.
    clip_rel = "speakers/SPEAKER_00/0001.wav"
    clip_path = artifact / clip_rel
    clip_path.parent.mkdir(parents=True, exist_ok=True)
    clip_path.write_bytes(b"FAKEWAV" * 200)

    complete = client.post(
        f"/api/internal/extract/{job_id}/complete",
        headers={"X-Extract-Worker-Token": "test-worker-token"},
        json={
            "duration_seconds": 12.0,
            "device": "cpu",
            "model": "test-model",
            "raw_turn_count": 3,
            "segments": [
                {
                    "speaker": "SPEAKER_00",
                    "start": 1.0,
                    "end": 4.5,
                    "file": clip_rel,
                    "purity": 1.0,
                    "quality": "clean",
                },
                {
                    "speaker": "SPEAKER_01",
                    "start": 5.0,
                    "end": 6.0,
                    "file": "speakers/SPEAKER_01/0001.wav",
                    "purity": 1.0,
                    "quality": "short",
                },
            ],
        },
    )
    assert complete.status_code == 200, complete.text
    done = complete.json()
    assert done["status"] == "needs_review"
    assert done["clean_segment_count"] == 1

    segs = client.get(
        f"/api/spaces/{space_id}/extract/jobs/{job_id}/segments",
        headers=headers,
        params={"quality": "clean"},
    )
    assert segs.status_code == 200
    clean = segs.json()["segments"]
    assert len(clean) == 1
    seg_id = clean[0]["id"]

    assign = client.post(
        f"/api/spaces/{space_id}/extract/jobs/{job_id}/assign-speaker",
        headers=headers,
        json={"speaker_label": "SPEAKER_00"},
    )
    assert assign.status_code == 200
    assert assign.json()["assigned_speaker_label"] == "SPEAKER_00"

    imported = client.post(
        f"/api/spaces/{space_id}/extract/jobs/{job_id}/segments/accept",
        headers=headers,
        json={"segment_ids": [seg_id]},
    )
    assert imported.status_code == 200, imported.text
    payload = imported.json()
    assert payload["imported"] == 1
    assert payload["total_clean_seconds"] == 3.5

    samples = client.get(
        f"/api/spaces/{space_id}/voice-samples",
        headers=headers,
        params={"voice_id": voice_id},
    )
    assert samples.status_code == 200
    rows = samples.json()["samples"]
    assert len(rows) == 1
    assert rows[0]["source"] == "extract"
    assert rows[0]["speaker_label"] == "SPEAKER_00"
    assert rows[0]["extract_job_id"] == job_id

    finish = client.post(
        f"/api/spaces/{space_id}/extract/jobs/{job_id}/finish",
        headers=headers,
    )
    assert finish.status_code == 200
    assert finish.json()["status"] == "done"

    get_settings.cache_clear()
