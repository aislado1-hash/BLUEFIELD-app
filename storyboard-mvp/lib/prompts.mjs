// Todo el texto que se le manda a los modelos vive aquí.
// Los prompts de imagen/video van en inglés (los modelos rinden mejor); la UI y el storyboard en español.

export const STORYBOARD_SCHEMA = {
  type: 'OBJECT',
  properties: {
    scenes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING', description: 'Título corto en español' },
          time: { type: 'STRING', description: 'Hora del día, p. ej. 05:30' },
          location: { type: 'STRING', description: 'Zona: litera, asiento del conductor, tablero, exterior del camión, parada de camiones...' },
          action: { type: 'STRING', description: 'Qué hace ella, en español, 1-2 frases' },
          camera: { type: 'STRING', description: 'Plano y ángulo, en español' },
          imagePrompt: { type: 'STRING', description: 'Prompt en inglés para el fotograma clave' },
          motionPrompt: { type: 'STRING', description: 'Prompt en inglés para animar el fotograma (movimiento, cámara, sonido ambiente)' },
        },
        required: ['title', 'time', 'location', 'action', 'camera', 'imagePrompt', 'motionPrompt'],
      },
    },
  },
  required: ['scenes'],
};

const characterText = (c) => [
  c.name && `Name: ${c.name}.`,
  c.description && `Appearance: ${c.description}.`,
  c.outfit && `Outfit: ${c.outfit}.`,
].filter(Boolean).join(' ') || 'A female truck driver.';

export function storyboardPrompt(p) {
  return `Eres guionista y director de fotografía de videos cortos verticales tipo "day in the life" de mujeres camioneras / conductoras de tráiler.
Crea un storyboard de EXACTAMENTE ${p.routine.sceneCount} escenas en orden cronológico que cuente su rutina.

PERSONAJE: ${characterText(p.character)}
INTERIOR DEL CAMIÓN (el set principal, debe respetarse): ${p.truck.description || 'cabina de tráiler americano con litera (sleeper)'}
ESTILO VISUAL: ${p.format.style}. Formato ${p.format.aspectRatio}.
IDEA / RUTINA DEL VIDEO: ${p.routine.brief || 'Un día normal en la carretera: despertar en la litera, café, inspección, manejar, comer en una parada y dormir.'}

Reglas:
- Variedad de planos (detalle, medio, POV, gran angular) y de zonas del camión, con algún momento exterior si encaja.
- Cada "imagePrompt" describe UN solo fotograma fotográfico: sujeto, acción congelada, encuadre, lente, luz y hora. No describas la cara ni la ropa con detalle: se dan por imagen de referencia; di solo "the woman from the character sheet".
- Cada "motionPrompt" describe 4-8 segundos de movimiento sutil y realista a partir de ese fotograma: qué se mueve, movimiento de cámara y sonido ambiente. Sin cortes.
- Nada de texto, logotipos ni marcas en pantalla.`;
}

export function sceneImagePrompt(p, scene, { hasSheet, truckRefs, hasPrev }) {
  const lines = [
    `Create a single photorealistic keyframe for a vertical ${p.format.aspectRatio} short video.`,
    `Visual style: ${p.format.style}.`,
    `Scene (${scene.time}, ${scene.location}): ${scene.imagePrompt || scene.action}`,
    scene.camera && `Camera: ${scene.camera}.`,
    hasSheet
      ? 'The woman MUST be the exact same person as in the CHARACTER STYLE SHEET reference: same face, hairstyle, body type, skin tone, tattoos/accessories and the same outfit unless the scene says otherwise.'
      : `The woman: ${characterText(p.character)}`,
    truckRefs
      ? `When the scene is inside the truck, it MUST match the TRUCK INTERIOR reference${truckRefs > 1 ? 's' : ''}: same dashboard, seats, colors, materials, sleeper layout and objects.`
      : p.truck.description && `Truck interior: ${p.truck.description}.`,
    hasPrev && 'Keep continuity of lighting and props with the PREVIOUS SCENE reference, but do not copy its composition.',
    'Do not render the reference sheet layout, text, captions, watermarks or logos. One single frame, no collage.',
  ];
  return lines.filter(Boolean).join('\n');
}

export function sceneMotionPrompt(p, scene) {
  return [
    scene.motionPrompt || scene.action,
    'Keep the woman\'s identity and outfit exactly as in the first frame. Realistic, natural motion, handheld vlog feel, no cuts, no on-screen text.',
  ].join(' ');
}

export function characterSheetPrompt(p) {
  return `Character design reference sheet of a female truck driver for a film production.
${characterText(p.character)}
Layout: full body front view, side view and back view, plus 3 close-up head shots with different expressions, and small detail callouts of outfit pieces and accessories. Clean neutral light-gray studio background, even soft lighting, photorealistic, consistent identity across all views. No text labels.`;
}

export function truckInteriorPrompt(p) {
  return `Photorealistic wide-angle reference photo of the interior of a semi-truck cab, as a film set reference, empty of people.
${p.truck.description || 'American long-haul truck cab with sleeper berth.'}
Show the driver seat, steering wheel, dashboard and the sleeper area behind. Natural daylight through the windshield. No text, no logos.`;
}

export const REF_LABELS = {
  sheet: 'CHARACTER STYLE SHEET (identity and outfit reference):',
  truck: 'TRUCK INTERIOR reference (set reference):',
  prev: 'PREVIOUS SCENE reference (continuity only):',
};
