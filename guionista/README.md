# Guionista de Fútbol (con tu cuenta de Claude, sin API key)

App local que genera guiones de fútbol en formato chat para vídeos largos de YouTube.
Usa **Claude Code** con tu cuenta Pro/Max, así que no necesita API key: pulsas un botón y el resultado sale solo.

## Arrancar

- Windows: doble clic en `iniciar-windows.bat`.
- Mac/Linux: abre `iniciar-mac-linux.command`.

El lanzador comprueba que tengas Node.js, instala Claude Code si falta
(`npm install -g @anthropic-ai/claude-code`), te pide iniciar sesión la primera vez
(`claude auth login`) y abre `http://localhost:3000`.

## Modos

1. **Crear guion**: título y contexto → secciones de la A a la J más la **K. Evaluación de retención**.
   Debajo aparece el botón **«Mejorar este guion»**, que lo analiza y lo corrige automáticamente.
2. **Generar ideas**: cada idea tiene **«Desarrollar esta idea»**, que genera su guion completo directamente.
3. **Mejorar guion**: pegas un guion y obtienes análisis, mejoras y, si lo marcas, la versión corregida.

## Detalles técnicos

- `server.mjs` (Node, sin dependencias) lanza `claude -p` con `prompt-maestro.md` como system prompt,
  sin herramientas y sin guardar sesión, y transmite el texto a la página por SSE.
- Puedes elegir el modelo (Opus / Sonnet / el predeterminado) y la calidad (`--effort`).
- Cada generación gasta de los límites de uso de tu plan de Claude.
- Para cambiar las reglas, edita `prompt-maestro.md` y vuelve a abrir el programa.
