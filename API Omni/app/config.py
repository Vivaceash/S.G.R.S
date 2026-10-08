import logging
from typing import List, Optional, Union
from pathlib import Path
from pydantic import field_validator, model_validator
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
    OV_USERNAME: str = ""
    OV_PASSWORD: str = ""
    OV_AUTH_MODE: str = "credentials"
    # Deprecated: las consultas upstream deben usar login con OV_USERNAME/OV_PASSWORD.
    OV_API_KEY: str = ""
    OV_VERIFY_SSL: bool = True
    OV_CA_BUNDLE: Optional[str] = None

    # Configuración de Seguridad y Autenticación del Backend
    # Acepta APP_API_KEY o API_SECRET_KEY con soporte para múltiples claves separadas por coma
    APP_API_KEY: Optional[str] = None
    API_SECRET_KEY_CONFIG: Optional[str] = None
    ALLOW_UNAUTHENTICATED: bool = False

    # Autenticación de Dos Pasos (2FA / TOTP) y Sesiones
    ENABLE_2FA: bool = False
    TOTP_SECRET_KEY: Optional[str] = None
    JWT_SECRET_KEY: str = "sgrs-secure-jwt-secret-key-change-in-production-2026"
    SESSION_EXPIRE_HOURS: int = 1
    ALLOW_2FA_ENROLLMENT: bool = False

    # Límite de tasa de peticiones (Rate Limiting)
    RATE_LIMIT_PER_MINUTE: int = 60
    AUTH_RATE_LIMIT_PER_MINUTE: int = 10

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

    ALLOWED_HOSTS: Union[List[str], str] = ["*"]
    TRUSTED_PROXY_IPS: Union[List[str], str] = []

    # Configuración del Servidor y Entorno
    SERVER_HOST: str = "127.0.0.1"
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

    @field_validator("ALLOWED_HOSTS", "TRUSTED_PROXY_IPS", mode="before")
    @classmethod
    def parse_comma_separated_lists(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            return [item.strip() for item in v.split(",") if item.strip()]
        return v

    @model_validator(mode="after")
    def validate_security_configuration(self):
        environment = self.ENVIRONMENT.strip().lower()
        weak_api_keys = {"admin", "123456", "omnivista-secret-api-key-change-me"}
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

        if self.ALLOW_UNAUTHENTICATED and environment != "test":
            raise ValueError("ALLOW_UNAUTHENTICATED solo puede usarse en el entorno test.")

        if environment not in {"development", "test"}:
            if self.DEBUG:
                raise ValueError("DEBUG debe estar desactivado fuera de development/test.")
            if not self.api_keys or any(key.lower() in weak_api_keys or len(key) < 16 for key in self.api_keys):
                raise ValueError("APP_API_KEY debe contener claves robustas fuera de development/test.")
            if self.OV_AUTH_MODE != "credentials":
                raise ValueError("OV_AUTH_MODE debe ser 'credentials' fuera de development/test.")
            if self.OV_API_KEY:
                raise ValueError("OV_API_KEY no está permitido: OmniVista debe autenticarse con usuario y contraseña.")
            if not self.OV_USERNAME.strip() or not self.OV_PASSWORD.strip():
                raise ValueError("OV_USERNAME y OV_PASSWORD son obligatorios para autenticar OmniVista.")
            if not self.JWT_SECRET_KEY or self.JWT_SECRET_KEY == default_jwt_secret:
                raise ValueError("JWT_SECRET_KEY debe reemplazarse fuera de development/test.")
            if self.ALLOW_2FA_ENROLLMENT:
                raise ValueError("El enrolamiento 2FA debe permanecer cerrado fuera de development/test.")
            if self.ENABLE_2FA and (not self.TOTP_SECRET_KEY or len(self.TOTP_SECRET_KEY.encode("utf-8")) < 32):
                raise ValueError("TOTP_SECRET_KEY debe contener al menos 32 bytes aleatorios.")
            if not self.OV_VERIFY_SSL and not self.OV_CA_BUNDLE:
                raise ValueError("La validación TLS de OmniVista es obligatoria fuera de development/test.")
            if self.OV_PROTOCOL.lower() != "https":
                raise ValueError("OV_PROTOCOL debe ser https fuera de development/test.")
            if self.OV_CA_BUNDLE and not Path(self.OV_CA_BUNDLE).is_file():
                raise ValueError("OV_CA_BUNDLE debe apuntar a un archivo CA existente.")
            if "*" in self.ALLOWED_HOSTS:
                raise ValueError("ALLOWED_HOSTS no puede contener '*' fuera de development/test.")
            if "*" in self.CORS_ORIGINS:
                raise ValueError("CORS_ORIGINS no puede contener '*' fuera de development/test.")

        return self

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
