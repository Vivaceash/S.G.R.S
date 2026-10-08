import os
import uvicorn
from app.config import settings

if __name__ == "__main__":
    print("=" * 70)
    print(" Iniciando Servidor FastAPI - OmniVista 2500 Backend API")
    display_host = os.environ.get("SGRS_SERVER_IP", "192.168.38.250")
    print(f" Documentación Scalar disponible en: http://{display_host}:{settings.SERVER_PORT}/scalar")
    print(f" Conectado a OmniVista en: {settings.ov_base_url}")
    print("=" * 70)
    
    uvicorn.run(
        "app.main:app",
        host=settings.SERVER_HOST,
        port=settings.SERVER_PORT,
        reload=settings.DEBUG
    )
