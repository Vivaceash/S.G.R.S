import logging
from typing import List, Optional, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

import os
from pathlib import Path

logger = logging.getLogger("fortinet_api.config")
_BASE_DIR = Path(__file__).resolve().parent.parent.parent
_ENV_FILE = _BASE_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE) if _ENV_FILE.exists() else ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Configuración general del servidor
    APP_NAME: str = "Fortinet FortiGate REST Integration API"
    APP_VERSION: str = "1.0.0"
    HOST: str = "0.0.0.0"
    PORT: int = 8001
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Seguridad de la API (soporta clave única o múltiples separadas por coma)
    APP_API_KEY: Optional[str] = "admin"
    API_SECRET_KEY: Optional[str] = None
    ALLOW_UNAUTHENTICATED: bool = False

    # Límite de tasa de peticiones (Rate Limiting)
    RATE_LIMIT_PER_MINUTE: int = 120

    # Tamaño máximo de cuerpo de petición (en bytes, 1MB por defecto)
    MAX_REQUEST_BODY_BYTES: int = 1_048_576

    # Hosts permitidos para TrustedHostMiddleware
    ALLOWED_HOSTS: Union[List[str], str] = ["*"]

    # Orígenes CORS permitidos
    CORS_ORIGINS: Union[List[str], str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "http://localhost:8001",
        "http://127.0.0.1:8001",
    ]

    # Exposición de documentación interactiva (Scalar / OpenAPI)
    ENABLE_DOCS: bool = True

    # Enmascarar IPs y datos de infraestructura sensible en respuestas públicas de /health
    MASK_INTERNAL_IPS: bool = True

    # Conexión con FortiGate / FortiOS
    FORTIOS_HOST: str = "192.168.1.1"
    FORTIOS_PORT: int = 443
    FORTIOS_SCHEME: str = "https"
    FORTIOS_API_TOKEN: str = ""
    FORTIOS_DEFAULT_VDOM: str = "root"
    FORTIOS_VERIFY_SSL: bool = False
    FORTIOS_CA_BUNDLE: Optional[str] = None
    FORTIOS_TIMEOUT: float = 15.0

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            if v.strip() == "*":
                return ["*"]
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @field_validator("ALLOWED_HOSTS", mode="before")
    @classmethod
    def parse_allowed_hosts(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            return [host.strip() for host in v.split(",") if host.strip()]
        return v

    @property
    def api_keys(self) -> List[str]:
        """Obtiene la lista de claves de API válidas."""
        raw = self.APP_API_KEY or self.API_SECRET_KEY or ""
        keys = [
            k.strip().strip('"').strip("'")
            for k in raw.split(",")
            if k.strip().strip('"').strip("'")
        ]
        return keys

    @property
    def fortios_base_url(self) -> str:
        """Genera la URL base completa hacia el FortiGate."""
        if self.FORTIOS_PORT in (80, 443):
            return f"{self.FORTIOS_SCHEME}://{self.FORTIOS_HOST}"
        return f"{self.FORTIOS_SCHEME}://{self.FORTIOS_HOST}:{self.FORTIOS_PORT}"


settings = Settings()
