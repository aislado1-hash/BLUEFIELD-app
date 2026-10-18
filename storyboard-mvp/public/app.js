// UI de la MVP (vanilla JS). Estado: ajustes + proyecto actual; el servidor es la fuente de verdad.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let settings = null;
let project = null;
const busy = new Set(); // claves "img:<sceneId>", "vid:<sceneId>"

// ---------- api ----------
async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
const P = (suffix = '') => `/api/projects/${project.id}${suffix}`;
const media = (rel) => (rel ? `/media/${project.id}/${rel.split('/').pop()}` : '');

function toast(msg, err = false) {
  const d = document.createElement('div');
  d.textContent = msg;
  if (err) d.className = 'err';
  $('#toast').append(d);
  setTimeout(() => d.remove(), err ? 7000 : 3500);
}

async function run(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { if (btn) btn.disabled = false; }
}

const fileToDataUrl = (f) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(f); });

// ---------- navegación ----------
function show(step) {
  $$('#steps button').forEach((b) => b.classList.toggle('active', b.dataset.step === step));
  $$('section[data-panel]').forEach((s) => s.classList.toggle('active', s.dataset.panel === step));
  try { localStorage.setItem('step', step); } catch {}
  if (step === 'video') renderClips();
}
$('#steps').addEventListener('click', (e) => e.target.dataset.step && show(e.target.dataset.step));

// ---------- conexión ----------
const PROVIDER_NAMES = { browser: 'Navegador (Flow)', api: 'API de Gemini', demo: 'Demo' };

function renderSettings() {
  const b = $('#connBadge');
  const mode = settings.effectiveMock ? 'demo' : settings.provider;
  b.className = 'badge ' + (mode === 'demo' ? 'demo' : 'ok');
  b.textContent = mode === 'api' ? `API ${settings.keyPreview}` : (settings.provider === 'api' ? 'Demo (falta API key)' : PROVIDER_NAMES[mode]);
  $$('#providers input').forEach((r) => { r.checked = r.value === settings.provider; });
  $$('[data-for]').forEach((el) => { el.hidden = el.dataset.for !== settings.provider; });
  $('#apiKey').placeholder = settings.connected ? `Guardada: ${settings.keyPreview}` : 'AIza…';
  $('#mText').value = settings.models.text;
  $('#mImage').value = settings.models.image;
  $('#mVideo').value = settings.models.video;
  pollBrowser();
}

$('#providers').addEventListener('change', (e) => run(null, async () => {
  settings = await api('POST', '/api/settings', { provider: e.target.value });
  renderSettings();
  if (settings.provider === 'api' && settings.connected) testKey();
}));

// ---------- navegador ----------
let browserTimer = null;
function renderBrowser(st) {
  const el = $('#browserStatus');
  if (!st.open) { el.className = 'status'; el.textContent = 'Navegador cerrado. Se abrirá solo al generar, o ábrelo ahora para iniciar sesión.'; }
  else if (st.needsLogin) { el.className = 'status warn'; el.textContent = 'Inicia sesión con tu cuenta de Google en la ventana del navegador.'; }
  else { el.className = 'status ok'; el.textContent = `✔ Navegador abierto en ${st.url || '…'}`; }
  const act = $('#activity');
  act.hidden = !st.current;
  if (st.current) act.textContent = `🌐 ${st.current.label} — ${st.current.step}${st.queued ? ` · ${st.queued} en cola` : ''}`;
}
async function pollBrowser() {
  clearTimeout(browserTimer);
  if (settings.provider !== 'browser') { $('#activity').hidden = true; return; }
  try { renderBrowser(await api('GET', '/api/browser')); } catch {}
  browserTimer = setTimeout(pollBrowser, 2000);
}
$('#browserOpen').onclick = (e) => run(e.target, async () => { renderBrowser(await api('POST', '/api/browser/open')); });
$('#browserClose').onclick = (e) => run(e.target, async () => { renderBrowser(await api('POST', '/api/browser/close')); });

async function testKey() {
  const st = $('#connStatus');
  st.className = 'status'; st.textContent = 'Probando conexión…';
  try {
    const r = await api('POST', '/api/settings/test');
    for (const [k, list] of Object.entries(r.available)) $(`#dl${k[0].toUpperCase()}${k.slice(1)}`).innerHTML = list.map((m) => `<option value="${esc(m)}">`).join('');
    st.className = 'status ok';
    st.textContent = `✔ Conectado. Modelos de imagen: ${r.available.image.length}, de video (Veo): ${r.available.video.length}.`;
    if (!r.available.video.length) { st.className = 'status warn'; st.textContent += ' Tu key no tiene acceso a Veo: activa la facturación en Google AI Studio.'; }
  } catch (e) { st.className = 'status err'; st.textContent = e.message; }
}

$('#saveKey').onclick = (e) => run(e.target, async () => {
  const apiKey = $('#apiKey').value.trim();
  if (!apiKey && !settings.connected) throw new Error('Pega tu API key primero.');
  if (apiKey) settings = await api('POST', '/api/settings', { apiKey });
  $('#apiKey').value = '';
  renderSettings();
  await testKey();
});
$('#clearKey').onclick = (e) => run(e.target, async () => { settings = await api('POST', '/api/settings', { apiKey: '' }); renderSettings(); $('#connStatus').textContent = 'Desconectado.'; });
$('#saveModels').onclick = (e) => run(e.target, async () => {
  settings = await api('POST', '/api/settings', { models: { text: $('#mText').value.trim(), image: $('#mImage').value.trim(), video: $('#mVideo').value.trim() } });
  renderSettings(); toast('Modelos guardados');
});

// ---------- proyectos ----------
async function loadProjects(selectId) {
  let list = await api('GET', '/api/projects');
  if (!list.length) { await api('POST', '/api/projects', { name: 'Mi primera rutina' }); list = await api('GET', '/api/projects'); }
  let saved = null;
  try { saved = localStorage.getItem('project'); } catch {}
  const id = selectId || (list.some((p) => p.id === saved) ? saved : list[0].id);
  $('#projectSelect').innerHTML = list.map((p) => `<option value="${p.id}" ${p.id === id ? 'selected' : ''}>${esc(p.name)} (${p.sceneCount} esc.)</option>`).join('')
    + '<option value="__rename">✎ Renombrar actual…</option><option value="__delete">🗑 Borrar actual…</option>';
  await openProject(id);
}

async function openProject(id) {
  project = await api('GET', `/api/projects/${id}`);
  try { localStorage.setItem('project', id); } catch {}
  renderAll();
}

$('#newProject').onclick = (e) => run(e.target, async () => {
  const name = prompt('Nombre del proyecto', 'Rutina nueva');
  if (name === null) return;
  const p = await api('POST', '/api/projects', { name });
  await loadProjects(p.id);
  show('char');
});
$('#projectSelect').onchange = (e) => run(null, async () => {
  const v = e.target.value;
  if (v === '__rename') {
    const name = prompt('Nuevo nombre', project.name);
    if (name) await api('PATCH', P(), { name });
    return loadProjects(project.id);
  }
  if (v === '__delete') {
    if (confirm(`¿Borrar "${project.name}" y todas sus imágenes y videos?`)) { await api('DELETE', P()); try { localStorage.removeItem('project'); } catch {} return loadProjects(); }
    return loadProjects(project.id);
  }
  await openProject(v);
});

// ---------- campos enlazados (data-bind="seccion.campo") ----------
const saveTimers = {};
function bindFields() {
  for (const el of $$('[data-bind]')) {
    const [sec, key] = el.dataset.bind.split('.');
    el.value = project[sec][key] ?? '';
  }
}
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-bind]');
  if (!el) return;
  const [sec, key] = el.dataset.bind.split('.');
  const value = el.type === 'number' ? Number(el.value) : el.value;
  project[sec][key] = value;
  clearTimeout(saveTimers[el.dataset.bind]);
  saveTimers[el.dataset.bind] = setTimeout(() => api('PATCH', P(), { [sec]: { [key]: value } }).catch((x) => toast(x.message, true)), 500);
  if (sec === 'format') renderScenes();
});
const flushFields = () => Promise.all(Object.entries(saveTimers).map(([bind, t]) => {
  clearTimeout(t); delete saveTimers[bind];
  const [sec, key] = bind.split('.');
  return api('PATCH', P(), { [sec]: { [key]: project[sec][key] } });
}));

// ---------- personaje ----------
function renderCharacter() {
  const img = project.character.sheetImage;
  $('#sheetPreview').innerHTML = img ? `<img src="${media(img)}" alt="Hoja de estilo">` : 'Sin hoja de estilo todavía · arrastra una imagen aquí';
  $('#sheetDel').hidden = !img;
}
$('#sheetFile').onchange = (e) => uploadSheet(e.target.files[0]);
async function uploadSheet(file) {
  if (!file) return;
  await run(null, async () => { project = await api('POST', P('/character/sheet'), { dataUrl: await fileToDataUrl(file) }); renderCharacter(); toast('Hoja de estilo guardada'); });
}
$('#sheetGen').onclick = (e) => run(e.target, async () => {
  await flushFields();
  $('#sheetPreview').classList.add('busy');
  try { project = await api('POST', P('/character/sheet/generate')); renderCharacter(); } finally { $('#sheetPreview').classList.remove('busy'); }
});
$('#sheetDel').onclick = (e) => run(e.target, async () => { project = await api('DELETE', P('/character/sheet')); renderCharacter(); });

const sheetBox = $('#sheetBox');
sheetBox.addEventListener('dragover', (e) => { e.preventDefault(); sheetBox.classList.add('over'); });
sheetBox.addEventListener('dragleave', () => sheetBox.classList.remove('over'));
sheetBox.addEventListener('drop', (e) => { e.preventDefault(); sheetBox.classList.remove('over'); uploadSheet(e.dataTransfer.files[0]); });

// ---------- camión ----------
function renderTruck() {
  $('#truckThumbs').innerHTML = project.truck.images.length
    ? project.truck.images.map((p, i) => `<figure><img src="${media(p)}" alt="Interior ${i + 1}"><button data-rm="${esc(p)}" title="Quitar">×</button>${i < 2 ? '' : '<figcaption class="hint">no se usa (máx. 2)</figcaption>'}</figure>`).join('')
    : '<p class="hint">Sin fotos del interior todavía.</p>';
}
$('#truckFile').onchange = (e) => run(null, async () => {
  for (const f of e.target.files) project = await api('POST', P('/truck/images'), { dataUrl: await fileToDataUrl(f) });
  e.target.value = '';
  renderTruck();
});
$('#truckGen').onclick = (e) => run(e.target, async () => {
  await flushFields();
  $('#truckThumbs').classList.add('busy');
  try { project = await api('POST', P('/truck/images/generate')); renderTruck(); } finally { $('#truckThumbs').classList.remove('busy'); }
});
$('#truckThumbs').onclick = (e) => {
  const path = e.target.dataset.rm;
  if (path) run(null, async () => { project = await api('POST', P('/truck/images/remove'), { path }); renderTruck(); });
};

// ---------- storyboard ----------
const FIELDS = [
  ['title', 'Título'], ['time', 'Hora'], ['location', 'Zona'], ['action', 'Acción', 2], ['camera', 'Cámara'],
  ['imagePrompt', 'Prompt de imagen (EN)', 3], ['motionPrompt', 'Prompt de animación (EN)', 2],
];

function sceneCard(s, i) {
  const frame = s.image ? `<img src="${media(s.image)}" alt="">` : 'Sin imagen';
  const hist = s.imageHistory.length > 1
    ? `<div class="history">${s.imageHistory.map((h) => `<img src="${media(h)}" data-pick="${esc(h)}" class="${h === s.image ? 'cur' : ''}" title="Usar esta versión">`).join('')}</div>` : '';
  const fields = FIELDS.map(([k, label, rows]) => `<label>${label}${rows
    ? `<textarea data-f="${k}" rows="${rows}">${esc(s[k])}</textarea>`
    : `<input data-f="${k}" value="${esc(s[k])}">`}</label>`).join('');
  return `<article class="scene" data-id="${s.id}">
    <div class="frame ${busy.has('img:' + s.id) ? 'busy' : ''}"><span class="num">#${i + 1} · ${esc(s.time)}</span>${frame}</div>
    <div class="body">${hist}${fields}
      <div class="row">
        <button data-act="img">${s.image ? '↻ Regenerar' : '🖼️ Generar'} imagen</button>
        <button data-act="up" class="ghost" title="Subir">↑</button><button data-act="down" class="ghost" title="Bajar">↓</button>
        <button data-act="del" class="ghost danger" title="Borrar">🗑</button>
      </div>
    </div></article>`;
}

function renderScenes() {
  const opt = $(`#projectSelect option[value="${project.id}"]`);
  if (opt) opt.textContent = `${project.name} (${project.scenes.length} esc.)`;
  document.documentElement.style.setProperty('--ar', project.format.aspectRatio.replace(':', '/'));
  $('#scenes').innerHTML = project.scenes.length ? project.scenes.map(sceneCard).join('') : '<p class="hint">Todavía no hay escenas: describe la rutina y pulsa “Crear storyboard”.</p>';
  const missing = [!project.character.sheetImage && 'hoja de estilo de la camionera', !project.truck.images.length && 'fotos del interior del camión'].filter(Boolean);
  $('#refWarn').textContent = missing.length ? `⚠ Falta: ${missing.join(' y ')}. Sin referencias la cara, la ropa y la cabina pueden cambiar entre escenas.` : '';
}

async function genSceneImage(id) {
  busy.add('img:' + id); renderScenes();
  try { project = await api('POST', P(`/scenes/${id}/image`), { continuity: $('#continuity').checked }); }
  catch (e) { toast(e.message, true); }
  finally { busy.delete('img:' + id); renderScenes(); }
}

$('#scenes').addEventListener('change', (e) => {
  const f = e.target.dataset.f;
  if (!f) return;
  const id = e.target.closest('.scene').dataset.id;
  const s = project.scenes.find((x) => x.id === id);
  s[f] = e.target.value;
  api('PATCH', P(`/scenes/${id}`), { [f]: s[f] }).catch((x) => toast(x.message, true));
});
$('#scenes').addEventListener('click', (e) => {
  const card = e.target.closest('.scene');
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.dataset.pick) return run(null, async () => { project = await api('POST', P(`/scenes/${id}/image/select`), { path: e.target.dataset.pick }); renderScenes(); });
  const act = e.target.dataset.act;
  if (act === 'img') genSceneImage(id);
  if (act === 'up' || act === 'down') run(null, async () => { project = await api('POST', P(`/scenes/${id}/move`), { dir: act === 'up' ? -1 : 1 }); renderScenes(); });
  if (act === 'del' && confirm('¿Borrar esta escena?')) run(null, async () => { project = await api('DELETE', P(`/scenes/${id}`)); renderScenes(); });
});

$('#genBoard').onclick = (e) => run(e.target, async () => {
  if (project.scenes.length && !confirm('Esto reemplaza las escenas actuales. ¿Continuar?')) return;
  await flushFields();
  e.target.textContent = 'Escribiendo storyboard…';
  try { project = await api('POST', P('/storyboard')); renderScenes(); toast(`Storyboard listo: ${project.scenes.length} escenas`); }
  finally { e.target.textContent = '✨ Crear storyboard'; }
});
$('#addScene').onclick = (e) => run(e.target, async () => { project = await api('POST', P('/scenes'), {}); renderScenes(); });
$('#genAllImages').onclick = (e) => run(e.target, async () => {
  const pending = project.scenes.filter((s) => !s.image).map((s) => s.id);
  const ids = pending.length ? pending : (confirm('Todas tienen imagen. ¿Regenerarlas todas?') ? project.scenes.map((s) => s.id) : []);
  // en orden: con "continuidad" cada escena usa la anterior como referencia
  for (const id of ids) await genSceneImage(id);
});

// ---------- video ----------
function clipCard(s, i) {
  const job = s.videoJob;
  let frame = s.image ? `<img src="${media(s.image)}" alt="">` : '';
  let state = s.image ? 'Lista para animar' : 'Sin imagen';
  if (s.video) { frame = `<video src="${media(s.video)}" muted loop playsinline controls preload="metadata"></video>`; state = '✔ Video listo'; }
  else if (job?.status === 'mock') { frame = `<img class="kenburns" src="${media(s.image)}" alt="">`; state = 'Vista previa (demo)'; }
  else if (job?.status === 'running') state = `⏳ ${esc(job.message || 'Animando…')} (1-6 min)`;
  else if (job?.status === 'error') state = `✖ ${esc(job.message)}`;
  const isBusy = job?.status === 'running' || busy.has('vid:' + s.id);
  return `<div class="clip" data-id="${s.id}">
    <div class="frame ${isBusy ? 'busy' : ''}">${frame}</div>
    <div class="meta"><b>#${i + 1} ${esc(s.title)}</b><span class="hint">${state}</span>
      <button data-anim ${!s.image || isBusy ? 'disabled' : ''}>${s.video ? '↻ Re-animar' : '🎬 Animar'}</button>
      ${s.video ? `<a class="btn ghost" href="${media(s.video)}" download="escena-${i + 1}.mp4">⬇ Descargar clip</a>` : ''}</div></div>`;
}

function renderClips() {
  $('#clips').innerHTML = project.scenes.length ? project.scenes.map(clipCard).join('') : '<p class="hint">Primero crea el storyboard y las imágenes.</p>';
  $('#finalLink').innerHTML = project.finalVideo ? `🎞️ Video final: <a href="${media(project.finalVideo)}" download>descargar MP4</a>` : '';
  schedulePoll();
}

async function animate(id) {
  busy.add('vid:' + id); renderClips();
  try { project = await api('POST', P(`/scenes/${id}/video`), { durationSeconds: Number($('#duration').value) }); }
  catch (e) { toast(e.message, true); }
  finally { busy.delete('vid:' + id); renderClips(); }
}
$('#clips').addEventListener('click', (e) => { if (e.target.dataset.anim !== undefined) animate(e.target.closest('.clip').dataset.id); });
$('#animAll').onclick = (e) => run(e.target, async () => {
  const ids = project.scenes.filter((s) => s.image && !s.video && s.videoJob?.status !== 'running').map((s) => s.id);
  if (!ids.length) return toast('No hay escenas pendientes de animar');
  await Promise.all(ids.map(animate));
});

let pollTimer = null;
function schedulePoll() {
  clearTimeout(pollTimer);
  const running = project.scenes.filter((s) => s.videoJob?.status === 'running');
  if (!running.length) return;
  pollTimer = setTimeout(async () => {
    for (const s of running) {
      try { project = await api('GET', P(`/scenes/${s.id}/video`)); } catch (e) { toast(e.message, true); }
    }
    renderClips();
  }, 10000);
}

$('#exportBtn').onclick = (e) => run(e.target, async () => {
  e.target.textContent = 'Exportando…';
  try { project = await api('POST', P('/export')); renderClips(); toast('Video final listo'); }
  finally { e.target.textContent = '⬇ Exportar MP4 final'; }
});

$('#playAll').onclick = () => {
  const seq = project.scenes.filter((s) => s.video || s.image);
  if (!seq.length) return toast('No hay nada que reproducir todavía');
  const player = $('#player'), vid = $('#playerVideo'), img = $('#playerImg');
  player.hidden = false;
  let i = 0;
  const next = () => {
    if (i >= seq.length) { $('#playerCap').textContent = '— Fin —'; return; }
    const s = seq[i++];
    $('#playerCap').textContent = `#${i} ${s.time} · ${s.title} — ${s.action}`;
    if (s.video) {
      img.hidden = true; vid.hidden = false; vid.src = media(s.video); vid.onended = next; vid.play();
    } else {
      vid.pause(); vid.hidden = true; img.hidden = false; img.src = media(s.image);
      img.classList.remove('kenburns'); void img.offsetWidth; img.classList.add('kenburns');
      setTimeout(next, Number($('#duration').value) * 1000);
    }
  };
  next();
};

// ---------- arranque ----------
function renderAll() {
  bindFields(); renderCharacter(); renderTruck(); renderScenes();
  if ($('section[data-panel="video"]').classList.contains('active')) renderClips();
}

(async () => {
  settings = await api('GET', '/api/settings');
  renderSettings();
  await loadProjects();
  let step = null;
  try { step = localStorage.getItem('step'); } catch {}
  show(step || 'conn');
  if (settings.provider === 'api' && settings.connected) testKey();
})().catch((e) => toast(e.message, true));
