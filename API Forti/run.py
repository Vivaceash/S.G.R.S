import os
import uvicorn
from app.core.config import settings


from app.security.logging import mask_sensitive_ip


def main():
    target = mask_sensitive_ip(settings.fortios_base_url) if settings.MASK_INTERNAL_IPS else settings.fortios_base_url
    print(f"==================================================")
    print(f"Iniciando {settings.APP_NAME}")
    print(f"Escuchando en: http://{settings.HOST}:{settings.PORT}")
    display_host = os.environ.get("SGRS_SERVER_IP", "192.168.38.250")
    print(f"Documentación Scalar: http://{display_host}:{settings.PORT}/scalar")
    print(f"X-API-Key configurada: {'[ACTIVADA]' if settings.api_keys else '[DESACTIVADA]'} ({len(settings.api_keys)} activa(s))")
    print(f"FortiGate Target: {target}")
    print(f"==================================================")

    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )


if __name__ == "__main__":
    main()
