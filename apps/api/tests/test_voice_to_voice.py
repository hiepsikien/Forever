"""STT + heritage voice/TTS wiring — no live Gemini or ElevenLabs."""

from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.services.heritage_chat import _REFUSE_UNHEARD, maybe_heritage_reply
from app.services.heritage_tts import ChatTtsResult, synthesize_chat_reply
from app.services.stt import Transcript, transcribe
from tests.test_heritage_chat import _login, _space


def test_transcribe_disabled():
    settings = Settings(stt_enabled=False, gemini_api_key="x")
    result = transcribe(settings, path="/tmp/nope.m4a", mime="audio/mp4")
    assert result.error == "disabled"
    assert not result.ok


def test_transcribe_unsupported_mime(tmp_path: Path):
    audio = tmp_path / "x.bin"
    audio.write_bytes(b"abc")
    settings = Settings(stt_enabled=True, gemini_api_key="x")
    result = transcribe(settings, path=audio, mime="application/octet-stream")
    assert result.error == "unsupported_mime"


def test_transcribe_too_large(tmp_path: Path):
    audio = tmp_path / "big.m4a"
    audio.write_bytes(b"x" * 100)
    settings = Settings(stt_enabled=True, gemini_api_key="x", stt_max_bytes=10)
    result = transcribe(settings, path=audio, mime="audio/mp4")
    assert result.error == "too_large"


def test_transcribe_success(tmp_path: Path):
    audio = tmp_path / "ok.m4a"
    audio.write_bytes(b"fake-audio")
    settings = Settings(
        stt_enabled=True,
        gemini_api_key="x",
        gemini_model="gemini-test",
        stt_model="gemini-test",
    )
    mock = MagicMock()
    mock.text = "Bố ơi con chào bố"
    mock.error = None
    mock.latency_ms = 120
    with patch("app.services.stt.call_gemini", return_value=mock) as call:
        result = transcribe(settings, path=audio, mime="audio/mp4")
    assert result.ok
    assert result.text == "Bố ơi con chào bố"
    assert result.provider == "gemini"
    assert result.model == "gemini-test"
    assert call.called
    contents = call.call_args.args[1].contents
    assert "inline_data" in contents[0]["parts"][0]


def test_transcribe_empty_becomes_error(tmp_path: Path):
    audio = tmp_path / "ok.m4a"
    audio.write_bytes(b"fake")
    settings = Settings(stt_enabled=True, gemini_api_key="x")
    mock = MagicMock()
    mock.text = "   "
    mock.error = None
    mock.latency_ms = 10
    with patch("app.services.stt.call_gemini", return_value=mock):
        result = transcribe(settings, path=audio, mime="audio/mpeg")
    assert not result.ok
    assert result.error == "empty_transcript"


def test_synthesize_chat_reply_skips_when_not_ready():
    voice = MagicMock()
    voice.status = "draft"
    voice.provider_voice_id = ""
    voice.space_id = "s1"
    voice.provider = "elevenlabs"
    voice.tts_prefs_json = ""
    assert synthesize_chat_reply(MagicMock(), voice=voice, text="Xin chào") is None


def test_synthesize_chat_reply_skips_long_text():
    voice = MagicMock()
    voice.status = "ready"
    voice.provider_voice_id = "v1"
    voice.space_id = "s1"
    voice.provider = "elevenlabs"
    voice.tts_prefs_json = ""
    settings = Settings(heritage_tts_max_chars=5, elevenlabs_api_key="k")
    assert (
        synthesize_chat_reply(
            MagicMock(), voice=voice, text="quá dài rồi", settings=settings
        )
        is None
    )


def test_synthesize_chat_reply_saves_audio():
    voice = MagicMock()
    voice.status = "ready"
    voice.provider_voice_id = "pv1"
    voice.space_id = "space-1"
    voice.provider = "elevenlabs"
    voice.tts_prefs_json = ""
    db = MagicMock()
    db.query.return_value.filter.return_value.one_or_none.return_value = None
    settings = Settings(
        heritage_tts_enabled=True,
        heritage_tts_max_chars=512,
        elevenlabs_api_key="key",
        voice_default_provider="elevenlabs",
    )
    with (
        patch(
            "app.services.heritage_tts.vp.text_to_speech", return_value=b"mp3-bytes"
        ),
        patch(
            "app.services.heritage_tts.save_bytes", return_value="space-1/x.mp3"
        ) as save,
    ):
        result = synthesize_chat_reply(
            db, voice=voice, text="Con ơi.", settings=settings
        )
    assert isinstance(result, ChatTtsResult)
    assert result.media_path == "space-1/x.mp3"
    assert result.media_mime == "audio/mpeg"
    assert result.meta["provider"] == "elevenlabs"
    assert result.meta["chars"] == 7
    save.assert_called_once()


def test_voice_message_stt_fills_body(client: TestClient, monkeypatch):
    monkeypatch.setenv("STT_ENABLED", "true")
    monkeypatch.setenv("HERITAGE_ASYNC_REPLY", "false")
    monkeypatch.setenv("AGENT_ENABLED", "true")
    get_settings.cache_clear()

    token = _login(client, "voice-stt@forever.family", "Steward")
    headers = {"Authorization": f"Bearer {token}"}
    space_id = _space(client, token, "Voice STT")

    threads = client.get(f"/api/spaces/{space_id}/threads", headers=headers)
    assert threads.status_code == 200
    family = next(t for t in threads.json()["threads"] if t["kind"] == "family")

    empty = Transcript(
        text="", provider="gemini", model="m", error="empty_transcript"
    )
    with patch("app.routers.messages.transcribe", return_value=empty):
        res = client.post(
            f"/api/threads/{family['id']}/messages/voice",
            headers=headers,
            files={"file": ("v.m4a", BytesIO(b"audio-bytes"), "audio/mp4")},
        )
    assert res.status_code == 200, res.text
    msg_id = res.json()["id"]

    listed = client.get(f"/api/threads/{family['id']}/messages", headers=headers)
    assert listed.status_code == 200
    voice_row = next(m for m in listed.json()["messages"] if m["id"] == msg_id)
    assert voice_row["body"] == ""
    assert voice_row["meta"]["stt"]["error"] == "empty_transcript"

    filled = Transcript(
        text="Con chào cả nhà", provider="gemini", model="m", latency_ms=9
    )
    with patch("app.routers.messages.transcribe", return_value=filled):
        res2 = client.post(
            f"/api/threads/{family['id']}/messages/voice",
            headers=headers,
            files={"file": ("v2.m4a", BytesIO(b"audio-2"), "audio/mp4")},
        )
    assert res2.status_code == 200
    msg2 = res2.json()["id"]
    listed2 = client.get(f"/api/threads/{family['id']}/messages", headers=headers)
    row2 = next(m for m in listed2.json()["messages"] if m["id"] == msg2)
    assert row2["body"] == "Con chào cả nhà"
    assert row2["meta"]["stt"]["chars"] == len("Con chào cả nhà")


def test_maybe_heritage_unheard_refusal():
    from app.models import IdentityProfile, Message, Thread

    db = MagicMock()
    thread = MagicMock(spec=Thread)
    thread.kind = "heritage"
    thread.id = "t1"
    message = MagicMock(spec=Message)
    message.kind = "voice"
    message.body = "  "
    identity = MagicMock(spec=IdentityProfile)
    identity.heritage_entity_status = "ready"
    identity.id = "i1"

    settings = Settings(
        agent_enabled=True,
        heritage_tts_enabled=False,
        heritage_memory_enabled=False,
    )

    with (
        patch(
            "app.services.heritage_chat.identity_for_heritage_thread",
            return_value=identity,
        ),
        patch("app.services.heritage_chat.generate_heritage_reply") as gen,
    ):
        reply = maybe_heritage_reply(
            db, thread=thread, user_message=message, settings=settings
        )

    gen.assert_not_called()
    assert reply is not None
    assert reply.body == _REFUSE_UNHEARD
    meta = json.loads(reply.meta_json)
    assert meta["heritage_refusal"] == "unheard"
    assert reply.kind == "text"


def test_maybe_heritage_attaches_tts():
    from app.models import IdentityProfile, Message, Thread

    db = MagicMock()
    thread = MagicMock(spec=Thread)
    thread.kind = "heritage"
    thread.id = "t1"
    message = MagicMock(spec=Message)
    message.kind = "text"
    message.body = "Bố ơi"
    identity = MagicMock(spec=IdentityProfile)
    identity.heritage_entity_status = "ready"
    identity.id = "i1"
    voice = MagicMock()
    voice.status = "ready"

    settings = Settings(
        agent_enabled=True,
        heritage_tts_enabled=True,
        heritage_memory_enabled=False,
    )
    tts = ChatTtsResult(
        media_path="s/a.mp3",
        media_mime="audio/mpeg",
        meta={"provider": "elevenlabs", "chars": 10, "latency_ms": 1},
    )

    with (
        patch(
            "app.services.heritage_chat.identity_for_heritage_thread",
            return_value=identity,
        ),
        patch(
            "app.services.heritage_chat.generate_heritage_reply",
            return_value=("Con ơi, bố đây.", {"ok": True}),
        ),
        patch(
            "app.services.heritage_chat.voice_for_identity", return_value=voice
        ),
        patch(
            "app.services.heritage_tts.synthesize_chat_reply", return_value=tts
        ),
    ):
        reply = maybe_heritage_reply(
            db, thread=thread, user_message=message, settings=settings
        )

    assert reply is not None
    assert reply.kind == "voice"
    assert reply.media_path == "s/a.mp3"
    assert reply.body == "Con ơi, bố đây."
    meta = json.loads(reply.meta_json)
    assert meta["tts"]["provider"] == "elevenlabs"
