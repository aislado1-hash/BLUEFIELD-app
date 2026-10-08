// Runtime del navegador: construye UNA timeline GSAP (window.__timelines["main"])
// a partir del plan que genera build/engine.mjs. Se inyecta inline en index.html.
//
// Reglas HyperFrames respetadas:
//  - timeline pausada única, registrada al terminar de construirse;
//  - sin relojes ni Math.random (PRNG con semilla);
//  - medidas de layout solo en el setup (antes de crear tweens);
//  - nunca se animan elementos .clip (solo hijos/wrappers).
(function () {
  const PLAN = window.__SHORT_PLAN;
  const ANIM = window.__SHORT_SCENES;

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function build() {
    const tl = gsap.timeline({ paused: true });
    const $ = (s) => document.querySelector(s);
    const $$ = (s, root) => Array.from((root || document).querySelectorAll(s));
    const rand = mulberry32(PLAN.seed || 7);

    // Estado "desde" de propiedades compartidas entre escenas (fromTo explícitos = seek seguro).
    const state = { zoom: 1, mood: {}, scroll: 0, status: "st-idle", active: null, blur: 0 };

    const rt = {
      PLAN, $, $$, rand, state,

      // --- cámara ---------------------------------------------------------
      zoom(tl, t, to, dur, ease) {
        tl.fromTo("#cam-zoom", { scale: state.zoom }, { scale: to, duration: dur, ease: ease || "power2.inOut", immediateRender: false }, t);
        state.zoom = to;
      },
      punch(tl, t, amount, dur) {
        tl.fromTo("#cam-punch", { scale: 1 }, { scale: 1 + amount, duration: 0.09, ease: "power2.out", immediateRender: false }, t)
          .to("#cam-punch", { scale: 1, duration: dur || 0.5, ease: "power3.out" }, t + 0.09);
      },
      shake(tl, t, amp, dur) {
        const steps = Math.max(4, Math.round((dur || 0.4) / 0.045));
        for (let i = 0; i < steps; i++) {
          const k = 1 - i / steps;
          tl.to("#cam-shake", {
            x: (rand() * 2 - 1) * amp * k, y: (rand() * 2 - 1) * amp * k, rotation: (rand() * 2 - 1) * 0.6 * k,
            duration: 0.045, ease: "none",
          }, t + i * 0.045);
        }
        tl.to("#cam-shake", { x: 0, y: 0, rotation: 0, duration: 0.08, ease: "power2.out" }, t + steps * 0.045);
      },
      flash(tl, t, strength, dur) {
        tl.fromTo("#fx-flash", { opacity: strength }, { opacity: 0, duration: dur || 0.4, ease: "power2.out", immediateRender: false }, t);
      },
      mood(tl, t, name, to, dur) {
        const from = state.mood[name] || 0;
        tl.fromTo(`#mood-${name}`, { opacity: from }, { opacity: to, duration: dur, ease: "power2.inOut", immediateRender: false }, t);
        state.mood[name] = to;
      },
      blurChat(tl, t, to, dur) {
        tl.fromTo("#chat-cam", { filter: `blur(${state.blur}px)` }, { filter: `blur(${to}px)`, duration: dur, ease: "power2.inOut", immediateRender: false }, t);
        state.blur = to;
      },
      glitch(tl, t, dur) {
        const n = Math.round((dur || 0.3) / 0.05);
        for (let i = 0; i < n; i++) {
          tl.set("#fx-glitch", { opacity: rand() * 0.3 + 0.12, x: (rand() * 2 - 1) * 26, skewX: (rand() * 2 - 1) * 8 }, t + i * 0.05);
        }
        tl.set("#fx-glitch", { opacity: 0, x: 0, skewX: 0 }, t + n * 0.05);
      },

      // --- chat -----------------------------------------------------------
      panelIn(tl, t) {
        tl.fromTo("#chat-header", { opacity: 0, y: -60 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, t);
        tl.fromTo("#chat-panel", { opacity: 0, y: 180, scale: 0.93 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "power3.out" }, t + 0.04);
      },
      status(tl, t, id) {
        if (state.status === id) return;
        if (state.status) tl.fromTo(`#${state.status}`, { opacity: 1, y: 0 }, { opacity: 0, y: -14, duration: 0.18, immediateRender: false }, t);
        tl.fromTo(`#${id}`, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.22, ease: "power2.out", immediateRender: false }, t + 0.05);
        state.status = id;
      },
      scrollTo(tl, t, y) {
        if (Math.abs(y - state.scroll) < 1) return;
        tl.fromTo("#thread", { y: state.scroll }, { y, duration: 0.45, ease: "power3.out", immediateRender: false }, t);
        state.scroll = y;
      },
      /** Burbuja + palabras sincronizadas + anillo de "hablando" + scroll. */
      message(tl, it) {
        const el = document.getElementById(it.dom);
        const bubble = el.querySelector(".msg__bubble");
        const e = it.energy;
        const dir = it.side === "right" ? 1 : -1;
        rt.status(tl, it.at - 0.32, `st-${it.id}`);
        rt.scrollTo(tl, it.at - 0.05, -it.scrollY);

        tl.fromTo(el, { opacity: 0, y: 50 + e * 50, x: 36 * dir, scale: 0.84 - e * 0.12 },
          { opacity: 1, y: 0, x: 0, scale: 1, duration: 0.38 + e * 0.12, ease: `back.out(${(1.3 + e * 1.8).toFixed(2)})`, immediateRender: false }, it.at);
        if (state.active) {
          tl.fromTo(`#${state.active} .msg__bubble`, { opacity: 1 }, { opacity: 0.66, duration: 0.3, immediateRender: false }, it.at);
        }
        state.active = it.dom;

        const glow = el.querySelector(".msg__glow");
        if (glow && e >= 0.7) {
          tl.fromTo(glow, { opacity: 0 }, { opacity: 0.35 + e * 0.6, duration: 0.25, ease: "power2.out", immediateRender: false }, it.at + 0.05)
            .to(glow, { opacity: e >= 0.9 ? 0.55 : 0.18, duration: 0.8, ease: "power2.inOut" }, it.at + 0.4);
        }

        const words = $$(".w", bubble);
        words.forEach((w, i) => {
          const wt = it.words[i];
          if (!wt) return;
          const emoji = w.classList.contains("w--emoji");
          tl.fromTo(w, emoji ? { opacity: 0, scale: 0.2, rotation: -25 } : { opacity: 0, y: 18 },
            emoji ? { opacity: 1, scale: 1, rotation: 0, duration: 0.4, ease: "back.out(3)", immediateRender: false }
                  : { opacity: 1, y: 0, duration: 0.16, ease: "power2.out", immediateRender: false },
            Math.max(it.at + 0.04, wt.start));
        });

        const ring = el.querySelector(".msg__ring");
        const talk = Math.max(0.3, it.speechEnd - it.voiceStart);
        const reps = Math.max(0, Math.floor(talk / 0.5) - 1);
        tl.fromTo(ring, { scale: 1, opacity: 0.9 }, { scale: 1.45, opacity: 0, duration: 0.5, ease: "power1.out", repeat: reps, immediateRender: false }, it.voiceStart);
      },
      thread(tl, items) {
        items.forEach((it) => rt.message(tl, it));
      },
    };

    // --- setup: medidas (una sola vez) ------------------------------------
    const viewport = $("#thread-viewport");
    const vh = viewport.clientHeight - parseFloat(getComputedStyle(viewport).paddingTop) - parseFloat(getComputedStyle(viewport).paddingBottom);
    const scrollOf = {};
    $$(".msg", $("#thread")).forEach((m) => {
      const bottom = m.offsetTop + m.offsetHeight;
      scrollOf[m.id] = Math.max(0, bottom - vh);
    });
    PLAN.scenes.forEach((s) => (s.data.items || []).forEach((it) => (it.scrollY = scrollOf[it.dom] || 0)));

    // --- fondo vivo: partículas y luces (finitas, deterministas) ----------
    const D = PLAN.duration;
    $$(".particle").forEach((p, i) => {
      const dur = 6 + rand() * 6;
      tl.fromTo(p, { y: 0, opacity: 0 }, { y: -(220 + rand() * 380), opacity: 0.25 + rand() * 0.55, duration: dur / 2, ease: "sine.inOut", yoyo: true, repeat: Math.max(0, Math.floor(D / (dur / 2)) - 1) }, rand() * 2);
    });
    $$(".glow").forEach((g, i) => {
      tl.fromTo(g, { x: 0, y: 0, scale: 1 }, { x: (i % 2 ? -1 : 1) * 140, y: (i % 3 ? 1 : -1) * 160, scale: 1.25, duration: D / 2, ease: "sine.inOut", yoyo: true, repeat: 1 }, 0);
    });

    // --- escenas en orden ---------------------------------------------------
    PLAN.scenes.forEach((s) => ANIM[s.type](tl, s, rt));

    window.__timelines["main"] = tl;
  }

  document.fonts.ready.then(build);
})();
