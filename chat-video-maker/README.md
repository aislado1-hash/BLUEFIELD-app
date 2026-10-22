# Chat Video Maker LOCAL — v36

Crea vídeos de chats de grupo (personajes con foto, burbujas, eventos del grupo y voces AI33) y los exporta a MP4 con Remotion, todo en tu PC.

## Inicio

1. Ejecuta `INICIAR_CHAT_VIDEO.bat` (la primera vez instala Remotion; tarda un par de minutos).
2. Se abre el navegador. Crea un proyecto o abre uno existente.
3. Configura personajes, escribe el guion, genera las voces y pulsa **Generar MP4**.

Requisitos: Python 3 y Node.js LTS.

## Formato del guion

```
Titulo inicial: "Francia contra España hoy"

Juan: Hola a todos.
Pepe: ¿Qué tal? 😎
evento: Juan sacó a Pepe del grupo
María: ¿Qué ha pasado?
evento: María cambió el título del grupo a Viaje a Madrid
```

- `Titulo inicial:` se muestra centrado al principio, con su propio audio; el chat empieza 2 s después.
- **Personajes de proyectos anteriores:** al detectar un personaje nuevo en el guion, si ya lo usaste con voz en otro proyecto (o está en la biblioteca), se copia tal cual estaba: voz, velocidad, foto, colores, lado y tamaños. Se toma el del proyecto más reciente; la biblioteca manda si también tiene voz. La foto se copia a la carpeta del proyecto nuevo.
- **Varios títulos:** `Titulo inicial 2:`, `Titulo inicial 3:`… se pueden poner en cualquier punto del guion. Cada uno aparece en pantalla completa justo donde está escrito, con su propio audio, y 2 s después el chat sigue donde estaba. Si repites `Titulo inicial:` sin número, se numeran solos por orden.
- `Nombre: texto` es un mensaje del personaje con ese nombre.
- `evento:` es un aviso del sistema `[ … ]` con su propio audio.
  Si la frase dice que alguien **sale / es sacado / es eliminado** del grupo, **se une / es añadido** al grupo o **cambia el título del grupo a …**, la cabecera se actualiza sola.
- **Reacciones:** al final de un mensaje, `{r: 😂3 🔥 💀}` (el número es cuántas personas reaccionan). Aparecen debajo de la burbuja cuando termina la voz de ese mensaje. También vale `{reacciones: 😂 🔥}`.
- Los emojis se ven en el vídeo pero no se envían a la voz.

## Funciones principales

- **Aviso al terminar los audios:** cuando acaban de generarse las voces (mensajes o eventos + título) suena un aviso y aparece una tarjeta con cuenta atrás. Si no pulsas **✕ Apagar aviso** (o Esc) en 10 s, se genera el MP4 solo. **🎬 Generar ya** lo lanza al momento. Se desactiva con la casilla de *05 · Exportar vídeo*.
- **Formato vertical 9:16** (1080×1920 / 720×1280) para TikTok, Reels y Shorts, además de horizontal 16:9. Se elige en *05 · Exportar vídeo*.
- **Plantillas de estilo:** Clásico, WhatsApp, Telegram, Instagram DM y Discord (*00 · Estilo y cabecera*).
- **Música de fondo con ducking:** en *02 · Conversación → 🎵 Música de fondo* elige un archivo de audio. Suena en bucle todo el vídeo, entra y sale con un fundido y baja sola mientras habla una voz (título, eventos y mensajes), volviendo a subir al terminar. «Volumen» es el nivel normal y «Al hablar» el nivel durante las voces. Se oye igual en la vista previa y en el MP4.
- **Lado de las burbujas:** por defecto cambian de lado cada vez que cambia quien habla; si el mismo personaje manda varios mensajes seguidos, se quedan en el mismo lado. En *02 · Conversación → Lado de las burbujas* puedes elegir «Fijo» para que cada personaje use siempre su propio lado.
- **Personajes automáticos al pegar el guion:** al pegar un guion en *02 · Conversación* se crean solos todos los personajes que aparecen (alternando izquierda/derecha con los colores de la plantilla) y se quitan los personajes vacíos que el guion no usa. Solo tienes que ponerles foto y voz. Si un personaje está en la biblioteca, llega con su foto y voz; si hay una voz guardada con su mismo nombre, se le asigna. Si escribes a mano un nombre nuevo, aparece el botón «＋ Crear personajes».
- **Voces guardadas:** en *01 · Personajes → Voz del personaje* escribe el Voice ID, ponle un nombre y pulsa «💾 Guardar voz». Después elígela del desplegable en cualquier personaje y proyecto. Se guardan en `public/library/voices.json`.
- **Biblioteca de personajes:** guarda un personaje (foto, colores, tamaños, voz) y reutilízalo en cualquier proyecto. Se guarda en `public/library/`.
- **Saltar en la vista previa:** barra de tiempo bajo la vista previa y clic en cualquier fila de la línea de tiempo.
- **Velocidad de render:** Rápido / Equilibrado / Máxima calidad.

## Estructura

| Archivo | Qué hace |
|---|---|
| `index.html` | Editor y vista previa |
| `shared/chatcore.js` | **Núcleo compartido**: lectura del guion, línea de tiempo, cabecera, animaciones y estilos. Lo usan la vista previa y Remotion, por eso se ven igual. |
| `remotion/index.tsx` | Composición de Remotion que genera el MP4 |
| `server.py` | Servidor local: proyectos, archivos, voces AI33 y render |
| `public/projects/<proyecto>/` | `project.json`, `assets/` (fotos, fondo, sonido, música), `tts/` (voces) y el MP4 |
| `public/library/` | Biblioteca de personajes (`characters.json` + fotos) y voces guardadas (`voices.json`) |

Para cambiar un tamaño, color o margen del vídeo, edítalo en `shared/chatcore.js` → `C.styles`: cambia a la vez en la vista previa y en el MP4.

## Notas

- **Caché de voces:** cada audio se identifica por texto + voz + velocidad. Si ya existe en la carpeta del proyecto, se reutiliza y no se vuelve a pagar.
- **Las voces siguen a su mensaje:** puedes insertar, borrar o mover líneas del guion después de generar las voces; cada mensaje conserva la suya. Si cambias el texto de un mensaje o la voz de un personaje, ese mensaje se marca «⚠ sin voz» en la línea de tiempo hasta que vuelvas a pulsar «Generar voces» (solo se generan los que faltan).
- **Guardado automático:** el proyecto se guarda solo al editar (indicador arriba a la derecha).
- **API key de AI33:** nunca se guarda en los proyectos. Opcionalmente se puede recordar en el navegador.
- **Proyectos de versiones anteriores:** copia la carpeta `public/projects` de tu versión antigua a esta. Al abrirlos, las fotos y el sonido incrustados se convierten solos en archivos.
- **Variables opcionales:** `CHAT_VIDEO_PORT` (puerto fijo), `CHAT_VIDEO_BROWSER` (Chrome propio para Remotion), `CHAT_VIDEO_NO_BROWSER=1` (no abrir el navegador).

## Cambios en v36

- Música de fondo en bucle con ducking automático durante las voces.
- Las burbujas alternan de lado al cambiar de personaje (opción «Fijo» para el comportamiento anterior).
- Personajes creados automáticamente al pegar un guion.
- Voces guardadas reutilizables (desplegable en cada personaje y en los eventos).
- **Arreglado:** al insertar, borrar o mover líneas del guion (o quitar un personaje) después de generar las voces, cada mensaje sonaba con la voz del anterior, tanto en la vista previa como en el MP4. Ahora cada audio se asocia al contenido del mensaje (texto + voz + velocidad), no a su posición.
- Aviso «⚠ sin voz» en la línea de tiempo y bajo el guion para los mensajes que cambiaron y necesitan voz nueva.
- Incluye los arreglos de descarga de v35.1.
- Quitados el guion con ChatGPT y la miniatura automática.

## Cambios en v35.1

- **Arreglado:** «Descargar MP4» no descargaba nada si el nombre del proyecto tenía emojis o comillas tipográficas (“ ”). Ahora descarga con el nombre completo.
- La descarga se envía por partes, sin cargar el vídeo entero en memoria.
- Nuevo botón «📁 Abrir carpeta del vídeo» junto a la descarga.
- Al abrir un proyecto que ya tiene MP4, aparece directamente el botón de descarga.

## Cambios en v35

- Formato vertical 9:16 con márgenes seguros para la interfaz de TikTok/Reels/Shorts.
- Plantillas de estilo: WhatsApp, Telegram, Instagram DM, Discord y Clásico.
- Reacciones con emojis debajo de los mensajes (`{r: 😂3 🔥}`).
- Guion generado con ChatGPT, con creación automática de personajes y botón de deshacer.
- Biblioteca de personajes reutilizables; botón para quitar un personaje del proyecto.
- Barra para saltar a cualquier momento de la vista previa y clic en la línea de tiempo.
- Miniatura automática en PNG.
- Render más rápido: usa todos los núcleos del procesador, ajustes de velocidad y una carpeta de render que solo contiene los archivos del proyecto. Antes Remotion copiaba en cada render la carpeta `public` entera, con todos los proyectos y MP4 anteriores, y cada render era más lento que el anterior.
- Botones para quitar la foto de fondo y el sonido.
- Aviso de líneas del guion ignoradas porque el nombre no coincide con ningún personaje.

## Cambios en v34

**Errores corregidos en el MP4**
- Los `evento:` del guion salían **dos veces** en el vídeo (uno con voz y otro mudo de 1,8 s). Ahora salen una vez.
- La animación de entrada (Pop / Deslizar / Aparecer) se aplicaba al mensaje equivocado cuando había eventos.
- La **foto de fondo** no aparecía en el MP4.
- Los eventos escritos en el guion no cambiaban el número de miembros ni el título de la cabecera.

**Vista previa = MP4**
- La vista previa y Remotion usan el mismo núcleo (`shared/chatcore.js`): mismos tamaños de burbuja, cabecera, eventos, nombres e indicador "escribiendo".
- En la vista previa se oyen también las voces del título y de los eventos, con los mismos tiempos que en el MP4.
- El campo *Tamaño del texto del evento* ya funciona y se guarda.

**Rendimiento y robustez**
- La vista previa ya no recalcula la línea de tiempo ni reconstruye el chat en cada fotograma.
- Las fotos y el sonido se guardan como archivos del proyecto, no incrustados en `project.json`.
- **Generar MP4** muestra una barra de progreso con los fotogramas renderizados.
- Guardado automático y escritura atómica de `project.json`.
- Versiones de Remotion fijadas (4.0.534) con `package-lock.json`.
- El servidor rechaza peticiones de otras webs y rutas de archivo no válidas.

**Limpieza**
- Eliminado el modo "diálogo" antiguo, el código sin uso y la instalación de Playwright/Chromium en cada arranque (Remotion trae su propio navegador).
- Un solo README y una sola versión (v34) en todo el programa.
