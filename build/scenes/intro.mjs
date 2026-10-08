// HOOK: título que se "estampa" palabra a palabra con la voz del narrador + notificación
// del primer mensaje. Termina con una salida rápida hacia el panel de chat.
import { esc, wordSpans, r3 } from "../lib/html.mjs";

export function sceneIntro(scene, ctx) {
  const line = ctx.line(scene.line);
  const start = ctx.cursor;
  const voiceStart = start + (scene.voiceDelay ?? 0.15);
  const v = ctx.addVoice(line.id, voiceStart);
  const end = Math.max(start + (scene.minDuration ?? 1.9), v.speechEnd + 0.3);
  const notifAt = start + (scene.notifAt ?? 0.05); // el hook entra en el primer frame

  const preview = ctx.line(scene.preview || ctx.firstConversationLine());
  const pChar = ctx.char(preview.character);

  ctx.addSfx("buzz", start, 0.55);
  ctx.addSfx("whoosh", voiceStart, 0.45);
  ctx.addSfx("chime", notifAt, 0.55);
  ctx.addSfx("whoosh", end - 0.3, 0.5);

  ctx.layer({
    id: "intro",
    start,
    duration: end - start + 0.45,
    html: `
      <div id="intro-zoom" class="abs"><div id="intro-inner">
        <div class="kicker" id="intro-kicker"><span class="dot"></span>${esc(scene.kicker || "1 MENSAJE NUEVO")}</div>
        <h1 class="intro__title" id="intro-title">${wordSpans(line.cap, { emphasis: scene.emphasis || [] })}</h1>
        <div class="notif" id="intro-notif">
          <div class="notif__av">${esc(ctx.spec.chat?.groupEmoji || "💬")}</div>
          <div class="notif__txt">
            <div class="notif__top"><span>${esc(ctx.spec.chat?.groupName || "CHAT")}</span><span>ahora</span></div>
            <div class="notif__msg">${esc(pChar.displayName)}: ${esc(preview.cap)}</div>
          </div>
        </div>
      </div></div>`,
  });
  ctx.cursor = end;
  return { start, end, data: { words: v.words, voiceStart: r3(voiceStart), notifAt: r3(notifAt), end: r3(end) }, music: "intro" };
}

// Se ejecuta en el navegador (serializado por engine.mjs). Solo usa tl, s y rt.
export function animate(tl, s, rt) {
  const d = s.data;
  tl.fromTo("#intro-kicker", { scale: 1.2, opacity: 0.85 }, { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(2.4)" }, s.start);
  tl.fromTo("#intro-zoom", { scale: 1 }, { scale: 1.07, duration: d.end - s.start, ease: "none" }, s.start);
  rt.$$("#intro-title .w").forEach((w, i) => {
    const wt = d.words[i] || d.words[d.words.length - 1];
    const emoji = w.classList.contains("w--emoji");
    tl.fromTo(w, { opacity: 0, scale: emoji ? 0.2 : 1.9, filter: "blur(14px)" },
      { opacity: 1, scale: 1, filter: "blur(0px)", duration: emoji ? 0.4 : 0.26, ease: emoji ? "back.out(3)" : "power3.out" }, wt.start);
  });
  rt.punch(tl, d.words[d.words.length - 1].start, 0.035, 0.45);
  tl.fromTo("#intro-notif", { opacity: 0.6, y: -90, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: "back.out(1.7)" }, d.notifAt);
  // salida: el título "atraviesa" la cámara y entra el chat
  tl.to("#intro-inner", { opacity: 0, scale: 1.3, filter: "blur(20px)", duration: 0.42, ease: "power2.in" }, d.end - 0.28);
  rt.panelIn(tl, d.end - 0.18);
}
