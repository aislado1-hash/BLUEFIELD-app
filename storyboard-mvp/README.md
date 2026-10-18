# Storyboard Camioneras (MVP)

App web local para crear storyboards de rutinas de **chicas camioneras / conductoras de tráiler**:
generas las imágenes de cada escena manteniendo a tu personaje y tu camión, y luego las **animas** como clips de video.

```
1 Conexión ─► 2 Camionera (hoja de estilo) ─► 3 Camión por dentro ─► 4 Rutina → storyboard → imágenes ─► 5 Animar → video final
```

## Arranque

```bash
cd storyboard-mvp
npm start            # → http://127.0.0.1:5173
```

Sin dependencias: solo Node 20+. Para exportar el MP4 final hace falta `ffmpeg` en el PATH.

## Conectar la cuenta de Google

Google Flow **no tiene API pública**. La app usa la **Gemini API** de tu cuenta de Google, que da acceso a los
mismos modelos que usa Flow:

| Paso | Modelo por defecto | Alternativas |
| --- | --- | --- |
| Storyboard (texto → escenas) | `gemini-2.5-flash` | cualquier Gemini de texto |
| Imágenes (Nano Banana) | `gemini-2.5-flash-image` | `gemini-3-pro-image-preview` (Nano Banana Pro) |
| Animación imagen → video (Veo) | `veo-3.1-generate-preview` | `veo-3.1-fast-generate-preview` (más barato) |

1. Crea una API key en <https://aistudio.google.com/apikey> con tu cuenta de Google.
2. Veo es de pago: activa la facturación en el proyecto de esa key.
3. Pega la key en la pestaña **Conexión** (se guarda en `data/settings.json`, que no se sube a git)
   o arranca con `GEMINI_API_KEY=... npm start`.

Sin key, la app funciona en **modo demo**: storyboard de ejemplo, imágenes de marcador y vista previa animada,
para probar el flujo sin gastar créditos.

> Los créditos de tu plan de Flow (Google AI Pro/Ultra) **no** se consumen aquí: la Gemini API se factura aparte.
> Existen servicios de terceros que automatizan la web de Flow, pero no son oficiales y pueden ir contra los
> términos de Google, así que la MVP no los usa. El cliente está aislado en `lib/gemini.mjs` por si se cambia de proveedor.

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
| `lib/gemini.mjs` | Cliente REST: `generateContent` (texto/imagen) y `predictLongRunning` + polling (Veo) |
| `lib/prompts.mjs` | Todos los prompts y el esquema JSON del storyboard |
| `lib/store.mjs` | Ajustes y proyectos en `data/` (JSON + `media/`) |
| `lib/mock.mjs` | Modo demo |
| `public/` | UI (HTML + JS + CSS sin frameworks) |
| `test/` | `npm test`: flujo completo en modo demo y forma de las peticiones a Gemini/Veo |

## Límites conocidos de la MVP

- Un solo usuario, local (escucha en `127.0.0.1`). Para publicarlo haría falta login y guardar la key en el servidor.
- Los clips de Veo duran 4–8 s; el export une los clips tal cual (sin transiciones, música ni subtítulos).
- Los videos generados por Veo se guardan en local al terminar; Google los borra de sus servidores a los 2 días.
