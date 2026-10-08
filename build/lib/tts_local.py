"""TTS local de reserva (espeak-ng). SOLO para probar el pipeline sin AI33.

Suena robótico: sirve para validar sincronía, ritmo y render, no para publicar.
Se activa con TTS_PROVIDER=local, o en modo auto cuando no hay AI33_API_KEY.
"""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path


def available() -> bool:
    return shutil.which("espeak-ng") is not None


def synthesize(text: str, local_voice: dict, speed: float, out_path: Path) -> dict:
    voice = local_voice.get("voice", "es")
    rate = int(local_voice.get("rate", 160) * speed)
    pitch = int(local_voice.get("pitch", 50))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "v.wav"
        subprocess.run(["espeak-ng", "-v", voice, "-s", str(rate), "-p", str(pitch), "-w", str(wav), text],
                       check=True, capture_output=True)
        # Un poco de cuerpo (EQ + compresión suave) para que no suene tan fino.
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(wav),
             "-af", "highpass=f=90,equalizer=f=220:t=q:w=1:g=3,acompressor=threshold=-18dB:ratio=3,"
                    "aresample=44100",
             "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", str(out_path)],
            check=True, capture_output=True)
    return {}
