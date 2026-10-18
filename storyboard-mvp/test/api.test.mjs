// Flujo completo contra el servidor en modo demo + forma de las peticiones a Gemini con fetch simulado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sb-test-'));
process.env.DATA_DIR = dataDir;
process.env.GEMINI_API_KEY = '';
const { server } = await import('../server.mjs');
const gemini = await import('../lib/gemini.mjs');

let base;
before(() => new Promise((ok) => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; ok(); })));
after(async () => { server.close(); await rm(dataDir, { recursive: true, force: true }); });

const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error), { status: r.status });
  return j;
};
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

test('flujo demo: personaje, camión, storyboard, imágenes y animación', async () => {
  assert.equal((await call('GET', '/api/settings')).provider, 'browser', 'el navegador es el modo por defecto');
  const s = await call('POST', '/api/settings', { provider: 'demo' });
  assert.equal(s.effectiveMock, true);

  let p = await call('POST', '/api/projects', { name: 'Test' });
  await assert.rejects(call('POST', `/api/projects/${p.id}/character/sheet/generate`), /Describe/);
  p = await call('PATCH', `/api/projects/${p.id}`, { character: { name: 'Rosy', description: 'pelo trenza', outfit: 'franela roja', sheetImage: 'x' }, routine: { sceneCount: 4 } });
  assert.equal(p.character.sheetImage, null, 'sheetImage no es editable por PATCH');

  p = await call('POST', `/api/projects/${p.id}/character/sheet`, { dataUrl: PNG });
  assert.match(p.character.sheetImage, /^media\/sheet-.*\.png$/);
  p = await call('POST', `/api/projects/${p.id}/truck/images`, { dataUrl: PNG });
  assert.equal(p.truck.images.length, 1);

  p = await call('POST', `/api/projects/${p.id}/storyboard`);
  assert.equal(p.scenes.length, 4);

  // generaciones en paralelo no deben pisarse entre sí
  const results = await Promise.all(p.scenes.map((sc) => call('POST', `/api/projects/${p.id}/scenes/${sc.id}/image`, {})));
  p = await call('GET', `/api/projects/${p.id}`);
  assert.ok(p.scenes.every((sc) => sc.image), JSON.stringify(results.at(-1).scenes.map((x) => x.image)));

  const img = await fetch(`${base}/media/${p.id}/${p.scenes[0].image.split('/')[1]}`);
  assert.equal(img.headers.get('content-type'), 'image/svg+xml');

  p = await call('POST', `/api/projects/${p.id}/scenes/${p.scenes[0].id}/video`, { durationSeconds: 8 });
  assert.equal(p.scenes[0].videoJob.status, 'mock');

  const first = p.scenes[0].id;
  p = await call('POST', `/api/projects/${p.id}/scenes/${first}/move`, { dir: 1 });
  assert.equal(p.scenes[1].id, first);
  p = await call('DELETE', `/api/projects/${p.id}/scenes/${first}`);
  assert.equal(p.scenes.length, 3);

  const list = await call('GET', '/api/projects');
  assert.equal(list[0].sceneCount, 3);
  await assert.rejects(call('GET', '/api/projects/..%2F..'), (e) => e.status === 404 || e.status === 400);
});

test('peticiones a Gemini: imagen con referencias y Veo imagen→video', async () => {
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, opts = {}) => {
    sent.push({ url: String(url), body: opts.body && JSON.parse(opts.body), headers: opts.headers });
    const json = (o) => new Response(JSON.stringify(o), { status: 200 });
    if (String(url).includes(':generateContent')) return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }] });
    if (String(url).includes(':predictLongRunning')) return json({ name: 'models/veo/operations/op1' });
    if (String(url).endsWith('/operations/op1')) return json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://files.example/v.mp4' } }] } } });
    if (String(url) === 'https://files.example/v.mp4') return new Response(Buffer.from('mp4data'));
    throw new Error('url inesperada ' + url);
  };
  try {
    const img = await gemini.generateImage('KEY', 'gemini-2.5-flash-image', 'prompt', [{ label: 'SHEET', mimeType: 'image/png', data: 'BBBB' }], '9:16');
    assert.equal(img.mimeType, 'image/png');
    const b = sent[0].body;
    assert.equal(sent[0].headers['x-goog-api-key'], 'KEY');
    assert.deepEqual(b.contents[0].parts.map((x) => Object.keys(x)[0]), ['text', 'inline_data', 'text']);
    assert.equal(b.generationConfig.imageConfig.aspectRatio, '9:16');

    const op = await gemini.startVideo('KEY', 'veo-3.1-generate-preview', { prompt: 'move', image: { mimeType: 'image/png', data: 'CCCC' }, aspectRatio: '9:16', durationSeconds: 8 });
    assert.equal(op, 'models/veo/operations/op1');
    assert.equal(sent[1].body.instances[0].image.bytesBase64Encoded, 'CCCC');
    assert.equal(sent[1].body.parameters.durationSeconds, 8);
    const v = await gemini.pollVideo('KEY', op);
    assert.equal(v.buffer.toString(), 'mp4data');
  } finally { globalThis.fetch = realFetch; }
});

test('animar varias escenas en paralelo no rompe la lectura del proyecto', async () => {
  let p = await call('POST', '/api/projects', { name: 'Paralelo' });
  p = await call('PATCH', `/api/projects/${p.id}`, { routine: { sceneCount: 6 } });
  p = await call('POST', `/api/projects/${p.id}/storyboard`);
  for (const sc of p.scenes) await call('POST', `/api/projects/${p.id}/scenes/${sc.id}/image`, {});
  await Promise.all(p.scenes.map((sc) => call('POST', `/api/projects/${p.id}/scenes/${sc.id}/video`, {})));
  p = await call('GET', `/api/projects/${p.id}`);
  assert.ok(p.scenes.every((sc) => sc.videoJob?.status === 'mock'));
});
