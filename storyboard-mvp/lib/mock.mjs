// Modo demo: permite recorrer todo el flujo sin API key (imágenes SVG de marcador, sin video real).
const ROUTINE = [
  ['Despertar en la litera', '05:10', 'litera', 'Se despierta en la litera, apaga la alarma del móvil y se estira.', 'Plano medio cenital desde el techo de la litera', 'Overhead medium shot of the woman waking up in the sleeper berth, phone alarm glowing, warm reading light, pre-dawn blue through the curtain', 'She stretches slowly and turns off the alarm, the curtain sways a little, soft engine idle hum'],
  ['Café en la cabina', '05:30', 'asiento del copiloto', 'Prepara café en la cafetera de 12V y lo sopla.', 'Primer plano de manos y taza, perfil', 'Close-up of her hands holding a steaming mug inside the cab, 12V coffee maker on the console, steam backlit by dawn light', 'Steam rises from the mug, she blows on it and takes a sip, slow push-in, quiet morning birds outside'],
  ['Inspección pre-viaje', '06:00', 'exterior del camión', 'Revisa llantas y luces con una linterna.', 'Plano general bajo, gran angular', 'Low wide-angle shot of the woman inspecting the truck tires with a flashlight at dawn in a truck stop parking lot', 'She walks along the trailer pointing the flashlight at the tires, camera tracks sideways, gravel crunching'],
  ['En la carretera', '08:15', 'asiento del conductor', 'Maneja con el sol de frente, sonriendo.', 'Plano medio desde el tablero', 'Dashboard-mounted medium shot of the woman driving, both hands on the wheel, golden sunlight flaring through the windshield, open highway ahead', 'She drives and glances at the mirror, the landscape flows by, sunlight flickers across her face, engine and road noise'],
  ['Comida en la parada', '13:00', 'parada de camiones', 'Come algo rápido en la cabina mirando el mapa.', 'POV sobre el tablero', 'POV shot over the dashboard: sandwich on a paper wrap, paper road map and phone GPS, her hand reaching for a drink', 'Her hand picks up the sandwich, the map rustles, camera drifts slightly, distant trucks passing'],
  ['Noche en la litera', '22:30', 'litera', 'Se acuesta con una lámpara cálida y cierra la cortina.', 'Plano medio lateral', 'Side medium shot of the woman lying in the sleeper berth under a warm lamp, blanket, small personal decorations, night outside', 'She pulls the curtain closed and switches off the lamp, slow dolly-out, quiet rain on the roof'],
];

export function mockStoryboard(count) {
  return Array.from({ length: count }, (_, i) => {
    const [title, time, location, action, camera, imagePrompt, motionPrompt] = ROUTINE[i % ROUTINE.length];
    return { title, time, location, action, camera, imagePrompt, motionPrompt };
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function wrap(text, width) {
  const out = [];
  let line = '';
  for (const w of String(text).split(/\s+/)) {
    if ((line + ' ' + w).trim().length > width) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out.slice(0, 8);
}

export function mockImage(title, subtitle, aspectRatio = '9:16') {
  const [w, h] = aspectRatio === '16:9' ? [1280, 720] : [720, 1280];
  let hue = 0;
  for (const c of title) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  const lines = wrap(subtitle, 34).map((l, i) => `<text x="50%" y="${h / 2 + 40 + i * 34}" font-size="24" fill="#fff" fill-opacity=".85" text-anchor="middle">${esc(l)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,28%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},55%,12%)"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<text x="50%" y="${h / 2 - 30}" font-family="sans-serif" font-size="40" font-weight="700" fill="#fff" text-anchor="middle">${esc(title)}</text>
<g font-family="sans-serif">${lines}</g>
<text x="50%" y="${h - 40}" font-family="sans-serif" font-size="20" fill="#fff" fill-opacity=".5" text-anchor="middle">MODO DEMO · conecta tu cuenta para generar de verdad</text>
</svg>`;
  return { mimeType: 'image/svg+xml', buffer: Buffer.from(svg) };
}
