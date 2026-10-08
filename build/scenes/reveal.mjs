// MOMENTO FUERTE / GIRO: flash, sacudida, glitch y zoom. La intensidad escala con
// la energía de cada línea (0.9 = momento fuerte, 1.0 = giro). `hold` congela el
// plano unos segundos tras la última línea para que el giro respire.
import { placeLines } from "./_thread.mjs";

export function sceneReveal(scene, ctx) {
  const start = ctx.cursor;
  // Subida de tensión durante la pausa previa a la línea fuerte.
  const first = ctx.line(scene.lines[0]);
  if ((first.energy ?? 0) >= 1) ctx.addSfx("riser", start, 0.5);
  const items = placeLines(scene.lines, ctx);
  for (const it of items) {
    if (it.energy >= 0.9) {
      ctx.addSfx("boom", it.at, 0.7 + (it.energy - 0.9) * 2);
      ctx.addSfx("glitch", it.at, 0.35);
    }
  }
  ctx.cursor += scene.hold ?? 0.25;
  return { start, end: ctx.cursor, data: { items }, music: "hit" };
}

export function animate(tl, s, rt) {
  const d = s.data;
  rt.mood(tl, s.start, "tension", 0.25, 0.3);
  rt.mood(tl, s.start, "dark", 0.15, 0.3);
  rt.thread(tl, d.items);
  d.items.forEach((it) => {
    const e = it.energy;
    if (e < 0.9) return;
    rt.flash(tl, it.at, e >= 1 ? 0.95 : 0.75, e >= 1 ? 0.6 : 0.4);
    rt.shake(tl, it.at, e >= 1 ? 26 : 16, e >= 1 ? 0.55 : 0.4);
    rt.glitch(tl, it.at - 0.02, e >= 1 ? 0.35 : 0.25);
    rt.punch(tl, it.at, e >= 1 ? 0.07 : 0.04, 0.6);
    rt.zoom(tl, it.at, e >= 1 ? 1.12 : 1.04, e >= 1 ? 1.2 : 0.8, "power3.out");
    rt.mood(tl, it.at, "gold", e >= 1 ? 1 : 0.6, 0.3);
  });
}
