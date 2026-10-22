@echo off
chcp 65001 >nul
title Chat Video Maker LOCAL v36 - Remotion
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python no esta instalado. Descargalo de https://www.python.org/ y marca "Add to PATH".
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js no esta instalado.
  echo Instala Node.js LTS desde https://nodejs.org/ y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)
if not exist "node_modules\remotion\package.json" (
  echo Instalando Remotion y dependencias ^(solo la primera vez^)...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo npm ci fallo, probando npm install...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
      echo Error instalando dependencias.
      pause
      exit /b 1
    )
  )
)
python server.py
pause
