import logging
from typing import List, Optional, Union
from pathlib import Path
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("omnivista_api.config")
_BASE_DIR = Path(__file__).resolve().parent.parent
_ENV_FILE = _BASE_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE) if _ENV_FILE.exists() else ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Configuración OmniVista 2500 NMS
    OV_HOST: str = "192.168.10.201"
    OV_PORT: int = 443
    OV_PROTOCOL: str = "https"
    OV_USERNAME: str = "admin.red"
    OV_PASSWORD: str = ""
    OV_API_KEY: str = ""
    OV_VERIFY_SSL: bool = False
    OV_CA_BUNDLE: Optional[str] = None

    # Configuración de Seguridad y Autenticación del Backend
    # Acepta APP_API_KEY o API_SECRET_KEY con soporte para múltiples claves separadas por coma
    APP_API_KEY: Optional[str] = "admin"
    API_SECRET_KEY_CONFIG: Optional[str] = None
    ALLOW_UNAUTHENTICATED: bool = False

    # Límite de tasa de peticiones (Rate Limiting)
    RATE_LIMIT_PER_MINUTE: int = 60

    # Límite máximo de tamaño del cuerpo de la petición (1MB por defecto)
    MAX_REQUEST_BODY_BYTES: int = 1_048_576

    # Exposición de documentación interactiva y OpenAPI
    ENABLE_DOCS: bool = True

    # Enmascarar IPs de infraestructura en respuestas de salud
    MASK_INTERNAL_IPS: bool = True

    # Configuración CORS
    CORS_ORIGINS: Union[List[str], str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ]

    # Configuración del Servidor y Entorno
    SERVER_HOST: str = "0.0.0.0"
    SERVER_PORT: int = 8000
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            if v.strip() == "*":
                return ["*"]
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @property
    def api_keys(self) -> List[str]:
        """Obtiene la lista limpia de claves de API válidas."""
        raw = self.APP_API_KEY or self.API_SECRET_KEY_CONFIG or ""
        return [
            k.strip().strip('"').strip("'")
            for k in raw.split(",")
            if k.strip().strip('"').strip("'")
        ]

    @property
    def API_KEYS(self) -> List[str]:
        """Retrocompatibilidad para settings.API_KEYS."""
        return self.api_keys

    @property
    def API_SECRET_KEY(self) -> str:
        """Retrocompatibilidad para settings.API_SECRET_KEY."""
        return self.api_keys[0] if self.api_keys else ""

    @property
    def ov_base_url(self) -> str:
        """Construye la URL base para conectar con OmniVista."""
        if self.OV_PORT in (80, 443):
            return f"{self.OV_PROTOCOL}://{self.OV_HOST}"
        return f"{self.OV_PROTOCOL}://{self.OV_HOST}:{self.OV_PORT}"


settings = Settings()
