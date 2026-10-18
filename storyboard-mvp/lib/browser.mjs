// Piloto de navegador: abre un Chrome real con un perfil propio (inicias sesión en Google una vez),
// y maneja Google Flow (imágenes y video) y Gemini web (guion) como lo harías tú a mano.
//
// La web de Flow cambia a menudo, así que el piloto no depende de una estructura exacta:
// - cada control se busca entre varios candidatos (texto/aria-label en inglés y español), ampliables en
//   data/selectors.json sin tocar código;
// - los resultados se detectan como imágenes/videos NUEVOS en la página y se descargan con tu sesión;
// - si un paso no se puede automatizar, se avisa en la app y se espera a que lo hagas tú en la ventana
//   (modo asistido): en cuanto aparece el resultado, se captura igual.
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const FLOW_URL = process.env.FLOW_URL || 'https://labs.google/fx/tools/flow';
export const GEMINI_URL = process.env.GEMINI_URL || 'https://gemini.google.com/app';

const DEFAULT_SELECTORS = {
  promptBox: ['textarea', '[contenteditable="true"]', '[role="textbox"]'],
  newProject: ['button:has-text("New project")', 'button:has-text("Nuevo proyecto")', 'a:has-text("New project")', 'a:has-text("Nuevo proyecto")'],
  modeMenu: ['[role="combobox"]', 'button:has-text("to Video")', 'button:has-text("a video")', 'button:has-text("Create Image")', 'button:has-text("Crear imagen")'],
  modeOption: {
    image: ['[role="option"]:has-text("Image")', '[role="option"]:has-text("Imagen")', 'li:has-text("Create Image")', 'li:has-text("Crear imagen")'],
    video: ['[role="option"]:has-text("Frames to Video")', '[role="option"]:has-text("Fotogramas")', 'li:has-text("Frames to Video")', 'li:has-text("Fotogramas a video")'],
  },
  attach: ['button[aria-label*="upload" i]', 'button[aria-label*="subir" i]', 'button[aria-label*="add" i]', 'button[aria-label*="añadir" i]', 'button:has-text("add")', 'button:has-text("+")'],
  confirmUpload: ['button:has-text("Crop and Save")', 'button:has-text("Recortar y guardar")', 'button:has-text("Save")', 'button:has-text("Guardar")', 'button:has-text("Done")', 'button:has-text("Listo")'],
  submit: ['button:has-text("arrow_forward")', 'button[aria-label*="create" i]', 'button[aria-label*="crear" i]', 'button[aria-label*="generate" i]', 'button[aria-label*="generar" i]', 'button[aria-label*="send" i]', 'button[aria-label*="enviar" i]'],
  geminiResponse: ['message-content', '.model-response-text', 'model-response'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class BrowserDriver {
  constructor({ profileDir, selectorsFile }) {
    this.profileDir = profileDir;
    this.selectorsFile = selectorsFile;
    this.ctx = null;
    this.pages = {};
    this.queue = Promise.resolve();
    this.jobs = new Map();
    this.current = null;
  }

  // ---------- ciclo de vida ----------
  async selectors() {
    try {
      const extra = JSON.parse(await readFile(this.selectorsFile, 'utf8'));
      const merged = structuredClone(DEFAULT_SELECTORS);
      for (const [k, v] of Object.entries(extra)) {
        if (Array.isArray(v)) merged[k] = [...v, ...(merged[k] || [])];
        else if (v && typeof v === 'object') for (const [m, list] of Object.entries(v)) merged[k][m] = [...list, ...(merged[k]?.[m] || [])];
      }
      return merged;
    } catch { return DEFAULT_SELECTORS; }
  }

  async open() {
    if (this.ctx) return;
    let chromium;
    try { ({ chromium } = await import('playwright-core')); } catch {
      throw Object.assign(new Error('Falta la dependencia playwright-core: ejecuta "npm install" en storyboard-mvp.'), { status: 500 });
    }
    await mkdir(this.profileDir, { recursive: true });
    const opts = {
      headless: process.env.BROWSER_HEADLESS === '1',
      viewport: null,
      acceptDownloads: true,
      // sin la barra de "Chrome está siendo controlado"; Google rechaza el login en navegadores marcados
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
    };
    if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
    else opts.channel = 'chrome';
    try {
      this.ctx = await chromium.launchPersistentContext(this.profileDir, opts);
    } catch (e) {
      const hint = process.env.CHROME_PATH ? `Revisa CHROME_PATH (${process.env.CHROME_PATH}).` : 'Instala Google Chrome o define CHROME_PATH con la ruta del navegador.';
      throw Object.assign(new Error(`No se pudo abrir el navegador. ${hint} (${e.message.split('\n')[0]})`), { status: 500 });
    }
    this.ctx.on('close', () => { this.ctx = null; this.pages = {}; });
    const [first] = this.ctx.pages();
    this.pages.flow = first || await this.ctx.newPage();
    await this.pages.flow.goto(FLOW_URL).catch(() => {});
  }

  async close() {
    const c = this.ctx;
    this.ctx = null; this.pages = {};
    if (c) await c.close().catch(() => {});
  }

  status() {
    const flow = this.pages.flow;
    const url = flow && !flow.isClosed() ? flow.url() : null;
    const queued = [...this.jobs.values()].filter((j) => j.status === 'queued').length;
    return {
      open: Boolean(this.ctx),
      url,
      needsLogin: Boolean(url && /accounts\.google\.com/.test(url)),
      current: this.current && { label: this.current.label, step: this.current.step },
      queued,
    };
  }

  async page(name, url) {
    if (!this.ctx) await this.open();
    let p = this.pages[name];
    if (!p || p.isClosed()) {
      p = this.pages[name] = await this.ctx.newPage();
      await p.goto(url);
    }
    await p.bringToFront();
    return p;
  }

  // ---------- cola: una sola tarea a la vez en el navegador ----------
  enqueue(label, fn) {
    const id = randomUUID().slice(0, 8);
    const job = { id, label, status: 'queued', step: 'En cola', result: null, error: null };
    this.jobs.set(id, job);
    const promise = this.queue.then(async () => {
      job.status = 'running'; this.current = job;
      try {
        job.result = await fn((step) => { job.step = step; });
        job.status = 'done'; job.step = 'Listo';
        return job.result;
      } catch (e) {
        job.status = 'error'; job.error = e.message; job.step = e.message;
        throw e;
      } finally { this.current = null; }
    });
    this.queue = promise.catch(() => {});
    job.promise = promise;
    return job;
  }

  getJob(id) { return this.jobs.get(id); }

  // ---------- utilidades de página ----------
  /** Primer candidato visible (el último en el DOM: en Flow la caja de prompt activa suele ser la última). */
  async find(page, candidates, timeoutMs = 0) {
    const end = Date.now() + timeoutMs;
    do {
      for (const sel of candidates) {
        const loc = page.locator(sel);
        const n = await loc.count().catch(() => 0);
        for (let i = n - 1; i >= 0; i--) {
          const el = loc.nth(i);
          if (await el.isVisible().catch(() => false)) return el;
        }
      }
      if (Date.now() < end) await sleep(500);
    } while (Date.now() < end);
    return null;
  }

  async clickFirst(page, candidates, timeoutMs = 0) {
    const el = await this.find(page, candidates, timeoutMs);
    if (!el) return false;
    await el.click().catch(() => {});
    return true;
  }

  async mediaSrcs(page, kind) {
    return page.evaluate((k) => {
      if (k === 'video') {
        return [...document.querySelectorAll('video')].map((v) => v.currentSrc || v.src || v.querySelector('source')?.src).filter(Boolean);
      }
      // solo imágenes ya cargadas y grandes: descarta avatares, iconos y miniaturas
      return [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth >= 300 && i.naturalHeight >= 300).map((i) => i.currentSrc || i.src);
    }, kind);
  }

  async download(page, src, kind) {
    if (src.startsWith('blob:') || src.startsWith('data:')) {
      const r = await page.evaluate(async (s) => {
        const b = await (await fetch(s)).blob();
        const data = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result.split(',')[1]); fr.readAsDataURL(b); });
        return { type: b.type, data };
      }, src);
      return { mimeType: normalizeMime(r.type, kind), buffer: Buffer.from(r.data, 'base64') };
    }
    const res = await this.ctx.request.get(src);
    if (!res.ok()) throw new Error(`No se pudo descargar el resultado (${res.status()})`);
    return { mimeType: normalizeMime(res.headers()['content-type'], kind), buffer: await res.body() };
  }

  // ---------- Google Flow ----------
  /**
   * Genera en Flow. mode 'image': prompt + imágenes de referencia. mode 'video': prompt + fotograma inicial.
   * Devuelve [{mimeType, buffer}] con todas las variantes que produzca Flow.
   */
  async flowGenerate({ mode, prompt, files = [] }, step = () => {}) {
    const S = await this.selectors();
    const page = await this.page('flow', FLOW_URL);
    const manual = [];

    step('Buscando la caja de prompt en Flow…');
    let box = await this.find(page, S.promptBox, 5000);
    if (!box) {
      if (/accounts\.google\.com/.test(page.url())) step('Inicia sesión con tu cuenta de Google en la ventana del navegador…');
      else if (await this.clickFirst(page, S.newProject, 3000)) step('Creando proyecto nuevo en Flow…');
      else step('Abre (o crea) un proyecto en Flow en la ventana del navegador…');
      box = await this.find(page, S.promptBox, 180000);
      if (!box) throw new Error('No encontré la caja de prompt de Flow. ¿Tienes un proyecto abierto y la sesión iniciada?');
    }

    step(mode === 'video' ? 'Eligiendo "Frames to Video"…' : 'Eligiendo modo imagen…');
    let modeOk = false;
    if (await this.clickFirst(page, S.modeMenu, 1500)) modeOk = await this.clickFirst(page, S.modeOption[mode], 2000);
    if (!modeOk) { await page.keyboard.press('Escape').catch(() => {}); manual.push(mode === 'video' ? 'elige "Frames to Video"' : 'elige el modo de imagen'); }

    if (files.length) {
      step(`Subiendo ${files.length} imagen(es) de referencia…`);
      const uploaded = await this.attachFiles(page, S, files);
      if (!uploaded) manual.push(`sube ${files.map((f) => path.basename(f)).join(', ')} (están en la carpeta data del proyecto)`);
      else await this.clickFirst(page, S.confirmUpload, 4000);
    }

    step('Escribiendo el prompt…');
    box = await this.find(page, S.promptBox, 5000) || box;
    await box.click().catch(() => {});
    await box.fill(prompt).catch(async () => { await page.keyboard.insertText(prompt); });

    const before = new Set(await this.mediaSrcs(page, mode));
    if (manual.length) {
      step(`Modo asistido: en la ventana de Flow ${manual.join(' y ')}, y pulsa Generar. Te espero…`);
    } else {
      step('Enviando a Flow…');
      const sent = await this.clickFirst(page, S.submit, 2000);
      if (!sent) await box.press('Enter').catch(() => {});
    }

    const timeout = mode === 'video' ? 12 * 60_000 : 4 * 60_000;
    const stableMs = mode === 'video' ? 10_000 : 8_000;
    const end = Date.now() + timeout;
    let found = [];
    let lastChange = Date.now();
    const t0 = Date.now();
    while (Date.now() < end) {
      await sleep(2000);
      if (page.isClosed()) throw new Error('Se cerró la pestaña de Flow');
      const now = (await this.mediaSrcs(page, mode)).filter((s) => !before.has(s));
      if (now.length !== found.length) { found = now; lastChange = Date.now(); }
      const secs = Math.round((Date.now() - t0) / 1000);
      if (!manual.length) step(found.length ? `Recibiendo resultados (${found.length})…` : `Flow está generando… ${secs}s`);
      if (found.length && Date.now() - lastChange >= stableMs) break;
    }
    if (!found.length) throw new Error('Flow no devolvió resultados a tiempo. Revisa la ventana del navegador (cola, créditos o aviso de políticas).');

    step(`Descargando ${found.length} resultado(s)…`);
    const out = [];
    for (const src of found) out.push(await this.download(page, src, mode));
    return out;
  }

  async attachFiles(page, S, files) {
    // 1) input[type=file] existente (suele estar oculto)
    const inputs = page.locator('input[type="file"]');
    if (await inputs.count()) {
      const input = inputs.last();
      const multiple = await input.evaluate((el) => el.multiple).catch(() => false);
      try {
        if (multiple || files.length === 1) await input.setInputFiles(files);
        else for (const f of files) { await input.setInputFiles(f); await sleep(1500); }
        return true;
      } catch { /* probar el botón */ }
    }
    // 2) botón que abre el selector de archivos
    for (const sel of S.attach) {
      const btn = await this.find(page, [sel]);
      if (!btn) continue;
      try {
        const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }), btn.click()]);
        await chooser.setFiles(chooser.isMultiple() ? files : files[0]);
        return true;
      } catch { await page.keyboard.press('Escape').catch(() => {}); }
    }
    return false;
  }

  // ---------- Gemini web (guion del storyboard) ----------
  async geminiStoryboard(prompt, step = () => {}) {
    const S = await this.selectors();
    const page = await this.page('gemini', GEMINI_URL);
    await page.goto(GEMINI_URL).catch(() => {});
    step('Abriendo un chat nuevo en Gemini…');
    let box = await this.find(page, S.promptBox, 15000);
    if (!box) {
      step('Inicia sesión en Gemini en la ventana del navegador…');
      box = await this.find(page, S.promptBox, 180000);
      if (!box) throw new Error('No encontré la caja de texto de Gemini. ¿Sesión iniciada?');
    }
    await box.click();
    await box.fill(prompt).catch(async () => { await page.keyboard.insertText(prompt); });
    step('Gemini está escribiendo el storyboard…');
    if (!(await this.clickFirst(page, S.submit, 1500))) await box.press('Enter');

    const end = Date.now() + 4 * 60_000;
    let last = '';
    let stableSince = Date.now();
    while (Date.now() < end) {
      await sleep(2000);
      const text = await this.lastResponseText(page, S);
      if (text !== last) { last = text; stableSince = Date.now(); continue; }
      const parsed = extractScenesJson(text);
      if (parsed && Date.now() - stableSince >= 4000) return parsed;
    }
    throw new Error('Gemini no devolvió un storyboard válido a tiempo. Mira la ventana del navegador y reintenta.');
  }

  async lastResponseText(page, S) {
    for (const sel of S.geminiResponse) {
      const loc = page.locator(sel);
      const n = await loc.count().catch(() => 0);
      if (n) return loc.nth(n - 1).innerText().catch(() => '');
    }
    return page.evaluate(() => document.body.innerText);
  }
}

function normalizeMime(type, kind) {
  const t = String(type || '').split(';')[0].trim().toLowerCase();
  if (['image/png', 'image/jpeg', 'image/webp', 'video/mp4'].includes(t)) return t;
  return kind === 'video' ? 'video/mp4' : 'image/png';
}

/** Busca en el texto el último objeto JSON con un array "scenes" no vacío. */
export function extractScenesJson(text) {
  let idx = text.lastIndexOf('"scenes"');
  while (idx >= 0) {
    const start = text.lastIndexOf('{', idx);
    if (start < 0) break;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1));
          if (Array.isArray(obj.scenes) && obj.scenes.length && obj.scenes.every((s) => s && s.title)) return obj;
        } catch { /* sigue buscando */ }
        break;
      }
    }
    idx = text.lastIndexOf('"scenes"', idx - 1);
  }
  return null;
}
