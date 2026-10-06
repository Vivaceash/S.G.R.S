import uvicorn
import subprocess
import sys
import os
from app.core.config import BASE
from app.core.config import settings


if __name__ == '__main__':
    private_env = BASE / '.private/.env'
    if not private_env.exists():
        subprocess.run([sys.executable, str(BASE / 'scripts/configure_local.py')], check=True)
        os.execv(sys.executable, [sys.executable, __file__])
    print(f'{settings.APP_NAME} — http://localhost:{settings.PORT}/scalar')
    uvicorn.run('app.main:app', host=settings.HOST, port=settings.PORT, reload=settings.DEBUG, workers=1)
