// CLIFFHANGER: se corta el ritmo (música en silencio), el chat se desenfoca y una
// frase grande aparece palabra a palabra con la voz. Cierra con un riser hacia el CTA.
import { wordSpans, r3 } from "../lib/html.mjs";

export function sceneCliffhanger(scene, ctx) {
  const line = ctx.line(scene.line);
  const start = ctx.cursor;
  const voiceStart = start + (scene.silence ?? 0.55);
  const v = ctx.addVoice(line.id, voiceStart);
  const end = v.speechEnd + (scene.tail ?? 0.75);

  ctx.addSfx("boom", start, 0.55);
  ctx.addSfx("glitch", start + 0.05, 0.3);
  ctx.addSfx("riser", end - 1.1, 0.55);

  ctx.layer({
    id: "cliff",
    overlay: true, // por encima de los overlays de luz (mood-*) para que la frase no se oscurezca
    start,
    duration: end - start + 0.2,
    html: `
      <div id="cliff-inner">
        <div class="cliff__q" id="cliff-q">?</div>
        <div class="cliff__text" id="cliff-text">${wordSpans(line.cap, { emphasis: scene.emphasis || ["cambió", "todo"] })}</div>
      </div>`,
  });
  ctx.cursor = end;
  ctx.endThread(voiceStart); // el chat se desvanece antes de que aparezca la frase
  return { start, end, data: { words: v.words, voiceStart: r3(voiceStart), speechEnd: r3(v.speechEnd), end: r3(end) }, music: "drop" };
}

export function animate(tl, s, rt) {
  const d = s.data;
  rt.blurChat(tl, s.start, 18, 0.5);
  tl.fromTo("#chat-cam", { opacity: 1 }, { opacity: 0, duration: 0.45, ease: "power2.in" }, s.start + 0.05);
  rt.mood(tl, s.start, "dark", 0.72, 0.5);
  rt.mood(tl, s.start, "tension", 0.15, 0.5);
  rt.mood(tl, s.start, "gold", 0, 0.5);
  rt.zoom(tl, s.start, 0.96, 0.6, "power2.out");
  rt.glitch(tl, s.start, 0.25);
  tl.fromTo("#cliff-q", { opacity: 0, scale: 0.7, rotation: -8 }, { opacity: 1, scale: 1.08, rotation: 6, duration: d.end - s.start, ease: "sine.inOut" }, s.start);
  rt.$$("#cliff-text .w").forEach((w, i) => {
    const wt = d.words[i] || d.words[d.words.length - 1];
    const em = w.classList.contains("w--em");
    tl.fromTo(w, { opacity: 0, y: 40, filter: "blur(10px)" },
      { opacity: 1, y: 0, filter: "blur(0px)", duration: em ? 0.35 : 0.24, ease: "power3.out" }, wt.start);
    if (em) tl.fromTo(w, { scale: 1 }, { scale: 1.12, duration: 0.18, yoyo: true, repeat: 1, ease: "power2.out" }, wt.start + 0.1);
  });
  // respiración final: empuje lento sobre la frase
  tl.fromTo("#cliff-text", { scale: 1 }, { scale: 1.06, duration: d.end - d.speechEnd + 0.2, ease: "power1.in" }, d.speechEnd);
}
