@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel%==0 (
  start "Servidor local" /min cmd /k "py -3 -m http.server 8000"
) else (
  start "Servidor local" /min cmd /k "python -m http.server 8000"
)
timeout /t 2 /nobreak >nul
start "" "http://localhost:8000"
