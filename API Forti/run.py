import uvicorn
from app.core.config import settings


def main():
    print(f"==================================================")
    print(f"🔥 Iniciando {settings.APP_NAME}")
    print(f"🌐 Escuchando en: http://{settings.HOST}:{settings.PORT}")
    print(f"📖 Documentación Scalar: http://localhost:{settings.PORT}/scalar")
    print(f"🛡️  X-API-Key configurada: {'[ACTIVADA]' if settings.APP_API_KEY else '[DESACTIVADA]'}")
    print(f"🎯 FortiGate Target: {settings.fortios_base_url}")
    print(f"==================================================")

    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )


if __name__ == "__main__":
    main()
