@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Guionista de Futbol

where node >nul 2>nul || (
  echo Falta Node.js. Se abrira la web para descargarlo: instala la version LTS y vuelve a abrir este archivo.
  start https://nodejs.org
  pause
  exit /b
)

where claude >nul 2>nul || (
  echo Instalando Claude Code ^(solo la primera vez^)...
  call npm install -g @anthropic-ai/claude-code
)
where claude >nul 2>nul || (
  echo No se pudo instalar Claude Code. Prueba a ejecutar como administrador: npm install -g @anthropic-ai/claude-code
  pause
  exit /b
)

call claude auth status | findstr /c:"\"loggedIn\": true" >nul || (
  echo Inicia sesion con tu cuenta de Claude en el navegador que se va a abrir...
  call claude auth login
)

start "" http://localhost:3000
echo.
echo Guionista abierto en http://localhost:3000  -  Para cerrarlo, cierra esta ventana.
node server.mjs
pause
