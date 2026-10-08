// CONTEXTO: conversación normal. Luz neutra, cámara estable.
import { placeLines } from "./_thread.mjs";

export function sceneChat(scene, ctx) {
  const start = ctx.cursor;
  const items = placeLines(scene.lines, ctx);
  return { start, end: ctx.cursor, data: { items }, music: "groove" };
}

export function animate(tl, s, rt) {
  rt.mood(tl, s.start, "tension", 0, 0.5);
  rt.mood(tl, s.start, "dark", 0, 0.5);
  rt.zoom(tl, s.start, 1, 0.6);
  rt.thread(tl, s.data.items);
}
