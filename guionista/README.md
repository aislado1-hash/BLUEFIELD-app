# Guionista: guiones de fútbol en formato chat (API de Claude)

MVP web que convierte un **título + contexto** en un guion completo para vídeos largos de YouTube
(historias de fútbol contadas en un grupo de chat), siguiendo el prompt maestro de `prompt-maestro.md`.

## Uso

```bash
npm install
cp .env.example .env      # rellena ANTHROPIC_API_KEY
npm run guionista         # abre http://localhost:3000
```

## Qué hace

- Formulario con los datos de la sección 21 del prompt: título, contexto, duración, personajes
  obligatorios, final deseado y catálogo de eventos de Chat Video Maker.
- El guion llega en streaming, con las secciones de la A a la J.
- Tiene tres vistas: **Documento** (con tablas), **Vista chat** (burbujas de la sección E) y **Texto**.
- Botones: copiar solo el guion (sección E), copiar todo y descargar en `.md`.
- Historial de los últimos 20 guiones y borrador del formulario, guardados en el navegador.

## Detalles técnicos

- `server.mjs`: servidor Node sin dependencias extra; `POST /api/generar` transmite eventos SSE.
- Modelo `claude-opus-5-5` (se cambia con `CLAUDE_MODEL`), pensamiento adaptativo y `effort` elegible
  (Rápida / Equilibrada / Máxima).
- El prompt maestro va como `system` con caché de prompt, así las siguientes generaciones salen más baratas.
- Si el modelo rechaza la petición por política, el *fallback* del servidor (`fallbacks: "default"`) la
  reintenta automáticamente con otro modelo.
- Para cambiar las reglas del guionista, edita `prompt-maestro.md` y reinicia el servidor.
