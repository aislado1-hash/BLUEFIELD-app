// CTA: entrada con flash, titular que se estampa con la voz y botón de suscripción
// que se "pulsa" (con estallido de partículas). Corto: ~2.5–3.5 s.
import { esc, wordSpans, r3 } from "../lib/html.mjs";

export function sceneCta(scene, ctx) {
  const line = ctx.line(scene.line);
  const start = ctx.cursor;
  const voiceStart = start + (scene.voiceDelay ?? 0.2);
  const v = ctx.addVoice(line.id, voiceStart);
  const pressAt = Math.max(voiceStart + 1.2, v.speechEnd - 0.35);
  const end = Math.max(start + 2.4, v.speechEnd + (scene.tail ?? 0.55), pressAt + 0.7);

  // Titular = primeras N palabras del texto en pantalla; el resto, subtítulo.
  const tokens = line.cap.split(/\s+/).filter(Boolean);
  const n = scene.headlineWords ?? 3;
  const head = tokens.slice(0, n).join(" ");
  const sub = tokens.slice(n).join(" ");

  ctx.addSfx("whoosh", start - 0.12, 0.55);
  ctx.addSfx("boom", start, 0.4);
  ctx.addSfx("pop", pressAt, 0.8);
  ctx.addSfx("sparkle", pressAt + 0.02, 0.6);

  const rand = ctx.rng(99);
  const colors = ["#ffc83d", "#ff3b5c", "#ffffff", "#ff8a3d"];
  const bursts = Array.from({ length: 22 }, (_, i) => {
    const a = (i / 22) * Math.PI * 2 + rand() * 0.3;
    const r = 220 + rand() * 260;
    return { x: r3(Math.cos(a) * r), y: r3(Math.sin(a) * r * 0.7), c: colors[i % colors.length], s: r3(0.6 + rand() * 1.2) };
  });

  ctx.layer({
    id: "cta",
    start,
    duration: end - start + 0.05,
    overlay: true,
    html: `
      <div id="cta-bg" class="abs"></div>
      <div id="cta-inner">
        <div class="cta__head" id="cta-head">${wordSpans(head)}</div>
        <div class="cta__sub" id="cta-sub">${wordSpans(sub)}</div>
        <div class="cta__btn" id="cta-btn">
          ${bursts.map((b, i) => `<span class="burst" id="cta-burst-${i}" style="background:${b.c}"></span>`).join("")}
          <div class="cta__pill cta__pill--on" id="cta-on">🔔 ${esc(scene.button || "SUSCRÍBETE")}</div>
          <div class="cta__pill cta__pill--done" id="cta-done">✓ ${esc(scene.buttonDone || "SUSCRITO")}</div>
        </div>
      </div>`,
  });
  ctx.cursor = end;
  return { start, end, data: { words: v.words, pressAt: r3(pressAt), end: r3(end), bursts }, music: "outro" };
}

export function animate(tl, s, rt) {
  const d = s.data;
  rt.flash(tl, s.start, 0.9, 0.45);
  tl.fromTo("#cta-bg", { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power2.out" }, s.start);
  rt.$$("#cta-inner .w").forEach((w, i) => {
    const wt = d.words[i] || d.words[d.words.length - 1];
    const head = w.closest("#cta-head");
    tl.fromTo(w, { opacity: 0, scale: head ? 2.2 : 1, y: head ? 0 : 30 },
      { opacity: 1, scale: 1, y: 0, duration: head ? 0.26 : 0.2, ease: head ? "power4.out" : "power3.out" },
      Math.max(s.start + 0.05, wt.start - (head ? 0.05 : 0)));
  });
  tl.fromTo("#cta-btn", { opacity: 0, y: 80, scale: 0.8 }, { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: "back.out(2)" }, s.start + 0.45);
  // pulsación del botón
  tl.to("#cta-btn", { scale: 0.9, duration: 0.08, ease: "power2.in" }, d.pressAt - 0.08)
    .to("#cta-btn", { scale: 1.06, duration: 0.18, ease: "back.out(3)" }, d.pressAt)
    .to("#cta-btn", { scale: 1, duration: 0.25, ease: "power2.out" }, d.pressAt + 0.18);
  tl.fromTo("#cta-on", { opacity: 1 }, { opacity: 0, duration: 0.12, immediateRender: false }, d.pressAt);
  tl.fromTo("#cta-done", { opacity: 0 }, { opacity: 1, duration: 0.12, immediateRender: false }, d.pressAt);
  d.bursts.forEach((b, i) => {
    tl.fromTo(`#cta-burst-${i}`, { x: 0, y: 0, opacity: 1, scale: b.s },
      { x: b.x, y: b.y, opacity: 0, scale: 0.2, duration: 0.7, ease: "power3.out", immediateRender: false }, d.pressAt);
  });
  rt.shake(tl, d.pressAt, 8, 0.25);
}
