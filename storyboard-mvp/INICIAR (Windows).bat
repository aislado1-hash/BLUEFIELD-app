@echo off
chcp 65001 >nul
title Storyboard Camioneras
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Falta un programa necesario: Node.js. Intentando instalarlo...
  echo.
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo.
    echo  No se pudo instalar solo. Se abrira la pagina de descarga:
    echo  descarga el instalador para Windows, instalalo con Siguiente, Siguiente...
    echo  y despues vuelve a hacer doble clic en INICIAR.
    start "" https://nodejs.org/es/download
    pause
    exit /b
  )
  echo.
  echo  Listo. Cierra esta ventana y vuelve a hacer doble clic en INICIAR.
  pause
  exit /b
)

if not exist "node_modules\playwright-core" (
  echo  Preparando la app por primera vez, espera un momento...
  call npm install --omit=dev --no-audit --no-fund
)

node server.mjs
pause
