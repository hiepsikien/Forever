from app.services.voice_script import _clean_script, generate_voice_sample_script
from app.config import Settings


def test_clean_script_strips_lead_in():
    raw = "Hãy đọc đoạn sau:\nBuổi sáng nhà mình thường dậy sớm và pha trà."
    cleaned = _clean_script(raw)
    assert "Hãy đọc" not in cleaned
    assert "Buổi sáng" in cleaned


def test_fallback_script_without_gemini():
    settings = Settings(gemini_api_key="")
    script, source = generate_voice_sample_script(settings, seed=1)
    assert source == "fallback"
    assert len(script.split()) > 40
