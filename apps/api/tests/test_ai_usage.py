"""Tests for AI usage telemetry and API."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.db import SessionLocal
from app.models import AiUsageEvent
from app.services.ai_usage import (
    UsageContext,
    aggregate_space_usage,
    estimate_cost_usd,
    record_usage,
)
from app.services.heritage_gemini import GeminiResult


def _login(client, email: str, name: str) -> str:
    res = client.post(
        "/api/auth/dev-login",
        json={"email": email, "password": "forever123", "name": name},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


def _space_id(client, headers: dict) -> str:
    space = client.post("/api/spaces", headers=headers, json={"name": "Nhà test"}).json()
    return space["id"]


def test_estimate_cost_gemini_tokens():
    cost = estimate_cost_usd(
        service="gemini",
        operation="heritage_compose",
        input_tokens=1000,
        output_tokens=200,
    )
    assert cost > 0
    assert cost < 0.01


def test_estimate_cost_tts_chars():
    cost = estimate_cost_usd(
        service="elevenlabs",
        operation="tts_chat",
        output_chars=500,
    )
    assert cost == 0.15


def test_record_and_aggregate():
    db = SessionLocal()
    try:
        space_id = "testspace-ai-usage-1"
        record_usage(
            service="gemini",
            operation="stt",
            model="gemini-test",
            input_tokens=500,
            output_tokens=50,
            latency_ms=1200,
            context=UsageContext(space_id=space_id, operation="stt"),
        )
        record_usage(
            service="elevenlabs",
            operation="tts_chat",
            model="eleven_v3",
            output_chars=120,
            latency_ms=800,
            context=UsageContext(space_id=space_id, operation="tts_chat"),
        )
        summary = aggregate_space_usage(db, space_id=space_id, days=30)
        assert summary["totals"]["calls"] == 2
        assert summary["totals"]["estimated_usd"] > 0
        modalities = {
            row["operation"]: row["calls"] for row in summary["totals"]["by_modality"]
        }
        assert modalities.get("stt") == 1
        assert modalities.get("tts") == 1
        assert "llm" not in modalities
    finally:
        db.query(AiUsageEvent).filter(AiUsageEvent.space_id == space_id).delete()
        db.commit()
        db.close()


def test_aggregate_excludes_old_events():
    db = SessionLocal()
    space_id = "testspace-ai-usage-old"
    row = AiUsageEvent(
        id="oldusage1evt",
        space_id=space_id,
        service="gemini",
        provider="gemini",
        operation="agent",
        model="gemini-test",
        estimated_cost_usd=0.01,
        created_at=datetime.now(timezone.utc) - timedelta(days=40),
    )
    db.add(row)
    db.commit()
    try:
        summary = aggregate_space_usage(db, space_id=space_id, days=30)
        ops = [row["operation"] for row in summary["totals"]["by_operation"]]
        assert "agent" not in ops
    finally:
        db.query(AiUsageEvent).filter(AiUsageEvent.space_id == space_id).delete()
        db.commit()
        db.close()


def test_get_ai_usage_steward(client):
    token = _login(client, "ai-usage-steward@example.com", "Steward")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space_id(client, headers)
    record_usage(
        service="gemini",
        operation="heritage_compose",
        model="gemini-test",
        input_tokens=100,
        output_tokens=50,
        context=UsageContext(space_id=space_id, operation="heritage_compose"),
    )
    res = client.get(f"/api/spaces/{space_id}/ai-usage?days=30", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["totals"]["calls"] >= 1
    assert "disclaimer" in data


def test_get_ai_usage_member_forbidden(client):
    owner_token = _login(client, "ai-owner@example.com", "Owner")
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    space_id = _space_id(client, owner_headers)

    member_token = _login(client, "ai-member@example.com", "Member")
    # Member needs invite — create invite and join
    invite = client.post(f"/api/spaces/{space_id}/invites", headers=owner_headers).json()
    join = client.post(
        "/api/spaces/join",
        headers={"Authorization": f"Bearer {member_token}"},
        json={"code": invite["code"]},
    )
    assert join.status_code == 200

    res = client.get(
        f"/api/spaces/{space_id}/ai-usage?days=30",
        headers={"Authorization": f"Bearer {member_token}"},
    )
    assert res.status_code == 403


def test_call_gemini_records_usage_when_context_set():
    from app.config import Settings
    from app.services.heritage_gemini import GeminiCall, call_gemini

    settings = Settings(gemini_api_key="test-key", seed_demo=False)
    mock_response_data = {
        "candidates": [{"content": {"parts": [{"text": "ok"}]}}],
        "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5},
    }

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return mock_response_data

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, *args, **kwargs):
            return FakeResponse()

    space_id = "testspace-gemini-hook"
    with patch("app.services.heritage_gemini.httpx.Client", return_value=FakeClient()):
        result = call_gemini(
            settings,
            GeminiCall(
                system_prompt="sys",
                contents=[{"role": "user", "parts": [{"text": "hi"}]}],
                model="gemini-test",
                usage=UsageContext(space_id=space_id, operation="agent"),
            ),
        )
    assert result.text == "ok"
    db = SessionLocal()
    try:
        rows = (
            db.query(AiUsageEvent)
            .filter(
                AiUsageEvent.space_id == space_id,
                AiUsageEvent.operation == "agent",
            )
            .all()
        )
        assert len(rows) == 1
        assert rows[0].input_tokens == 10
        assert rows[0].output_tokens == 5
    finally:
        db.query(AiUsageEvent).filter(AiUsageEvent.space_id == space_id).delete()
        db.commit()
        db.close()
