# Motor de Shorts de conversación (HyperFrames + HTML + GSAP)

Prototipo: un Short vertical (1080x1920, 60 fps, ~33 s) contado como chat entre personajes,
generado **solo** a partir de una ficha JSON.

```
specs/<id>.json ─► build/voices.py ─► (AI33 TTS | caché) ─► build/engine.mjs ─► HTML + GSAP
                                                                 │
                    renders/<id>.mp4 ◄─ hyperframes render ◄─ hyperframes check ◄─ build/audio.py
```

## Uso

```bash
npm install                      # hyperframes (CLI de render) + gsap
cp .env.example .env             # y pon AI33_API_KEY
python3 build/run.py short_001   # pipeline completo -> renders/short_001.mp4
python3 build/run.py short_001 --no-render        # hasta `hyperframes check`
python3 build/run.py short_001 --quality draft    # render rápido
python3 build/run.py short_001 --provider local   # forzar TTS local de prueba
```

Requisitos: Node 22+, Python 3 + numpy, ffmpeg. Para el TTS local de prueba: `espeak-ng`.

## Estructura

| Ruta | Qué es |
| --- | --- |
| `specs/<id>.json` | Ficha del Short: personajes (voice_id, speed, color, lado), líneas (`cap` en pantalla, `tts` hablado, `energy`), escenas, goal, promotion |
| `build/run.py` | Orquestador (validar → TTS → composición → audio → check → render → frames) |
| `build/validate.py` | Validación de la ficha (`--stage spec`) y de assets/duración (`--stage assets`) |
| `build/voices.py` | TTS con caché por hash, mide duración, inicio/fin de habla y timing por palabra |
| `build/lib/ai33.py` | Cliente AI33 v3 (POST `/v3/text-to-speech` + polling `/v1/task/<id>`) |
| `build/lib/tts_local.py` | TTS de reserva (espeak-ng) solo para pruebas sin key |
| `build/engine.mjs` | Ficha + timing → `build/dist/<id>/index.html` (composición HyperFrames) + `cues.json` |
| `build/scenes/*.mjs` | Un módulo por tipo de escena: `scene<Tipo>()` (tiempos + marcado) y `animate()` (tweens) |
| `build/lib/runtime.js` | Runtime del navegador: UNA timeline GSAP `window.__timelines["main"]` + helpers (cámara, flash, shake, glitch, burbujas, palabras) |
| `build/lib/styles.css` | Estética del formato |
| `build/audio.py`, `build/lib/synth.py` | Voces normalizadas (-16 LUFS), música por secciones y librería de SFX |
| `voices/cache/<hash>.mp3` | Caché de TTS. hash = proveedor + voz + velocidad + texto |
| `audio/<id>/voices.json` | Timing medido de cada línea |
| `assets/` | Fuentes (Inter), GSAP local, SFX (`assets/sfx/*.wav`, reemplazables por reales) |
| `renders/` | `<id>.mp4` y frames de control `<id>_frames/` |

## Reglas de la ficha

- `cap` = texto en pantalla (con emojis). `tts` = texto hablado (opcional; por defecto `cap`).
  Los emojis se eliminan siempre antes de enviar a AI33.
- `energy` (0–1) cambia la animación: rebote/escala de entrada, brillo, punch de cámara, tamaño
  de la burbuja (≥0.9 grande, 1.0 enorme), y en `reveal` flash + shake + glitch + zoom.
- `pauseBefore` (s) fuerza una pausa dramática antes de una línea.
- `voice_id` con prefijo `REPLACE_` = marcador: hay que sustituirlo por la voz real de AI33.
  Con proveedor `ai33` es un error de validación; con `local` solo un aviso.

## Añadir un tipo de escena

1. `build/scenes/<tipo>.mjs` con `scene<Tipo>(scene, ctx)` y `animate(tl, s, rt)`.
2. Registrar en `build/scenes/index.mjs` y en `SCENE_TYPES` (`build/lib/common.py`).

`ctx` ofrece: `cursor` (tiempo), `line()`, `char()`, `addVoice()`, `addSfx()`, `layer()`, `gap()`,
`thread` y `placeLines()` (en `_thread.mjs`) para escenas de conversación.
