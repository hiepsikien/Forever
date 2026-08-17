"""Per-space heritage pipeline toggles in admin settings."""

from __future__ import annotations

from datetime import datetime, timezone

from app.db import SessionLocal
from app.models import SpaceSettings
from app.services.heritage_pipeline import (
    apply_pipeline_overrides,
    load_heritage_pipeline,
    server_pipeline_defaults,
)


def _login(client, email: str, name: str) -> str:
    res = client.post(
        "/api/auth/dev-login",
        json={"email": email, "password": "forever123", "name": name},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


def test_settings_include_pipeline_defaults(client):
    token = _login(client, "pipeline-steward@example.com", "Steward")
    headers = {"Authorization": f"Bearer {token}"}
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà pipeline"}).json()
    res = client.get(f"/api/spaces/{space['id']}/settings", headers=headers)
    assert res.status_code == 200
    data = res.json()
    pipeline = data["heritage_pipeline"]
    keys = [f["key"] for f in pipeline["flags"]]
    assert keys == [
        "stt",
        "analyzer",
        "grounding",
        "critic",
        "tts",
        "anti_repeat",
        "family_bridge",
    ]
    defaults = server_pipeline_defaults()
    by_key = {f["key"]: f for f in pipeline["flags"]}
    assert by_key["analyzer"]["enabled"] is defaults.analyzer
    assert by_key["analyzer"]["overridden"] is False


def test_patch_pipeline_override_and_clear(client):
    token = _login(client, "pipeline-owner@example.com", "Owner")
    headers = {"Authorization": f"Bearer {token}"}
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà toggle"}).json()
    space_id = space["id"]

    res = client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=headers,
        json={"heritage_pipeline": {"analyzer": True, "critic": True}},
    )
    assert res.status_code == 200, res.text
    flags = {f["key"]: f for f in res.json()["heritage_pipeline"]["flags"]}
    assert flags["analyzer"]["enabled"] is True
    assert flags["analyzer"]["overridden"] is True
    assert flags["critic"]["enabled"] is True

    db = SessionLocal()
    try:
        effective = load_heritage_pipeline(db, space_id)
        assert effective.analyzer is True
        assert effective.critic is True
    finally:
        db.close()

    # Clear analyzer override → follow server default again.
    res = client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=headers,
        json={"heritage_pipeline": {"analyzer": None}},
    )
    assert res.status_code == 200
    flags = {f["key"]: f for f in res.json()["heritage_pipeline"]["flags"]}
    assert flags["analyzer"]["overridden"] is False
    assert flags["analyzer"]["enabled"] is server_pipeline_defaults().analyzer
    assert flags["critic"]["overridden"] is True


def test_apply_pipeline_overrides_roundtrip():
    row = SpaceSettings(
        space_id="tmp-pipeline",
        heritage_pipeline_json="",
        updated_at=datetime.now(timezone.utc),
    )
    apply_pipeline_overrides(row, flags={"stt": False, "tts": False})
    assert '"stt": false' in row.heritage_pipeline_json
    apply_pipeline_overrides(row, flags={"stt": None, "tts": None})
    assert row.heritage_pipeline_json == ""


def test_patch_pipeline_models(client):
    token = _login(client, "pipeline-models@example.com", "Owner")
    headers = {"Authorization": f"Bearer {token}"}
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà models"}).json()
    space_id = space["id"]

    res = client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=headers,
        json={
            "heritage_pipeline": {
                "models": {
                    "compose": "gemini-3.7-flash",
                    "stt": "gemini-3.1-flash-lite",
                }
            }
        },
    )
    assert res.status_code == 200, res.text
    pipeline = res.json()["heritage_pipeline"]
    choice_ids = {c["id"] for c in pipeline["model_choices"]}
    assert "gemini-3.6-flash" in choice_ids
    assert "gemini-3.7-flash" in choice_ids
    models = {m["key"]: m for m in pipeline["models"]}
    assert models["compose"]["model"] == "gemini-3.7-flash"
    assert models["compose"]["overridden"] is True
    assert models["stt"]["model"] == "gemini-3.1-flash-lite"

    db = SessionLocal()
    try:
        effective = load_heritage_pipeline(db, space_id)
        assert effective.compose_model == "gemini-3.7-flash"
        assert effective.stt_model == "gemini-3.1-flash-lite"
    finally:
        db.close()

    res = client.patch(
        f"/api/spaces/{space_id}/settings",
        headers=headers,
        json={"heritage_pipeline": {"models": {"compose": None}}},
    )
    assert res.status_code == 200
    models = {m["key"]: m for m in res.json()["heritage_pipeline"]["models"]}
    assert models["compose"]["overridden"] is False
    assert models["compose"]["model"] == server_pipeline_defaults().compose_model


def test_server_defaults_use_lite_except_compose():
    from app.config import Settings

    settings = Settings.model_construct(
        gemini_model="gemini-3.5-flash",
        stt_model="gemini-3.1-flash-lite",
        heritage_analyzer_model="gemini-3.1-flash-lite",
        heritage_compose_model="",
        heritage_critic_model="gemini-3.1-flash-lite",
        stt_enabled=True,
        heritage_analyzer_enabled=True,
        heritage_grounding_enabled=True,
        heritage_critic_enabled=False,
        heritage_tts_enabled=True,
        heritage_anti_repeat_enabled=True,
    )
    defaults = server_pipeline_defaults(settings)
    assert defaults.stt_model == "gemini-3.1-flash-lite"
    assert defaults.analyzer_model == "gemini-3.1-flash-lite"
    assert defaults.critic_model == "gemini-3.1-flash-lite"
    assert defaults.compose_model == "gemini-3.5-flash"


def test_thinking_config_matches_gemini_constraints():
    from app.services.heritage_gemini import thinking_config_for_model

    assert thinking_config_for_model("gemini-3.1-flash-lite") == {"thinkingBudget": 0}
    assert thinking_config_for_model("gemini-3.5-flash") == {"thinkingBudget": 0}
    assert thinking_config_for_model("gemini-3.5-flash-lite") == {"thinkingLevel": "minimal"}
    assert thinking_config_for_model("gemini-3.6-flash") == {"thinkingLevel": "minimal"}
    assert thinking_config_for_model("gemini-3.7-flash") == {"thinkingLevel": "low"}
