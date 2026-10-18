// Persistencia en disco: data/settings.json y data/projects/<id>/{project.json, media/*}
import { mkdir, readFile, writeFile, readdir, rm, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export const DEFAULT_MODELS = {
  text: 'gemini-2.5-flash',
  image: 'gemini-2.5-flash-image',
  video: 'veo-3.1-generate-preview',
};

const shortId = () => randomUUID().slice(0, 8);

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  // escritura atómica: un lector concurrente nunca ve el archivo a medias
  const tmp = `${file}.${shortId()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, file);
}

// ---------- ajustes ----------
export async function getSettings() {
  const s = await readJson(SETTINGS_FILE, {});
  return {
    apiKey: s.apiKey || process.env.GEMINI_API_KEY || '',
    mock: s.mock ?? false,
    models: { ...DEFAULT_MODELS, ...(s.models || {}) },
  };
}

export async function saveSettings(patch) {
  const current = await readJson(SETTINGS_FILE, {});
  const next = { ...current };
  if (typeof patch.apiKey === 'string') next.apiKey = patch.apiKey.trim();
  if (typeof patch.mock === 'boolean') next.mock = patch.mock;
  if (patch.models) next.models = { ...(current.models || {}), ...patch.models };
  await writeJson(SETTINGS_FILE, next);
  return getSettings();
}

export function publicSettings(s) {
  const k = s.apiKey;
  return {
    connected: Boolean(k),
    keyPreview: k ? `${k.slice(0, 4)}…${k.slice(-4)}` : null,
    mock: s.mock,
    // sin key, la app funciona en modo demo
    effectiveMock: s.mock || !k,
    models: s.models,
  };
}

// ---------- proyectos ----------
const projectDir = (id) => {
  if (!/^[a-z0-9-]+$/i.test(id)) throw httpError(400, 'id de proyecto inválido');
  return path.join(PROJECTS_DIR, id);
};
export const mediaDir = (id) => path.join(projectDir(id), 'media');

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function newProject(name) {
  return {
    id: shortId(),
    name: name || 'Rutina sin título',
    createdAt: new Date().toISOString(),
    format: { aspectRatio: '9:16', style: 'cinemático realista, luz natural, look de vlog documental' },
    character: { name: '', description: '', outfit: '', sheetImage: null },
    truck: { description: '', images: [] },
    routine: { brief: '', sceneCount: 6 },
    scenes: [],
    finalVideo: null,
  };
}

export function newScene(fields = {}) {
  return {
    id: shortId(),
    title: '', time: '', location: '', action: '',
    imagePrompt: '', motionPrompt: '', camera: '',
    image: null, imageHistory: [],
    video: null, videoJob: null,
    ...fields,
  };
}

export async function listProjects() {
  if (!existsSync(PROJECTS_DIR)) return [];
  const ids = await readdir(PROJECTS_DIR);
  const all = await Promise.all(ids.map((id) => readJson(path.join(PROJECTS_DIR, id, 'project.json'), null)));
  return all.filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ id, name, createdAt, scenes, character }) => ({
      id, name, createdAt, sceneCount: scenes.length, cover: scenes.find((s) => s.image)?.image || character.sheetImage,
    }));
}

export async function getProject(id) {
  const p = await readJson(path.join(projectDir(id), 'project.json'), null);
  if (!p) throw httpError(404, 'proyecto no encontrado');
  return p;
}

export async function saveProject(p) {
  await writeJson(path.join(projectDir(p.id), 'project.json'), p);
  return p;
}

export async function deleteProject(id) {
  await rm(projectDir(id), { recursive: true, force: true });
}

export function findScene(p, sceneId) {
  const s = p.scenes.find((x) => x.id === sceneId);
  if (!s) throw httpError(404, 'escena no encontrada');
  return s;
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'video/mp4': 'mp4' };
export const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));

/** Guarda bytes en media/ y devuelve la ruta relativa al proyecto ("media/<archivo>"). */
export async function saveMedia(projectId, prefix, buffer, mimeType) {
  const ext = EXT[mimeType];
  if (!ext) throw httpError(400, `tipo de archivo no soportado: ${mimeType}`);
  const dir = mediaDir(projectId);
  await mkdir(dir, { recursive: true });
  const name = `${prefix}-${Date.now()}-${shortId()}.${ext}`;
  await writeFile(path.join(dir, name), buffer);
  return `media/${name}`;
}

/** Lee un archivo de media como {mimeType, data(base64)} para mandarlo como referencia. */
export async function loadMedia(projectId, rel) {
  const name = path.basename(rel);
  const ext = name.split('.').pop();
  const buf = await readFile(path.join(mediaDir(projectId), name));
  return { mimeType: MIME[ext], data: buf.toString('base64'), buffer: buf };
}

export function parseDataUrl(dataUrl) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) throw httpError(400, 'imagen inválida (se esperaba data URL base64)');
  return { mimeType: m[1], buffer: Buffer.from(m[2], 'base64') };
}
