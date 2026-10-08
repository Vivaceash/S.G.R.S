from pathlib import Path
from urllib.parse import urlsplit
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE = Path(__file__).resolve().parents[2]
PRIVATE_ENV = BASE / '.private/.env'


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(PRIVATE_ENV, BASE / '.env'), env_prefix='INVENTARIOS_', extra='ignore')
    APP_NAME: str = 'SGRS - API Inventarios'
    APP_VERSION: str = '1.0.0'
    HOST: str = '127.0.0.1'
    PORT: int = Field(8002, ge=1, le=65535)
    DEBUG: bool = False
    ENVIRONMENT: str = 'development'
    ENABLE_DOCS: bool = True
    API_KEYS: str = ''
    INTEGRATION_KEYS: str = ''
    WRITE_KEYS: str = ''
    EXPORT_KEYS: str = ''
    DASHBOARD_KEY: str = ''
    ENABLE_2FA: bool = False
    ALLOW_2FA_ENROLLMENT: bool = False
    JWT_SECRET_KEY: str = ''
    TOTP_SECRET_KEY: str = ''
    SESSION_EXPIRE_HOURS: int = Field(1, ge=1, le=24)
    RATE_LIMIT_PER_MINUTE: int = Field(240, ge=1)
    AUTH_RATE_LIMIT_PER_MINUTE: int = Field(10, ge=1)
    MAX_REQUEST_BODY_BYTES: int = Field(65536, ge=1024)
    TRUSTED_PROXY_IPS: list[str] = []
    CORS_ORIGINS: list[str] = []
    ALLOWED_HOSTS: list[str] = ['localhost', '127.0.0.1', 'testserver']
    DATABASE: Path = BASE / '.private/inventarios.sqlite3'
    FORTI_URL: str = 'http://127.0.0.1:8001/api/v1'
    FORTI_KEY: str = ''
    FORTI_AUTH_MODE: str = 'api-key'
    FORTI_VDOM: str = 'root'
    OMNI_URL: str = 'http://127.0.0.1:8000/api/v1'
    OMNI_KEY: str = ''
    OMNI_AUTH_MODE: str = 'api-key'
    CA_BUNDLE: str | None = None
    TIMEOUT_SECONDS: float = Field(8, ge=1, le=60)
    STALE_SECONDS: int = Field(120, ge=15)
    REFRESH_SECONDS: int = Field(0, ge=0, description='0 desactiva el cotejo periódico')
    RETENTION_DAYS: int = Field(90, ge=1)

    @property
    def api_keys(self):
        return self.keys(self.API_KEYS)

    @staticmethod
    def keys(value):
        return [key.strip() for key in value.split(',') if key.strip()]

    @model_validator(mode='after')
    def validate_settings(self):
        self.DATABASE = self.DATABASE.resolve()
        if self.ENABLE_2FA and (len(self.JWT_SECRET_KEY) < 32 or len(self.TOTP_SECRET_KEY) < 32):
            raise ValueError('2FA requiere secretos JWT y TOTP independientes de al menos 32 caracteres.')
        groups = [self.keys(self.API_KEYS), self.keys(self.INTEGRATION_KEYS), self.keys(self.WRITE_KEYS), self.keys(self.EXPORT_KEYS), [self.DASHBOARD_KEY] if self.DASHBOARD_KEY else []]
        keys = [key for group in groups for key in group]
        # API_KEYS and EXPORT_KEYS may share a temporary operator key; key_principal
        # unions read/export only. WRITE_KEYS and the dashboard identity stay separate.
        if self.ENVIRONMENT not in ('development', 'test'):
            if not keys or any(len(key) < 32 for key in keys) or self.DEBUG or '*' in self.ALLOWED_HOSTS or '*' in self.CORS_ORIGINS:
                raise ValueError('Producción requiere claves robustas, hosts/orígenes explícitos y DEBUG desactivado.')
            if self.ALLOW_2FA_ENROLLMENT:
                raise ValueError('Cierra el enrolamiento 2FA en producción.')
        for name in ('FORTI', 'OMNI'):
            url = urlsplit(getattr(self, name + '_URL'))
            if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment:
                raise ValueError('URL de proveedor no válida.')
            if url.scheme == 'http' and url.hostname not in ('localhost', '127.0.0.1', '::1'):
                raise ValueError('Los proveedores remotos requieren HTTPS.')
            if getattr(self, name + '_AUTH_MODE') not in ('api-key', 'bearer'):
                raise ValueError('Autenticación de proveedor no admitida.')
        return self


settings = Settings()
