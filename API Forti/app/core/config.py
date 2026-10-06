import logging
from typing import List, Optional, Union
from pydantic import field_validator, model_validator
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
    HOST: str = "127.0.0.1"
    PORT: int = 8001
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Seguridad de la API (soporta clave única o múltiples separadas por coma)
    APP_API_KEY: Optional[str] = "admin"
    API_SECRET_KEY: Optional[str] = None
    ALLOW_UNAUTHENTICATED: bool = False

    # Autenticación de Dos Pasos (2FA / TOTP) y Sesiones
    ENABLE_2FA: bool = False
    TOTP_SECRET_KEY: Optional[str] = None
    JWT_SECRET_KEY: str = "sgrs-secure-jwt-secret-key-change-in-production-2026"
    SESSION_EXPIRE_HOURS: int = 1
    ALLOW_2FA_ENROLLMENT: bool = False

    # Límite de tasa de peticiones (Rate Limiting)
    RATE_LIMIT_PER_MINUTE: int = 120
    AUTH_RATE_LIMIT_PER_MINUTE: int = 10

    # Tamaño máximo de cuerpo de petición (en bytes, 1MB por defecto)
    MAX_REQUEST_BODY_BYTES: int = 1_048_576

    # Hosts permitidos para TrustedHostMiddleware
    ALLOWED_HOSTS: Union[List[str], str] = ["*"]

    # Solo se confia en cabeceras X-Forwarded-* cuando la conexion proviene
    # directamente de una de estas IPs o redes (CIDR).
    TRUSTED_PROXY_IPS: Union[List[str], str] = []

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
    FORTIOS_VERIFY_SSL: bool = True
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

    @field_validator("TRUSTED_PROXY_IPS", mode="before")
    @classmethod
    def parse_trusted_proxies(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            return [proxy.strip() for proxy in v.split(",") if proxy.strip()]
        return v

    @model_validator(mode="after")
    def validate_security_configuration(self):
        environment = self.ENVIRONMENT.strip().lower()
        weak_api_keys = {"admin", "123456", "forti-secret-api-key-change-me"}
        default_jwt_secret = "sgrs-secure-jwt-secret-key-change-in-production-2026"

        if self.ENABLE_2FA and (
            not self.JWT_SECRET_KEY
            or self.JWT_SECRET_KEY == default_jwt_secret
            or len(self.JWT_SECRET_KEY.encode("utf-8")) < 32
        ):
            raise ValueError(
                "ENABLE_2FA requiere un JWT_SECRET_KEY aleatorio de al menos 32 bytes."
            )
        if self.ENABLE_2FA and not self.TOTP_SECRET_KEY:
            raise ValueError("ENABLE_2FA requiere configurar un TOTP_SECRET_KEY propio y aleatorio.")

        if environment not in {"development", "test"}:
            if self.DEBUG:
                raise ValueError("DEBUG debe estar desactivado fuera de development/test.")
            if self.ALLOW_UNAUTHENTICATED:
                raise ValueError("ALLOW_UNAUTHENTICATED solo puede usarse en development/test.")
            if not self.api_keys or any(key.lower() in weak_api_keys or len(key) < 16 for key in self.api_keys):
                raise ValueError("APP_API_KEY debe contener claves robustas fuera de development/test.")
            if not self.JWT_SECRET_KEY or self.JWT_SECRET_KEY == default_jwt_secret:
                raise ValueError("JWT_SECRET_KEY debe reemplazarse fuera de development/test.")
            if self.ALLOW_2FA_ENROLLMENT:
                raise ValueError("El enrolamiento 2FA debe permanecer cerrado fuera de development/test.")
            if self.ENABLE_2FA and (not self.TOTP_SECRET_KEY or len(self.TOTP_SECRET_KEY.encode("utf-8")) < 32):
                raise ValueError("TOTP_SECRET_KEY debe contener al menos 32 bytes aleatorios.")
            if not self.FORTIOS_VERIFY_SSL and not self.FORTIOS_CA_BUNDLE:
                raise ValueError("La validación TLS de FortiOS es obligatoria fuera de development/test.")
            if self.FORTIOS_SCHEME.lower() != "https":
                raise ValueError("FORTIOS_SCHEME debe ser https fuera de development/test.")
            if self.FORTIOS_CA_BUNDLE and not Path(self.FORTIOS_CA_BUNDLE).is_file():
                raise ValueError("FORTIOS_CA_BUNDLE debe apuntar a un archivo CA existente.")
            if "*" in self.ALLOWED_HOSTS:
                raise ValueError("ALLOWED_HOSTS no puede contener '*' fuera de development/test.")
            if "*" in self.CORS_ORIGINS:
                raise ValueError("CORS_ORIGINS no puede contener '*' fuera de development/test.")

        return self

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
