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
          if (!item.emoji && !/[\p{L}\p{N}]/u.test(x)) item.emoji = x;
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
    const plan = finish(segs, () => []);
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

  /** Subtítulo palabra a palabra de la frase que suena. */
  const karaoke = (l, lt, box) => {
    if (!l) return null;
    const parts = l.text.split(/(\s+)/), total = parts.reduce((a, w) => a + (w.trim() ? w.length + 1 : 0), 0) || 1;
    const done = clamp01(lt / (l.dur * 1000)) * total;
    let acc = 0;
    const kids = parts.map((w) => {
      if (!w.trim()) return w;
      const a = acc; acc += w.length + 1;
      const st = done >= acc ? 1 : done >= a ? 2 : 0;
      return N('span', { opacity: st === 0 ? '0.35' : '1', color: st === 2 ? '#ffd166' : '#ffffff' }, w.replace(/\*/g, ''));
    });
    return N('div', { position: 'absolute', left: px(box.left), right: px(box.right), bottom: px(box.bottom), display: 'flex', justifyContent: 'center', zIndex: '20' }, [
      N('div', { background: 'rgba(0,0,0,.62)', borderRadius: '20px', padding: '16px 34px', fontFamily: F.FONT, fontWeight: '800', fontSize: px(box.size || 46), color: '#fff', textAlign: 'center', lineHeight: '1.22', maxWidth: '1500px' }, kids),
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
    const accent = seg.kind === 'item' ? (seg.item.rank === 1 ? '#ffd166' : topColor(seg.item, plan)) : seg.kind === 'drum' ? '#ffd166' : '#118ab2';
    const kids = [
      N('div', { position: 'absolute', inset: '0px', background: 'linear-gradient(135deg, #0d1321 0%, #1b2440 100%)' }),
      N('div', { position: 'absolute', left: '-200px', top: '-200px', right: '-200px', bottom: '-200px', background: 'repeating-linear-gradient(115deg, rgba(255,255,255,.035) 0 40px, transparent 40px 120px)', transform: `translateX(${((ms / 25) % 120).toFixed(1)}px)` }),
      N('div', { position: 'absolute', inset: '0px', background: `radial-gradient(circle at ${V ? '50% 30%' : '30% 50%'}, ${accent}55 0%, transparent 55%)` }),
    ];
    if (seg.kind === 'intro') {
      kids.push(N('div', { position: 'absolute', inset: '0px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: F.FONT, color: '#fff', padding: '0 80px', boxSizing: 'border-box' }, [
        N('div', { fontSize: '40px', fontWeight: '900', letterSpacing: '10px', color: '#ffd166', opacity: String(clamp01(t / 400)) }, `🏆 TOP ${plan.items.length}`),
        N('div', { marginTop: '20px', fontSize: px(V ? 96 : 116), fontWeight: '900', textAlign: 'center', lineHeight: '1.05', transform: `scale(${(0.7 + 0.3 * back(t / 700)).toFixed(3)})` }, seg.title),
        N('div', { marginTop: '40px', display: 'flex', gap: '26px', flexWrap: 'wrap', justifyContent: 'center' }, plan.items.slice().sort((a, b) => a.rank - b.rank).slice(0, 6).map((it, i) => {
          const src = imgs[F.imageKey('top', it.name)];
          return N('div', { position: 'relative', width: '130px', height: '130px', borderRadius: '50%', overflow: 'hidden', background: 'rgba(255,255,255,.1)', border: '4px solid rgba(255,255,255,.25)', opacity: String(clamp01((t - 500 - i * 150) / 250)), transform: `translateY(${(Math.sin(t / 250 + i) * 10).toFixed(1)}px)`, filter: it.rank === 1 ? 'blur(10px)' : 'none' }, [picture(src, it.emoji, 80)]);
        })),
      ]));
    }
    if (seg.kind === 'drum') {
      kids.push(N('div', { position: 'absolute', inset: '0px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F.FONT, padding: '0 60px', boxSizing: 'border-box' }, [
        N('div', { fontSize: px(V ? 96 : 120), fontWeight: '900', color: '#ffd166', textAlign: 'center', transform: `scale(${(1 + 0.04 * Math.sin(t / 40)).toFixed(3)}) translateX(${(Math.sin(t / 17) * (t / 260)).toFixed(1)}px)`, textShadow: '0 0 40px #ffd16688' }, '🥁 ' + (l ? l.text : 'Y el número 1 es…')),
      ]));
    }
    if (seg.kind === 'item') kids.push(...topItem(p, plan, seg, t, W, H, V, imgs));
    if (seg.kind === 'outro') {
      kids.push(N('div', { position: 'absolute', inset: '0px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: F.FONT, color: '#fff', gap: '40px', padding: '0 60px', boxSizing: 'border-box' }, [
        N('div', { fontSize: px(V ? 80 : 96), fontWeight: '900', textAlign: 'center', transform: `scale(${(0.7 + 0.3 * back(t / 600)).toFixed(3)})` }, '¿Cuál es tu favorito? 💬'),
        N('div', { padding: '22px 60px', borderRadius: '999px', background: '#ff0033', fontSize: '64px', fontWeight: '900', transform: `scale(${(1 + 0.05 * Math.sin(t / 160)).toFixed(3)})`, opacity: String(clamp01((t - 600) / 300)) }, '🔔 SUSCRÍBETE'),
      ]));
    }
    // Escalera de puestos (horizontal): revelados, actual resaltado y «???» en los que faltan.
    if (!V && (seg.kind === 'item' || seg.kind === 'drum')) {
      const shownRanks = new Set(plan.segments.filter((s) => s.kind === 'item' && ms / 1000 >= s.start + 0.9).map((s) => s.item.rank));
      const cur = seg.kind === 'item' ? seg.item.rank : 0;
      kids.push(N('div', { position: 'absolute', right: '40px', top: '120px', width: '340px', display: 'flex', flexDirection: 'column', gap: '14px', fontFamily: F.FONT, zIndex: '10' },
        plan.items.slice().sort((a, b) => a.rank - b.rank).slice(0, 10).map((it) => {
          const on = shownRanks.has(it.rank), isCur = it.rank === cur, col = it.rank === 1 ? '#ffd166' : topColor(it, plan);
          return N('div', { display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 18px', borderRadius: '16px', background: isCur ? col : 'rgba(255,255,255,.07)', color: isCur ? '#111' : '#fff', transform: `scale(${isCur ? 1.06 : 1})`, boxShadow: isCur ? `0 0 30px ${col}88` : 'none', border: '2px solid rgba(255,255,255,.08)' }, [
            N('div', { fontSize: '34px', fontWeight: '900', width: '62px' }, '#' + it.rank),
            N('div', { fontSize: '28px', fontWeight: '800', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, on ? `${it.emoji ? it.emoji + ' ' : ''}${it.name}` : '???'),
          ]);
        })));
    }
    if (seg.kind !== 'drum') kids.push(karaoke(l, lt, V ? { left: 50, right: 50, bottom: 300, size: 44 } : { left: 120, right: seg.kind === 'item' ? 420 : 120, bottom: 54 }));
    return N('div', { position: 'absolute', left: '0px', top: '0px', width: px(W), height: px(H), overflow: 'hidden', background: '#0d1321', fontFamily: F.FONT }, kids.filter(Boolean));
  }

  const TOP_COLORS = ['#e76f51', '#f4a261', '#2a9d8f', '#9b5de5', '#118ab2', '#ef476f', '#06d6a0', '#ff9f1c', '#8ac926', '#4cc9f0'];
  const topColor = (it, plan) => TOP_COLORS[Math.max(0, plan.items.indexOf(it)) % TOP_COLORS.length];

  function topItem(p, plan, seg, t, W, H, V, imgs) {
    const it = seg.item, col = it.rank === 1 ? '#ffd166' : topColor(it, plan), isOne = it.rank === 1;
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
    out.push(N('div', { position: 'absolute', left: px(card.left), top: px(card.top), width: px(card.size), height: px(card.size), borderRadius: '40px', overflow: 'hidden', transform: `translateY(${((1 - cardK) * 120).toFixed(1)}px) scale(${(0.85 + 0.15 * cardK).toFixed(3)})`, opacity: String(clamp01((t - 850) / 250)), boxShadow: `0 30px 70px rgba(0,0,0,.55), 0 0 0 8px ${col}`, background: `radial-gradient(circle at 50% 40%, ${col} 0%, ${col}55 45%, #11182b 100%)` }, [
      N('div', { position: 'absolute', inset: '0px', transform: `scale(${(1 + 0.08 * clamp01(t / (seg.dur * 1000))).toFixed(4)})` }, [picture(src, it.emoji || '⭐', 380)]),
      isOne && t > 900 ? N('div', { position: 'absolute', left: '0px', right: '0px', top: '16px', textAlign: 'center', fontSize: '120px', lineHeight: '1', transform: `translateY(${((1 - back((t - 1000) / 500)) * -200).toFixed(1)}px)` }, '👑') : null,
    ].filter(Boolean)));
    out.push(N('div', { position: 'absolute', left: px(info.left), top: px(info.top), width: px(info.width), fontFamily: F.FONT, color: '#fff', opacity: String(clamp01((t - 1000) / 300)), transform: `translateX(${((1 - easeOut((t - 1000) / 400)) * 80).toFixed(1)}px)` }, [
      N('div', { fontSize: px(isOne ? 92 : 84), fontWeight: '900', lineHeight: '1', color: isOne ? '#ffd166' : '#fff', textShadow: `0 0 30px ${col}88` }, it.name),
      N('div', { marginTop: '36px', display: 'flex', flexDirection: 'column', gap: '22px' }, it.stats.map(([label, v], i) => {
        const k = easeOut((statsT - i * 350) / 650), shown = Math.round(v * k);
        return N('div', { opacity: String(clamp01((statsT - i * 350) / 200)) }, [
          N('div', { display: 'flex', justifyContent: 'space-between', fontSize: '34px', fontWeight: '800' }, [N('span', {}, label), N('span', {}, `${shown}/10`)]),
          N('div', { marginTop: '8px', height: '22px', borderRadius: '11px', background: 'rgba(255,255,255,.12)', overflow: 'hidden' }, [
            N('div', { width: `${(v * 10 * k).toFixed(1)}%`, height: '100%', borderRadius: '11px', background: `linear-gradient(90deg, ${col}, #ffffff)` }),
          ]),
        ]);
      })),
      it.fact ? N('div', { marginTop: '36px', display: 'inline-block', padding: '14px 24px', borderRadius: '16px', background: 'rgba(255,255,255,.1)', fontSize: '32px', fontWeight: '800', opacity: String(clamp01((statsT - it.stats.length * 350 - 300) / 300)) }, '💡 ' + it.fact) : null,
    ].filter(Boolean)));
    out.push(N('div', { position: 'absolute', left: px(numX), top: px(numY), transform: `translate(-50%, -50%) scale(${numScale.toFixed(3)})`, fontFamily: 'Impact, "Arial Black", sans-serif', fontSize: '260px', lineHeight: '1', color: isOne ? '#ffd166' : '#fff', WebkitTextStroke: `6px ${col}`, textShadow: `0 0 40px ${col}`, opacity: String(clamp01(t / 120)), zIndex: '12', whiteSpace: 'nowrap' }, '#' + it.rank));
    if (t < 160) out.push(N('div', { position: 'absolute', inset: '0px', background: '#fff', opacity: String(0.5 * (1 - t / 160)), zIndex: '30' }));
    return out;
  }

  /* ───────────────────────── Escena: Historia ───────────────────────── */

  const PHOTO_FILTERS = { sepia: 'sepia(.85) contrast(1.05)', bn: 'grayscale(1) contrast(1.1)', 'blanco y negro': 'grayscale(1) contrast(1.1)', antigua: 'sepia(.6) contrast(.95) brightness(.95) blur(.4px)', color: 'none', '': 'none' };

  function sceneHist(p, plan, ms) {
    const { w: W, h: H } = C.canvasSize(p), V = H > W;
    const { seg, t, line: l, lt } = F.at(plan, ms);
    const hero = p.hist || {};
    const col = hero.color || '#f839f2', heroImg = hero.image || null;
    const amp = ampOf(l, lt);
    const fadeOut = clamp01((seg.dur * 1000 - t) / 400);
    const imgs = p.fmtImages || {};
    const kids = [
      // Fondo: la foto pequeña y desenfocada, ampliada ×10 (igual a la vista y mucho más rápido de renderizar que un desenfoque grande).
      heroImg ? N('img', { position: 'absolute', left: '-100px', top: '-100px', width: px((W + 200) / 10), height: px((H + 200) / 10), objectFit: 'cover', filter: 'blur(6px) brightness(.35) sepia(.4)', transform: 'scale(10)', transformOrigin: '0 0' }, null, { src: heroImg })
        : N('div', { position: 'absolute', inset: '0px', background: 'radial-gradient(circle at 50% 40%, #3a2a1c 0%, #14100c 70%)' }),
      N('div', { position: 'absolute', inset: '0px', background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,.7) 100%)' }),
    ];
    const avatar = (size, extra) => N('div', { width: px(size), height: px(size), borderRadius: '50%', overflow: 'hidden', border: `${Math.round(size / 32)}px solid ${col}`, boxShadow: `0 0 36px ${col}`, transform: `translateY(${(-amp * 18).toFixed(1)}px) scale(${(1 + amp * 0.05).toFixed(3)})`, background: '#2a2018', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: px(size * 0.5), ...(extra || {}) }, [
      heroImg ? N('img', { width: '100%', height: '100%', objectFit: 'cover' }, null, { src: heroImg }) : '🎙️',
    ]);
    const nameTag = () => N('div', { marginTop: '20px', padding: '8px 30px', borderRadius: '999px', background: col, color: '#fff', fontFamily: F.FONT, fontWeight: '900', fontSize: '42px' }, hero.name || 'Narrador');
    if (seg.kind === 'intro') {
      kids.push(N('div', { position: 'absolute', inset: '0px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: String(fadeOut), padding: '0 60px', boxSizing: 'border-box' }, [
        N('div', { transform: `scale(${(0.6 + 0.4 * easeOut(t / 800)).toFixed(3)})` }, [avatar(300)]),
        N('div', { marginTop: '40px', fontFamily: F.SERIF, fontSize: px(V ? 84 : 110), color: '#fff6e6', fontStyle: 'italic', textAlign: 'center', opacity: String(clamp01((t - 400) / 600)) }, seg.title),
      ]));
    }
    if (seg.kind === 'chapter') {
      kids.push(N('div', { position: 'absolute', inset: '0px', background: 'rgba(0,0,0,.55)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: String(Math.min(clamp01(t / 300), fadeOut)), padding: '0 60px', boxSizing: 'border-box' }, [
        N('div', { fontFamily: F.FONT, fontSize: '40px', fontWeight: '900', letterSpacing: '14px', color: col }, `CAPÍTULO ${seg.n}`),
        N('div', { marginTop: '18px', width: `${(easeOut((t - 200) / 700) * 700).toFixed(0)}px`, height: '4px', background: '#fff6e6' }),
        N('div', { marginTop: '26px', fontFamily: F.SERIF, fontSize: px(V ? 100 : 130), color: '#fff6e6', fontStyle: 'italic', textAlign: 'center', opacity: String(clamp01((t - 300) / 500)), transform: `translateY(${((1 - easeOut((t - 300) / 500)) * 30).toFixed(1)}px)` }, seg.title),
      ]));
    }
    if (seg.kind === 'photo') {
      const src = imgs[F.imageKey('hist', seg.label)];
      const len = seg.dur * 1000, inK = easeOut(t / 700), k = clamp01(t / len);
      const scale = 1.05 + 0.13 * easeInOut(k), dir = (seg.start * 7) % 1 > 0.5 ? 1 : -1;
      const rot = -3 + 6 * ((seg.start * 7) % 1);
      const box = V ? { left: 90, top: 250, w: 900, h: 700 } : { left: 150, top: 120, w: 1000, h: 760 };
      kids.push(N('div', { position: 'absolute', inset: '0px', opacity: String(fadeOut) }, [
        N('div', { position: 'absolute', left: px(box.left), top: px(box.top), width: px(box.w), height: px(box.h), padding: '26px 26px 90px', boxSizing: 'border-box', background: '#fbf8f1', borderRadius: '8px', boxShadow: '0 24px 44px rgba(0,0,0,.55)', transform: `translateY(${((1 - inK) * -160).toFixed(1)}px) rotate(${(rot * (0.4 + 0.6 * inK)).toFixed(2)}deg) scale(${(1.1 - 0.1 * inK).toFixed(3)})`, opacity: String(clamp01(t / 250)) }, [
          N('div', { position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#222' }, [
            N('div', { position: 'absolute', inset: '0px', transform: `translate(${(dir * 30 * easeInOut(k)).toFixed(1)}px, ${(-12 * easeInOut(k)).toFixed(1)}px) scale(${scale.toFixed(4)})` }, [
              src ? picture(src, '', 0, { filter: PHOTO_FILTERS[seg.filter] || 'none' })
                : N('div', { position: 'absolute', inset: '0px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '18px', color: '#bbb', fontFamily: F.FONT, fontSize: '40px', fontWeight: '800', background: 'repeating-linear-gradient(45deg,#2a2a2a 0 30px,#252525 30px 60px)' }, ['🖼️', `Falta la foto «${seg.label}»`]),
            ]),
            N('div', { position: 'absolute', inset: '0px', background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.4) 100%)' }),
          ]),
          N('div', { position: 'absolute', left: '0px', right: '0px', bottom: '22px', textAlign: 'center', fontFamily: '"Segoe Print", "Comic Sans MS", cursive', fontSize: '40px', color: '#3a3026', opacity: String(clamp01((t - 500) / 400)) }, seg.label),
        ]),
        seg.chapter ? N('div', V ? { position: 'absolute', left: '0px', right: '0px', top: '150px', textAlign: 'center', fontFamily: F.FONT, fontSize: '30px', fontWeight: '900', letterSpacing: '4px', color: 'rgba(255,246,230,.75)' }
          : { position: 'absolute', right: '150px', top: '120px', width: '420px', textAlign: 'center', fontFamily: F.FONT, fontSize: '30px', fontWeight: '900', letterSpacing: '4px', color: 'rgba(255,246,230,.75)' }, seg.chapter.toUpperCase()) : null,
      ].filter(Boolean)));
      const show = easeOut(t / 500) * fadeOut;
      kids.push(N('div', V ? { position: 'absolute', left: '0px', right: '0px', top: '1010px', display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: String(show) }
        : { position: 'absolute', right: '150px', top: '300px', width: '420px', display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: String(show), transform: `translateX(${((1 - show) * 200).toFixed(1)}px)` }, [avatar(V ? 260 : 380), nameTag()]));
    }
    if (seg.kind === 'talk') {
      // Narración sin foto: el narrador grande en el centro.
      kids.push(N('div', { position: 'absolute', inset: '0px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: String(Math.min(clamp01(t / 300), fadeOut)) }, [
        avatar(V ? 420 : 440), nameTag(),
        seg.chapter ? N('div', { marginTop: '24px', fontFamily: F.FONT, fontSize: '30px', fontWeight: '900', letterSpacing: '4px', color: 'rgba(255,246,230,.75)' }, seg.chapter.toUpperCase()) : null,
      ].filter(Boolean)));
    }
    if (seg.kind === 'outro') {
      kids.push(N('div', { position: 'absolute', inset: '0px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '40px' }, [
        N('div', { fontFamily: F.SERIF, fontSize: '150px', color: '#fff6e6', fontStyle: 'italic', opacity: String(clamp01(t / 500)) }, 'Fin'),
        N('div', { padding: '20px 56px', borderRadius: '999px', background: '#ff0033', fontFamily: F.FONT, fontSize: '56px', fontWeight: '900', color: '#fff', transform: `scale(${(1 + 0.05 * Math.sin(t / 160)).toFixed(3)})`, opacity: String(clamp01((t - 700) / 300)) }, '🔔 ¿PARTE 2? SUSCRÍBETE'),
      ]));
    }
    if (seg.kind !== 'chapter') kids.push(karaoke(l, lt, V ? { left: 50, right: 50, bottom: 300, size: 44 } : { left: 80, right: 80, bottom: 46, size: 44 }));
    return N('div', { position: 'absolute', left: '0px', top: '0px', width: px(W), height: px(H), overflow: 'hidden', background: '#14100c', fontFamily: F.FONT }, kids.filter(Boolean));
  }

  /** Árbol de nodos del fotograma en ms. */
  F.scene = (p, plan, ms) => (p.format === 'hist' ? sceneHist(p, plan, ms) : sceneTop(p, plan, ms));

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
