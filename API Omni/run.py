import uvicorn
from app.config import settings

if __name__ == "__main__":
    print("=" * 70)
    print(" Iniciando Servidor FastAPI - OmniVista 2500 Backend API")
    print(f" Documentación Scalar disponible en: http://localhost:{settings.SERVER_PORT}/docs")
    print(f" Conectado a OmniVista en: {settings.ov_base_url}")
    print("=" * 70)
    
    uvicorn.run(
        "app.main:app",
        host=settings.SERVER_HOST,
        port=settings.SERVER_PORT,
        reload=settings.DEBUG
    )
