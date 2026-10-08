#!/usr/bin/env node
// Motor de composición: ficha JSON + timing de voces -> proyecto HyperFrames.
//
//   node build/engine.mjs short_001
//
// Lee  specs/<id>.json y audio/<id>/voices.json
// Crea build/dist/<id>/index.html  (composición HyperFrames: HTML + CSS + 1 timeline GSAP)
//      build/dist/<id>/cues.json   (plan de audio para build/audio.py: secciones, SFX, voces)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCENES, CONVERSATION_TYPES } from "./scenes/index.mjs";
import { esc, r3 } from "./lib/html.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Contexto que reciben las escenas: cursor de tiempo + registro de voces, SFX y capas. */
function makeContext(spec, voices, gapScale) {
  const lines = Object.fromEntries(spec.lines.map((l) => [l.id, l]));
  const ctx = {
    spec,
    cursor: 0,
    gapSum: 0,
    voiceClips: [],
    sfx: [],
    layers: [],
    thread: [],
    status: [],
    threadEnd: null,
    line(id) {
      if (!lines[id]) throw new Error(`Línea desconocida: ${id}`);
      return lines[id];
    },
    char(name) {
      const c = spec.characters[name];
      if (!c) throw new Error(`Personaje desconocido: ${name}`);
      return c;
    },
    rng: (seed) => mulberry32(seed),
    /** Pausa por defecto antes de una línea: algo mayor cuanto más energía (drama). */
    gap(line) {
      const g = (0.12 + 0.14 * (line.energy ?? 0.3)) * gapScale;
      ctx.gapSum += g;
      return g;
    },
    firstConversationLine() {
      const s = spec.scenes.find((sc) => CONVERSATION_TYPES.has(sc.type));
      return s.lines[0];
    },
    addVoice(id, t) {
      const v = voices.lines[id];
      if (!v) throw new Error(`Falta audio de voz para ${id} (ejecuta build/voices.py)`);
      ctx.voiceClips.push({
        id: `vo-${id}`, line: id, character: lines[id].character, hash: v.hash,
        src: `media/vo/${v.hash}.wav`, start: r3(t),
        duration: r3(Math.min(v.duration, v.speechEnd + 0.25)),
        speechStart: r3(t + v.speechStart), speechEnd: r3(t + v.speechEnd),
      });
      return { speechEnd: t + v.speechEnd, words: v.words.map((w) => ({ start: r3(t + w.start), end: r3(t + w.end) })) };
    },
    addSfx(name, t, gain = 0.6) {
      ctx.sfx.push({ name, start: r3(Math.max(0, t)), gain: r3(gain) });
    },
    layer(l) {
      ctx.layers.push(l);
    },
    endThread(t) {
      ctx.threadEnd = t;
    },
  };
  return ctx;
}

function layout(spec, voices, gapScale) {
  const ctx = makeContext(spec, voices, gapScale);
  const scenes = spec.scenes.map((sc, i) => {
    const def = SCENES[sc.type];
    if (!def) throw new Error(`Tipo de escena no implementado: ${sc.type}`);
    const r = def.build(sc, ctx);
    return { index: i, type: sc.type, beat: sc.beat || sc.type, start: r3(r.start), end: r3(r.end), music: r.music, data: r.data };
  });
  return { ctx, scenes, total: ctx.cursor };
}

/** Ajusta las pausas entre mensajes para acercarse a targetDuration (sin tocar las voces). */
function fitToTarget(spec, voices) {
  const target = spec.targetDuration;
  let res = layout(spec, voices, 1);
  if (!target) return { ...res, gapScale: 1 };
  const diff = res.total - target;
  if (Math.abs(diff) < 0.5 || res.ctx.gapSum === 0) return { ...res, gapScale: 1 };
  const scale = Math.min(2.2, Math.max(0.35, (res.ctx.gapSum - diff) / res.ctx.gapSum));
  return { ...layout(spec, voices, scale), gapScale: scale };
}

// Duración (s) de cada SFX de la librería (build/lib/synth.py / assets/sfx).
const SFX_LEN = { tick: 0.05, pop: 0.12, beep: 0.18, whoosh: 0.55, boom: 1.6, riser: 1.2, chime: 1.3, sparkle: 0.8, glitch: 0.32, buzz: 0.5 };

/** Reparte clips en pistas sin solapes (greedy por inicio). */
function packTracks(clips, base) {
  const ends = [];
  for (const c of [...clips].sort((a, b) => a.start - b.start)) {
    let k = ends.findIndex((e) => e <= c.start);
    if (k < 0) { k = ends.length; ends.push(0); }
    ends[k] = c.start + c.duration;
    c.track = base + k;
  }
  return clips;
}

/** Envolvente de ducking de la música: baja bajo cada voz, sube en los huecos. */
function duckLane(voiceClips, duration, base, duck) {
  const wins = [];
  for (const v of [...voiceClips].sort((a, b) => a.start - b.start)) {
    const s = v.speechStart - 0.08, e = v.speechEnd + 0.3;
    const last = wins[wins.length - 1];
    if (last && s - last[1] < 0.45) last[1] = Math.max(last[1], e);
    else wins.push([s, e]);
  }
  const pts = [{ t: 0, v: base }];
  for (const [s, e] of wins) {
    pts.push({ t: r3(Math.max(0, s - 0.12)), v: base }, { t: r3(Math.max(0, s)), v: duck });
    pts.push({ t: r3(e), v: duck }, { t: r3(Math.min(duration, e + 0.35)), v: base });
  }
  pts.push({ t: r3(Math.max(0, duration - 0.4)), v: pts[pts.length - 1].v }, { t: r3(duration), v: 0 });
  // monotonía estricta en t
  const out = [];
  for (const p of pts) if (!out.length || p.t > out[out.length - 1].t) out.push(p);
  return { version: 1, lanes: [{ target: "volume", points: out }] };
}

function fontFaces() {
  const faces = [["Inter-Medium.otf", 500], ["Inter-Bold.otf", 700], ["Inter-ExtraBold.otf", 800], ["Inter-Black.otf", 900]];
  return faces.map(([f, w]) => `@font-face{font-family:"Inter";src:url("fonts/${f}") format("opentype");font-weight:${w};font-style:normal;}`).join("\n");
}

function main() {
  const id = process.argv[2];
  if (!id) throw new Error("Uso: node build/engine.mjs <short_id>");
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "specs", `${id}.json`), "utf8"));
  const voices = JSON.parse(fs.readFileSync(path.join(ROOT, "audio", id, "voices.json"), "utf8"));
  const fmt = { width: 1080, height: 1920, fps: 60, ...(spec.format || {}) };

  const { ctx, scenes, total, gapScale } = fitToTarget(spec, voices);
  const duration = Math.ceil(total * fmt.fps) / fmt.fps;
  const threadEnd = r3(Math.min(duration, ctx.threadEnd ?? duration));

  // ---- fondo: partículas deterministas
  const rand = mulberry32(1234);
  const particles = Array.from({ length: 34 }, () => {
    const s = 3 + rand() * 7;
    return `<span class="particle" style="left:${(rand() * 1080).toFixed(0)}px;top:${(300 + rand() * 1700).toFixed(0)}px;width:${s.toFixed(1)}px;height:${s.toFixed(1)}px"></span>`;
  }).join("");

  // ---- cabecera del grupo
  const members = (spec.chat?.members || Object.keys(spec.characters).filter((k) => spec.characters[k].role !== "narrator"))
    .map((k) => spec.characters[k]);
  const header = `
    <div id="chat-header">
      <div class="stack">${members.map((c) => `<div class="stack__av" data-layout-allow-occlusion style="--c:${c.color}">${esc(c.initials)}</div>`).join("")}</div>
      <div class="group">
        <div class="group__name">${esc(spec.chat?.groupName || "CHAT")} ${esc(spec.chat?.groupEmoji || "")}</div>
        <div class="group__status"><div class="status" id="st-idle"><i style="background:#22d37a"></i>${members.length} miembros · en línea</div>${ctx.status.join("")}</div>
      </div>
    </div>`;

  const layerHtml = (l, track) =>
    `<section id="${l.id}" class="clip" data-start="${r3(l.start)}" data-duration="${r3(Math.min(l.duration, duration - l.start))}" data-track-index="${track}">${l.html}</section>`;
  const camLayers = ctx.layers.filter((l) => !l.overlay);
  const overlayLayers = ctx.layers.filter((l) => l.overlay);

  // ---- audio
  const music = { volume: 0.55, duckTo: 0.28, ...(spec.audio?.music || {}) };
  const voiceVol = spec.audio?.voiceVolume ?? 1;
  const sfxVol = spec.audio?.sfxVolume ?? 0.7;
  for (const x of ctx.sfx) x.duration = SFX_LEN[x.name] ?? 1;
  packTracks(ctx.voiceClips, 10);
  packTracks(ctx.sfx, 30);
  const audioTags = [
    `<audio id="music-bed" src="media/music.wav" data-start="0" data-duration="${duration}" data-track-index="20" data-audio-group="music" data-volume="1" data-automation='${JSON.stringify(duckLane(ctx.voiceClips, duration, music.volume, music.duckTo))}'></audio>`,
    ...ctx.voiceClips.map((v, i) =>
      `<audio id="${v.id}" src="${v.src}" data-start="${v.start}" data-duration="${v.duration}" data-track-index="${v.track}" data-audio-group="voiceover" data-volume="${voiceVol}"></audio>`),
    ...ctx.sfx.map((s, i) =>
      `<audio id="sfx-${String(i + 1).padStart(2, "0")}-${s.name}" src="media/sfx/${s.name}.wav" data-start="${s.start}" data-duration="${s.duration}" data-track-index="${s.track}" data-audio-group="sfx" data-volume="${r3(s.gain * sfxVol)}"></audio>`),
  ];

  const plan = { id: spec.id, duration, fps: fmt.fps, seed: 7, gapScale: r3(gapScale), scenes };
  const animSrc = Object.entries(SCENES).map(([k, v]) => `  ${JSON.stringify(k)}: (${v.animate.toString()})`).join(",\n");
  const css = fs.readFileSync(path.join(HERE, "lib", "styles.css"), "utf8");
  const runtime = fs.readFileSync(path.join(HERE, "lib", "runtime.js"), "utf8");

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${fmt.width}, height=${fmt.height}" />
<title>${esc(spec.title)}</title>
<script src="vendor/gsap.min.js"></script>
<style>
${fontFaces()}
${css}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="${fmt.width}" data-height="${fmt.height}" data-duration="${duration}" data-fps="${fmt.fps}">
  <div id="bg" class="abs" data-layout-ignore><div class="glow glow--a"></div><div class="glow glow--b"></div><div class="glow glow--c"></div><div id="grid" class="abs"></div>${particles}</div>
  <div id="cam-zoom" class="abs"><div id="cam-punch" class="abs"><div id="cam-shake" class="abs">
    <section id="chat" class="clip" data-start="0" data-duration="${threadEnd}" data-track-index="1">
      <div id="chat-cam" class="abs">
        ${header}
        <div id="chat-panel"><div id="thread-viewport"><div id="thread">${ctx.thread.join("")}
        </div></div></div>
      </div>
    </section>
    ${camLayers.map((l, i) => layerHtml(l, 2 + i)).join("\n    ")}
  </div></div></div>
  <div id="mood-dark" class="fx" data-layout-ignore data-layout-allow-occlusion></div>
  <div id="mood-tension" class="fx" data-layout-ignore data-layout-allow-occlusion></div>
  <div id="mood-gold" class="fx" data-layout-ignore data-layout-allow-occlusion></div>
  ${overlayLayers.map((l, i) => layerHtml(l, 6 + i)).join("\n  ")}
  <div id="fx-glitch" class="fx" data-layout-ignore data-layout-allow-occlusion></div>
  <div id="grain" class="fx" data-layout-ignore data-layout-allow-occlusion></div>
  <div id="fx-flash" class="fx" data-layout-ignore data-layout-allow-occlusion></div>
  ${audioTags.join("\n  ")}
</div>
<script>
window.__SHORT_PLAN = ${JSON.stringify(plan)};
window.__SHORT_SCENES = {
${animSrc}
};
</script>
<script>
${runtime}
</script>
</body>
</html>
`;

  const out = path.join(ROOT, "build", "dist", id);
  fs.mkdirSync(path.join(out, "vendor"), { recursive: true });
  fs.mkdirSync(path.join(out, "fonts"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "assets", "vendor", "gsap.min.js"), path.join(out, "vendor", "gsap.min.js"));
  for (const f of fs.readdirSync(path.join(ROOT, "assets", "fonts"))) {
    fs.copyFileSync(path.join(ROOT, "assets", "fonts", f), path.join(out, "fonts", f));
  }
  fs.writeFileSync(path.join(out, "index.html"), html);
  const cues = {
    id: spec.id, duration, fps: fmt.fps, gapScale: r3(gapScale),
    sections: scenes.map((s) => ({ type: s.type, beat: s.beat, music: s.music, start: s.start, end: s.end })),
    voices: ctx.voiceClips, sfx: ctx.sfx, music: { ...music, src: "media/music.wav" },
  };
  fs.writeFileSync(path.join(out, "cues.json"), JSON.stringify(cues, null, 2));
  console.log(`[engine] ${scenes.length} escenas · ${ctx.voiceClips.length} voces · ${ctx.sfx.length} SFX · ` +
    `duración ${duration.toFixed(2)}s (objetivo ${spec.targetDuration}s, pausas x${gapScale.toFixed(2)}) -> ${path.relative(ROOT, out)}/index.html`);
  for (const s of scenes) console.log(`[engine]   ${s.start.toFixed(2).padStart(6)}–${s.end.toFixed(2).padStart(6)}  ${s.type.padEnd(12)} ${s.beat}`);
}

main();
