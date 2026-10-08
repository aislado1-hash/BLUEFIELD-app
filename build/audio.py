#!/usr/bin/env python3
"""Paso de audio: prepara voz, música y SFX que referencia la composición.

    python build/audio.py short_001

Lee build/dist/<id>/cues.json (generado por engine.mjs) y escribe en build/dist/<id>/media/:
  vo/<hash>.wav    voces normalizadas en sonoridad (siempre claramente audibles)
  music.wav        música de fondo que sigue las secciones del Short
  sfx/<name>.wav   efectos usados (de assets/sfx/ si existen, si no sintetizados)

La mezcla final (incluido el ducking música/voz) la hace HyperFrames en el render
a partir de los <audio> y su data-automation.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import synth  # noqa: E402
from lib.common import ASSETS, AUDIO_DIR, DIST, ROOT, SFX_NAMES, log, run  # noqa: E402

VOICE_LUFS = -16


def ensure_sfx_library() -> None:
    """Genera assets/sfx/<name>.wav para los SFX soportados que no existan aún."""
    for name in SFX_NAMES:
        p = ASSETS / "sfx" / f"{name}.wav"
        if not p.exists():
            synth.write_wav(p, synth.sfx(name))
            log("audio", f"SFX sintetizado: assets/sfx/{name}.wav")


def main() -> int:
    short_id = sys.argv[1]
    out = DIST / short_id
    cues = json.loads((out / "cues.json").read_text())
    voices = json.loads((AUDIO_DIR / short_id / "voices.json").read_text())
    media = out / "media"
    (media / "vo").mkdir(parents=True, exist_ok=True)
    (media / "sfx").mkdir(parents=True, exist_ok=True)

    # Voces: normalización de sonoridad (EBU R128) para que la voz domine la mezcla.
    for v in cues["voices"]:
        src = ROOT / voices["lines"][v["line"]]["file"]
        dst = media / "vo" / f"{v['hash']}.wav"
        if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
            run(["ffmpeg", "-y", "-v", "error", "-i", str(src),
                 "-af", f"loudnorm=I={VOICE_LUFS}:TP=-1.5:LRA=7", "-ar", "48000", "-ac", "2", str(dst)])
    log("audio", f"{len(cues['voices'])} voces normalizadas a {VOICE_LUFS} LUFS")

    ensure_sfx_library()
    used = sorted({s["name"] for s in cues["sfx"]})
    for name in used:
        shutil.copyfile(ASSETS / "sfx" / f"{name}.wav", media / "sfx" / f"{name}.wav")
    log("audio", f"SFX usados: {', '.join(used)}")

    custom = ASSETS / "music" / f"{cues['music'].get('style', '')}.wav"
    if custom.exists():
        run(["ffmpeg", "-y", "-v", "error", "-stream_loop", "-1", "-i", str(custom), "-t", str(cues["duration"]),
             "-ar", "48000", "-ac", "2", str(media / "music.wav")])
        log("audio", f"música: {custom.relative_to(ROOT)}")
    else:
        synth.write_wav(media / "music.wav", synth.music(cues, cues["music"].get("bpm", 96)))
        log("audio", f"música procedural {cues['duration']:.1f}s · secciones: "
                     + " → ".join(s["music"] for s in cues["sections"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
