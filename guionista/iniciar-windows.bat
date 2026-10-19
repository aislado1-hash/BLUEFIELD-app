@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (
  echo No se encuentra Node.js. Instalalo desde https://nodejs.org ^(version LTS^) y vuelve a abrir este archivo.
  start https://nodejs.org
  pause
  exit /b
)
if not exist .env (
  set /p KEY=Pega tu API key de Anthropic y pulsa Enter: 
  call echo ANTHROPIC_API_KEY=%%KEY%%> .env
)
if not exist node_modules\@anthropic-ai\sdk call npm install --omit=dev
start "" http://localhost:3000
node server.mjs
pause
