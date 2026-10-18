#!/bin/bash
# Doble clic para abrir Storyboard Camioneras en Mac.
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Falta un programa necesario: Node.js."
  echo "  Se abrirá la página de descarga: descarga el instalador para macOS,"
  echo "  instálalo y después vuelve a hacer doble clic en INICIAR."
  open "https://nodejs.org/es/download"
  read -n 1 -s -r -p "  Pulsa una tecla para cerrar..."
  exit 1
fi

if [ ! -d node_modules/playwright-core ]; then
  echo "  Preparando la app por primera vez, espera un momento..."
  npm install --omit=dev --no-audit --no-fund
fi

node server.mjs
