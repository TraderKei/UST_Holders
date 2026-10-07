from functools import lru_cache
from pathlib import Path
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="TIC_", extra="ignore")
    database_url: str = "sqlite+pysqlite:///tic.db"
    raw_storage_dir: Path = Path("data/raw/archive")
    storage_backend: str = "local"
    http_timeout_seconds: float = Field(30, gt=0)
    http_retry_count: int = Field(3, ge=0, le=10)
    http_backoff_seconds: float = Field(0.5, ge=0)
    http_user_agent: str = "tic-holdings-pipeline/0.1"
    log_level: str = "INFO"
    s3_bucket: str | None = None
    s3_prefix: str = "tic/raw"
    s3_endpoint_url: str | None = None

    @field_validator("database_url")
    @classmethod
    def reject_empty_database_url(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("database_url must not be empty")
        return value

@lru_cache
def get_settings() -> Settings:
    return Settings()

