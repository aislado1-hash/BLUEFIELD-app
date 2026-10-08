// Helpers de marcado compartidos por las escenas.

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const EMOJI_RE = /\p{Extended_Pictographic}/u;
export const isEmojiToken = (tok) => EMOJI_RE.test(tok) && !/[\p{L}\p{N}]/u.test(tok);

/**
 * Convierte un texto en <span class="w"> por palabra, para revelarlas sincronizadas con la voz.
 * `emphasis` = palabras (sin puntuación, minúsculas) que se resaltan.
 */
export function wordSpans(text, { emphasis = [], cls = "w" } = {}) {
  const emph = new Set(emphasis.map((e) => e.toLowerCase()));
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const bare = tok.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
      const classes = [cls];
      if (isEmojiToken(tok)) classes.push(`${cls}--emoji`);
      if (bare && emph.has(bare)) classes.push(`${cls}--em`);
      return `<span class="${classes.join(" ")}">${esc(tok)}</span>`;
    })
    .join(" ");
}

export const r3 = (n) => Math.round(n * 1000) / 1000;
