from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://forever:forever@localhost:5434/forever"
    upload_dir: str = "uploads"
    cors_origins: str = "http://localhost:8081,http://127.0.0.1:8081,http://localhost:19006"
    seed_demo: bool = True

    firebase_project_id: str = ""
    firebase_credentials_json: str = ""
    auth_dev_mode: bool = True
    auth_dev_secret: str = "forever-dev-secret-change-me"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def firebase_enabled(self) -> bool:
        project_id = self.firebase_project_id.strip()
        return bool(project_id and not project_id.startswith("replace-with-"))


@lru_cache
def get_settings() -> Settings:
    return Settings()
