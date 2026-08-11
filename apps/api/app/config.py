from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET_PLACEHOLDER = "forever-dev-secret-change-me"
_MIN_DEV_SECRET_LEN = 16


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://forever:forever@localhost:5434/forever"
    upload_dir: str = "uploads"
    cors_origins: str = "http://localhost:8081,http://127.0.0.1:8081,http://localhost:19006"
    seed_demo: bool = True

    firebase_project_id: str = ""
    firebase_credentials_json: str = ""
    # Off unless a deployment opts in. Dev tokens are signed with a shared
    # secret, so anyone holding it can mint a token for any email.
    auth_dev_mode: bool = False
    auth_dev_secret: str = DEV_SECRET_PLACEHOLDER

    agent_enabled: bool = True
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"
    gemini_api_base: str = "https://generativelanguage.googleapis.com/v1beta"

    # Heritage chat v2 — see docs/heritage-chat-v2.plan.md.
    # Every stage ships behind a flag so a bad turn can be rolled back per-space.
    heritage_async_reply: bool = True
    heritage_codex_enabled: bool = True
    heritage_analyzer_enabled: bool = False
    heritage_grounding_enabled: bool = True
    heritage_critic_enabled: bool = False
    heritage_memory_enabled: bool = True
    heritage_candidates_enabled: bool = True
    heritage_anti_repeat_enabled: bool = True
    heritage_analyzer_model: str = ""
    heritage_compose_model: str = ""
    heritage_evidence_token_budget: int = 1800
    heritage_memory_compact_every: int = 6
    # Token overlap above which two replies count as the same reply.
    heritage_repeat_threshold: float = 0.6

    # Speech-to-text for chat voice notes (Gemini inline audio). See
    # docs/voice-to-voice.plan.md V0. Empty stt_model → gemini_model.
    # Default Lite: STT does not need Flash-tier reasoning; ~3× cheaper audio.
    stt_enabled: bool = True
    stt_provider: str = "gemini"
    stt_model: str = "gemini-3.1-flash-lite"
    # Skip base64 STT above this size (Gemini inline limit; chat max is 25MB).
    stt_max_bytes: int = 10 * 1024 * 1024

    # Attach cloned-voice audio to heritage replies. Off = text-only (rollback).
    # docs/voice-to-voice.plan.md V2. On by default so «Gọi cho Bố» works locally.
    heritage_tts_enabled: bool = True
    # Skip TTS (text-only) above this length — aligned with story depth budget.
    heritage_tts_max_chars: int = 512

    # Shared ElevenLabs key (primary for now). Space Cài đặt can override later.
    elevenlabs_api_key: str = ""
    # eleven_v3: best quality + Vietnamese (70+ langs). multilingual_v2 does NOT list VI.
    elevenlabs_tts_model: str = "eleven_v3"
    elevenlabs_language_code: str = "vi"
    elevenlabs_api_base: str = "https://api.elevenlabs.io/v1"
    # TTS defaults tuned for Instant Voice Clone similarity (Vietnamese lab).
    # Higher similarity reduces drift toward a generic (often younger) baseline.
    elevenlabs_stability: float = 0.5
    elevenlabs_similarity_boost: float = 0.9
    elevenlabs_style: float = 0.15
    # Slightly under 1.0 — Instant Clone TTS often reads a touch faster than natural speech.
    elevenlabs_speed: float = 0.9
    elevenlabs_speaker_boost: bool = True
    elevenlabs_remove_noise: bool = True
    # Soften gaps between sentences (model-aware pause markers).
    elevenlabs_lengthen_pauses: bool = True

    # MiniMax — second Voice DNA provider. Clones from up to 5 minutes of
    # reference audio, which is what ElevenLabs IVC cannot use.
    minimax_api_key: str = ""
    # Turbo is ~40% cheaper than HD and fast enough for «Gọi». HD stays in the
    # Speak lab for A/B; chat prefs must pick it explicitly.
    minimax_tts_model: str = "speech-2.8-turbo"
    minimax_api_base: str = "https://api.minimax.io/v1"
    minimax_speed: float = 0.9
    minimax_lengthen_pauses: bool = True
    # Forever already denoises and normalizes samples; a second pass on
    # MiniMax's side only costs fidelity.
    minimax_remove_noise: bool = False

    # Provider used when a Voice DNA row does not name one.
    voice_default_provider: str = "elevenlabs"

    # Shared secret for local Extract worker → Forever API claim/complete.
    extract_worker_token: str = "forever-extract-worker"
    # Re-queue running jobs with no worker heartbeat after this many minutes.
    extract_job_stale_minutes: int = 60

    # Sentry (forever-api). Empty DSN = disabled. Never enable send_default_pii —
    # Authorization and chat/memory bodies must not leave the server.
    sentry_dsn: str = ""
    sentry_environment: str = "development"
    sentry_traces_sample_rate: float = 0.2

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def analyzer_model(self) -> str:
        return self.heritage_analyzer_model.strip() or self.gemini_model

    @property
    def compose_model(self) -> str:
        return self.heritage_compose_model.strip() or self.gemini_model

    @property
    def firebase_enabled(self) -> bool:
        project_id = self.firebase_project_id.strip()
        return bool(project_id and not project_id.startswith("replace-with-"))

    @model_validator(mode="after")
    def _reject_guessable_dev_secret(self) -> "Settings":
        """Refuse to boot rather than accept forgeable sessions.

        `verify_id_token` falls back to dev tokens whenever `auth_dev_mode` is
        on, so a blank or published secret lets anyone sign a token claiming
        any email — and `upsert_user_from_claims` matches on email. That is
        full account takeover, not a downgraded dev login.
        """
        if not self.auth_dev_mode:
            return self
        secret = self.auth_dev_secret.strip()
        if secret == DEV_SECRET_PLACEHOLDER:
            reason = "is still the published placeholder"
        elif not secret:
            reason = "is empty"
        elif len(secret) < _MIN_DEV_SECRET_LEN:
            reason = f"is shorter than {_MIN_DEV_SECRET_LEN} characters"
        else:
            return self
        raise ValueError(
            f"AUTH_DEV_MODE=true but AUTH_DEV_SECRET {reason}. Anyone could then "
            "mint a session for any account. Set AUTH_DEV_MODE=false (production), "
            "or set AUTH_DEV_SECRET to a random value: "
            "python -c 'import secrets; print(secrets.token_urlsafe(32))'"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
