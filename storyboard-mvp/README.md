# Storyboard Camioneras (MVP)

App web local para crear storyboards de rutinas de **chicas camioneras / conductoras de tráiler**:
generas las imágenes de cada escena manteniendo a tu personaje y tu camión, y luego las **animas** como clips de video.

```
1 Conexión ─► 2 Camionera (hoja de estilo) ─► 3 Camión por dentro ─► 4 Rutina → storyboard → imágenes ─► 5 Animar → video final
```

## Arranque

```bash
cd storyboard-mvp
npm install          # instala playwright-core (controla tu Chrome; no descarga otro navegador)
npm start            # → http://127.0.0.1:5173
```

Requisitos: Node 20+ y **Google Chrome** instalado. Para exportar el MP4 final hace falta `ffmpeg` en el PATH.

## Modos de generación (pestaña Conexión)

### 🌐 Navegador: Google Flow (por defecto, sin APIs)

La app abre un **Chrome real** con un perfil propio (`data/chrome-profile/`) y lo maneja como lo harías tú:

| Paso | Dónde | Qué hace el navegador |
| --- | --- | --- |
| Storyboard | gemini.google.com | abre un chat, pega el pedido y lee el JSON de la respuesta |
| Hoja de estilo / interior del camión / escenas | Flow, modo imagen | sube las referencias, escribe el prompt, pulsa crear y descarga **todas** las variantes (quedan en el historial de la escena) |
| Animar | Flow, *Frames to Video* | sube la imagen de la escena como primer fotograma, escribe el prompt de movimiento y descarga el clip |

1. Pulsa **Abrir navegador** e inicia sesión con tu cuenta de Google la primera vez (queda guardada).
2. En Flow abre o crea un proyecto y elige la proporción (9:16 para vertical).
3. Deja la ventana abierta y trabaja en la app. Las tareas van **en cola, de una en una**; la barra amarilla
   de arriba dice qué está haciendo el navegador.

**Modo asistido.** La web de Flow cambia a menudo. Si el piloto no encuentra un control (el selector de modo,
el botón de subir…), la barra te dice qué hacer a mano en la ventana (p. ej. *“elige Frames to Video y pulsa
Generar”*) y la app captura el resultado igualmente en cuanto aparece. Los resultados se detectan como
imágenes/videos nuevos en la página, así que no dependen del diseño exacto.

Si Flow cambia un botón, puedes añadir selectores sin tocar código en `data/selectors.json`
(se prueban antes que los de serie; claves en `lib/browser.mjs` → `DEFAULT_SELECTORS`):

```json
{ "submit": ["button[aria-label=\"Generar\"]"], "modeOption": { "video": ["text=Fotogramas a vídeo"] } }
```

Variables: `CHROME_PATH` (ruta a otro Chrome/Chromium), `FLOW_URL`, `GEMINI_URL`.

> ⚠️ Automatizar la web de Flow con tu cuenta usa los créditos de tu plan, pero **no es un uso oficial**:
> los términos de Google limitan el acceso automatizado y la cuenta podría recibir avisos o límites.
> Úsalo con moderación (la app ya va de una en una) y bajo tu responsabilidad.

### 🔑 API de Gemini

Mismos modelos con una API key de <https://aistudio.google.com/apikey> (Veo requiere facturación activada).
Se factura aparte de tu plan de Flow.

| Paso | Modelo por defecto | Alternativas |
| --- | --- | --- |
| Storyboard | `gemini-2.5-flash` | cualquier Gemini de texto |
| Imágenes (Nano Banana) | `gemini-2.5-flash-image` | `gemini-3-pro-image-preview` (Nano Banana Pro) |
| Animación (Veo) | `veo-3.1-generate-preview` | `veo-3.1-fast-generate-preview` |

### 🧪 Demo

Storyboard de ejemplo, imágenes de marcador y vista previa animada, para probar el flujo sin generar nada.

## Cómo mantiene la consistencia

- La **hoja de estilo** de la camionera (subida o generada desde la descripción) se envía como imagen de
  referencia en cada escena, con la instrucción de conservar cara, pelo y ropa.
- Hasta **2 fotos del interior del camión** se envían como referencia del set.
- Con **Continuidad** activada, la imagen de la escena anterior también se envía (luz y objetos).
- Veo anima **a partir de la imagen aprobada** de la escena, así que el clip arranca con el personaje correcto.

Cada escena es editable (hora, zona, acción, cámara, prompt de imagen y de animación), puedes regenerar la imagen,
volver a una versión anterior desde el historial, reordenar y borrar.

## Estructura

| Ruta | Qué es |
| --- | --- |
| `server.mjs` | Servidor HTTP: API JSON + estáticos + media. Un candado por proyecto para escrituras concurrentes |
| `lib/browser.mjs` | Piloto de navegador (Playwright + tu Chrome): Flow y Gemini web, cola de tareas, modo asistido |
| `lib/gemini.mjs` | Cliente REST: `generateContent` (texto/imagen) y `predictLongRunning` + polling (Veo) |
| `lib/prompts.mjs` | Todos los prompts y el esquema JSON del storyboard |
| `lib/store.mjs` | Ajustes y proyectos en `data/` (JSON + `media/`) |
| `lib/mock.mjs` | Modo demo |
| `public/` | UI (HTML + JS + CSS sin frameworks) |
| `test/` | `npm test`: flujo demo, peticiones a Gemini/Veo y el piloto contra réplicas locales de Flow y Gemini (`test/fixtures/`) |

## Límites conocidos de la MVP

- Un solo usuario, local (escucha en `127.0.0.1`). Para publicarlo haría falta login y guardar la key en el servidor.
- Los clips de Veo duran 4–8 s; el export une los clips tal cual (sin transiciones, música ni subtítulos).
- Los videos generados por Veo se guardan en local al terminar; Google los borra de sus servidores a los 2 días.
- El piloto se probó contra réplicas de Flow y Gemini, no contra la web real: la primera vez revisa la barra de
  estado y, si algún paso queda en modo asistido, añade el selector correcto en `data/selectors.json`.
