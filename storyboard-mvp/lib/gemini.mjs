// Cliente REST mínimo de la Gemini API (Google AI Studio).
// Son los mismos modelos que usa Google Flow: Nano Banana (imágenes) y Veo (video).
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function call(apiKey, urlPath, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/${urlPath}`, {
    method,
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.error?.message || text.slice(0, 300) || res.statusText;
    throw Object.assign(new Error(`Gemini API ${res.status}: ${msg}`), { status: res.status === 401 || res.status === 403 ? 401 : 502 });
  }
  return json;
}

/** Comprueba la key listando modelos; devuelve los ids de imagen/video/texto disponibles. */
export async function testConnection(apiKey) {
  const r = await call(apiKey, 'models?pageSize=200');
  const names = (r.models || []).map((m) => m.name.replace(/^models\//, ''));
  return {
    image: names.filter((n) => /image/.test(n)),
    video: names.filter((n) => /^veo/.test(n)),
    text: names.filter((n) => /^gemini/.test(n) && !/image|tts|embedding|live|audio/.test(n)),
  };
}

/** Texto -> JSON con esquema (planificación del storyboard). */
export async function generateJson(apiKey, model, prompt, schema) {
  const r = await call(apiKey, `models/${model}:generateContent`, {
    method: 'POST',
    body: {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.9 },
    },
  });
  const text = r.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  try { return JSON.parse(text); } catch { throw new Error('El modelo no devolvió JSON válido'); }
}

/**
 * Imagen con referencias (hoja de estilo del personaje + interior del camión).
 * refs: [{ label, mimeType, data(base64) }]
 */
export async function generateImage(apiKey, model, prompt, refs, aspectRatio) {
  const parts = [];
  for (const ref of refs) {
    parts.push({ text: ref.label });
    parts.push({ inline_data: { mime_type: ref.mimeType, data: ref.data } });
  }
  parts.push({ text: prompt });
  const r = await call(apiKey, `models/${model}:generateContent`, {
    method: 'POST',
    body: {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio } },
    },
  });
  const out = r.candidates?.[0]?.content?.parts || [];
  const img = out.find((p) => p.inlineData || p.inline_data);
  if (!img) {
    const why = r.candidates?.[0]?.finishReason || r.promptFeedback?.blockReason || out.map((p) => p.text).join(' ');
    throw new Error(`No se generó imagen (${why || 'sin motivo'}). Ajusta el prompt e inténtalo de nuevo.`);
  }
  const d = img.inlineData || img.inline_data;
  return { mimeType: d.mimeType || d.mime_type, buffer: Buffer.from(d.data, 'base64') };
}

/** Lanza Veo imagen->video. Devuelve el nombre de la operación de larga duración. */
export async function startVideo(apiKey, model, { prompt, image, aspectRatio, durationSeconds }) {
  const parameters = { aspectRatio, personGeneration: 'allow_adult' };
  if (durationSeconds) parameters.durationSeconds = Number(durationSeconds);
  const r = await call(apiKey, `models/${model}:predictLongRunning`, {
    method: 'POST',
    body: {
      instances: [{ prompt, image: { bytesBase64Encoded: image.data, mimeType: image.mimeType } }],
      parameters,
    },
  });
  if (!r.name) throw new Error('Veo no devolvió una operación');
  return r.name;
}

/** Consulta la operación. {done:false} | {done:true, buffer} | lanza error. */
export async function pollVideo(apiKey, operationName) {
  const op = await call(apiKey, operationName);
  if (!op.done) return { done: false };
  if (op.error) throw new Error(`Veo: ${op.error.message}`);
  const resp = op.response?.generateVideoResponse;
  const uri = resp?.generatedSamples?.[0]?.video?.uri;
  if (!uri) {
    const why = resp?.raiMediaFilteredReasons?.join(' ') || 'el video fue filtrado o no se generó';
    throw new Error(`Veo: ${why}`);
  }
  const res = await fetch(uri, { headers: { 'x-goog-api-key': apiKey }, redirect: 'follow' });
  if (!res.ok) throw new Error(`No se pudo descargar el video (${res.status})`);
  return { done: true, buffer: Buffer.from(await res.arrayBuffer()) };
}
