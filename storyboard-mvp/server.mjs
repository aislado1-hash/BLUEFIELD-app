// Servidor local de la MVP: API JSON + archivos estáticos. Sin dependencias externas.
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

async function ctx() {
  const s = await store.getSettings();
  return { s, mock: s.mock || !s.apiKey };
}

// ---------- generación ----------
async function referenceImages(p, { scene, continuity }) {
  const refs = [];
  if (p.character.sheetImage) refs.push({ label: P.REF_LABELS.sheet, ...(await store.loadMedia(p.id, p.character.sheetImage)) });
  for (const img of p.truck.images.slice(0, 2)) refs.push({ label: P.REF_LABELS.truck, ...(await store.loadMedia(p.id, img)) });
  if (continuity && scene) {
    const idx = p.scenes.findIndex((s) => s.id === scene.id);
    const prev = p.scenes.slice(0, idx).reverse().find((s) => s.image);
    if (prev) refs.push({ label: P.REF_LABELS.prev, ...(await store.loadMedia(p.id, prev.image)) });
  }
  // los SVG del modo demo no sirven de referencia para el modelo
  return refs.filter((r) => r.mimeType !== 'image/svg+xml');
}

async function genImage(p, prompt, refs, mockTitle, mockText) {
  const { s, mock } = await ctx();
  if (mock) return mockImage(mockTitle, mockText, p.format.aspectRatio);
  return gemini.generateImage(s.apiKey, s.models.image, prompt, refs, p.format.aspectRatio);
}

async function generateCharacterSheet(id) {
  const p = await store.getProject(id);
  if (!p.character.description && !p.character.outfit) throw httpError(400, 'Describe primero a tu camionera (aspecto y ropa).');
  const img = await genImage({ ...p, format: { ...p.format, aspectRatio: '16:9' } }, P.characterSheetPrompt(p), [],
    `Hoja de estilo: ${p.character.name || 'camionera'}`, `${p.character.description} ${p.character.outfit}`);
  const rel = await store.saveMedia(id, 'sheet', img.buffer, img.mimeType);
  return update(id, (q) => { q.character.sheetImage = rel; });
}

async function generateTruckImage(id) {
  const p = await store.getProject(id);
  if (!p.truck.description) throw httpError(400, 'Describe primero cómo es el camión por dentro.');
  const img = await genImage({ ...p, format: { ...p.format, aspectRatio: '16:9' } }, P.truckInteriorPrompt(p), [],
    'Interior del camión', p.truck.description);
  const rel = await store.saveMedia(id, 'truck', img.buffer, img.mimeType);
  return update(id, (q) => { q.truck.images.push(rel); });
}

async function generateStoryboard(id) {
  const p = await store.getProject(id);
  const count = Math.max(1, Math.min(12, Number(p.routine.sceneCount) || 6));
  p.routine.sceneCount = count;
  const { s, mock } = await ctx();
  const scenes = mock
    ? mockStoryboard(count)
    : (await gemini.generateJson(s.apiKey, s.models.text, P.storyboardPrompt(p), P.STORYBOARD_SCHEMA)).scenes;
  return update(id, (q) => { q.scenes = scenes.slice(0, count).map((sc) => store.newScene(sc)); q.finalVideo = null; });
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
  const img = await genImage(p, prompt, refs, `${scene.time} · ${scene.title}`, scene.action);
  const rel = await store.saveMedia(id, `scene-${sceneId}`, img.buffer, img.mimeType);
  return update(id, (q) => {
    const sc = store.findScene(q, sceneId);
    sc.image = rel;
    sc.imageHistory = [rel, ...sc.imageHistory.filter((x) => x !== rel)].slice(0, 8);
    sc.video = null; sc.videoJob = null;
  });
}

async function startSceneVideo(id, sceneId, { durationSeconds = 8 } = {}) {
  const p = await store.getProject(id);
  const scene = store.findScene(p, sceneId);
  if (!scene.image) throw httpError(400, 'Primero genera la imagen de esta escena.');
  const { s, mock } = await ctx();
  let job;
  if (mock || scene.image.endsWith('.svg')) {
    job = { status: 'mock', message: 'Modo demo: vista previa animada sin video real.' };
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
  const { s } = await ctx();
  try {
    const r = await gemini.pollVideo(s.apiKey, job.operation);
    if (!r.done) return p;
    const rel = await store.saveMedia(id, `video-${sceneId}`, r.buffer, 'video/mp4');
    return update(id, (q) => { const sc = store.findScene(q, sceneId); sc.video = rel; sc.videoJob = { status: 'done' }; });
  } catch (e) {
    if (e.status === 401) throw e;
    return update(id, (q) => { const sc = store.findScene(q, sceneId); sc.videoJob = { status: 'error', message: e.message }; });
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
    throw httpError(500, `ffmpeg falló (¿está instalado?): ${String(e.stderr || e.message).slice(-300)}`);
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, HOST, () => console.log(`Storyboard camioneras → http://${HOST}:${PORT}`));
}
export { server };
