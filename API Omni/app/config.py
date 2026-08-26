import os
from typing import List
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()


class Settings:
    # Configuración OmniVista 2500
    OV_HOST: str = os.getenv("OV_HOST", "192.168.10.201")
    OV_PORT: int = int(os.getenv("OV_PORT", "443"))
    OV_PROTOCOL: str = os.getenv("OV_PROTOCOL", "https")
    OV_USERNAME: str = os.getenv("OV_USERNAME", "admin.red")
    OV_PASSWORD: str = os.getenv("OV_PASSWORD", "").strip('"').strip("'")
    OV_API_KEY: str = os.getenv("OV_API_KEY", "")
    OV_VERIFY_SSL: bool = os.getenv("OV_VERIFY_SSL", "false").lower() == "true"

    # Configuración de Seguridad de la API Backend
    # Si se define, los clientes deben enviar el header 'X-API-KEY: <valor>' o 'Authorization: Bearer <valor>'
    API_SECRET_KEY: str = os.getenv("API_SECRET_KEY", "").strip()

    # Configuración CORS para el Dashboard en React Vite
    CORS_ORIGINS: List[str] = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173,http://127.0.0.1:3000",
        ).split(",")
        if origin.strip()
    ]

    # Configuración del Servidor
    SERVER_HOST: str = os.getenv("SERVER_HOST", "0.0.0.0")
    SERVER_PORT: int = int(os.getenv("SERVER_PORT", "8000"))

    @property
    def ov_base_url(self) -> str:
        if self.OV_PORT in (80, 443):
            return f"{self.OV_PROTOCOL}://{self.OV_HOST}"
        return f"{self.OV_PROTOCOL}://{self.OV_HOST}:{self.OV_PORT}"


settings = Settings()
