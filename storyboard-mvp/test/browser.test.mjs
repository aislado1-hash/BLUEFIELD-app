// Piloto de navegador contra réplicas locales de Flow y Gemini (sin cuenta de Google).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const skip = !existsSync(CHROME) && 'no hay Chromium disponible (define CHROME_PATH)';

const fake = http.createServer(async (req, res) => {
  if (req.url.startsWith('/clip.mp4')) return res.writeHead(200, { 'content-type': 'video/mp4' }).end('FAKEMP4');
  const file = req.url.startsWith('/gemini') ? 'fake-gemini.html' : 'fake-flow.html';
  res.writeHead(200, { 'content-type': 'text/html' }).end(await readFile(path.join(here, 'fixtures', file)));
});
await new Promise((ok) => fake.listen(0, '127.0.0.1', ok));
const fakeBase = `http://127.0.0.1:${fake.address().port}`;

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sb-browser-'));
Object.assign(process.env, { DATA_DIR: dataDir, FLOW_URL: `${fakeBase}/flow`, GEMINI_URL: `${fakeBase}/gemini`, BROWSER_HEADLESS: '1', CHROME_PATH: CHROME });
const { server, browser } = await import('../server.mjs');

let base;
before(() => new Promise((ok) => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; ok(); })));
after(async () => { await browser.close(); server.close(); fake.close(); await rm(dataDir, { recursive: true, force: true }); });

const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
};
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

test('flujo completo con el navegador: storyboard en Gemini, imágenes y video en Flow', { skip, timeout: 120000 }, async () => {
  assert.equal((await call('GET', '/api/settings')).provider, 'browser');
  let p = await call('POST', '/api/projects', { name: 'Navegador' });
  p = await call('PATCH', `/api/projects/${p.id}`, { routine: { sceneCount: 2 }, character: { description: 'trenza', outfit: 'franela' } });
  p = await call('POST', `/api/projects/${p.id}/character/sheet`, { dataUrl: PNG });
  p = await call('POST', `/api/projects/${p.id}/truck/images`, { dataUrl: PNG });

  p = await call('POST', `/api/projects/${p.id}/storyboard`);
  assert.deepEqual(p.scenes.map((s) => s.title), ['Escena 1', 'Escena 2']);

  p = await call('POST', `/api/projects/${p.id}/scenes/${p.scenes[0].id}/image`, { continuity: true });
  const sc = p.scenes[0];
  assert.match(sc.image, /\.png$/);
  assert.equal(sc.imageHistory.length, 2, 'Flow devolvió 2 variantes; el avatar pequeño se ignora');

  const flow = browser.pages.flow;
  let log = await flow.evaluate(() => window.__log);
  assert.equal(log[0].mode, 'Create Image');
  assert.equal(log[0].files.length, 2, 'hoja de estilo + interior del camión');
  assert.match(log[0].prompt, /Attached reference images, in order: 1\) character style sheet/);

  p = await call('POST', `/api/projects/${p.id}/scenes/${sc.id}/video`, {});
  assert.equal(p.scenes[0].videoJob.status, 'running');
  for (let i = 0; i < 60 && p.scenes[0].videoJob?.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    p = await call('GET', `/api/projects/${p.id}/scenes/${sc.id}/video`);
  }
  assert.equal(p.scenes[0].videoJob.status, 'done', JSON.stringify(p.scenes[0].videoJob));
  const mp4 = await fetch(`${base}/media/${p.id}/${p.scenes[0].video.split('/')[1]}`);
  assert.equal(await mp4.text(), 'FAKEMP4');

  log = await flow.evaluate(() => window.__log);
  assert.equal(log[1].mode, 'Frames to Video');
  assert.equal(log[1].files.length, 1);
  assert.equal(log[1].cropped, true);
});

test('extractScenesJson ignora texto alrededor y JSON incompleto', async () => {
  const { extractScenesJson } = await import('../lib/browser.mjs');
  assert.equal(extractScenesJson('{"scenes": [{"title": "a"'), null);
  const r = extractScenesJson('Claro, aquí tienes:\n```json\n{"scenes":[{"title":"x {raro}","time":"5"}]}\n```');
  assert.equal(r.scenes[0].title, 'x {raro}');
});
