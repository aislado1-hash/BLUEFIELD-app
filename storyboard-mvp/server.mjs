// Servidor local de la MVP: API JSON + archivos estáticos + piloto de navegador.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './lib/store.mjs';
import * as gemini from './lib/gemini.mjs';
import * as P from './lib/prompts.mjs';
import { mockStoryboard, mockImage } from './lib/mock.mjs';
import { BrowserDriver } from './lib/browser.mjs';

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_BODY = 40 * 1024 * 1024;
const { httpError } = store;

// ---------- un candado por proyecto: lectura fresca + cambio + guardado ----------
const locks = new Map();
function update(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const next = prev.then(async () => {
    const p = await store.getProject(id);
    const r = await fn(p);
    await store.saveProject(p);
    return r === undefined ? p : r;
  });
  locks.set(id, next.catch(() => {}));
  return next;
}

const browser = new BrowserDriver({
  profileDir: path.join(store.DATA_DIR, 'chrome-profile'),
  selectorsFile: path.join(store.DATA_DIR, 'selectors.json'),
});

async function ctx() {
  const s = await store.getSettings();
  return { s, mode: store.isMock(s) ? 'demo' : s.provider };
}

// ---------- generación ----------
async function referenceImages(p, { scene, continuity }) {
  const refs = [];
  const add = async (label, rel) => refs.push({ label, file: path.join(store.mediaDir(p.id), path.basename(rel)), ...(await store.loadMedia(p.id, rel)) });
  if (p.character.sheetImage) await add(P.REF_LABELS.sheet, p.character.sheetImage);
  for (const img of p.truck.images.slice(0, 2)) await add(P.REF_LABELS.truck, img);
  if (continuity && scene) {
    const idx = p.scenes.findIndex((s) => s.id === scene.id);
    const prev = p.scenes.slice(0, idx).reverse().find((s) => s.image);
    if (prev) await add(P.REF_LABELS.prev, prev.image);
  }
  // los SVG del modo demo no sirven de referencia para el modelo
  return refs.filter((r) => r.mimeType !== 'image/svg+xml');
}

/** Devuelve una o varias variantes [{mimeType, buffer}] (Flow suele dar varias por prompt). */
async function genImages(p, prompt, refs, label, mockText) {
  const { s, mode } = await ctx();
  if (mode === 'demo') return [mockImage(label, mockText, p.format.aspectRatio)];
  if (mode === 'browser') {
    const fullPrompt = [prompt, P.attachedRefsNote(refs.map((r) => r.label)), `Aspect ratio ${p.format.aspectRatio}.`].filter(Boolean).join('\n');
    const job = browser.enqueue(`Imagen: ${label}`, (step) => browser.flowGenerate({ mode: 'image', prompt: fullPrompt, files: refs.map((r) => r.file) }, step));
    return job.promise;
  }
  return [await gemini.generateImage(s.apiKey, s.models.image, prompt, refs, p.format.aspectRatio)];
}

async function saveAll(id, prefix, images) {
  const rels = [];
  for (const img of images) rels.push(await store.saveMedia(id, prefix, img.buffer, img.mimeType));
  return rels;
}

async function generateCharacterSheet(id) {
  const p = await store.getProject(id);
  if (!p.character.description && !p.character.outfit) throw httpError(400, 'Describe primero a tu camionera (aspecto y ropa).');
  const [first] = await saveAll(id, 'sheet', await genImages({ ...p, format: { ...p.format, aspectRatio: '16:9' } }, P.characterSheetPrompt(p), [],
    `Hoja de estilo: ${p.character.name || 'camionera'}`, `${p.character.description} ${p.character.outfit}`));
  return update(id, (q) => { q.character.sheetImage = first; });
}

async function generateTruckImage(id) {
  const p = await store.getProject(id);
  if (!p.truck.description) throw httpError(400, 'Describe primero cómo es el camión por dentro.');
  const [first] = await saveAll(id, 'truck', await genImages({ ...p, format: { ...p.format, aspectRatio: '16:9' } }, P.truckInteriorPrompt(p), [],
    'Interior del camión', p.truck.description));
  return update(id, (q) => { q.truck.images.push(first); });
}

async function generateStoryboard(id) {
  const p = await store.getProject(id);
  const count = Math.max(1, Math.min(12, Number(p.routine.sceneCount) || 6));
  p.routine.sceneCount = count;
  const { s, mode } = await ctx();
  let scenes;
  if (mode === 'demo') scenes = mockStoryboard(count);
  else if (mode === 'browser') scenes = (await browser.enqueue('Storyboard en Gemini', (step) => browser.geminiStoryboard(P.storyboardChatPrompt(p), step)).promise).scenes;
  else scenes = (await gemini.generateJson(s.apiKey, s.models.text, P.storyboardPrompt(p), P.STORYBOARD_SCHEMA)).scenes;
  const clean = scenes.slice(0, count).map((sc) => Object.fromEntries(Object.entries(sc).map(([k, v]) => [k, String(v ?? '')])));
  return update(id, (q) => { q.scenes = clean.map((sc) => store.newScene(sc)); q.finalVideo = null; });
}

async function generateSceneImage(id, sceneId, { continuity = true } = {}) {
  const p = await store.getProject(id);
  const scene = store.findScene(p, sceneId);
  const refs = await referenceImages(p, { scene, continuity });
  const prompt = P.sceneImagePrompt(p, scene, {
    hasSheet: refs.some((r) => r.label === P.REF_LABELS.sheet),
    truckRefs: refs.filter((r) => r.label === P.REF_LABELS.truck).length,
    hasPrev: refs.some((r) => r.label === P.REF_LABELS.prev),
  });
  const rels = await saveAll(id, `scene-${sceneId}`, await genImages(p, prompt, refs, `${scene.time} · ${scene.title}`, scene.action));
  return update(id, (q) => {
    const sc = store.findScene(q, sceneId);
    sc.image = rels[0];
    sc.imageHistory = [...rels, ...sc.imageHistory.filter((x) => !rels.includes(x))].slice(0, 12);
    sc.video = null; sc.videoJob = null;
  });
}

async function startSceneVideo(id, sceneId, { durationSeconds = 8 } = {}) {
  const p = await store.getProject(id);
  const scene = store.findScene(p, sceneId);
  if (!scene.image) throw httpError(400, 'Primero genera la imagen de esta escena.');
  const { s, mode } = await ctx();
  let job;
  if (mode === 'demo' || scene.image.endsWith('.svg')) {
    job = { status: 'mock', message: 'Modo demo: vista previa animada sin video real.' };
  } else if (mode === 'browser') {
    const file = path.join(store.mediaDir(id), path.basename(scene.image));
    const b = browser.enqueue(`Video: ${scene.title}`, (step) => browser.flowGenerate({ mode: 'video', prompt: P.sceneMotionPrompt(p, scene), files: [file] }, step));
    b.promise.catch(() => {}); // el error se consulta por polling
    job = { status: 'running', browserJob: b.id, message: b.step, startedAt: new Date().toISOString() };
  } else {
    const image = await store.loadMedia(id, scene.image);
    const operation = await gemini.startVideo(s.apiKey, s.models.video, {
      prompt: P.sceneMotionPrompt(p, scene), image, aspectRatio: p.format.aspectRatio, durationSeconds,
    });
    job = { status: 'running', operation, startedAt: new Date().toISOString() };
  }
  return update(id, (q) => { const sc = store.findScene(q, sceneId); sc.videoJob = job; sc.video = null; });
}

async function pollSceneVideo(id, sceneId) {
  const p = await store.getProject(id);
  const scene = store.findScene(p, sceneId);
  const job = scene.videoJob;
  if (!job || job.status !== 'running') return p;
  const fail = (message) => update(id, (q) => { const sc = store.findScene(q, sceneId); sc.videoJob = { status: 'error', message }; });
  const finish = async (buffers) => {
    const rels = [];
    for (const b of buffers) rels.push(await store.saveMedia(id, `video-${sceneId}`, b, 'video/mp4'));
    return update(id, (q) => { const sc = store.findScene(q, sceneId); sc.video = rels[0]; sc.videoAlternatives = rels.slice(1); sc.videoJob = { status: 'done' }; });
  };

  if (job.browserJob) {
    const b = browser.getJob(job.browserJob);
    if (!b) return fail('Se perdió la tarea del navegador (¿se reinició el servidor?). Vuelve a animar.');
    if (b.status === 'error') return fail(b.error);
    if (b.status === 'done') return finish(b.result.map((r) => r.buffer));
    scene.videoJob.message = b.step; // progreso en vivo, sin guardar
    return p;
  }

  const { s } = await ctx();
  try {
    const r = await gemini.pollVideo(s.apiKey, job.operation);
    if (!r.done) return p;
    return finish([r.buffer]);
  } catch (e) {
    if (e.status === 401) throw e;
    return fail(e.message);
  }
}

async function exportFinal(id) {
  const p = await store.getProject(id);
  const clips = p.scenes.filter((s) => s.video).map((s) => path.join(store.mediaDir(id), path.basename(s.video)));
  if (!clips.length) throw httpError(400, 'No hay clips de video todavía.');
  const list = path.join(store.mediaDir(id), 'concat.txt');
  await writeFile(list, clips.map((c) => `file '${c}'`).join('\n'));
  const name = `final-${Date.now()}.mp4`;
  try {
    await promisify(execFile)('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', path.join(store.mediaDir(id), name)]);
  } catch (e) {
    if (e.code === 'ENOENT') throw httpError(500, 'Para unir los clips en un solo video hace falta el programa gratuito ffmpeg (ver LEEME). Mientras tanto, descarga cada clip con su botón ⬇.');
    throw httpError(500, `No se pudieron unir los clips: ${String(e.stderr || e.message).slice(-300)}`);
  }
  return update(id, (q) => { q.finalVideo = `media/${name}`; });
}

// ---------- rutas ----------
const EDITABLE = {
  format: ['aspectRatio', 'style'],
  character: ['name', 'description', 'outfit'],
  truck: ['description'],
  routine: ['brief', 'sceneCount'],
};
const SCENE_FIELDS = ['title', 'time', 'location', 'action', 'camera', 'imagePrompt', 'motionPrompt'];
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] !== undefined).map((k) => [k, obj[k]]));

const routes = [
  ['GET', /^\/api\/settings$/, async () => store.publicSettings(await store.getSettings())],
  ['POST', /^\/api\/settings$/, async (_, b) => store.publicSettings(await store.saveSettings(b))],
  ['POST', /^\/api\/settings\/test$/, async () => {
    const s = await store.getSettings();
    if (!s.apiKey) throw httpError(400, 'No hay API key guardada.');
    return { ok: true, available: await gemini.testConnection(s.apiKey) };
  }],

  ['GET', /^\/api\/browser$/, () => browser.status()],
  ['POST', /^\/api\/browser\/open$/, async () => { await browser.open(); return browser.status(); }],
  ['POST', /^\/api\/browser\/close$/, async () => { await browser.close(); return browser.status(); }],

  ['GET', /^\/api\/browser$/, () => browser.status()],
  ['POST', /^\/api\/browser\/open$/, async () => { await browser.open(); return browser.status(); }],
  ['POST', /^\/api\/browser\/close$/, async () => { await browser.close(); return browser.status(); }],

  ['GET', /^\/api\/projects$/, () => store.listProjects()],
  ['POST', /^\/api\/projects$/, (_, b) => store.saveProject(store.newProject(b.name))],
  ['GET', /^\/api\/projects\/([\w-]+)$/, ([id]) => store.getProject(id)],
  ['DELETE', /^\/api\/projects\/([\w-]+)$/, async ([id]) => { await store.deleteProject(id); return { ok: true }; }],
  ['PATCH', /^\/api\/projects\/([\w-]+)$/, ([id], b) => update(id, (p) => {
    if (typeof b.name === 'string') p.name = b.name;
    for (const [section, keys] of Object.entries(EDITABLE)) if (b[section]) Object.assign(p[section], pick(b[section], keys));
  })],

  ['POST', /^\/api\/projects\/([\w-]+)\/character\/sheet$/, async ([id], b) => {
    const { mimeType, buffer } = store.parseDataUrl(b.dataUrl);
    const rel = await store.saveMedia(id, 'sheet', buffer, mimeType);
    return update(id, (p) => { p.character.sheetImage = rel; });
  }],
  ['POST', /^\/api\/projects\/([\w-]+)\/character\/sheet\/generate$/, ([id]) => generateCharacterSheet(id)],
  ['DELETE', /^\/api\/projects\/([\w-]+)\/character\/sheet$/, ([id]) => update(id, (p) => { p.character.sheetImage = null; })],

  ['POST', /^\/api\/projects\/([\w-]+)\/truck\/images$/, async ([id], b) => {
    const { mimeType, buffer } = store.parseDataUrl(b.dataUrl);
    const rel = await store.saveMedia(id, 'truck', buffer, mimeType);
    return update(id, (p) => { p.truck.images.push(rel); });
  }],
  ['POST', /^\/api\/projects\/([\w-]+)\/truck\/images\/generate$/, ([id]) => generateTruckImage(id)],
  ['POST', /^\/api\/projects\/([\w-]+)\/truck\/images\/remove$/, ([id], b) => update(id, (p) => { p.truck.images = p.truck.images.filter((x) => x !== b.path); })],

  ['POST', /^\/api\/projects\/([\w-]+)\/storyboard$/, ([id]) => generateStoryboard(id)],
  ['POST', /^\/api\/projects\/([\w-]+)\/scenes$/, ([id], b) => update(id, (p) => {
    p.scenes.push(store.newScene({ title: 'Nueva escena', ...pick(b, SCENE_FIELDS) }));
  })],
  ['PATCH', /^\/api\/projects\/([\w-]+)\/scenes\/([\w-]+)$/, ([id, sid], b) => update(id, (p) => {
    Object.assign(store.findScene(p, sid), pick(b, SCENE_FIELDS));
  })],
  ['DELETE', /^\/api\/projects\/([\w-]+)\/scenes\/([\w-]+)$/, ([id, sid]) => update(id, (p) => {
    p.scenes = p.scenes.filter((s) => s.id !== sid);
  })],
  ['POST', /^\/api\/projects\/([\w-]+)\/scenes\/([\w-]+)\/move$/, ([id, sid], b) => update(id, (p) => {
    const i = p.scenes.findIndex((s) => s.id === sid);
    const j = i + (b.dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= p.scenes.length) return;
    [p.scenes[i], p.scenes[j]] = [p.scenes[j], p.scenes[i]];
  })],
  ['POST', /^\/api\/projects\/([\w-]+)\/scenes\/([\w-]+)\/image$/, ([id, sid], b) => generateSceneImage(id, sid, b)],
  ['POST', /^\/api\/projects\/([\w-]+)\/scenes\/([\w-]+)\/image\/select$/, ([id, sid], b) => update(id, (p) => {
    const sc = store.findScene(p, sid);
    if (!sc.imageHistory.includes(b.path)) throw httpError(400, 'imagen no encontrada en el historial');
    sc.image = b.path; sc.video = null; sc.videoJob = null;
  })],
  ['POST', /^\/api\/projects\/([\w-]+)\/scenes\/([\w-]+)\/video$/, ([id, sid], b) => startSceneVideo(id, sid, b)],
  ['GET', /^\/api\/projects\/([\w-]+)\/scenes\/([\w-]+)\/video$/, ([id, sid]) => pollSceneVideo(id, sid)],
  ['POST', /^\/api\/projects\/([\w-]+)\/export$/, ([id]) => exportFinal(id)],
];

// ---------- http ----------
const STATIC_MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(httpError(413, 'archivo demasiado grande (máx. 40 MB)')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(httpError(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}

async function serveFile(res, file) {
  if (!existsSync(file)) { res.writeHead(404).end('not found'); return; }
  const ext = file.split('.').pop();
  res.writeHead(200, { 'content-type': STATIC_MIME[ext] || 'application/octet-stream' });
  res.end(await readFile(file));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!route) throw httpError(404, 'ruta no encontrada');
      const params = route[1].exec(url.pathname).slice(1);
      const body = req.method === 'GET' ? {} : await readBody(req);
      const out = await route[2](params, body);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      return;
    }
    const media = /^\/media\/([\w-]+)\/([\w.-]+)$/.exec(url.pathname);
    if (media) return serveFile(res, path.join(store.mediaDir(media[1]), path.basename(media[2])));
    const rel = url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([/\\]|\.\.)+/, '');
    return serveFile(res, path.join(PUBLIC_DIR, rel));
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.message }));
  }
});

// las generaciones en el navegador pueden tardar minutos (y hacer cola)
server.requestTimeout = 0;

function openInBrowser(url) {
  if (process.env.NO_OPEN === '1') return;
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(cmd, args, () => {});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = `http://${HOST}:${PORT}`;
  server.on('error', (e) => {
    if (e.code !== 'EADDRINUSE') throw e;
    // ya estaba abierta (p. ej. doble clic dos veces): solo se muestra la página
    console.log(`La app ya estaba abierta. Abriendo ${url}`);
    openInBrowser(url);
    setTimeout(() => process.exit(0), 1000);
  });
  server.listen(PORT, HOST, () => {
    console.log(`\n  Storyboard Camioneras está funcionando en ${url}`);
    console.log('  NO CIERRES ESTA VENTANA mientras uses la app (al cerrarla, la app se apaga).\n');
    openInBrowser(url);
  });
}
export { server, browser };
