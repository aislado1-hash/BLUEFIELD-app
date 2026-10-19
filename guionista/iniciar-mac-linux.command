#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "No se encuentra Node.js. Instálalo desde https://nodejs.org (versión LTS) y vuelve a abrir este archivo."
  read -r -p "Pulsa Enter para salir"; exit 1
fi
if [ ! -f .env ]; then
  read -r -p "Pega tu API key de Anthropic y pulsa Enter: " KEY
  echo "ANTHROPIC_API_KEY=$KEY" > .env
fi
[ -d node_modules/@anthropic-ai/sdk ] || npm install --omit=dev
( sleep 2; (open http://localhost:3000 || xdg-open http://localhost:3000) >/dev/null 2>&1 ) &
node server.mjs
