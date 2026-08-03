from unittest.mock import MagicMock, patch

from app.config import Settings
from app.services import elevenlabs as el


def test_text_to_speech_sends_speed_and_paced_text():
    settings = Settings(
        elevenlabs_api_key="sk_test",
        elevenlabs_speed=0.9,
        elevenlabs_lengthen_pauses=True,
        elevenlabs_tts_model="eleven_v3",
        elevenlabs_language_code="vi",
    )
    mock_res = MagicMock()
    mock_res.status_code = 200
    mock_res.content = b"ID3fake"

    with patch("app.services.elevenlabs.httpx.Client") as client_cls:
        client = client_cls.return_value.__enter__.return_value
        client.post.return_value = mock_res
        audio = el.text_to_speech(
            settings=settings,
            api_key="sk_test",
            voice_id="voice_abc",
            text="Con nhớ bố lắm. Bố ơi con đây.",
            model_id="eleven_v3",
        )

    assert audio == b"ID3fake"
    kwargs = client.post.call_args.kwargs
    body = kwargs["json"]
    assert body["voice_settings"]["speed"] == 0.9
    assert "[short pause]" in body["text"]
    assert body["language_code"] == "vi"


def test_text_to_speech_can_disable_lengthen_pauses():
    settings = Settings(
        elevenlabs_api_key="sk_test",
        elevenlabs_speed=0.85,
        elevenlabs_lengthen_pauses=True,
        elevenlabs_tts_model="eleven_v3",
        elevenlabs_language_code="",
    )
    mock_res = MagicMock()
    mock_res.status_code = 200
    mock_res.content = b"ID3fake"

    with patch("app.services.elevenlabs.httpx.Client") as client_cls:
        client = client_cls.return_value.__enter__.return_value
        client.post.return_value = mock_res
        el.text_to_speech(
            settings=settings,
            api_key="sk_test",
            voice_id="voice_abc",
            text="Một. Hai.",
            lengthen_pauses=False,
            speed=0.85,
        )

    body = client.post.call_args.kwargs["json"]
    assert body["text"] == "Một. Hai."
    assert body["voice_settings"]["speed"] == 0.85
