#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Falta Node.js. Instala la versión LTS desde https://nodejs.org y vuelve a abrir este archivo."
  (open https://nodejs.org || xdg-open https://nodejs.org) >/dev/null 2>&1
  read -r -p "Pulsa Enter para salir"; exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "Instalando Claude Code (solo la primera vez)..."
  npm install -g @anthropic-ai/claude-code || sudo npm install -g @anthropic-ai/claude-code
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "No se pudo instalar Claude Code. Ejecuta: npm install -g @anthropic-ai/claude-code"
  read -r -p "Pulsa Enter para salir"; exit 1
fi

if ! claude auth status 2>/dev/null | grep -q '"loggedIn": true'; then
  echo "Inicia sesión con tu cuenta de Claude en el navegador que se va a abrir..."
  claude auth login
fi

( sleep 2; (open http://localhost:3000 || xdg-open http://localhost:3000) >/dev/null 2>&1 ) &
echo "Guionista abierto en http://localhost:3000 — para cerrarlo, cierra esta ventana."
node server.mjs
