// TENSIÓN: se apaga la luz, tinte rojo, empuje lento de cámara. Las líneas con
// energía >= 0.8 añaden un golpe grave y un pequeño "punch".
import { placeLines } from "./_thread.mjs";

export function sceneTension(scene, ctx) {
  const start = ctx.cursor;
  const items = placeLines(scene.lines, ctx);
  for (const it of items) if (it.energy >= 0.8) ctx.addSfx("boom", it.voiceStart, 0.35 + (it.energy - 0.8) * 1.5);
  return { start, end: ctx.cursor, data: { items }, music: "tension" };
}

export function animate(tl, s, rt) {
  const d = s.data;
  rt.mood(tl, s.start, "tension", 0.7, 0.8);
  rt.mood(tl, s.start, "dark", 0.3, 0.8);
  rt.mood(tl, s.start, "gold", 0, 0.4);
  rt.zoom(tl, s.start, 1 + 0.06, Math.max(1, s.end - s.start), "sine.inOut");
  rt.thread(tl, d.items);
  d.items.forEach((it) => { if (it.energy >= 0.8) rt.punch(tl, it.voiceStart, 0.012 + (it.energy - 0.8) * 0.12, 0.5); });
}
