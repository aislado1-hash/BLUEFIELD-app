# Guionista de Fútbol (sin API, con tu cuenta de claude.ai)

Un único archivo, `Guionista.html`, que se abre con doble clic en cualquier navegador.
No necesita servidor, Node.js ni API key: usa tu cuenta de claude.ai mediante copiar y pegar.

## Cómo se usa

1. Abre `Guionista.html` y elige el modo: **Crear guion**, **Generar ideas** o **Mejorar guion**.
2. Rellena el formulario y pulsa **«1. Copiar prompt y abrir Claude»**. Se copia el prompt maestro
   completo junto con tu petición, y se abre claude.ai en otra pestaña.
3. Pégalo en Claude (Ctrl+V / Cmd+V) y envíalo.
4. Cuando Claude termine, pulsa el botón **Copiar** que hay debajo de su respuesta, pégala en el
   cuadro **«2. Pega aquí la respuesta de Claude»** y pulsa **«Ver resultado»**.
   Si Claude se corta, escríbele «continúa» y pega las dos partes seguidas.

## Qué muestra

- La **puntuación de retención potencial** destacada (sección K del modo 1, o la evaluación del modo 3).
- Tres vistas: **Documento** (con tablas), **Vista chat** (burbujas del guion) o **Ideas** (tarjetas con el botón
  «Desarrollar esta idea»), y **Texto**.
- Botones: copiar solo el guion, copiar todo y descargar en `.md`.
- Historial de los últimos 20 resultados, guardado en el navegador.

## Cambiar las reglas

El prompt maestro (apartados 1–24 y el formato técnico) va dentro de `Guionista.html`, en el bloque
`<script type="text/plain" id="maestro">`. Edítalo con cualquier editor de texto y guarda el archivo.
