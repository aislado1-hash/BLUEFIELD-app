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

Tres modos (apartado 24 del prompt maestro):

1. **Crear guion**: a partir de un título y un contexto genera las secciones de la A a la J y,
   después, la **K. Evaluación de retención** (puntuación sobre 100, caídas de interés y plan de mejora).
2. **Generar ideas**: propone N ideas (10 por defecto) con el formato del apartado 23 y una
   priorización final. Cada idea tiene un botón **«Desarrollar esta idea»** que la carga en «Crear guion».
3. **Mejorar guion**: pegas un guion y obtienes su análisis de retención, las mejoras recomendadas
   y, si lo marcas, el guion corregido.

Además:

- El resultado llega en streaming y la puntuación de retención aparece destacada.
- Tiene tres vistas: **Documento** (con tablas), **Vista chat** (burbujas del guion) o **Ideas** (tarjetas), y **Texto**.
- Botones: copiar solo el guion, copiar todo y descargar en `.md`.
- Historial de los últimos 20 resultados y borrador del formulario, guardados en el navegador.

## Detalles técnicos

- `server.mjs`: servidor Node sin dependencias extra; `POST /api/generar` transmite eventos SSE.
- Modelo `claude-opus-5-5` (se cambia con `CLAUDE_MODEL`), pensamiento adaptativo y `effort` elegible
  (Rápida / Equilibrada / Máxima).
- El prompt maestro va como `system` con caché de prompt, así las siguientes generaciones salen más baratas.
- Si el modelo rechaza la petición por política, el *fallback* del servidor (`fallbacks: "default"`) la
  reintenta automáticamente con otro modelo.
- Para cambiar las reglas del guionista, edita `prompt-maestro.md` y reinicia el servidor.
