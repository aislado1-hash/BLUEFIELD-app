/*
 * Chat Video Maker — núcleo compartido (v36)
 *
 * Este archivo lo usan EXACTAMENTE igual:
 *   - la vista previa del navegador (index.html, vía <script src="/shared/chatcore.js">)
 *   - el render de Remotion (remotion/index.tsx, vía import)
 *
 * Aquí viven: lectura del guion, línea de tiempo, cabecera, reacciones,
 * plantillas de estilo, formato horizontal/vertical y TODOS los estilos.
 * Si cambias un tamaño aquí, cambia a la vez en la vista previa y en el MP4.
 *
 * Las longitudes se devuelven como cadenas con "px" para que sirvan igual
 * en React (Remotion) y en el DOM (vista previa).
 */
(function (root) {
  'use strict';
  const C = {};
  C.VERSION = 'v36';
  C.BLANK_IMG = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
  C.REACT_POP_MS = 260;

  const TITLE_RE = /^t[ií]tulo inicial(?:\s*(\d+))?\s*:/i;
  const EVENT_RE = /^evento\s*:/i;
  const REACT_RE = /\{\s*(?:reacci[oó]n(?:es)?|r)\s*:\s*([^}]*)\}\s*$/i;
  const px = (n) => `${Math.round(Number(n) * 100) / 100}px`;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ───────────────────────── Formato del lienzo ───────────────────────── */

  C.isVertical = (p) => Number(p.videoHeight) > Number(p.videoWidth);
  /** Lienzo virtual: 1920×1080 (horizontal) o 1080×1920 (vertical 9:16). */
  C.canvasSize = (p) => (C.isVertical(p) ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 });

  /** Ajuste automático del formato vertical (Shorts): activado salvo que se apague (p.autoFit === false). */
  C.autoFit = (p) => C.isVertical(p) && p.autoFit !== false;
  C.FIT_MAX = { bubbleSize: 130, size: 140 };   // tope de burbuja (%) y foto (px) en vertical con ajuste automático

  const layoutOf = (p) => C.isVertical(p)
    ? (C.autoFit(p)
      ? { // 9:16 con ajuste automático: columnas de foto más estrechas para que la burbuja tenga más ancho
          safeTop: 90, padX: 20, innerX: 6, bottom: 300, lanes: 'minmax(0,15%) minmax(0,70%) minmax(0,15%)',
          bubbleMax: '100%', textMax: '960px', headerPadX: 30, introPad: 60, nameMax: 150,
        }
      : { // 9:16 — márgenes pensados para la interfaz de TikTok / Reels / Shorts
          safeTop: 90, padX: 24, innerX: 8, bottom: 300, lanes: 'minmax(160px,17%) minmax(0,66%) minmax(160px,17%)',
          bubbleMax: '100%', textMax: '960px', headerPadX: 36, introPad: 60, nameMax: 170,
        })
    : { safeTop: 0, padX: 70, innerX: 20, bottom: 70, lanes: 'minmax(220px,20%) minmax(0,60%) minmax(220px,20%)',
        bubbleMax: '1120px', textMax: '1600px', headerPadX: 70, introPad: 80, nameMax: 220 };

  /* ───────────────────────── Plantillas de estilo ───────────────────────── */

  C.THEMES = {
    clasico: {
      label: 'Clásico', bg: '#11131a', font: 'Arial, sans-serif',
      headerBg: 'linear-gradient(180deg,rgba(10,13,19,.98),rgba(10,13,19,.90))', headerBorder: '1px solid rgba(255,255,255,.08)',
      headerText: '#f3f6fa', headerSub: '#9ca8b8', nameColor: '#ffffff',
      systemText: '#aeb8c7', systemBg: 'transparent', systemPad: '0px', brackets: true,
      left: { color: '#ff5d83', textColor: '#ffffff', strokeColor: '#000000', stroke: 2 },
      right: { color: '#39c96b', textColor: '#ffffff', strokeColor: '#000000', stroke: 2 },
      radius: 28, tail: 28, weight: '700', bubbleShadow: '0 12px 25px rgba(0,0,0,.24)',
      typingBg: '#ffffff22', reactBg: '#262b38', reactText: '#e6e9ef',
    },
    whatsapp: {
      label: 'WhatsApp', bg: '#0b141a', font: '"Segoe UI", Helvetica, Arial, sans-serif',
      headerBg: '#202c33', headerBorder: '1px solid #222d34', headerText: '#e9edef', headerSub: '#8696a0', nameColor: '#e9edef',
      systemText: '#8696a0', systemBg: '#182229', systemPad: '10px 24px', brackets: false,
      left: { color: '#202c33', textColor: '#e9edef', strokeColor: '#000000', stroke: 0 },
      right: { color: '#005c4b', textColor: '#e9edef', strokeColor: '#000000', stroke: 0 },
      radius: 22, tail: 4, weight: '500', bubbleShadow: '0 2px 3px rgba(0,0,0,.3)',
      typingBg: '#202c33', reactBg: '#202c33', reactText: '#e9edef',
    },
    telegram: {
      label: 'Telegram', bg: '#0e1621', font: '"Segoe UI", Roboto, Arial, sans-serif',
      headerBg: '#17212b', headerBorder: '1px solid #101921', headerText: '#ffffff', headerSub: '#6c7883', nameColor: '#ffffff',
      systemText: '#ffffff', systemBg: 'rgba(0,0,0,.35)', systemPad: '8px 22px', brackets: false,
      left: { color: '#182533', textColor: '#ffffff', strokeColor: '#000000', stroke: 0 },
      right: { color: '#2b5278', textColor: '#ffffff', strokeColor: '#000000', stroke: 0 },
      radius: 26, tail: 8, weight: '500', bubbleShadow: '0 1px 2px rgba(0,0,0,.35)',
      typingBg: '#182533', reactBg: '#2b5278', reactText: '#ffffff',
    },
    instagram: {
      label: 'Instagram DM', bg: '#000000', font: 'Helvetica, Arial, sans-serif',
      headerBg: '#000000', headerBorder: '1px solid #262626', headerText: '#f5f5f5', headerSub: '#a8a8a8', nameColor: '#f5f5f5',
      systemText: '#a8a8a8', systemBg: 'transparent', systemPad: '0px', brackets: false,
      left: { color: '#262626', textColor: '#ffffff', strokeColor: '#000000', stroke: 0 },
      right: { color: 'linear-gradient(135deg,#7638fa,#d300c5 60%,#ff0069)', textColor: '#ffffff', strokeColor: '#000000', stroke: 0 },
      radius: 44, tail: 44, weight: '500', bubbleShadow: 'none',
      typingBg: '#262626', reactBg: '#262626', reactText: '#ffffff',
    },
    discord: {
      label: 'Discord', bg: '#313338', font: '"gg sans", "Noto Sans", "Helvetica Neue", Arial, sans-serif',
      headerBg: '#2b2d31', headerBorder: '1px solid #1f2023', headerText: '#f2f3f5', headerSub: '#b5bac1', nameColor: '#f2f3f5',
      systemText: '#949ba4', systemBg: 'transparent', systemPad: '0px', brackets: false,
      left: { color: '#2b2d31', textColor: '#dbdee1', strokeColor: '#000000', stroke: 0 },
      right: { color: '#5865f2', textColor: '#ffffff', strokeColor: '#000000', stroke: 0 },
      radius: 18, tail: 18, weight: '500', bubbleShadow: '0 2px 6px rgba(0,0,0,.25)',
      typingBg: '#2b2d31', reactBg: '#3f4248', reactText: '#dbdee1',
    },
  };
  C.theme = (p) => C.THEMES[(p && p.theme) || 'clasico'] || C.THEMES.clasico;

  /* ───────────────────────── Efectos visuales (opcionales, por proyecto: p.fx) ───────────────────────── */

  C.FX_KEYS = ['text', 'tail', 'bg', 'speaker', 'header', 'details', 'smooth'];
  C.FX_ALL = { text: true, tail: true, bg: true, speaker: true, header: true, details: true, smooth: true, clock: '21:14' };
  C.FX_NONE = { text: false, tail: false, bg: false, speaker: false, header: false, details: false, smooth: false, clock: '21:14' };
  C.fx = (p) => (p && p.fx) || C.FX_NONE;
  C.FX_FONT = 'Nunito, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  C.FX_FONT_URL = 'https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800;900&display=swap';
  /** Tipografía de burbujas, nombres y cabecera: la de la plantilla, o Nunito con «Texto limpio». */
  const fontOf = (p) => (C.fx(p).text ? C.FX_FONT : C.theme(p).font);

  /** Primer color #hex de un valor (los degradados de Instagram también valen). */
  C.solidColor = (col) => {
    const m = String(col || '').match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
    if (!m) return '#888888';
    const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
    return '#' + h.toLowerCase();
  };
  const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mixHex = (a, b, k) => { const A = rgbOf(a), B = rgbOf(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join(''); };
  const rgba = (hex, a) => `rgba(${rgbOf(hex).join(',')},${a})`;

  /** «*palabra*» en un mensaje → trozo resaltado. Devuelve [{t, hi}]. */
  C.richText = (text) => {
    const s = String(text || ''), out = [], re = /\*([^*\n]+)\*/g;
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ t: s.slice(last, m.index), hi: false });
      out.push({ t: m[1], hi: true });
      last = re.lastIndex;
    }
    if (last < s.length) out.push({ t: s.slice(last), hi: false });
    return out;
  };

  /** Hora falsa del mensaje: la «Hora del chat» + 1 minuto cada 20 s de vídeo. */
  C.messageClock = (p, e) => {
    const m = String(C.fx(p).clock || '21:14').match(/^(\d{1,2}):(\d{2})/);
    const base = m ? Number(m[1]) * 60 + Number(m[2]) : 21 * 60 + 14;
    const t = (base + Math.floor((Number(e.visibleStart) || 0) / 20000)) % (24 * 60);
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  };

  /** Estado visual de una fila de mensaje en el fotograma f (quién habla, quién se atenúa, foto agrupada…). */
  C.rowState = (p, f, e, ms) => {
    const fx = C.fx(p);
    const speaking = !!(fx.speaker && f.speakingKey && e.key === f.speakingKey);
    return {
      ms, speaking,
      dim: !!(fx.speaker && f.speakingKey && !speaking),
      compact: !!e.hideAvatar,
      tail: !!(fx.tail && !e.hideAvatar),
      meta: fx.details ? C.messageClock(p, e) : null,
    };
  };

  /** Cabecera enriquecida: fotos del grupo y subtítulo («Ana está escribiendo…» o los nombres). null si está apagada. */
  C.headerExtras = (p, f) => {
    if (!C.fx(p).header) return null;
    const chars = (p.chars || []).filter((c) => c && c.name);
    const typing = f.typing && f.typing.char ? f.typing.char.name : '';
    return {
      avatars: chars.filter((c) => c.image).slice(0, 4).map((c) => c.image),
      subtitle: typing ? `${typing} está escribiendo…` : chars.map((c) => c.name).join(', '),
      typing: !!typing,
    };
  };

  /** Aplica una plantilla: devuelve los cambios para el proyecto y para cada personaje según su lado. */
  C.applyTheme = (themeId, chars) => {
    const t = C.THEMES[themeId] || C.THEMES.clasico;
    (chars || []).forEach((c) => Object.assign(c, t[c.side === 'left' ? 'left' : 'right']));
    return { theme: themeId, bgColor: t.bg };
  };

  /* ───────────────────────── Guion ───────────────────────── */

  C.stripQuotes = (s) => String(s || '').trim().replace(/^["“«]+|["”»]+$/g, '').trim();

  C.findChar = (chars, name) => {
    const n = String(name || '').trim().toLowerCase();
    return (chars || []).find((c) => String(c.name || '').trim().toLowerCase() === n);
  };

  const graphemes = (s) => {
    try { return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment); }
    catch (_) { return Array.from(s); }
  };

  /** "😂3 🔥, 💀x2" → [{emoji:'😂',count:3},{emoji:'🔥',count:1},{emoji:'💀',count:2}] */
  C.parseReactions = (raw) => {
    const out = [];
    for (const tok of String(raw || '').split(/[\s,]+/).filter(Boolean)) {
      const m = tok.match(/^(.*?)(?:[x×]?(\d+))?$/u);
      const emojis = graphemes((m && m[1]) || tok).filter((g) => g.trim());
      const n = m && m[2] ? Math.max(1, parseInt(m[2], 10)) : 1;
      emojis.forEach((e, i) => {
        const prev = out.find((r) => r.emoji === e);
        const add = i === emojis.length - 1 ? n : 1;
        if (prev) prev.count += add; else out.push({ emoji: e, count: add });
      });
    }
    return out.slice(0, 6);
  };

  /**
   * Lee el guion: títulos, mensajes (con reacciones) y eventos "evento:".
   * Títulos: "Titulo inicial:", "Titulo inicial 2:", "Titulo inicial 3:"… Cada uno sale en pantalla
   * completa en el punto del guion donde está escrito. Si se repite "Titulo inicial:" sin número,
   * se numera solo (2, 3…) según el orden.
   * Reacciones: al final del mensaje → "Pepe: Golazo {r: 😂3 🔥}"  o  "{reacciones: 😂 🔥}"
   */
  C.parseScript = (script, chars) => {
    const out = { initialTitle: '', titles: [], messages: [], scriptEvents: [], unknownNames: [] };
    let idx = 0, order = 0;
    for (const raw of String(script || '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      order++;
      const tm = line.match(TITLE_RE);
      if (tm) {
        const text = C.stripQuotes(line.replace(TITLE_RE, ''));
        if (text) out.titles.push({ number: tm[1] ? parseInt(tm[1], 10) : out.titles.length + 1, text, afterMessage: idx, order });
        continue;
      }
      if (EVENT_RE.test(line)) {
        const t = C.stripQuotes(line.replace(EVENT_RE, ''));
        if (t) out.scriptEvents.push({ id: 'script-' + out.scriptEvents.length, type: 'custom', afterMessage: idx, order, text: t, speech: t });
        continue;
      }
      const p = line.indexOf(':');
      if (p < 0) continue;
      const name = line.slice(0, p).trim();
      const c = C.findChar(chars, name);
      if (!c) { if (name && name.length <= 40 && !out.unknownNames.includes(name)) out.unknownNames.push(name); continue; }
      let text = line.slice(p + 1).trim();
      let reactions = [];
      const rm = text.match(REACT_RE);
      if (rm) { reactions = C.parseReactions(rm[1]); text = text.replace(REACT_RE, '').trim(); }
      out.messages.push({ char: c, text, reactions, lineIndex: idx++ });
    }
    out.initialTitle = out.titles.length ? out.titles[0].text : '';
    return out;
  };

  /** Nombre visible de un título: "Título inicial", "Título inicial 2"… */
  C.titleLabel = (t) => (!t || t.number <= 1 ? 'Título inicial' : 'Título inicial ' + t.number);

  /* ───────────────────────── Voces (caché) ───────────────────────── */

  /** Texto que se envía a la voz: sin emojis (el guion visual no cambia). Igual que strip_emojis_for_tts en server.py. */
  C.ttsText = (text) => String(text || '')
    .replace(/\*/g, '')
    .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/[︎️‍⃣\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/\s{2,}/g, ' ').trim();

  /** Voz y velocidad con las que se genera el audio de un personaje. */
  C.messageVoice = (c) => ({ voice: String((c && c.ai33Voice) || '').trim(), speed: Math.max(0.25, Number(c && c.ai33Speed) || 1) });

  /**
   * Identificador de un audio: tipo + texto hablado + voz + velocidad.
   * FNV-1a de 32 bits sobre unidades UTF-16: idéntico a audio_cache_key en server.py.
   */
  C.audioCacheKey = (text, voice, speed, kind) => {
    const raw = JSON.stringify([String(kind || 'message'), C.ttsText(text), String(voice || '').trim(), Number(speed || 1)]);
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(16).padStart(8, '0');
  };

  /** Voz de los títulos: la del primer personaje que tenga voz. */
  C.titleVoice = (chars) => String(((chars || []).find((c) => c && c.ai33Voice) || {}).ai33Voice || '').trim();
  C.titleAudioKey = (text, chars) => C.audioCacheKey(text, C.titleVoice(chars), 1, 'initialTitle');

  /** Audio de un título: se busca por contenido (texto + voz) en titleAudios; el primero admite el formato antiguo. */
  C.titleAudioFor = (p, title, i) => {
    const key = C.titleAudioKey(title.text, p.chars);
    const hit = (Array.isArray(p.titleAudios) ? p.titleAudios : []).find((x) => x && x.cacheKey === key && x.audio && Number(x.duration) > 0);
    if (hit) return { audio: hit.audio, duration: Number(hit.duration) };
    if (i === 0 && p.initialTitleAudio && (p.initialTitleAudioCacheKey ? p.initialTitleAudioCacheKey === key : p.initialTitle === title.text))
      return { audio: p.initialTitleAudio, duration: Number(p.initialTitleDuration) || 0 };
    return null;
  };

  /** Clave del audio que corresponde a un mensaje del guion (según su texto y la voz actual del personaje). */
  C.messageAudioKey = (m) => { const v = C.messageVoice(m.char); return C.audioCacheKey(m.text, v.voice, v.speed, 'message'); };

  /**
   * Busca el audio de cada mensaje por su CONTENIDO (texto + voz + velocidad), no por su posición.
   * Así, insertar, borrar o mover líneas del guion no desplaza las voces. Si un mensaje cambió,
   * se queda sin audio (y se avisa) en vez de sonar con la voz de otro.
   * Audios antiguos sin cacheKey: se usa la posición, como antes.
   */
  C.audioIndex = (dialogueMessages) => {
    const list = Array.isArray(dialogueMessages) ? dialogueMessages : [];
    const byKey = new Map();
    list.forEach((x) => { if (x && x.cacheKey && x.audio && Number(x.duration) > 0) byKey.set(String(x.cacheKey), x); });
    return (m) => {
      const hit = byKey.get(C.messageAudioKey(m));
      if (hit) return hit;
      return list.find((x) => x && !x.cacheKey && x.audio && Number(x.duration) > 0 && Number(x.lineIndex) === m.lineIndex) || null;
    };
  };

  const isScriptId = (e) => String((e && e.id) || '').startsWith('script-');

  /**
   * Une los eventos del guion con los guardados en el proyecto.
   * Cada línea "evento:" aparece UNA sola vez; si el proyecto ya tiene su audio
   * guardado, se reutiliza. Los eventos manuales (formulario) se añaden después.
   */
  C.mergeGroupEvents = (groupEvents, scriptEvents) => {
    const ge = Array.isArray(groupEvents) ? groupEvents : [];
    const stored = new Map();
    ge.filter(isScriptId).forEach((e) => {
      const k = String(e.speech || e.text || '');
      if (!stored.has(k)) stored.set(k, []);
      stored.get(k).push(e);
    });
    const fromScript = (scriptEvents || []).map((ev) => {
      const list = stored.get(ev.speech);
      const old = list && list.length ? list.shift() : null;
      if (!old) return { ...ev, audio: null, audioDuration: 0 };
      return { ...ev, id: old.id || ev.id, voice_id: old.voice_id, speed: old.speed, audio: old.audio || null, audioDuration: Number(old.audioDuration) || 0, audioCacheKey: old.audioCacheKey || '' };
    });
    return [...fromScript, ...ge.filter((e) => !isScriptId(e))];
  };

  C.eventLabel = (ev) => {
    if (ev.type === 'custom') return ev.text || ev.speech || 'Evento';
    const a = (ev.actor || '').trim();
    const v = (ev.value || '').trim();
    if (ev.type === 'leave') return v ? `${v} sacó del grupo a ${a || 'alguien'}` : `${a || 'Alguien'} salió del grupo`;
    if (ev.type === 'add') return `${a || 'Alguien'} añadió a ${v || 'alguien'} al grupo`;
    return `${a || 'Alguien'} cambió el título del grupo a «${v || 'Nuevo grupo'}»`;
  };

  C.eventSpeech = (ev) => {
    if (ev.type === 'custom') return ev.speech || ev.text || 'Evento';
    const a = (ev.actor || '').trim();
    const v = (ev.value || '').trim();
    if (ev.type === 'leave') return v ? `${v} sacó del grupo a ${a || 'alguien'}.` : `${a || 'Alguien'} ha salido del grupo.`;
    if (ev.type === 'add') return `${a || 'Alguien'} añadió a ${v || 'alguien'} al grupo.`;
    return `${a || 'Alguien'} cambió el título del grupo a ${v || 'Nuevo grupo'}.`;
  };

  /** Efecto de un evento sobre la cabecera (también para frases libres del guion). */
  C.eventEffect = (ev) => {
    if (ev.type === 'leave') return { members: -1 };
    if (ev.type === 'add') return { members: +1 };
    if (ev.type === 'title') return { title: (ev.value || '').trim() || null };
    const t = String(ev.text || ev.speech || '').trim();
    const low = t.toLowerCase();
    const m = t.match(/cambi[óo]\s+(?:el\s+)?(?:t[íi]tulo|nombre)\s+del\s+grupo\s+a\s+(.+)$/i);
    if (m) return { title: C.stripQuotes(m[1].replace(/[.!]+$/, '')) || null };
    if (/\bdel grupo\b/.test(low) && /(sac[óo]|ha sacado|elimin[óo]|ha eliminado|expuls[óo]|ha expulsado|sali[óo]|ha salido|abandon[óo]|ha abandonado|se fue|se ha ido)/.test(low)) return { members: -1 };
    if (/\bal grupo\b/.test(low) && /(añadi[óo]|anadi[óo]|ha añadido|agreg[óo]|ha agregado|meti[óo]|ha metido|invit[óo]|se uni[óo]|se ha unido|entr[óo]|ha entrado)/.test(low)) return { members: +1 };
    return {};
  };

  C.systemText = (text, p) => {
    const t = String(text || '').trim();
    if (p && !C.theme(p).brackets) return t;
    return `[ ${t}${/[.!?…]$/.test(t) ? '' : '.'} ]`;
  };

  /* ───────────────────────── Línea de tiempo ───────────────────────── */

  /** Tiempos en milisegundos; audioDuration en segundos. kinds: 'intro' | 'system' | 'message' */
  C.buildEvents = (p) => {
    const parsed = C.parseScript(p.script, p.chars || []);
    const groupEvents = C.mergeGroupEvents(p.groupEvents, parsed.scriptEvents);
    const d = Math.max(0, Number(p.delay) || 0) * 1000;
    const t = Math.max(0, Number(p.typing) || 0) * 1000;
    const v = Math.max(0.1, Number(p.duration) || 0.1) * 1000;
    const popup = Math.max(0, Number(p.popupDelay ?? 0.35)) * 1000;
    const out = [];
    let cursor = 0;

    // Títulos y eventos se colocan en su sitio del guion; en el mismo hueco, por orden de línea
    // (los eventos añadidos a mano, sin línea en el guion, van detrás).
    const byAfter = new Map();
    const place = (afterMessage, item) => {
      const k = clamp(Number(afterMessage) || 0, 0, parsed.messages.length);
      if (!byAfter.has(k)) byAfter.set(k, []);
      byAfter.get(k).push(item);
    };
    parsed.titles.forEach((title, ti) => place(title.afterMessage, { title, ti, order: title.order }));
    groupEvents.forEach((ev, gi) => place(ev.afterMessage, { ev, gi, order: Number(ev.order) || Infinity }));
    byAfter.forEach((list) => list.sort((a, b) => a.order - b.order));

    // Un título ocupa la pantalla mientras suena su audio y 2 s más; después sigue el chat.
    const pushTitle = ({ title, ti }) => {
      const a = C.titleAudioFor(p, title, ti);
      const secs = a ? a.duration : 0;
      const start = cursor;
      const end = start + secs * 1000 + 2000;
      out.push({ kind: 'intro', key: 'intro-' + ti, text: title.text, label: C.titleLabel(title), titleIndex: ti, start, typingStart: start, visibleStart: start, end, audio: a ? a.audio : null, audioDuration: secs });
      cursor = end;
    };

    const pushSystem = ({ ev, gi }) => {
      const start = cursor + d;
      const secs = Number(ev.audioDuration) || 0;
      const end = Math.max(start + 1800, start + 120 + secs * 1000);
      out.push({ kind: 'system', key: 'sys-' + gi, text: C.eventLabel(ev), event: ev, start, typingStart: start, visibleStart: start, end, audio: ev.audio || null, audioDuration: secs });
      cursor = end;
    };

    const audioFor = C.audioIndex(p.dialogueMessages);
    // Lados de las burbujas: por defecto cambian de lado cada vez que cambia quien habla
    // (mensajes seguidos del mismo personaje se quedan en su lado). Con sideMode 'fixed', cada personaje usa su propio lado.
    const alternate = p.sideMode !== 'fixed';
    let lastSpeaker = null, turnSide = 'left';
    const hasVoices = (p.dialogueMessages || []).some((x) => x && x.audio);
    let missingAudio = 0;

    for (let i = 0; i <= parsed.messages.length; i++) {
      (byAfter.get(i) || []).forEach((x) => (x.title ? pushTitle(x) : pushSystem(x)));
      if (i === parsed.messages.length) break;
      const m = parsed.messages[i];
      // Solo se guarda el lado del turno; el personaje sigue siendo el objeto real (así los cambios
      // de color, tamaño, foto… se ven al momento en la vista previa). El lado se aplica al dibujar (frameAt).
      let side = null;
      if (alternate) {
        if (lastSpeaker && m.char !== lastSpeaker) turnSide = turnSide === 'left' ? 'right' : 'left';
        lastSpeaker = m.char;
        side = turnSide;
      }
      const dm = audioFor(m);
      const secs = dm ? Number(dm.duration) : 0;
      const audioMissing = hasVoices && !secs && !!C.ttsText(m.text);
      if (audioMissing) missingAudio++;
      const start = cursor + d;
      const visibleStart = start + t;
      let end = secs ? Math.max(visibleStart + v, visibleStart + popup + secs * 1000) : visibleStart + v;
      let reactAt = null;
      if (m.reactions.length) {
        // Las reacciones aparecen cuando termina la voz del mensaje.
        reactAt = Math.max(visibleStart + 500, end - 600);
        end = Math.max(end, reactAt + 700);
      }
      out.push({ kind: 'message', key: 'msg-' + m.lineIndex, char: m.char, side, text: m.text, reactions: m.reactions, reactAt, lineIndex: m.lineIndex, start, typingStart: start, visibleStart, end, audio: secs ? dm.audio : null, audioDuration: secs, audioMissing });
      cursor = end;
    }
    const totalMs = out.length ? out[out.length - 1].end : 1000;
    return { events: out, totalMs, parsed, groupEvents, missingAudio };
  };

  /** Qué hay en pantalla en el instante ms. */
  C.frameAt = (p, events, ms) => {
    const intro = events.find((e) => e.kind === 'intro' && ms >= e.start && ms < e.end);
    if (intro) return { intro, shown: [], typing: null, header: null, sig: intro.key, animating: false };
    // Lado del turno aplicado sobre el personaje ACTUAL (sin copias guardadas).
    // En vertical con ajuste automático, burbuja y foto se limitan para que quepan (sin tocar el personaje guardado).
    const fit = C.autoFit(p);
    const fitChar = (c) => ({ ...c,
      bubbleSize: Math.min(Number(c.bubbleSize) || 100, C.FIT_MAX.bubbleSize),
      size: Math.min(Number(c.size) || 150, C.FIT_MAX.size),
      photoX: clamp(Number(c.photoX) || 0, -30, 30) });
    const withSide = (e) => {
      if (!e || e.kind !== 'message' || !e.char) return e;
      const turn = e.side && e.char.side !== e.side;
      if (!turn && !fit) return e;
      const c = turn ? { ...e.char, side: e.side } : e.char;
      return { ...e, char: fit ? fitChar(c) : c };
    };
    let shown = events.filter((e) => (e.kind === 'message' || e.kind === 'system') && ms >= e.visibleStart).map(withSide);
    const fx = C.fx(p);
    // Mensajes seguidos de la misma persona: la foto solo en el último (como en las apps de chat).
    if (fx.details) shown = shown.map((e, i) => {
      const n = shown[i + 1];
      return e.kind === 'message' && n && n.kind === 'message' && n.char && e.char && n.char.name === e.char.name ? { ...e, hideAvatar: true } : e;
    });
    const typing = withSide(events.find((e) => e.kind === 'message' && ms >= e.typingStart && ms < e.visibleStart) || null);
    let name = String(p.groupName || 'Chat de grupo').trim() || 'Chat de grupo';
    let count = Math.max(0, Number(p.groupMembers ?? 24) || 0);
    let lastMessage = null, animating = false, reacted = 0;
    for (const e of shown) {
      if (e.kind === 'system') {
        const fx = C.eventEffect(e.event || {});
        if (fx.title) name = fx.title;
        if (fx.members) count = Math.max(0, count + fx.members);
        continue;
      }
      lastMessage = e;
      if (e.reactAt != null && ms >= e.reactAt) { reacted++; if (ms - e.reactAt < C.REACT_POP_MS + 40) animating = true; }
    }
    if (lastMessage && ms - lastMessage.visibleStart < (fx.smooth || p.anim === 'Rebote' ? 520 : 360)) animating = true;
    // Quién habla: el último mensaje mientras dura (su voz o su tiempo en pantalla).
    const speakingKey = lastMessage && ms < lastMessage.end ? lastMessage.key : null;
    if (fx.speaker && speakingKey) animating = true;
    // Fondo vivo: color y lado de quien habla, con transición desde el anterior.
    let bgFx = null;
    if (fx.bg && !p.bgImage) {
      const msgs = shown.filter((e) => e.kind === 'message');
      const last = msgs[msgs.length - 1], prev = msgs[msgs.length - 2];
      if (last) {
        const k = clamp((ms - last.visibleStart) / 700, 0, 1);
        const to = { color: C.solidColor(last.char.color), x: last.char.side === 'left' ? 18 : 82 };
        const from = prev ? { color: C.solidColor(prev.char.color), x: prev.char.side === 'left' ? 18 : 82 } : to;
        const ease = k * k * (3 - 2 * k);
        bgFx = { color: mixHex(from.color, to.color, ease), x: from.x + (to.x - from.x) * ease };
        if (k < 1) animating = true;
      }
    }
    const sig = [name, count, shown.map((e) => e.key + (e.hideAvatar ? '·' : '')).join(','), typing ? typing.key : '', reacted].join('|');
    return { intro: null, shown, typing, header: { name, count }, lastMessage, speakingKey, bgFx, sig, animating };
  };

  /** Animación de entrada del último mensaje (Pop / Deslizar / Aparecer). */
  C.messageMotion = (e, isLast, ms, anim, smooth) => {
    const prog = clamp((ms - e.visibleStart) / 350, 0, 1);
    let scale = 1, tx = 0, ty = 0, opacity = 1, origin = 'center center', maxHeight = null;
    if (isLast) {
      if (anim === 'Pop') scale = 0.85 + 0.15 * prog;
      if (anim === 'Deslizar') tx = (1 - prog) * (e.char && e.char.side === 'left' ? -180 : 180);
      if (anim === 'Aparecer') opacity = prog;
      if (anim === 'Rebote') {
        // Crece desde el lado de la foto con un pequeño rebote (easeOutBack).
        const k = clamp((ms - e.visibleStart) / 480, 0, 1), c1 = 1.9, c3 = c1 + 1;
        const back = 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
        scale = 0.55 + 0.45 * back; ty = (1 - k) * 40; opacity = Math.min(1, k * 3);
        origin = (e.char && e.char.side === 'left' ? 'left' : 'right') + ' bottom';
      }
      // Desplazamiento suave: la fila nueva crece en altura y empuja el chat hacia arriba poco a poco.
      if (smooth) {
        const g = clamp((ms - e.visibleStart) / 300, 0, 1);
        if (g < 1) maxHeight = 700 * (1 - Math.pow(1 - g, 3));
      }
    }
    return { transform: `translate(${px(tx)}, ${px(ty)}) scale(${scale})`, opacity: String(opacity), origin, maxHeight };
  };

  /** Reacciones visibles en ms (null si todavía no) con su escala de "pop". */
  C.reactionState = (e, ms) => {
    if (e.reactAt == null || ms < e.reactAt || !e.reactions || !e.reactions.length) return null;
    const k = clamp((ms - e.reactAt) / C.REACT_POP_MS, 0, 1);
    const scale = k < 1 ? 0.4 + 0.75 * k - 0.15 * k * k : 1;   // pequeño rebote
    return { scale: Math.min(1.1, scale) };
  };

  /* ───────────────────────── Música de fondo (ducking) ───────────────────────── */

  C.MUSIC_ATTACK_MS = 250;    // la música empieza a bajar un poco antes de que hable la voz
  C.MUSIC_RELEASE_MS = 500;   // y vuelve a subir poco a poco cuando termina
  C.MUSIC_FADE_IN_MS = 800;
  C.MUSIC_FADE_OUT_MS = 1500;

  /** Tramos [inicio, fin] (ms) en los que suena una voz: títulos, eventos y mensajes. Mismos tiempos que el MP4. */
  C.voiceSegments = (p, events) => {
    const popup = Math.max(0, Number(p.popupDelay ?? 0.35)) * 1000;
    const segs = [];
    for (const e of events || []) {
      if (!e.audio || !(Number(e.audioDuration) > 0)) continue;
      const s = e.kind === 'intro' ? e.start : e.kind === 'system' ? e.visibleStart + 120 : e.visibleStart + popup;
      segs.push([s, s + Number(e.audioDuration) * 1000]);
    }
    return segs;
  };

  /** Volumen (0–1) de la música en el instante ms: «Volumen música» normalmente y «Mientras hablan» durante las voces,
   *  con transiciones suaves, fundido de entrada al principio y de salida al final. */
  C.musicVolume = (p, segs, ms, totalMs) => {
    const base = clamp(Number(p.musicVolume ?? 25), 0, 100) / 100;
    const ducked = Math.min(base, clamp(Number(p.musicDuck ?? 8), 0, 100) / 100);
    let d = 0;
    for (const [s, e] of segs || []) {
      let k = 0;
      if (ms >= s && ms <= e) k = 1;
      else if (ms < s && ms > s - C.MUSIC_ATTACK_MS) k = 1 - (s - ms) / C.MUSIC_ATTACK_MS;
      else if (ms > e && ms < e + C.MUSIC_RELEASE_MS) k = 1 - (ms - e) / C.MUSIC_RELEASE_MS;
      if (k > d) d = k;
      if (d >= 1) break;
    }
    let v = base + (ducked - base) * d;
    v *= clamp(ms / C.MUSIC_FADE_IN_MS, 0, 1);
    if (totalMs) v *= clamp((totalMs - ms) / C.MUSIC_FADE_OUT_MS, 0, 1);
    return clamp(v, 0, 1);
  };

  C.membersLabel = (n) => `👥 ${n} ${n === 1 ? 'miembro' : 'miembros'}`;

  /* ───────────────────────── Estilos ───────────────────────── */

  const headerSizeOf = (p) => clamp(Number(p.headerSize) || 108, 70, 220);
  const bubbleScaleOf = (c) => clamp(Number(c.bubbleSize || 100) / 100, 0.6, 3);

  /** Tamaño del nombre: el elegido; con «Texto limpio», salvo que su palabra más larga no quepa bajo la foto (entonces se reduce, sin partirla). */
  const nameFontSize = (p, c) => {
    const size = Number(c.nameSize) || 30;
    if (!C.fx(p).text && !C.autoFit(p)) return size;   // sin efectos ni ajuste, igual que siempre
    // Ancho aproximado en «em» de cada palabra (letras anchas, mayúsculas, estrechas y el resto), con margen.
    const em = (w) => Array.from(w).reduce((a, ch) => a + (/[mwMW@]/.test(ch) ? 0.9 : /[A-ZÁÉÍÓÚÑ]/.test(ch) ? 0.74 : /[iljtfrI.,'!|ií]/.test(ch) ? 0.34 : 0.6), 0) * 1.08;
    const longest = Math.max(0.6, ...String(c.name || '').split(/\s+/).map(em));
    const fit = layoutOf(p).nameMax / longest;
    return Math.max(14, Math.min(size, Math.floor(fit)));
  };

  C.styles = {
    background: (p) => ({
      backgroundColor: p.bgColor || p.bg || C.theme(p).bg,
      backgroundImage: p.__bgUrl ? `url("${p.__bgUrl}")` : 'none',
      backgroundSize: p.__bgUrl ? (p.bgFit || 'cover') : 'auto',
      backgroundPosition: 'center center',
      backgroundRepeat: 'no-repeat',
      color: '#fff',
      overflow: 'hidden',
    }),
    canvas: (p, scale) => {
      const s = C.canvasSize(p);
      return { position: 'absolute', left: '0px', top: '0px', width: px(s.w), height: px(s.h), transform: `scale(${scale})`, transformOrigin: 'top left', overflow: 'hidden' };
    },
    introWrap: (p) => ({ position: 'absolute', inset: '0px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: px(layoutOf(p).introPad), boxSizing: 'border-box', zIndex: '20' }),
    introText: (p) => ({
      fontFamily: p.initialTitleFont || C.theme(p).font,
      fontSize: px(Math.max(20, Number(p.initialTitleSize) || 72)),
      lineHeight: '1.12', fontWeight: '800',
      color: p.initialTitleColor || '#fff',
      WebkitTextStroke: `${px(Math.max(0, Number(p.initialTitleStroke) || 0))} ${p.initialTitleStrokeColor || '#000'}`,
      textAlign: 'center', maxWidth: layoutOf(p).textMax, textShadow: '0 5px 20px rgba(0,0,0,.45)',
    }),
    header: (p) => {
      const t = C.theme(p), L = layoutOf(p);
      return { position: 'absolute', left: '0px', right: '0px', top: '0px', height: px(headerSizeOf(p) + L.safeTop), paddingTop: px(L.safeTop), paddingLeft: px(L.headerPadX), paddingRight: px(L.headerPadX), display: 'grid', gridTemplateColumns: C.fx(p).header ? 'minmax(0,1fr) minmax(0,2.4fr) minmax(0,1fr)' : '1fr auto 1fr', columnGap: C.fx(p).header ? '12px' : '0px', alignItems: 'center', boxSizing: 'border-box', background: t.headerBg, borderBottom: t.headerBorder, zIndex: '5' };
    },
    headerName: (p) => ({ gridColumn: '2', fontFamily: fontOf(p), fontSize: px(34 * headerSizeOf(p) / 108), fontWeight: '800', color: C.theme(p).headerText, textAlign: 'center', maxWidth: C.fx(p).header ? '100%' : C.isVertical(p) ? '620px' : '1400px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
    headerMembers: (p) => ({ gridColumn: '3', justifySelf: 'end', fontFamily: fontOf(p), fontSize: px(22 * headerSizeOf(p) / 108), fontWeight: '700', color: C.theme(p).headerSub, whiteSpace: 'nowrap' }),
    chatOuter: (p) => {
      const L = layoutOf(p);
      return { position: 'absolute', left: px(L.padX), right: px(L.padX), top: px(headerSizeOf(p) + L.safeTop + 20), bottom: px(L.bottom), padding: `0 ${px(L.innerX)}`, boxSizing: 'border-box', overflow: 'hidden' };
    },
    chatInner: (p) => {
      const L = layoutOf(p);
      return { position: 'absolute', left: px(L.innerX), right: px(L.innerX), bottom: '0px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'visible' };
    },
    chatStack: () => ({ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', flexShrink: '0' }),
    row: (p, motion, st) => {
      const grow = motion && motion.maxHeight != null;
      return { display: 'grid', gridTemplateColumns: layoutOf(p).lanes, alignItems: 'center', width: '100%', minHeight: grow || (st && st.compact) ? '0px' : '190px', maxHeight: grow ? px(motion.maxHeight) : 'none', marginBottom: st && st.compact ? '12px' : '22px', position: 'relative', transform: motion ? motion.transform : 'none', transformOrigin: motion && motion.origin ? motion.origin : 'center center', opacity: motion ? motion.opacity : '1' };
    },
    visual: (c, st) => ({ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gridColumn: c.side === 'left' ? '1' : '3', gridRow: '1', minWidth: '0px', zIndex: '10', position: 'relative', opacity: st && st.dim ? '0.55' : '1' }),
    img: (c, st) => {
      const base = { width: px(c.size || 150), height: px(c.size || 150), objectFit: 'contain', objectPosition: 'center', transform: `translate(${px(c.photoX || 0)}, ${px(c.photoY || 0)})`, filter: 'drop-shadow(0 10px 16px rgba(0,0,0,.42))' };
      if (st && st.speaking) {
        // Quien habla: la foto late un poco y brilla con el color de su burbuja.
        const pulse = 1.07 + 0.03 * Math.sin((st.ms || 0) / 170);
        base.transform += ` scale(${pulse.toFixed(4)})`;
        base.filter = `drop-shadow(0 0 22px ${rgba(C.solidColor(c.color), 0.85)}) drop-shadow(0 10px 16px rgba(0,0,0,.42))`;
      }
      return base;
    },
    name: (p, c) => ({ fontFamily: fontOf(p), fontSize: px(nameFontSize(p, c)), fontWeight: C.fx(p).text ? '800' : '700', color: C.theme(p).nameColor, marginTop: '8px', textAlign: 'center', lineHeight: '1.05', maxWidth: px(layoutOf(p).nameMax), overflowWrap: 'anywhere', textShadow: '0 2px 6px rgba(0,0,0,.5)', position: 'relative', zIndex: '20' }),
    side: (c) => ({ display: 'flex', flexDirection: 'column', alignItems: c.side === 'left' ? 'flex-start' : 'flex-end', direction: 'ltr', transform: `translateX(${px(c.bubbleX || 0)})`, gridColumn: '2', gridRow: '1', justifySelf: c.side === 'left' ? 'start' : 'end', zIndex: '1', minWidth: '0px', maxWidth: '100%' }),
    bubble: (p, c, st) => {
      const s = bubbleScaleOf(c), t = C.theme(p), fx = C.fx(p);
      const r = px(t.radius * s), tail = px((st && st.tail ? 6 : t.tail) * s);
      const left = c.side === 'left';
      const color = c.color || t[left ? 'left' : 'right'].color;
      const out = {
        background: fx.tail ? `linear-gradient(180deg, rgba(255,255,255,.17), rgba(255,255,255,0) 75%), ${color}` : color, color: c.textColor || '#fff',
        padding: `${px(22 * s)} ${px(30 * s)}`,
        borderTopLeftRadius: left ? tail : r, borderTopRightRadius: left ? r : tail, borderBottomLeftRadius: r, borderBottomRightRadius: r,
        maxWidth: layoutOf(p).bubbleMax, boxSizing: 'border-box',
        fontFamily: fontOf(p), fontSize: px(52 * s), lineHeight: '1.12', fontWeight: fx.text ? '800' : t.weight,
        WebkitTextStroke: `${px((fx.text ? 0 : Number(c.stroke) || 0) * s)} ${c.strokeColor || '#000'}`,
        boxShadow: t.bubbleShadow, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', position: 'relative',
      };
      if (fx.text) out.textShadow = '0 1px 3px rgba(0,0,0,.22)';
      return out;
    },
    /** «Colita» de la burbuja, hacia la foto de quien habla. */
    tail: (p, c) => {
      const s = bubbleScaleOf(c), left = c.side === 'left';
      const col = mixHex(C.solidColor(c.color || C.theme(p)[left ? 'left' : 'right'].color), '#ffffff', 0.13);
      return { position: 'absolute', top: px(14 * s), [left ? 'left' : 'right']: px(-11 * s), width: px(30 * s), height: px(30 * s), background: col, transform: 'rotate(45deg)', borderRadius: px(5 * s), zIndex: '-1' };
    },
    /** Hora y ✓✓ en la esquina de la burbuja. */
    meta: (p, c) => {
      const s = bubbleScaleOf(c);
      return { display: 'block', textAlign: 'right', fontFamily: fontOf(p), fontSize: px(24 * s), fontWeight: '700', lineHeight: '1', opacity: '0.78', marginTop: px(6 * s), marginBottom: px(-8 * s), marginRight: px(-10 * s), WebkitTextStroke: '0px', textShadow: 'none', whiteSpace: 'nowrap' };
    },
    ticks: (c) => ({ color: c.side === 'right' ? '#53bdeb' : 'inherit', marginLeft: '0.3em', letterSpacing: '-0.25em' }),
    /** Palabra resaltada con *asteriscos*: efecto rotulador. */
    highlight: () => ({ background: 'rgba(255,224,102,.96)', color: '#1b1b1b', borderRadius: '.22em', padding: '0 .16em', WebkitTextStroke: '0px', textShadow: 'none', WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone' }),
    /** Fondo vivo: brillo del color de quien habla en su lado + patrón de puntos muy suave. */
    fxBackground: (f) => ({
      position: 'absolute', inset: '0px', zIndex: '0', pointerEvents: 'none',
      backgroundImage: (f.bgFx ? `radial-gradient(circle at ${f.bgFx.x.toFixed(2)}% 62%, ${rgba(f.bgFx.color, 0.34)} 0%, ${rgba(f.bgFx.color, 0)} 58%), ` : '') + 'radial-gradient(rgba(255,255,255,.055) 2px, transparent 2.6px)',
      backgroundSize: (f.bgFx ? '100% 100%, ' : '') + '46px 46px',
    }),
    headerLeft: () => ({ gridColumn: '1', display: 'flex', alignItems: 'center', minWidth: '0px' }),
    headerAvatar: (p, i) => {
      const sz = Math.round(headerSizeOf(p) * (C.isVertical(p) ? 0.52 : 0.6));
      return { width: px(sz), height: px(sz), flex: '0 0 auto', borderRadius: '50%', objectFit: 'cover', marginLeft: i ? px(-sz * (C.isVertical(p) ? 0.4 : 0.28)) : '0px', border: '3px solid rgba(10,13,19,.95)', background: '#1b2130', boxShadow: '0 4px 10px rgba(0,0,0,.35)' };
    },
    headerCenter: () => ({ gridColumn: '2', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '0px', width: '100%' }),
    headerSubtitle: (p, typing) => ({ fontFamily: fontOf(p), fontSize: px(20 * headerSizeOf(p) / 108), fontWeight: '700', color: typing ? '#6ee7a0' : C.theme(p).headerSub, marginTop: px(4 * headerSizeOf(p) / 108), maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
    reactions: (p, c, st) => {
      const s = bubbleScaleOf(c), t = C.theme(p);
      return {
        display: 'flex', alignItems: 'center', gap: px(6 * s), marginTop: px(-14 * s), marginLeft: px(22 * s), marginRight: px(22 * s),
        padding: `${px(5 * s)} ${px(12 * s)}`, background: t.reactBg, color: t.reactText,
        border: `${px(4 * s)} solid ${p.bgColor || t.bg}`, borderRadius: '999px', fontFamily: fontOf(p),
        fontSize: px(34 * s), lineHeight: '1.1', fontWeight: '700', position: 'relative', zIndex: '2',
        transform: `scale(${st ? st.scale : 1})`, transformOrigin: c.side === 'left' ? 'left top' : 'right top',
        boxShadow: '0 4px 10px rgba(0,0,0,.25)', whiteSpace: 'nowrap',
      };
    },
    reactionCount: (c) => ({ fontSize: px(26 * bubbleScaleOf(c)), marginLeft: px(2 * bubbleScaleOf(c)), opacity: '0.9' }),
    systemWrap: () => ({ display: 'flex', justifyContent: 'center', width: '100%', margin: '18px 0 24px' }),
    systemText: (p) => {
      const t = C.theme(p);
      return { color: t.systemText, background: t.systemBg, padding: t.systemPad, borderRadius: '16px', fontFamily: fontOf(p), fontSize: px(clamp(Number(p.eventSize) || 28, 14, 96)), fontWeight: '600', lineHeight: '1.3', textAlign: 'center', maxWidth: layoutOf(p).textMax, textShadow: t.systemBg === 'transparent' ? '0 2px 8px rgba(0,0,0,.35)' : 'none' };
    },
    typingRow: (p) => ({ display: 'grid', gridTemplateColumns: layoutOf(p).lanes, alignItems: 'center', width: '100%', marginBottom: '22px', flexShrink: '0' }),
    typing: (p, c) => ({ gridColumn: '2', gridRow: '1', justifySelf: c.side === 'left' ? 'start' : 'end', transform: `translateX(${px(c.bubbleX || 0)})`, background: C.theme(p).typingBg, color: '#fff', borderRadius: '28px', padding: '15px 28px', fontFamily: fontOf(p), fontSize: '48px', letterSpacing: '8px', lineHeight: '1.12' }),
  };

  root.ChatCore = C;
})(typeof globalThis !== 'undefined' ? globalThis : window);
