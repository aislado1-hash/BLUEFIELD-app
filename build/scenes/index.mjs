// Registro de tipos de escena. Para añadir uno nuevo (event, reaction, typing, pause,
// choice, flashback, split…): crea build/scenes/<tipo>.mjs exportando
//   scene<Tipo>(scene, ctx) -> { start, end, data, music }   (Node: tiempos + marcado)
//   animate(tl, s, rt)                                        (navegador: tweens GSAP)
// y añádelo aquí y a SCENE_TYPES en build/lib/common.py.
import * as intro from "./intro.mjs";
import * as chat from "./chat.mjs";
import * as tension from "./tension.mjs";
import * as reveal from "./reveal.mjs";
import * as cliffhanger from "./cliffhanger.mjs";
import * as cta from "./cta.mjs";

export const SCENES = {
  intro: { build: intro.sceneIntro, animate: intro.animate },
  chat: { build: chat.sceneChat, animate: chat.animate },
  tension: { build: tension.sceneTension, animate: tension.animate },
  reveal: { build: reveal.sceneReveal, animate: reveal.animate },
  cliffhanger: { build: cliffhanger.sceneCliffhanger, animate: cliffhanger.animate },
  cta: { build: cta.sceneCta, animate: cta.animate },
};

/** Escenas que añaden mensajes al hilo de chat (para saber qué línea "previsualizar"). */
export const CONVERSATION_TYPES = new Set(["chat", "tension", "reveal"]);
