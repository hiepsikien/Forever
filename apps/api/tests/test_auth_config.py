"""Dev auth must never be forgeable on a deployment that holds real memories.

Dev tokens are symmetric: `verify_id_token` falls back to `_verify_dev_token`
whenever AUTH_DEV_MODE is on, and `upsert_user_from_claims` resolves the caller
by email. So a known signing secret is not a weaker login — it is a signed
claim to be anybody. These tests keep the placeholder from ever shipping again.
"""

from __future__ import annotations

import pytest
from jose import jwt

from app.config import DEV_SECRET_PLACEHOLDER, Settings


def _settings(**overrides) -> Settings:
    base = {"auth_dev_mode": True, "auth_dev_secret": "a-real-random-secret-value"}
    return Settings(**{**base, **overrides})


def test_dev_mode_is_off_unless_asked_for(monkeypatch: pytest.MonkeyPatch, tmp_path):
    """A deployment that forgets the flag gets Firebase-only, not dev tokens."""
    monkeypatch.delenv("AUTH_DEV_MODE", raising=False)
    monkeypatch.chdir(tmp_path)  # ignore the developer's own .env
    assert Settings().auth_dev_mode is False


@pytest.mark.parametrize(
    ("secret", "label"),
    [
        (DEV_SECRET_PLACEHOLDER, "the published placeholder"),
        ("", "empty"),
        ("   ", "whitespace only"),
        ("short", "too short to resist guessing"),
    ],
)
def test_dev_mode_refuses_to_boot_on_a_guessable_secret(secret: str, label: str):
    with pytest.raises(ValueError, match="AUTH_DEV_SECRET"):
        _settings(auth_dev_secret=secret)


def test_a_guessable_secret_is_fine_while_dev_mode_is_off():
    """Production leaves the secret blank; that must not block startup."""
    settings = Settings(auth_dev_mode=False, auth_dev_secret="")
    assert settings.auth_dev_mode is False


def test_a_strong_secret_boots():
    assert _settings().auth_dev_mode is True


def test_the_placeholder_would_have_signed_a_token_for_anyone():
    """Why the guard exists, stated as an executable fact.

    This is the exact forgery the old default allowed: no login, no password,
    no Firebase — just the published secret and somebody else's email.
    """
    forged = jwt.encode(
        {"uid": "attacker", "email": "owner@example.com"},
        DEV_SECRET_PLACEHOLDER,
        algorithm="HS256",
    )
    claims = jwt.decode(forged, DEV_SECRET_PLACEHOLDER, algorithms=["HS256"])
    assert claims["email"] == "owner@example.com"

    with pytest.raises(ValueError):
        _settings(auth_dev_secret=DEV_SECRET_PLACEHOLDER)
