from unittest.mock import MagicMock, patch

import pytest

from app.config import Settings
from app.services import minimax as mm
from app.services import voice_providers as vp


def _settings(**kwargs) -> Settings:
    base = {
        "minimax_api_key": "mm_test",
        "minimax_tts_model": "speech-2.8-hd",
        "minimax_speed": 0.9,
        "minimax_lengthen_pauses": True,
    }
    base.update(kwargs)
    return Settings(**base)


def _json_response(payload: dict) -> MagicMock:
    res = MagicMock()
    res.status_code = 200
    res.json.return_value = payload
    return res


def test_tts_decodes_hex_audio_and_asks_for_vietnamese():
    audio = b"ID3fake-audio"
    response = _json_response(
        {"data": {"audio": audio.hex()}, "base_resp": {"status_code": 0}}
    )

    with patch("app.services.minimax.httpx.Client") as client_cls:
        client = client_cls.return_value.__enter__.return_value
        client.post.return_value = response
        out = mm.text_to_speech(
            settings=_settings(),
            api_key="mm_test",
            voice_id="fvabc-20260804",
            text="Con nhớ bố lắm. Bố ơi con đây.",
        )

    assert out == audio
    body = client.post.call_args.kwargs["json"]
    assert body["model"] == "speech-2.8-hd"
    assert body["language_boost"] == "Vietnamese"
    assert body["voice_setting"] == {"voice_id": "fvabc-20260804", "speed": 0.9}
    # 44.1 kHz / 256 kbps is the best shape the endpoint offers.
    assert body["audio_setting"]["sample_rate"] == 44_100
    assert body["audio_setting"]["bitrate"] == 256_000
    assert "<#0.40#>" in body["text"]


def test_tts_can_skip_pause_markers():
    response = _json_response(
        {"data": {"audio": b"x".hex()}, "base_resp": {"status_code": 0}}
    )

    with patch("app.services.minimax.httpx.Client") as client_cls:
        client = client_cls.return_value.__enter__.return_value
        client.post.return_value = response
        mm.text_to_speech(
            settings=_settings(),
            api_key="mm_test",
            voice_id="fvabc-20260804",
            text="Một. Hai.",
            lengthen_pauses=False,
            speed=1.4,
        )

    body = client.post.call_args.kwargs["json"]
    assert body["text"] == "Một. Hai."
    assert body["voice_setting"]["speed"] == 1.4


def test_errors_inside_a_200_response_are_raised():
    """MiniMax answers HTTP 200 and puts the real outcome in base_resp."""
    response = _json_response(
        {"base_resp": {"status_code": 2038, "status_msg": "no clone permission"}}
    )

    with patch("app.services.minimax.httpx.Client") as client_cls:
        client = client_cls.return_value.__enter__.return_value
        client.post.return_value = response
        with pytest.raises(mm.MinimaxError) as excinfo:
            mm.text_to_speech(
                settings=_settings(),
                api_key="mm_test",
                voice_id="fvabc-20260804",
                text="Xin chào.",
            )

    assert "xác minh tài khoản" in excinfo.value.message
    assert excinfo.value.status_code == 400


def test_unknown_status_codes_surface_the_vendor_message():
    response = _json_response(
        {"base_resp": {"status_code": 1041, "status_msg": "something new"}}
    )

    with patch("app.services.minimax.httpx.Client") as client_cls:
        client = client_cls.return_value.__enter__.return_value
        client.post.return_value = response
        with pytest.raises(mm.MinimaxError) as excinfo:
            mm.list_voices(settings=_settings(), api_key="mm_test")

    assert "something new" in excinfo.value.message


def test_insufficient_balance_points_at_pay_as_you_go():
    """Trial Token Plan credits cannot pay for TTS or cloning."""
    response = _json_response(
        {"base_resp": {"status_code": 1008, "status_msg": "insufficient balance"}}
    )

    with patch("app.services.minimax.httpx.Client") as client_cls:
        client = client_cls.return_value.__enter__.return_value
        client.post.return_value = response
        with pytest.raises(mm.MinimaxError) as excinfo:
            mm.text_to_speech(
                settings=_settings(),
                api_key="mm_test",
                voice_id="fvabc-1",
                text="Xin chào.",
            )

    assert "pay-as-you-go" in excinfo.value.message


def test_voice_id_follows_the_provider_rules():
    voice_id = mm.build_voice_id("_ab-cd~ef!")

    assert voice_id[0].isalpha()
    assert 8 <= len(voice_id) <= 256
    assert not voice_id.endswith(("-", "_"))
    assert all(ch.isalnum() or ch in "-_" for ch in voice_id)


def test_voice_id_survives_an_unusable_seed():
    voice_id = mm.build_voice_id("!!!")

    assert voice_id.startswith("fv-")
    assert len(voice_id) >= 8


def test_list_voices_reads_cloned_entries():
    response = _json_response(
        {
            "voice_cloning": [
                {"voice_id": "fvold-1", "created_time": "2026-07-01", "description": []},
                {"voice_id": "fvnew-2", "created_time": "2026-08-04", "description": []},
            ],
            "base_resp": {"status_code": 0},
        }
    )

    with patch("app.services.minimax.httpx.Client") as client_cls:
        client = client_cls.return_value.__enter__.return_value
        client.post.return_value = response
        rows = mm.list_voices(settings=_settings(), api_key="mm_test")

    assert [row["voice_id"] for row in rows] == ["fvnew-2", "fvold-1"]
    assert client.post.call_args.kwargs["json"] == {"voice_type": "voice_cloning"}


def test_clone_uploads_one_file_then_locks_the_voice(tmp_path):
    sample = tmp_path / "sample.wav"
    sample.write_bytes(b"fake")
    upload = _json_response({"file": {"file_id": 4242}, "base_resp": {"status_code": 0}})
    clone = _json_response({"base_resp": {"status_code": 0}})
    tts = _json_response(
        {"data": {"audio": b"x".hex()}, "base_resp": {"status_code": 0}}
    )

    def _fake_encode(paths, output_path, **kwargs):
        output_path.write_bytes(b"ID3merged")
        return 45_000, len(b"ID3merged")

    with (
        patch("app.services.minimax.concat_to_mp3", side_effect=_fake_encode),
        patch("app.services.minimax.httpx.Client") as client_cls,
    ):
        client = client_cls.return_value.__enter__.return_value
        client.post.side_effect = [upload, clone, tts]
        voice_id = mm.create_instant_voice_clone(
            settings=_settings(),
            api_key="mm_test",
            file_paths=[sample],
            voice_id_seed="abc123",
        )

    clone_body = client.post.call_args_list[1].kwargs["json"]
    assert clone_body["file_id"] == 4242
    assert clone_body["voice_id"] == voice_id
    assert clone_body["language_boost"] == "Vietnamese"
    # Forever already cleaned the sample; a second pass would only cost fidelity.
    assert clone_body["need_noise_reduction"] is False
    assert clone_body["need_volume_normalization"] is False
    # Third call locks the voice in, otherwise it is deleted after 7 days.
    assert client.post.call_args_list[2].kwargs["json"]["text"] == mm.LOCK_TEXT


def test_clone_rejects_samples_shorter_than_the_provider_minimum(tmp_path):
    sample = tmp_path / "sample.wav"
    sample.write_bytes(b"fake")

    with patch("app.services.minimax.concat_to_mp3", return_value=(4_000, 1_000)):
        with pytest.raises(mm.MinimaxError) as excinfo:
            mm.build_clone_source([sample], tmp_path / "out.mp3")

    assert "10 giây" in excinfo.value.message


def test_provider_dispatch_picks_models_and_defaults():
    settings = _settings(elevenlabs_api_key="sk", voice_default_provider="elevenlabs")

    assert vp.normalize("minimax") == vp.MINIMAX
    assert vp.normalize("", settings) == vp.ELEVENLABS
    assert vp.normalize("nonsense", settings) == vp.ELEVENLABS
    assert "speech-2.8-hd" in vp.tts_models(vp.MINIMAX)
    assert "eleven_v3" in vp.tts_models(vp.ELEVENLABS)
    assert vp.default_model(vp.MINIMAX, settings) == "speech-2.8-hd"
    assert vp.provider_for_model("speech-2.6-hd") == vp.MINIMAX
    assert vp.provider_for_model("eleven_v3") == vp.ELEVENLABS
    assert vp.provider_for_model("") is None


def test_provider_dispatch_translates_vendor_errors():
    with patch(
        "app.services.minimax.text_to_speech",
        side_effect=mm.MinimaxError("hỏng", status_code=400),
    ):
        with pytest.raises(vp.VoiceProviderError) as excinfo:
            vp.text_to_speech(
                vp.MINIMAX,
                settings=_settings(),
                api_key="mm_test",
                voice_id="fvabc-1",
                text="Xin chào.",
            )

    assert excinfo.value.message == "hỏng"
    assert excinfo.value.status_code == 400


def test_provider_dispatch_drops_settings_minimax_cannot_honour():
    with patch("app.services.minimax.text_to_speech", return_value=b"ok") as tts:
        vp.text_to_speech(
            vp.MINIMAX,
            settings=_settings(),
            api_key="mm_test",
            voice_id="fvabc-1",
            text="Xin chào.",
            stability=0.5,
            similarity_boost=0.9,
            style=0.15,
            use_speaker_boost=True,
            speed=0.9,
        )

    passed = tts.call_args.kwargs
    assert passed["speed"] == 0.9
    assert "stability" not in passed
    assert "similarity_boost" not in passed
    assert "style" not in passed
    assert "use_speaker_boost" not in passed
