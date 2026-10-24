/* Chat Video Maker · formatos «Top / Ranking» y «Historia narrada».
 * Núcleo compartido entre la vista previa (index.html) y el render (Remotion): lee el guion, calcula los
 * tiempos y describe cada fotograma como un árbol de nodos {t, s, c, src} que cada lado convierte a pantalla
 * (DOM en la vista previa, React en Remotion). Así los dos dibujan exactamente lo mismo. */
(function (root) {
  'use strict';
  const C = root.ChatCore;
  const F = {};

  F.FORMATS = { chat: '💬 Chat', top: '🏆 Top', hist: '📜 Historia' };
  F.isFormat = (p) => !!(p && (p.format === 'top' || p.format === 'hist'));
  F.FONT = 'Nunito, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  F.SERIF = 'Georgia, "Times New Roman", serif';
  /** Efectos de sonido incluidos con la app (carpeta shared/sfx). */
  F.SFX = { whoosh: '/sfx/whoosh.wav', drumroll: '/sfx/drumroll.wav', fanfare: '/sfx/fanfare.wav' };

  const px = (n) => `${Math.round(Number(n) * 100) / 100}px`;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
  const easeInOut = (x) => { const k = clamp01(x); return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; };
  const back = (x) => { const k = clamp01(x), c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
  const strip = (s) => C.stripQuotes(String(s || ''));
  const N = (t, s, c, extra) => ({ t, s: s || {}, c: c == null ? [] : Array.isArray(c) ? c : [c], ...(extra || {}) });

  /* ───────────────────────── Guion ───────────────────────── */

  const TITLE_RE = /^t[ií]tulo(?:\s+inicial)?\s*:/i;
  const INTRO_RE = /^intro\s*:/i;
  const OUTRO_RE = /^(?:final|cierre|outro)\s*:/i;
  const NARR_RE = /^(?:narrador|narraci[oó]n|voz)\s*:/i;
  /** «Algodón: texto» → «texto» (cualquier nombre corto antes de los dos puntos). */
  const speech = (line) => {
    const m = line.match(/^([^:|]{1,30}):\s*(.+)$/);
    return strip(m && m[1].trim().split(/\s+/).length <= 3 ? m[2] : line);
  };

  /** Top: título, intro, puestos (con estadísticas y dato), redoble opcional y final. */
  F.parseTop = (script) => {
    const out = { title: '', intro: [], outro: [], items: [], drum: '' };
    let cur = out.intro;
    for (const raw of String(script || '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (TITLE_RE.test(line)) { out.title = strip(line.replace(TITLE_RE, '')); continue; }
      if (INTRO_RE.test(line)) { const t = strip(line.replace(INTRO_RE, '')); if (t) out.intro.push(t); cur = out.intro; continue; }
      if (OUTRO_RE.test(line)) { const t = strip(line.replace(OUTRO_RE, '')); if (t) out.outro.push(t); cur = out.outro; continue; }
      if (/^redoble\s*:/i.test(line)) { out.drum = strip(line.replace(/^redoble\s*:/i, '')); continue; }
      if (/^puesto\s*:/i.test(line)) {
        const parts = line.replace(/^puesto\s*:/i, '').split('|').map((x) => x.trim()).filter(Boolean);
        const rank = parseInt(parts.shift(), 10);
        const item = { rank: Number.isFinite(rank) ? rank : out.items.length + 1, name: strip(parts.shift() || '?'), emoji: '', stats: [], fact: '', lines: [] };
        for (const x of parts) {
          const st = x.match(/^(.+?)\s+(\d{1,2})(?:\s*\/\s*10)?$/);
          if (/^dato\s*:/i.test(x)) item.fact = x.replace(/^dato\s*:\s*/i, '');   // el dato, aunque acabe en número
          else if (!item.emoji && !/[\p{L}\p{N}]/u.test(x)) item.emoji = x;
          else if (st) item.stats.push([st[1].trim(), Math.max(0, Math.min(10, Number(st[2])))]);
          else item.fact = x.replace(/^dato\s*:\s*/i, '');
        }
        out.items.push(item); cur = item.lines; continue;
      }
      const t = NARR_RE.test(line) ? strip(line.replace(NARR_RE, '')) : speech(line);
      if (t) cur.push(t);
    }
    return out;
  };

  /** Historia: título, intro, capítulos, fotos (rótulo | filtro) con su narración, y final. */
  F.parseHist = (script) => {
    const out = { title: '', intro: [], outro: [], blocks: [] };
    let cur = out.intro;
    for (const raw of String(script || '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (TITLE_RE.test(line)) { out.title = strip(line.replace(TITLE_RE, '')); continue; }
      if (INTRO_RE.test(line)) { const t = strip(line.replace(INTRO_RE, '')); if (t) out.intro.push(t); cur = out.intro; continue; }
      if (OUTRO_RE.test(line)) { const t = strip(line.replace(OUTRO_RE, '')); if (t) out.outro.push(t); cur = out.outro; continue; }
      if (/^cap[ií]tulo\s*:/i.test(line)) {
        const n = out.blocks.filter((b) => b.type === 'chapter').length + 1;
        out.blocks.push({ type: 'chapter', n, title: strip(line.replace(/^cap[ií]tulo\s*:/i, '')) || `Capítulo ${n}` });
        cur = null; continue;
      }
      if (/^foto\s*:/i.test(line)) {
        const [label, filter] = line.replace(/^foto\s*:/i, '').split('|').map((x) => x.trim());
        const b = { type: 'photo', label: strip(label), filter: (filter || '').toLowerCase(), lines: [] };
        out.blocks.push(b); cur = b.lines; continue;
      }
      const t = NARR_RE.test(line) ? strip(line.replace(NARR_RE, '')) : speech(line);
      if (!t) continue;
      if (!cur) { const b = { type: 'talk', lines: [] }; out.blocks.push(b); cur = b.lines; }
      cur.push(t);
    }
    return out;
  };

  /** Clave de la foto de un puesto o de una escena (la app guarda las fotos con esta clave). */
  F.imageKey = (format, name) => `${format}:${String(name || '').trim().toLowerCase()}`;

  /* ───────────────────────── Voces y tiempos ───────────────────────── */

  F.voiceOf = (p) => {
    const v = p.format === 'hist' ? p.hist || {} : p.top || {};
    return { voice: String(v.voice || '').trim(), speed: Math.max(0.25, Number(v.speed) || 1) };
  };

  /** Una frase con voz: su audio (si ya está generado, buscado por contenido) o una duración estimada. */
  const line = (p, text, kind) => {
    const { voice, speed } = F.voiceOf(p);
    const cacheKey = C.audioCacheKey(text, voice, speed, kind);
    const hit = (Array.isArray(p.fmtAudios) ? p.fmtAudios : []).find((x) => x && x.cacheKey === cacheKey && x.audio && Number(x.duration) > 0);
    const spoken = C.ttsText(text);
    return {
      text, kind, voice, speed, cacheKey,
      audio: hit ? hit.audio : null,
      dur: hit ? Number(hit.duration) : Math.max(1.2, spoken.length * 0.068),
      peaks: hit && Array.isArray(hit.peaks) ? hit.peaks : null,
      missing: !hit && !!spoken,
    };
  };

  /** Coloca las frases una detrás de otra (con una pequeña pausa) y devuelve su duración total. */
  const sequence = (lines) => {
    let at = 0;
    lines.forEach((l, i) => { l.at = at; at += l.dur + (i < lines.length - 1 ? 0.3 : 0); });
    return at;
  };

  /** Plan del vídeo: segmentos con sus tiempos (s), frases con voz y efectos de sonido. */
  F.plan = (p) => (p.format === 'hist' ? planHist(p) : planTop(p));

  const finish = (segs, sfx) => {
    let t = 0;
    for (const s of segs) {
      s.start = t; t += s.dur;
      s.lines.forEach((l) => { l.abs = s.start + s.voiceAt + l.at; });
    }
    const lines = segs.flatMap((s) => s.lines);
    return {
      segments: segs, lines, total: Math.max(1, t),
      sfx: sfx(segs),
      voiceSegs: lines.filter((l) => l.audio).map((l) => [l.abs * 1000, (l.abs + l.dur) * 1000]),
      missing: lines.filter((l) => l.missing).length,
    };
  };

  function planTop(p) {
    const d = F.parseTop(p.topScript);
    const L = (t) => line(p, t, 'top');
    const segs = [];
    const intro = d.intro.map(L);
    segs.push({ kind: 'intro', key: 'intro', title: d.title || 'Top', voiceAt: 0.8, lines: intro, dur: 0.8 + sequence(intro) + 1.4 });
    d.items.forEach((it, i) => {
      if (it.rank === 1 && i > 0) {
        const dl = [L(d.drum || 'Y el número uno es…')];
        segs.push({ kind: 'drum', key: 'drum', voiceAt: 0.2, lines: dl, dur: Math.max(2.8, 0.2 + sequence(dl) + 0.6) });
      }
      const lines = it.lines.map(L);
      segs.push({ kind: 'item', key: 'item-' + i, item: it, voiceAt: 0.9, lines, dur: Math.max(4.5, 0.9 + sequence(lines) + 1.8) });
    });
    const outro = d.outro.map(L);
    segs.push({ kind: 'outro', key: 'outro', voiceAt: 0.6, lines: outro, dur: outro.length ? 0.6 + sequence(outro) + 2.4 : 4 });
    const plan = finish(segs, (ss) => ss.flatMap((s) => (
      s.kind === 'item' ? [{ at: Math.max(0, s.start - 0.45), src: F.SFX.whoosh, dur: 1, vol: 0.8 }, ...(s.item.rank === 1 ? [{ at: s.start + 0.8, src: F.SFX.fanfare, dur: 2, vol: 0.7 }] : [])]
        : s.kind === 'drum' ? [{ at: s.start, src: F.SFX.drumroll, dur: 2.6, vol: 1 }] : []
    )));
    plan.items = d.items;
    plan.title = d.title;
    return plan;
  }

  function planHist(p) {
    const d = F.parseHist(p.histScript);
    const L = (t) => line(p, t, 'hist');
    const segs = [];
    const intro = d.intro.map(L);
    segs.push({ kind: 'intro', key: 'intro', title: d.title || 'Mi historia', voiceAt: 1.0, lines: intro, dur: 1.0 + sequence(intro) + 1.6 });
    let chapter = '';
    d.blocks.forEach((b, i) => {
      if (b.type === 'chapter') {
        chapter = `Capítulo ${b.n} · ${b.title}`;
        const cl = [L(`Capítulo ${b.n}. ${b.title}.`)];
        segs.push({ kind: 'chapter', key: 'ch-' + i, n: b.n, title: b.title, voiceAt: 0.7, lines: cl, dur: 0.7 + sequence(cl) + 1.3 });
      } else {
        const lines = b.lines.map(L);
        segs.push({ kind: b.type, key: 'b-' + i, label: b.label || '', filter: b.filter || '', chapter, voiceAt: 0.6, lines, dur: Math.max(4, 0.6 + sequence(lines) + 1.4) });
      }
    });
    const outro = d.outro.map(L);
    segs.push({ kind: 'outro', key: 'outro', voiceAt: 0.6, lines: outro, dur: outro.length ? 0.6 + sequence(outro) + 2.6 : 4 });
    const swoosh = ['barrido', 'deslizar', 'zoom'].includes(F.transitionOf(p));
    const plan = finish(segs, (ss) => (swoosh ? ss.slice(1).map((sg) => ({ at: Math.max(0, sg.start - 0.3), src: F.SFX.whoosh, dur: 1, vol: 0.45 })) : []));
    plan.title = d.title;
    plan.photos = d.blocks.filter((b) => b.type === 'photo').map((b) => b.label);
    return plan;
  }

  /** Segmento y frase que suenan en el instante ms. */
  F.at = (plan, ms) => {
    const s = ms / 1000;
    const seg = plan.segments.find((x) => s >= x.start && s < x.start + x.dur) || plan.segments[plan.segments.length - 1];
    const t = (s - seg.start) * 1000;
    let cur = null;
    for (const l of seg.lines) if (s >= l.abs - 0.05) cur = l;
    return { seg, t, line: cur, lt: cur ? (s - cur.abs) * 1000 : -1 };
  };

  /** Volumen de la voz (0–1) en ese momento, con la onda real si está analizada. */
  const ampOf = (l, lt) => {
    if (!l || lt < 0 || lt >= l.dur * 1000) return 0;
    if (!l.peaks || !l.peaks.length) return 0.35 + 0.3 * Math.abs(Math.sin(lt / 95));
    const i = (lt / (l.dur * 1000)) * (l.peaks.length - 1), a = Math.floor(i), b = Math.min(l.peaks.length - 1, a + 1);
    return (Number(l.peaks[a]) || 0) + ((Number(l.peaks[b]) || 0) - (Number(l.peaks[a]) || 0)) * (i - a);
  };

  /* ───────────────────────── Piezas de dibujo ───────────────────────── */

  /** Subtítulo palabra a palabra de la frase que suena, siempre en UNA línea: la frase se parte en trozos que
   *  caben en el ancho disponible y se muestra el trozo que se está diciendo. */
  const karaoke = (l, lt, box, S) => {
    if (!l) return null;
    const sub = (S && S.sub) || SUB.dark;
    const size = box.size || 46;
    const maxChars = Math.max(12, Math.floor((box.w - box.left - box.right - 80) / (size * 0.58)));
    const words = l.text.replace(/\*/g, '').split(/\s+/).filter(Boolean);
    // Trozos de una línea (por número de letras) y posición de cada palabra dentro del texto completo.
    const chunks = [];
    let cur = [], len = 0, pos = 0;
    words.forEach((w) => {
      if (cur.length && len + 1 + w.length > maxChars) { chunks.push(cur); cur = []; len = 0; }
      cur.push({ w, a: pos, b: pos + w.length + 1 }); len += (cur.length > 1 ? 1 : 0) + w.length; pos += w.length + 1;
    });
    if (cur.length) chunks.push(cur);
    const done = clamp01(lt / (l.dur * 1000)) * (pos || 1);
    const chunk = chunks.find((c) => done < c[c.length - 1].b) || chunks[chunks.length - 1] || [];
    const kids = [];
    chunk.forEach((x, i) => {
      if (i) kids.push(' ');
      const st = done >= x.b ? 1 : done >= x.a ? 2 : 0;
      kids.push(N('span', { opacity: st === 0 ? '0.35' : '1', color: st === 2 ? sub.hi : sub.color }, x.w));
    });
    return N('div', { position: 'absolute', left: px(box.left), right: px(box.right), bottom: px(box.bottom), display: 'flex', justifyContent: 'center', zIndex: '20' }, [
      N('div', { background: sub.bg, border: sub.border || 'none', borderRadius: sub.radius, padding: '14px 34px', fontFamily: F.FONT, fontWeight: sub.weight, fontSize: px(size), color: sub.color, textAlign: 'center', lineHeight: '1.22', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '100%', textShadow: sub.shadow || 'none' }, kids),
    ]);
  };

  /** Foto de un puesto o escena: imagen subida (que llena el marco) o, si falta, un emoji o un aviso. */
  const picture = (src, emoji, size, extraImg) => (src
    ? N('img', { position: 'absolute', left: '0px', top: '0px', width: '100%', height: '100%', objectFit: 'cover', ...(extraImg || {}) }, null, { src })
    : N('div', { position: 'absolute', inset: '0px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: px(size), lineHeight: '1' }, emoji || '🖼️'));

  const confetti = (t, W, H, extraCol) => {
    const cols = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#ffffff', extraCol || '#ffd166'];
    return Array.from({ length: 80 }).map((_, i) => {
      const r1 = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1, r2 = Math.abs(Math.sin(i * 78.233) * 12345.678) % 1;
      const x = r1 * W + Math.sin(t / 300 + i) * 40, y = -60 + ((t * (0.35 + r2 * 0.4) + r2 * 900) % (H + 170));
      return N('div', { position: 'absolute', left: px(x), top: px(y), width: '16px', height: '28px', background: cols[i % cols.length], transform: `rotate(${((t / 4 + i * 37) % 360).toFixed(1)}deg)`, borderRadius: '4px', opacity: String(clamp01(t / 300)), zIndex: '15' });
    });
  };

  /* ───────────────────────── Escena: Top ───────────────────────── */

  function sceneTop(p, plan, ms) {
    const { w: W, h: H } = C.canvasSize(p), V = H > W;
    const { seg, t, line: l, lt } = F.at(plan, ms);
    const imgs = p.fmtImages || {};
    const S = F.topStyle(p), titleFont = F.brandFont(p, S.title);
    const accent = seg.kind === 'item' ? (seg.item.rank === 1 ? S.gold : topColor(seg.item, plan, S)) : seg.kind === 'drum' ? S.gold : S.introAccent;
    const kids = [
      N('div', { position: 'absolute', inset: '0px', background: S.bg }),
      ...pattern(S, ms),
      N('div', { position: 'absolute', inset: '0px', background: `radial-gradient(circle at ${V ? '50% 30%' : '30% 50%'}, ${accent}${alphaHex(0.33 * S.glow)} 0%, transparent 55%)` }),
    ];
    if (seg.kind === 'intro') {
      kids.push(N('div', { position: 'absolute', inset: '0px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: F.FONT, color: S.text, padding: '0 80px', boxSizing: 'border-box' }, [
        N('div', { fontSize: '40px', fontWeight: '900', letterSpacing: '10px', color: S.gold, opacity: String(clamp01(t / 400)) }, `${S.trophy ? '🏆 ' : ''}TOP ${plan.items.length}`),
        N('div', { marginTop: '20px', fontFamily: titleFont, fontSize: px(V ? 96 : 116), fontWeight: '900', textAlign: 'center', lineHeight: '1.05', transform: `scale(${(0.7 + 0.3 * back(t / 700)).toFixed(3)})` }, seg.title),
        N('div', { marginTop: '40px', display: 'flex', gap: '26px', flexWrap: 'wrap', justifyContent: 'center' }, plan.items.slice().sort((a, b) => a.rank - b.rank).slice(0, 6).map((it, i) => {
          const src = imgs[F.imageKey('top', it.name)];
          return N('div', { position: 'relative', width: '130px', height: '130px', borderRadius: '50%', overflow: 'hidden', background: S.muted, border: `4px solid ${S.ring}`, opacity: String(clamp01((t - 500 - i * 150) / 250)), transform: `translateY(${(Math.sin(t / 250 + i) * 10).toFixed(1)}px)`, filter: 'blur(10px)' }, [picture(src, it.emoji, 80)]);   // ocultas: se descubren en su puesto
        })),
      ]));
    }
    if (seg.kind === 'drum') {
      kids.push(N('div', { position: 'absolute', inset: '0px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F.FONT, padding: '0 60px', boxSizing: 'border-box' }, [
        N('div', { fontFamily: titleFont, fontSize: px(V ? 96 : 120), fontWeight: '900', color: S.gold, textAlign: 'center', transform: `scale(${(1 + 0.04 * Math.sin(t / 40)).toFixed(3)}) translateX(${(Math.sin(t / 17) * (t / 260)).toFixed(1)}px)`, textShadow: `0 0 40px ${S.gold}${alphaHex(0.53 * S.glow)}` }, (S.trophy ? '🥁 ' : '') + (l ? l.text : 'Y el número 1 es…')),
      ]));
    }
    if (seg.kind === 'item') kids.push(...topItem(p, plan, seg, t, W, H, V, imgs));
    if (seg.kind === 'outro') {
      kids.push(N('div', { position: 'absolute', inset: '0px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: F.FONT, color: S.text, gap: '40px', padding: '0 60px', boxSizing: 'border-box' }, [
        N('div', { fontFamily: titleFont, fontSize: px(V ? 80 : 96), fontWeight: '900', textAlign: 'center', transform: `scale(${(0.7 + 0.3 * back(t / 600)).toFixed(3)})` }, S.trophy ? '¿Cuál es tu favorito? 💬' : '¿Cuál es tu favorito?'),
        N('div', { padding: '22px 60px', borderRadius: '999px', background: F.subscribeColor(p), color: '#fff', fontSize: '64px', fontWeight: '900', transform: `scale(${(1 + 0.05 * Math.sin(t / 160)).toFixed(3)})`, opacity: String(clamp01((t - 600) / 300)) }, '🔔 SUSCRÍBETE'),
      ]));
    }
    // Escalera de puestos (horizontal): revelados, actual resaltado y «???» en los que faltan.
    if (!V && (seg.kind === 'item' || seg.kind === 'drum')) {
      const shownRanks = new Set(plan.segments.filter((s) => s.kind === 'item' && ms / 1000 >= s.start + 0.9).map((s) => s.item.rank));
      const cur = seg.kind === 'item' ? seg.item.rank : 0;
      kids.push(N('div', { position: 'absolute', right: '40px', top: '120px', width: '340px', display: 'flex', flexDirection: 'column', gap: '14px', fontFamily: F.FONT, zIndex: '10' },
        plan.items.slice().sort((a, b) => a.rank - b.rank).slice(0, 10).map((it) => {
          const on = shownRanks.has(it.rank), isCur = it.rank === cur, col = it.rank === 1 ? S.gold : topColor(it, plan, S);
          return N('div', { display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 18px', borderRadius: px(Math.min(16, S.radius)), background: isCur ? col : S.muted, color: isCur ? S.onAccent : S.text, transform: `scale(${isCur ? 1.06 : 1})`, boxShadow: isCur ? `0 0 30px ${col}${alphaHex(0.53 * S.glow)}` : 'none', border: `2px solid ${S.muted}` }, [
            N('div', { fontSize: '34px', fontWeight: '900', width: '62px' }, '#' + it.rank),
            N('div', { fontSize: '28px', fontWeight: '800', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, on ? `${it.emoji ? it.emoji + ' ' : ''}${it.name}` : '???'),
          ]);
        })));
    }
    if (seg.kind !== 'drum') kids.push(karaoke(l, lt, V ? { w: W, left: 50, right: 50, bottom: 300, size: 44 } : { w: W, left: 120, right: seg.kind === 'item' ? 420 : 120, bottom: 54 }, S));
    return N('div', { position: 'absolute', left: '0px', top: '0px', width: px(W), height: px(H), overflow: 'hidden', background: S.base, fontFamily: F.FONT }, kids.filter(Boolean));
  }

  const TOP_COLORS = ['#e76f51', '#f4a261', '#2a9d8f', '#9b5de5', '#118ab2', '#ef476f', '#06d6a0', '#ff9f1c', '#8ac926', '#4cc9f0'];
  const topColor = (it, plan, S) => { const cols = (S && S.colors) || TOP_COLORS; return cols[Math.max(0, plan.items.indexOf(it)) % cols.length]; };

  /* ───────────────────────── Estilos visuales (Top / Historia) ───────────────────────── */

  const SUB = {
    dark: { bg: 'rgba(0,0,0,.62)', color: '#ffffff', hi: '#ffd166', radius: '20px', weight: '800' },
    doc: { bg: 'rgba(0,0,0,0)', color: '#f3efe6', hi: '#d4a017', radius: '0px', weight: '700', shadow: '0 2px 10px rgba(0,0,0,.95), 0 0 2px rgba(0,0,0,.9)' },
    neon: { bg: 'rgba(10,4,20,.78)', color: '#ffffff', hi: '#00e5ff', radius: '999px', weight: '800', border: '2px solid #ff2bd6' },
    light: { bg: '#16161a', color: '#ffffff', hi: '#ffd166', radius: '14px', weight: '800' },
    cine: { bg: 'rgba(0,0,0,0)', color: '#f5f0e6', hi: '#ffe08a', radius: '0px', weight: '600', shadow: '0 2px 8px rgba(0,0,0,.9)' },
  };
  /** Opacidad 0–1 → sufijo hexadecimal de color (#rrggbb + aa). */
  const alphaHex = (a) => Math.round(clamp01(a) * 255).toString(16).padStart(2, '0');

  F.TOP_STYLES = {
    clasico: { label: 'Clásico · azul', bg: 'linear-gradient(135deg, #0d1321 0%, #1b2440 100%)', base: '#0d1321', pattern: 'stripes', text: '#ffffff', muted: 'rgba(255,255,255,.08)', ring: 'rgba(255,255,255,.25)', gold: '#ffd166', onAccent: '#111111', introAccent: '#118ab2', colors: TOP_COLORS, title: F.FONT, num: 'Impact, "Arial Black", sans-serif', numColor: '#ffffff', barEnd: '#ffffff', radius: 40, glow: 1, trophy: true, sub: SUB.dark },
    documental: { label: 'Documental · sobrio', bg: 'radial-gradient(circle at 50% 35%, #211c16 0%, #0a0a0b 75%)', base: '#0a0a0b', pattern: 'vignette', text: '#f3efe6', muted: 'rgba(243,239,230,.07)', ring: 'rgba(243,239,230,.2)', gold: '#d4a017', onAccent: '#111111', introAccent: '#d4a017', colors: ['#c9a227', '#b08d57', '#9c6644', '#a68a64', '#8d7b68', '#b5838d', '#6d6875', '#a3b18a', '#7f5539', '#c2a878'], title: F.SERIF, num: F.SERIF, numColor: '#f3efe6', barEnd: '#f3efe6', radius: 6, glow: 0.45, trophy: false, sub: SUB.doc },
    neon: { label: 'Neón · noche', bg: 'radial-gradient(circle at 50% 110%, #2b0a4f 0%, #07040f 62%)', base: '#07040f', pattern: 'grid', text: '#ffffff', muted: 'rgba(255,255,255,.07)', ring: 'rgba(255,43,214,.6)', gold: '#ffe600', onAccent: '#0a0614', introAccent: '#ff2bd6', colors: ['#ff2bd6', '#00e5ff', '#a0ff1f', '#ff8a00', '#7b61ff', '#ff4d6d', '#00ffa3', '#ffd000', '#3d9bff', '#ff5ef0'], title: F.FONT, num: 'Impact, "Arial Black", sans-serif', numColor: '#ffffff', barEnd: '#ffffff', radius: 24, glow: 1.6, trophy: true, sub: SUB.neon },
    minimal: { label: 'Minimal · claro', bg: 'linear-gradient(180deg, #f5f3ee 0%, #e7e2d8 100%)', base: '#f5f3ee', pattern: 'none', text: '#16161a', muted: 'rgba(0,0,0,.06)', ring: 'rgba(0,0,0,.18)', gold: '#c98a00', onAccent: '#ffffff', introAccent: '#e63946', colors: ['#e63946', '#1d3557', '#2a9d8f', '#e76f51', '#457b9d', '#6a4c93', '#d68c45', '#264653', '#bc4749', '#3a86ff'], title: F.FONT, num: 'Impact, "Arial Black", sans-serif', numColor: '#16161a', barEnd: '#16161a', radius: 14, glow: 0.25, trophy: false, sub: SUB.light },
  };
  F.HIST_STYLES = {
    album: { label: 'Álbum · cálido', bgFilter: 'blur(6px) brightness(.35) sepia(.4)', fallbackBg: 'radial-gradient(circle at 50% 40%, #3a2a1c 0%, #14100c 70%)', base: '#14100c', vignette: 0.7, frame: 'polaroid', title: F.SERIF, italic: true, caps: false, text: '#fff6e6', soft: 'rgba(255,246,230,.75)', label: '"Segoe Print", "Comic Sans MS", cursive', letterbox: 0, sub: SUB.dark },
    documental: { label: 'Documental · frío', bgFilter: 'blur(6px) brightness(.22) grayscale(.7)', fallbackBg: 'radial-gradient(circle at 50% 40%, #1c2129 0%, #0b0c0f 70%)', base: '#0b0c0f', vignette: 0.85, frame: 'clean', title: F.SERIF, italic: false, caps: false, text: '#f1f1f1', soft: 'rgba(241,241,241,.65)', label: F.FONT, letterbox: 0, sub: SUB.doc },
    cine: { label: 'Cine · panorámico', bgFilter: 'blur(8px) brightness(.25) saturate(1.2)', fallbackBg: '#050505', base: '#000000', vignette: 0.6, frame: 'full', title: F.FONT, italic: false, caps: true, text: '#f5f0e6', soft: 'rgba(245,240,230,.7)', label: F.FONT, letterbox: 110, sub: SUB.cine },
    minimal: { label: 'Minimal · claro', bgFilter: null, fallbackBg: 'linear-gradient(180deg, #f4f1ea 0%, #e7e2d8 100%)', base: '#f4f1ea', vignette: 0, frame: 'light', title: F.SERIF, italic: true, caps: false, text: '#1d1b18', soft: 'rgba(29,27,24,.6)', label: F.FONT, letterbox: 0, sub: SUB.light },
  };
  F.topStyle = (p) => F.TOP_STYLES[(p.top || {}).style] || F.TOP_STYLES.clasico;
  F.histStyle = (p) => F.HIST_STYLES[(p.hist || {}).style] || F.HIST_STYLES.album;

  /** Fondo animado de cada estilo: rayas, rejilla de neón o viñeta. */
  const pattern = (S, ms) => {
    if (S.pattern === 'stripes') return [N('div', { position: 'absolute', left: '-200px', top: '-200px', right: '-200px', bottom: '-200px', background: 'repeating-linear-gradient(115deg, rgba(255,255,255,.035) 0 40px, transparent 40px 120px)', transform: `translateX(${((ms / 25) % 120).toFixed(1)}px)` })];
    if (S.pattern === 'grid') return [N('div', { position: 'absolute', left: '0px', right: '0px', top: '-80px', bottom: '-80px', backgroundImage: 'linear-gradient(rgba(255,43,214,.13) 2px, transparent 2px), linear-gradient(90deg, rgba(0,229,255,.10) 2px, transparent 2px)', backgroundSize: '80px 80px', transform: `translateY(${((ms / 30) % 80).toFixed(1)}px)` })];
    if (S.pattern === 'vignette') return [N('div', { position: 'absolute', inset: '0px', background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,.7) 100%)' })];
    return [];
  };

  function topItem(p, plan, seg, t, W, H, V, imgs) {
    const S = F.topStyle(p);
    const it = seg.item, col = it.rank === 1 ? S.gold : topColor(it, plan, S), isOne = it.rank === 1;
    const src = imgs[F.imageKey('top', it.name)];
    const slam = clamp01(t / 380), toCorner = easeOut((t - 700) / 450);
    const numScale = (3 - 2 * easeOut(slam)) * (1 - 0.72 * toCorner);
    const cornerX = V ? 150 : 210, cornerY = V ? 210 : 130;
    const numX = W / 2 + (cornerX - W / 2) * toCorner, numY = H / 2 - 20 + (cornerY - (H / 2 - 20)) * toCorner;
    const cardK = back((t - 850) / 550), statsT = t - 1300;
    const card = V ? { left: (W - 640) / 2, top: 330, size: 640 } : { left: 130, top: 210, size: 600 };
    const info = V ? { left: 90, top: 1010, width: W - 180 } : { left: 800, top: 220, width: 680 };
    const out = [];
    if (isOne && t > 900) out.push(...confetti(t - 900, W, H));
    out.push(N('div', { position: 'absolute', left: px(card.left), top: px(card.top), width: px(card.size), height: px(card.size), borderRadius: px(S.radius), overflow: 'hidden', transform: `translateY(${((1 - cardK) * 120).toFixed(1)}px) scale(${(0.85 + 0.15 * cardK).toFixed(3)})`, opacity: String(clamp01((t - 850) / 250)), boxShadow: `0 30px 70px rgba(0,0,0,${S.base === '#f5f3ee' ? '.25' : '.55'}), 0 0 0 8px ${col}`, background: `radial-gradient(circle at 50% 40%, ${col} 0%, ${col}55 45%, ${S.base} 100%)` }, [
      N('div', { position: 'absolute', inset: '0px', transform: `scale(${(1 + 0.08 * clamp01(t / (seg.dur * 1000))).toFixed(4)})` }, [picture(src, it.emoji || '⭐', 380)]),
      isOne && t > 900 ? N('div', { position: 'absolute', left: '0px', right: '0px', top: '16px', textAlign: 'center', fontSize: '120px', lineHeight: '1', transform: `translateY(${((1 - back((t - 1000) / 500)) * -200).toFixed(1)}px)` }, '👑') : null,
    ].filter(Boolean)));
    out.push(N('div', { position: 'absolute', left: px(info.left), top: px(info.top), width: px(info.width), fontFamily: F.FONT, color: S.text, opacity: String(clamp01((t - 1000) / 300)), transform: `translateX(${((1 - easeOut((t - 1000) / 400)) * 80).toFixed(1)}px)` }, [
      N('div', { fontFamily: F.brandFont(p, S.title), fontSize: px(isOne ? 92 : 84), fontWeight: '900', lineHeight: '1', color: isOne ? S.gold : S.text, textShadow: `0 0 30px ${col}${alphaHex(0.53 * S.glow)}` }, it.name),
      N('div', { marginTop: '36px', display: 'flex', flexDirection: 'column', gap: '22px' }, it.stats.map(([label, v], i) => {
        const k = easeOut((statsT - i * 350) / 650), shown = Math.round(v * k);
        return N('div', { opacity: String(clamp01((statsT - i * 350) / 200)) }, [
          N('div', { display: 'flex', justifyContent: 'space-between', fontSize: '34px', fontWeight: '800' }, [N('span', {}, label), N('span', {}, `${shown}/10`)]),
          N('div', { marginTop: '8px', height: '22px', borderRadius: '11px', background: S.muted, overflow: 'hidden' }, [
            N('div', { width: `${(v * 10 * k).toFixed(1)}%`, height: '100%', borderRadius: '11px', background: `linear-gradient(90deg, ${col}, ${S.barEnd})` }),
          ]),
        ]);
      })),
      it.fact ? N('div', { marginTop: '36px', display: 'inline-block', padding: '14px 24px', borderRadius: '16px', background: S.muted, fontSize: '32px', fontWeight: '800', opacity: String(clamp01((statsT - it.stats.length * 350 - 300) / 300)) }, '💡 ' + it.fact) : null,
    ].filter(Boolean)));
    out.push(N('div', { position: 'absolute', left: px(numX), top: px(numY), transform: `translate(-50%, -50%) scale(${numScale.toFixed(3)})`, fontFamily: S.num, fontSize: '260px', lineHeight: '1', color: isOne ? S.gold : S.numColor, WebkitTextStroke: `6px ${col}`, textShadow: `0 0 ${Math.round(40 * S.glow)}px ${col}`, opacity: String(clamp01(t / 120)), zIndex: '12', whiteSpace: 'nowrap' }, '#' + it.rank));
    if (t < 160) out.push(N('div', { position: 'absolute', inset: '0px', background: '#fff', opacity: String(0.5 * (1 - t / 160)), zIndex: '30' }));
    return out;
  }

  /* ───────────────────────── Escena: Historia ───────────────────────── */

  const PHOTO_FILTERS = { sepia: 'sepia(.85) contrast(1.05)', bn: 'grayscale(1) contrast(1.1)', 'blanco y negro': 'grayscale(1) contrast(1.1)', antigua: 'sepia(.6) contrast(.95) brightness(.95) blur(.4px)', color: 'none', '': 'none' };

  function sceneHist(p, plan, ms) {
    const { w: W, h: H } = C.canvasSize(p), V = H > W;
    const { seg, t, line: l, lt } = F.at(plan, ms);
    const S = F.histStyle(p), titleFont = F.brandFont(p, S.title);
    const hero = p.hist || {};
    const col = hero.color || '#f839f2', heroImg = hero.image || null;
    const amp = ampOf(l, lt);
    const fadeOut = clamp01((seg.dur * 1000 - t) / 400);
    const imgs = p.fmtImages || {};
    const LB = V ? Math.round(S.letterbox * 1.3) : S.letterbox;   // franjas negras de cine (arriba y abajo)
    const titleStyle = (size) => ({ fontFamily: titleFont, fontSize: px(size), color: S.text, fontStyle: S.italic ? 'italic' : 'normal', fontWeight: S.caps ? '800' : '400', letterSpacing: S.caps ? px(size * 0.12) : 'normal', textTransform: S.caps ? 'uppercase' : 'none', textAlign: 'center', lineHeight: '1.1' });
    const kids = [
      // Fondo: la foto pequeña y desenfocada, ampliada ×10 (igual a la vista y mucho más rápido de renderizar que un desenfoque grande).
      heroImg && S.bgFilter ? N('img', { position: 'absolute', left: '-100px', top: '-100px', width: px((W + 200) / 10), height: px((H + 200) / 10), objectFit: 'cover', filter: S.bgFilter, transform: 'scale(10)', transformOrigin: '0 0' }, null, { src: heroImg })
        : N('div', { position: 'absolute', inset: '0px', background: S.fallbackBg }),
      S.vignette ? N('div', { position: 'absolute', inset: '0px', background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${S.vignette}) 100%)` }) : null,
    ];
    const avatar = (size, extra) => N('div', { width: px(size), height: px(size), borderRadius: '50%', overflow: 'hidden', border: `${Math.round(size / 32)}px solid ${col}`, boxShadow: `0 0 36px ${col}`, transform: `translateY(${(-amp * 18).toFixed(1)}px) scale(${(1 + amp * 0.05).toFixed(3)})`, background: '#2a2018', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: px(size * 0.5), ...(extra || {}) }, [
      heroImg ? N('img', { width: '100%', height: '100%', objectFit: 'cover' }, null, { src: heroImg }) : '🎙️',
    ]);
    const nameTag = (small) => N('div', { marginTop: px(small ? 12 : 20), padding: small ? '6px 22px' : '8px 30px', borderRadius: '999px', background: col, color: '#fff', fontFamily: F.FONT, fontWeight: '900', fontSize: px(small ? 30 : 42) }, hero.name || 'Narrador');
    if (seg.kind === 'intro') {
      kids.push(N('div', { position: 'absolute', inset: '0px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: String(fadeOut), padding: '0 60px', boxSizing: 'border-box' }, [
        N('div', { transform: `scale(${(0.6 + 0.4 * easeOut(t / 800)).toFixed(3)})` }, [avatar(300)]),
        N('div', { marginTop: '40px', ...titleStyle(S.caps ? (V ? 64 : 84) : V ? 84 : 110), opacity: String(clamp01((t - 400) / 600)) }, seg.title),
      ]));
    }
    if (seg.kind === 'chapter') {
      kids.push(N('div', { position: 'absolute', inset: '0px', background: S.base === '#f4f1ea' ? 'rgba(244,241,234,.6)' : 'rgba(0,0,0,.55)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: String(Math.min(clamp01(t / 300), fadeOut)), padding: '0 60px', boxSizing: 'border-box' }, [
        N('div', { fontFamily: F.FONT, fontSize: '40px', fontWeight: '900', letterSpacing: '14px', color: col }, `CAPÍTULO ${seg.n}`),
        N('div', { marginTop: '18px', width: `${(easeOut((t - 200) / 700) * 700).toFixed(0)}px`, height: '4px', background: S.text }),
        N('div', { marginTop: '26px', ...titleStyle(S.caps ? (V ? 70 : 96) : V ? 100 : 130), opacity: String(clamp01((t - 300) / 500)), transform: `translateY(${((1 - easeOut((t - 300) / 500)) * 30).toFixed(1)}px)` }, seg.title),
      ]));
    }
    if (seg.kind === 'photo') {
      const src = imgs[F.imageKey('hist', seg.label)];
      const len = seg.dur * 1000, inK = easeOut(t / 700), k = clamp01(t / len);
      const scale = 1.05 + 0.13 * easeInOut(k), dir = (seg.start * 7) % 1 > 0.5 ? 1 : -1;
      const rot = -3 + 6 * ((seg.start * 7) % 1);
      const filter = PHOTO_FILTERS[seg.filter] || 'none';
      const kenBurns = N('div', { position: 'absolute', inset: '0px', transform: `translate(${(dir * 30 * easeInOut(k)).toFixed(1)}px, ${(-12 * easeInOut(k)).toFixed(1)}px) scale(${scale.toFixed(4)})` }, [
        src ? picture(src, '', 0, { filter })
          : N('div', { position: 'absolute', inset: '0px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '18px', color: '#bbb', fontFamily: F.FONT, fontSize: '40px', fontWeight: '800', background: 'repeating-linear-gradient(45deg,#2a2a2a 0 30px,#252525 30px 60px)' }, ['🖼️', `Falta la foto «${seg.label}»`]),
      ]);
      const chapterTag = (st) => (seg.chapter ? N('div', { fontFamily: F.FONT, fontSize: '30px', fontWeight: '900', letterSpacing: '4px', color: S.soft, ...st }, seg.chapter.toUpperCase()) : null);
      const side = V ? null : { right: 150, top: 300, width: 420 };
      let photo;
      if (S.frame === 'polaroid') {
        const box = V ? { left: 90, top: 250, w: 900, h: 700 } : { left: 150, top: 120, w: 1000, h: 760 };
        photo = N('div', { position: 'absolute', left: px(box.left), top: px(box.top), width: px(box.w), height: px(box.h), padding: '26px 26px 90px', boxSizing: 'border-box', background: '#fbf8f1', borderRadius: '8px', boxShadow: '0 24px 44px rgba(0,0,0,.55)', transform: `translateY(${((1 - inK) * -160).toFixed(1)}px) rotate(${(rot * (0.4 + 0.6 * inK)).toFixed(2)}deg) scale(${(1.1 - 0.1 * inK).toFixed(3)})`, opacity: String(clamp01(t / 250)) }, [
          N('div', { position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#222' }, [kenBurns, N('div', { position: 'absolute', inset: '0px', background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.4) 100%)' })]),
          N('div', { position: 'absolute', left: '0px', right: '0px', bottom: '22px', textAlign: 'center', fontFamily: S.label, fontSize: '40px', color: '#3a3026', opacity: String(clamp01((t - 500) / 400)) }, seg.label),
        ]);
      } else if (S.frame === 'full') {
        // Cine: la foto llena la pantalla entre las franjas negras; el rótulo, arriba a la izquierda.
        const box = V ? { left: 0, top: 300, w: W, h: 760 } : { left: 0, top: 0, w: W, h: H };
        photo = N('div', { position: 'absolute', left: px(box.left), top: px(box.top), width: px(box.w), height: px(box.h), overflow: 'hidden', opacity: String(clamp01(t / 500)) }, [
          kenBurns,
          N('div', { position: 'absolute', inset: '0px', background: 'linear-gradient(180deg, rgba(0,0,0,.55) 0%, transparent 30%, transparent 62%, rgba(0,0,0,.65) 100%)' }),
          N('div', { position: 'absolute', left: px(V ? 50 : 90), top: px((V ? 0 : LB) + 40), fontFamily: F.FONT, fontSize: '34px', fontWeight: '800', letterSpacing: '8px', textTransform: 'uppercase', color: S.text, opacity: String(clamp01((t - 400) / 500)), borderLeft: `6px solid ${col}`, paddingLeft: '20px' }, seg.label),
        ]);
      } else {
        // Documental (oscuro) o minimal (claro): foto limpia, sin girar, con el rótulo como faldón.
        const light = S.frame === 'light';
        const box = V ? { left: 70, top: 250, w: 940, h: 700 } : { left: 140, top: 130, w: 1040, h: 720 };
        photo = N('div', { position: 'absolute', left: px(box.left), top: px(box.top), width: px(box.w), height: px(box.h), boxSizing: 'border-box', border: light ? '14px solid #ffffff' : '2px solid rgba(255,255,255,.18)', borderRadius: light ? '6px' : '3px', boxShadow: light ? '0 18px 40px rgba(0,0,0,.18)' : '0 24px 50px rgba(0,0,0,.6)', overflow: 'hidden', background: '#222', transform: `translateY(${((1 - inK) * 40).toFixed(1)}px)`, opacity: String(clamp01(t / 400)) }, [
          kenBurns,
          N('div', { position: 'absolute', left: '0px', bottom: px(light ? 0 : 36), maxWidth: '86%', background: light ? 'rgba(255,255,255,.92)' : 'rgba(0,0,0,.72)', color: light ? '#1d1b18' : '#ffffff', borderLeft: `8px solid ${col}`, padding: '14px 28px', fontFamily: F.FONT, fontSize: '32px', fontWeight: '800', letterSpacing: '2px', textTransform: 'uppercase', transform: `translateX(${((1 - easeOut((t - 450) / 500)) * -110).toFixed(1)}%)`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, seg.label),
        ]);
      }
      kids.push(N('div', { position: 'absolute', inset: '0px', opacity: String(fadeOut) }, [
        photo,
        S.frame === 'full' ? null : chapterTag(V ? { position: 'absolute', left: '0px', right: '0px', top: '150px', textAlign: 'center' } : { position: 'absolute', right: '150px', top: '120px', width: '420px', textAlign: 'center' }),
      ].filter(Boolean)));
      const show = easeOut(t / 500) * fadeOut;
      if (S.frame === 'full' && !V) {
        kids.push(N('div', { position: 'absolute', right: '70px', top: px(LB + 40), display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: String(show) }, [avatar(190), nameTag(true)]));
      } else {
        kids.push(N('div', V ? { position: 'absolute', left: '0px', right: '0px', top: '1010px', display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: String(show) }
          : { position: 'absolute', right: px(side.right), top: px(side.top), width: px(side.width), display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: String(show), transform: `translateX(${((1 - show) * 200).toFixed(1)}px)` }, [avatar(V ? 260 : 380), nameTag()]));
      }
    }
    if (seg.kind === 'talk') {
      // Narración sin foto: el narrador grande en el centro.
      kids.push(N('div', { position: 'absolute', inset: '0px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: String(Math.min(clamp01(t / 300), fadeOut)) }, [
        avatar(V ? 420 : 440), nameTag(),
        seg.chapter ? N('div', { marginTop: '24px', fontFamily: F.FONT, fontSize: '30px', fontWeight: '900', letterSpacing: '4px', color: S.soft }, seg.chapter.toUpperCase()) : null,
      ].filter(Boolean)));
    }
    if (seg.kind === 'outro') {
      kids.push(N('div', { position: 'absolute', inset: '0px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '40px' }, [
        N('div', { ...titleStyle(S.caps ? 110 : 150), opacity: String(clamp01(t / 500)) }, 'Fin'),
        N('div', { padding: '20px 56px', borderRadius: '999px', background: F.subscribeColor(p), fontFamily: F.FONT, fontSize: '56px', fontWeight: '900', color: '#fff', transform: `scale(${(1 + 0.05 * Math.sin(t / 160)).toFixed(3)})`, opacity: String(clamp01((t - 700) / 300)) }, '🔔 ¿PARTE 2? SUSCRÍBETE'),
      ]));
    }
    if (LB) {
      kids.push(N('div', { position: 'absolute', left: '0px', right: '0px', top: '0px', height: px(LB), background: '#000', zIndex: '18' }));
      kids.push(N('div', { position: 'absolute', left: '0px', right: '0px', bottom: '0px', height: px(LB), background: '#000', zIndex: '18' }));
    }
    const subBox = V ? { w: W, left: 50, right: 50, bottom: 300, size: 44 } : LB ? { w: W, left: 120, right: 120, bottom: Math.max(10, (LB - 74) / 2), size: 42 } : { w: W, left: 80, right: 80, bottom: 46, size: 44 };
    if (seg.kind !== 'chapter') kids.push(karaoke(l, lt, subBox, S));
    return N('div', { position: 'absolute', left: '0px', top: '0px', width: px(W), height: px(H), overflow: 'hidden', background: S.base, fontFamily: F.FONT }, kids.filter(Boolean));
  }

  /* ───────────────────────── Transiciones entre bloques ───────────────────────── */

  F.TRANSITIONS = { auto: 'Original del estilo', fundido: 'Fundido a negro', barrido: 'Barrido de color', deslizar: 'Deslizar', zoom: 'Zoom', destello: 'Destello' };
  F.transitionOf = (p) => { const v = ((p.format === 'hist' ? p.hist : p.top) || {}).transition; return F.TRANSITIONS[v] ? v : 'auto'; };
  const TR_MS = { fundido: 450, barrido: 420, deslizar: 450, zoom: 420, destello: 260 };

  /** Envuelve la escena con la transición elegida: sale en los últimos ms de un bloque y entra en los primeros del siguiente. */
  const withTransition = (p, plan, ms, scene) => {
    const tr = F.transitionOf(p);
    if (tr === 'auto') return scene;
    const { w: W, h: H } = C.canvasSize(p);
    const { seg, t } = F.at(plan, ms), i = plan.segments.indexOf(seg), D = TR_MS[tr];
    const inK = i > 0 ? clamp01(t / D) : 1, outK = i < plan.segments.length - 1 ? clamp01((seg.dur * 1000 - t) / D) : 1;
    if (inK >= 1 && outK >= 1) return scene;
    const entering = inK < 1, k = entering ? inK : outK;   // 0 = en el corte, 1 = escena normal
    const color = (F.brand(p) && F.brand(p).color) || (p.format === 'hist' ? (p.hist || {}).color || '#f839f2' : F.topStyle(p).gold);
    let wrap = {}, over = null;
    if (tr === 'fundido') over = N('div', { position: 'absolute', inset: '0px', background: '#000', opacity: String(1 - easeInOut(k)), zIndex: '40' });
    if (tr === 'destello') over = N('div', { position: 'absolute', inset: '0px', background: '#fff', opacity: String(1 - k), zIndex: '40' });
    if (tr === 'zoom') {
      wrap = { transform: `scale(${(entering ? 1 + 0.25 * (1 - easeOut(k)) : 1 + 0.35 * Math.pow(1 - k, 2)).toFixed(4)})` };
      over = N('div', { position: 'absolute', inset: '0px', background: '#000', opacity: String(0.85 * (1 - easeInOut(k))), zIndex: '40' });
    }
    if (tr === 'deslizar') wrap = { transform: `translateX(${(entering ? (1 - easeOut(k)) * W : -Math.pow(1 - k, 2) * W).toFixed(1)}px)` };
    if (tr === 'barrido') {
      // Una franja del color de la marca (o del estilo) cruza la pantalla y tapa el corte.
      const x = entering ? easeInOut(1 - k) * 100 : -100 + easeInOut(1 - k) * 100;
      over = N('div', { position: 'absolute', left: '-10%', top: '0px', width: '120%', height: px(H), transform: `translateX(${x.toFixed(2)}%) skewX(-12deg)`, zIndex: '40' }, [
        N('div', { position: 'absolute', inset: '0px', background: color }),
        N('div', { position: 'absolute', top: '0px', bottom: '0px', [entering ? 'left' : 'right']: '-60px', width: '60px', background: '#ffffff', opacity: '0.85' }),
      ]);
    }
    return N('div', { position: 'absolute', left: '0px', top: '0px', width: px(W), height: px(H), overflow: 'hidden', background: '#000' }, [
      N('div', { position: 'absolute', left: '0px', top: '0px', width: px(W), height: px(H), ...wrap }, [scene]),
      over,
    ].filter(Boolean));
  };

  /** Árbol de nodos del fotograma en ms. */
  F.scene = (p, plan, ms) => withTransition(p, plan, ms, p.format === 'hist' ? sceneHist(p, plan, ms) : sceneTop(p, plan, ms));

  /* ───────────────────────── Kit de marca (todos los formatos) ───────────────────────── */

  /** Tipografías de marca (Google Fonts) con los grosores que existen de cada una. */
  F.BRAND_FONTS = { Montserrat: '400;700;900', Poppins: '400;700;900', Oswald: '400;700', 'Bebas Neue': '400', Anton: '400', 'Playfair Display': '400;700;900', 'Roboto Slab': '400;700;900' };
  F.brandFontUrl = (p) => {
    const b = F.brand(p), f = b && b.font;
    return f && F.BRAND_FONTS[f] ? `https://fonts.googleapis.com/css2?family=${f.replace(/ /g, '+')}:wght@${F.BRAND_FONTS[f]}&display=swap` : null;
  };
  /** Kit de marca del vídeo (null si el proyecto no lo usa). */
  F.brand = (p) => (p && p.brand && p.brand.on ? p.brand : null);
  F.brandFont = (p, fallback) => { const b = F.brand(p); return b && b.font && F.BRAND_FONTS[b.font] ? `"${b.font}", ${fallback}` : fallback; };
  F.subscribeColor = (p) => { const b = F.brand(p); return b && b.color ? b.color : '#ff0033'; };
  /** Segundos de la presentación y del cierre del canal (0 si están apagados). */
  F.brandTiming = (p) => {
    const b = F.brand(p), has = !!(b && (b.logo || b.name));
    return { intro: has && b.intro ? 3 : 0, outro: has && b.outro ? 5 : 0 };
  };

  const brandLogo = (b, size, st) => (b.logo
    ? N('img', { height: px(size), maxWidth: px(size * 3), objectFit: 'contain', ...(st || {}) }, null, { src: b.logo })
    : null);

  /** Presentación (phase 'intro') o cierre ('outro') del canal en el instante ms de esa parte. */
  F.brandCard = (p, phase, ms) => {
    const b = F.brand(p) || {}, { w: W, h: H } = C.canvasSize(p), V = H > W;
    const col = b.color || '#ffd166', font = F.brandFont(p, F.FONT), t = ms;
    const kids = [
      N('div', { position: 'absolute', inset: '0px', background: '#08090c' }),
      N('div', { position: 'absolute', inset: '0px', background: `radial-gradient(circle at 50% 45%, ${col}40 0%, transparent 55%)`, opacity: String(clamp01(t / 600)) }),
    ];
    if (phase === 'intro') {
      const k = back((t - 150) / 700), out = clamp01((3000 - t) / 450);
      kids.push(N('div', { position: 'absolute', inset: '0px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '34px', opacity: String(out) }, [
        b.logo ? N('div', { transform: `scale(${(0.5 + 0.5 * k).toFixed(4)})`, opacity: String(clamp01((t - 150) / 300)) }, [brandLogo(b, V ? 300 : 280, { filter: `drop-shadow(0 0 30px ${col}88)` })]) : null,
        b.name ? N('div', { fontFamily: font, fontSize: px(V ? 84 : 96), fontWeight: '900', color: '#ffffff', letterSpacing: px(4 + 14 * (1 - easeOut((t - 500) / 900))), opacity: String(clamp01((t - 500) / 500)), textAlign: 'center', padding: '0 60px' }, b.name) : null,
        N('div', { width: px(easeOut((t - 700) / 800) * (V ? 520 : 640)), height: '6px', borderRadius: '3px', background: col }),
      ].filter(Boolean)));
      // Brillo que cruza el logo.
      kids.push(N('div', { position: 'absolute', top: '0px', bottom: '0px', width: '220px', left: px(-300 + easeInOut((t - 900) / 900) * (W + 600)), background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.18), transparent)', transform: 'skewX(-18deg)', opacity: String(out) }));
    } else {
      const k = back((t - 200) / 650);
      kids.push(N('div', { position: 'absolute', inset: '0px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '30px', opacity: String(clamp01(t / 400) * clamp01((5000 - t) / 500)), padding: '0 60px', boxSizing: 'border-box' }, [
        N('div', { fontFamily: font, fontSize: '40px', fontWeight: '800', letterSpacing: '10px', color: 'rgba(255,255,255,.7)', textTransform: 'uppercase' }, 'Gracias por ver'),
        b.logo ? N('div', { transform: `scale(${(0.6 + 0.4 * k).toFixed(4)})` }, [brandLogo(b, V ? 240 : 200)]) : null,
        b.name ? N('div', { fontFamily: font, fontSize: px(V ? 76 : 84), fontWeight: '900', color: '#ffffff', textAlign: 'center' }, b.name) : null,
        N('div', { marginTop: '10px', padding: '22px 64px', borderRadius: '999px', background: col, color: '#ffffff', fontFamily: font, fontSize: '60px', fontWeight: '900', transform: `scale(${(1 + 0.05 * Math.sin(t / 160)).toFixed(3)})`, opacity: String(clamp01((t - 700) / 300)), textShadow: '0 2px 6px rgba(0,0,0,.35)' }, '🔔 SUSCRÍBETE'),
      ].filter(Boolean)));
    }
    return N('div', { position: 'absolute', left: '0px', top: '0px', width: px(W), height: px(H), overflow: 'hidden', background: '#08090c' }, kids);
  };

  /** Marca de agua del canal (logo o nombre) en la esquina elegida. null si está apagada. */
  F.watermark = (p) => {
    const b = F.brand(p);
    if (!b || !b.watermark || !(b.logo || b.name)) return null;
    const { w: W, h: H } = C.canvasSize(p), V = H > W, size = Math.max(40, Math.min(300, Number(b.wmSize) || 110));
    const pos = String(b.wmPos || 'br'), mx = V ? 40 : 36, top = V ? 110 : 30, bottom = V ? 320 : 30;
    return N('div', { position: 'absolute', [pos[1] === 'l' ? 'left' : 'right']: px(mx), [pos[0] === 't' ? 'top' : 'bottom']: px(pos[0] === 't' ? top : bottom), opacity: String(Math.max(0.1, Math.min(1, (Number(b.wmOpacity) || 70) / 100))), zIndex: '60', pointerEvents: 'none', display: 'flex', alignItems: 'center' }, [
      b.logo ? brandLogo(b, size, { filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.5))' })
        : N('div', { fontFamily: F.brandFont(p, F.FONT), fontSize: px(size * 0.32), fontWeight: '900', color: '#ffffff', textShadow: '0 2px 8px rgba(0,0,0,.7)', whiteSpace: 'nowrap' }, b.name),
    ]);
  };

  /* ───────────────────────── Ejemplos ───────────────────────── */

  F.EXAMPLE_TOP = `Titulo: "Los 5 perros más inteligentes"
intro: Estos son los cinco perros más inteligentes del mundo. ¿Adivinas cuál es el número uno?
puesto: 5 | Dóberman | 🐕 | Inteligencia 8 | Energía 9 | Obediencia 9 | Dato: Aprende una orden nueva en menos de 5 repeticiones
narrador: Número cinco: el dóberman. Leal, rápido, y capaz de aprender una orden nueva en menos de cinco repeticiones.
puesto: 4 | Golden Retriever | 🦮 | Inteligencia 8 | Energía 8 | Simpatía 10 | Dato: Perro guía y de rescate por excelencia
narrador: Número cuatro: el golden retriever. Tan listo como bueno. Aunque su mayor talento sea robar calcetines.
puesto: 3 | Pastor Alemán | 🐕‍🦺 | Inteligencia 9 | Energía 9 | Obediencia 9 | Dato: Policía, rescatista y perro guía
narrador: Número tres: el pastor alemán. Policía, rescatista y guía. Si hay un trabajo, él lo aprende.
puesto: 2 | Caniche | 🐩 | Inteligencia 10 | Energía 7 | Peinado 10 | Dato: Uno de los cerebros más brillantes del mundo canino
narrador: Número dos: el caniche. Detrás de ese peinado hay uno de los cerebros más brillantes del mundo canino.
redoble: Y el número uno es…
puesto: 1 | Border Collie | 🐶 | Inteligencia 10 | Energía 10 | Obediencia 10 | Dato: Entiende más de 1.000 palabras
narrador: ¡El border collie! Entiende más de mil palabras. Y si te descuidas, te organiza la casa.
final: ¿Cuál es tu favorito? Te leo en los comentarios.`;

  F.EXAMPLE_HIST = `Titulo: "La historia de Algodón"
intro: Hola. Soy Algodón. Y esta es mi historia.
capitulo: Los orígenes
foto: Granja Los Prados · 2021 | sepia
Algodón: Nací en una granja pequeñita. Era la más pequeña de seis hermanos. Y la más lista.
foto: Mi primer hogar
Algodón: Allí aprendí lo importante de la vida: las zanahorias se comen, y los humanos se ablandan con una mirada.
capitulo: El primer cable
foto: El salón · Marzo 2022
Algodón: Un día encontré algo largo, negro y crujiente detrás del sofá. Fue amor a primer mordisco.
capitulo: La leyenda
foto: Hoy
Algodón: Hoy soy la reina de esta casa. Y ningún cable está a salvo.
final: Fin. ¿Quieres la segunda parte? Suscríbete.`;

  root.ChatFormats = F;
})(typeof globalThis !== 'undefined' ? globalThis : window);
