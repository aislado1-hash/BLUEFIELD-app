// Lógica compartida por las escenas "de conversación" (chat, tension, reveal…):
// coloca cada línea en el tiempo, registra su voz/SFX y genera la burbuja.
import { esc, wordSpans, r3 } from "../lib/html.mjs";

export function bubbleMarkup(line, char, dom) {
  const e = line.energy ?? 0.3;
  const size = e >= 1 ? "msg--huge" : e >= 0.9 ? "msg--big" : "";
  return `
  <div class="msg msg--${char.side || "left"} ${size}" id="${dom}" style="--c:${char.color}" data-energy="${e}">
    <div class="msg__avatar"><span class="msg__ring"></span><span class="msg__initials">${esc(char.initials || char.displayName[0])}</span></div>
    <div class="msg__body">
      <div class="msg__name">${esc(char.displayName)}</div>
      <div class="msg__bubble"><span class="msg__glow"></span><span class="msg__text">${wordSpans(line.cap, { emphasis: line.emphasis || [] })}</span></div>
    </div>
  </div>`;
}

export function statusMarkup(line, char) {
  return `<div class="status" id="st-${line.id}"><i style="background:${char.color}"></i><b style="color:${char.color}">${esc(char.displayName)}</b>&nbsp;está escribiendo…</div>`;
}

/** SFX por defecto de una burbuja según su energía (sobrescribible con line.sfx). */
function defaultBubbleSfx(energy) {
  if (energy >= 0.9) return [];
  return [{ name: "pop", gain: 0.45 + energy * 0.35 }];
}

/**
 * Coloca las líneas de una escena de conversación a partir de ctx.cursor.
 * Devuelve los items que el runtime anima (tiempos absolutos de la composición).
 */
export function placeLines(lineIds, ctx) {
  return lineIds.map((id) => {
    const line = ctx.line(id);
    const char = ctx.char(line.character);
    const pause = line.pauseBefore ?? ctx.gap(line);
    const voiceStart = ctx.cursor + pause;
    const v = ctx.addVoice(id, voiceStart);
    const at = voiceStart - 0.08;
    const dom = `m-${id}`;
    ctx.thread.push(bubbleMarkup(line, char, dom));
    ctx.status.push(statusMarkup(line, char));
    for (const s of line.sfx || defaultBubbleSfx(line.energy ?? 0.3)) ctx.addSfx(s.name, at + (s.offset || 0), s.gain);
    ctx.cursor = v.speechEnd;
    return {
      id, dom, at: r3(at), voiceStart: r3(voiceStart), speechEnd: r3(v.speechEnd),
      energy: line.energy ?? 0.3, side: char.side || "left", words: v.words,
    };
  });
}
