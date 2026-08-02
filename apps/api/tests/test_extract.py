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


def _heritage_voice(
    client: TestClient,
    headers: dict,
    space_id: str,
    *,
    name: str = "Bố",
    relation: str = "Bố",
) -> str:
    ident = client.post(
        f"/api/spaces/{space_id}/identities",
        headers=headers,
        json={
            "display_name": name,
            "relation_label": relation,
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


def _complete_pool_job(
    client: TestClient,
    *,
    headers: dict,
    space_id: str,
    worker_token: str = "test-worker-token",
) -> tuple[str, str, str]:
    """Create job, fake worker complete with 2 clean speakers. Returns job_id, seg0, seg1."""
    created = client.post(
        f"/api/spaces/{space_id}/extract/jobs",
        headers=headers,
        data={"num_speakers": "3"},
        files={"file": ("tape.wav", BytesIO(b"RIFFxxxxWAVEdata"), "audio/wav")},
    )
    assert created.status_code == 200, created.text
    job_id = created.json()["id"]
    assert created.json()["voice_profile_id"] is None

    claim = client.post(
        "/api/internal/extract/claim",
        headers={"X-Extract-Worker-Token": worker_token},
    )
    assert claim.status_code == 200, claim.text
    artifact = Path(claim.json()["artifact_dir_absolute"])
    for rel in (
        "speakers/SPEAKER_00/0001.wav",
        "speakers/SPEAKER_01/0001.wav",
    ):
        path = artifact / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"FAKEWAV" * 200)

    complete = client.post(
        f"/api/internal/extract/{job_id}/complete",
        headers={"X-Extract-Worker-Token": worker_token},
        json={
            "duration_seconds": 20.0,
            "device": "cpu",
            "model": "test-model",
            "raw_turn_count": 4,
            "segments": [
                {
                    "speaker": "SPEAKER_00",
                    "start": 1.0,
                    "end": 5.0,
                    "file": "speakers/SPEAKER_00/0001.wav",
                    "purity": 1.0,
                    "quality": "clean",
                },
                {
                    "speaker": "SPEAKER_01",
                    "start": 6.0,
                    "end": 9.5,
                    "file": "speakers/SPEAKER_01/0001.wav",
                    "purity": 1.0,
                    "quality": "clean",
                },
                {
                    "speaker": "SPEAKER_02",
                    "start": 10.0,
                    "end": 11.0,
                    "file": "speakers/SPEAKER_02/0001.wav",
                    "purity": 1.0,
                    "quality": "short",
                },
            ],
        },
    )
    assert complete.status_code == 200, complete.text
    segs = client.get(
        f"/api/spaces/{space_id}/extract/jobs/{job_id}/segments",
        headers=headers,
        params={"quality": "clean"},
    ).json()["segments"]
    assert len(segs) == 2
    # Sorted longest-first.
    assert segs[0]["duration_ms"] >= segs[1]["duration_ms"]
    by_speaker = {s["speaker_label"]: s["id"] for s in segs}
    return job_id, by_speaker["SPEAKER_00"], by_speaker["SPEAKER_01"]


def test_extract_pool_import_to_multiple_voices(
    client: TestClient, tmp_path, monkeypatch
):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    monkeypatch.setenv("EXTRACT_WORKER_TOKEN", "test-worker-token")
    from app.config import get_settings

    get_settings.cache_clear()

    token = _login(client, "extract-pool-owner@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token)
    bo_voice = _heritage_voice(client, headers, space_id, name="Hùng", relation="Bố")

    # Member cannot create extract jobs.
    invite = client.post(f"/api/spaces/{space_id}/invites", headers=headers).json()
    member_token = _login(client, "extract-pool-member@example.com", "Mẹ")
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
        data={"num_speakers": "2"},
        files={"file": ("tape.wav", BytesIO(b"RIFFxxxxWAVE"), "audio/wav")},
    )
    assert denied.status_code == 403

    bad = client.post(
        "/api/internal/extract/claim", headers={"X-Extract-Worker-Token": "nope"}
    )
    assert bad.status_code == 401

    job_id, seg0, seg1 = _complete_pool_job(
        client, headers=headers, space_id=space_id
    )

    # SPEAKER_00 → existing Bố voice
    assign = client.post(
        f"/api/spaces/{space_id}/extract/jobs/{job_id}/assign-speaker",
        headers=headers,
        json={"speaker_label": "SPEAKER_00", "voice_profile_id": bo_voice},
    )
    assert assign.status_code == 200, assign.text
    assert assign.json()["speaker_assignments"]["SPEAKER_00"] == bo_voice

    imported_bo = client.post(
        f"/api/spaces/{space_id}/extract/jobs/{job_id}/segments/accept",
        headers=headers,
        json={"segment_ids": [seg0], "voice_profile_id": bo_voice},
    )
    assert imported_bo.status_code == 200, imported_bo.text
    assert imported_bo.json()["imported"] == 1
    assert imported_bo.json()["voice_profile_id"] == bo_voice

    # SPEAKER_01 → create new identity + Voice DNA in same job/pool
    imported_me = client.post(
        f"/api/spaces/{space_id}/extract/jobs/{job_id}/segments/accept",
        headers=headers,
        json={
            "segment_ids": [seg1],
            "speaker_label": "SPEAKER_01",
            "create_identity": {
                "display_name": "Lan",
                "relation_label": "Mẹ",
                "status": "remembered",
                "consent": True,
            },
        },
    )
    assert imported_me.status_code == 200, imported_me.text
    me_voice = imported_me.json()["voice_profile_id"]
    assert me_voice != bo_voice
    assert imported_me.json()["job"]["speaker_assignments"]["SPEAKER_01"] == me_voice

    bo_samples = client.get(
        f"/api/spaces/{space_id}/voice-samples",
        headers=headers,
        params={"voice_id": bo_voice},
    ).json()["samples"]
    assert len(bo_samples) == 1
    assert bo_samples[0]["speaker_label"] == "SPEAKER_00"
    assert bo_samples[0]["pipeline_stage"] == "unprocessed"

    me_samples = client.get(
        f"/api/spaces/{space_id}/voice-samples",
        headers=headers,
        params={"voice_id": me_voice},
    ).json()["samples"]
    assert len(me_samples) == 1
    assert me_samples[0]["speaker_label"] == "SPEAKER_01"
    assert me_samples[0]["extract_job_id"] == job_id
    assert me_samples[0]["pipeline_stage"] == "unprocessed"

    finish = client.post(
        f"/api/spaces/{space_id}/extract/jobs/{job_id}/finish",
        headers=headers,
    )
    assert finish.status_code == 200
    assert finish.json()["status"] == "done"

    get_settings.cache_clear()


def test_stale_running_job_requeued(client: TestClient, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    monkeypatch.setenv("EXTRACT_WORKER_TOKEN", "test-worker-token")
    monkeypatch.setenv("EXTRACT_JOB_STALE_MINUTES", "30")
    from datetime import datetime, timedelta, timezone

    from app.config import get_settings
    from app.db import SessionLocal
    from app.models import ExtractJob

    get_settings.cache_clear()

    token = _login(client, "extract-stale-owner@example.com", "Con")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token)

    created = client.post(
        f"/api/spaces/{space_id}/extract/jobs",
        headers=headers,
        data={"num_speakers": "2"},
        files={"file": ("tape.wav", BytesIO(b"RIFFxxxxWAVEdata"), "audio/wav")},
    )
    assert created.status_code == 200, created.text
    job_id = created.json()["id"]

    claim = client.post(
        "/api/internal/extract/claim",
        headers={"X-Extract-Worker-Token": "test-worker-token"},
    )
    assert claim.status_code == 200, claim.text
    assert claim.json()["job"]["id"] == job_id

    with SessionLocal() as db:
        job = db.query(ExtractJob).filter(ExtractJob.id == job_id).one()
        job.started_at = datetime.now(timezone.utc) - timedelta(hours=2)
        db.commit()

    listed = client.get(
        f"/api/spaces/{space_id}/extract/jobs",
        headers=headers,
    )
    assert listed.status_code == 200, listed.text
    row = next(j for j in listed.json()["jobs"] if j["id"] == job_id)
    assert row["status"] == "queued"
    assert "timeout" in (row.get("error_message") or "").lower()

    reclaim_claim = client.post(
        "/api/internal/extract/claim",
        headers={"X-Extract-Worker-Token": "test-worker-token"},
    )
    assert reclaim_claim.status_code == 200, reclaim_claim.text
    assert reclaim_claim.json()["job"]["id"] == job_id

    get_settings.cache_clear()
