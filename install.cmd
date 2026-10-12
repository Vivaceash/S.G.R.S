@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if not errorlevel 1 goto use_py
where python >nul 2>&1
if not errorlevel 1 goto use_python
echo [SGRS] ERROR: se requiere Python 3.11 o superior.
exit /b 1

:use_py
py -3 run.py install %*
exit /b %errorlevel%

:use_python
python run.py install %*
exit /b %errorlevel%
