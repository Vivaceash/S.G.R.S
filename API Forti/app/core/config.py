from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # API Server Settings
    APP_NAME: str = "Fortinet FortiGate REST Integration API"
    APP_VERSION: str = "1.0.0"
    HOST: str = "0.0.0.0"
    PORT: int = 8001
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Security settings for our FastAPI (clients consuming port 8001)
    APP_API_KEY: Optional[str] = "forti-secret-api-key-change-me"
    RATE_LIMIT_PER_MINUTE: int = 120

    # FortiGate connection settings
    FORTIOS_HOST: str = "192.168.1.1"
    FORTIOS_PORT: int = 443
    FORTIOS_SCHEME: str = "https"
    FORTIOS_API_TOKEN: str = ""
    FORTIOS_DEFAULT_VDOM: str = "root"
    FORTIOS_VERIFY_SSL: bool = False
    FORTIOS_TIMEOUT: float = 15.0

    @property
    def fortios_base_url(self) -> str:
        """Genera la URL base completa hacia el FortiGate."""
        return f"{self.FORTIOS_SCHEME}://{self.FORTIOS_HOST}:{self.FORTIOS_PORT}"


settings = Settings()
