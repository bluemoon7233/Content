from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    anthropic_api_key: str
    meta_app_id: str = ""
    meta_app_secret: str = ""
    meta_page_access_token: str = ""
    meta_page_id: str = ""
    meta_ig_user_id: str = ""
    host: str = "0.0.0.0"
    port: int = 8000

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()
