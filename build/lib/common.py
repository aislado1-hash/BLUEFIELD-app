"""Utilidades compartidas por el pipeline (rutas, ficha, .env, texto, ffmpeg)."""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPECS = ROOT / "specs"
VOICES_CACHE = ROOT / "voices" / "cache"
AUDIO_DIR = ROOT / "audio"
RENDERS = ROOT / "renders"
ASSETS = ROOT / "assets"
DIST = ROOT / "build" / "dist"

# Tipos de escena que el motor sabe construir (build/scenes/*.mjs).
# Añadir un tipo nuevo = crear build/scenes/<tipo>.mjs y registrarlo en build/scenes/index.mjs.
SCENE_TYPES = {"intro", "chat", "tension", "reveal", "cliffhanger", "cta"}
GOALS = {"subscribers", "long_video", "comments"}
PROMOTION_TYPES = {"trailer", "cliffhanger", "independent", "continuation", "long_video"}
SFX_NAMES = ["tick", "pop", "beep", "whoosh", "boom", "riser", "chime", "sparkle", "glitch", "buzz"]


def log(step: str, msg: str) -> None:
    print(f"[{step}] {msg}", flush=True)


def load_env(path: Path = ROOT / ".env") -> None:
    """Carga .env en os.environ sin pisar variables ya definidas. Nunca imprime valores."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


def spec_path(short_id: str) -> Path:
    return SPECS / f"{short_id}.json"


def load_spec(short_id: str) -> dict:
    return json.loads(spec_path(short_id).read_text(encoding="utf-8"))


def lines_by_id(spec: dict) -> dict:
    return {line["id"]: line for line in spec.get("lines", [])}


# --- Texto -----------------------------------------------------------------

_EMOJI_RE = re.compile(
    "["
    "\U0001F000-\U0001FAFF"  # pictogramas, emoticonos, transporte, símbolos ampliados
    "\U00002600-\U000027BF"  # símbolos varios + dingbats (⚽ está aquí)
    "\U00002B00-\U00002BFF"
    "\U0000FE00-\U0000FE0F"  # selectores de variación
    "\U0000200D"  # ZWJ
    "\U000020E3"
    "\U0001F1E6-\U0001F1FF"  # banderas
    "]+",
    flags=re.UNICODE,
)


def strip_emojis(text: str) -> str:
    """Texto para TTS: sin emojis y con espacios normalizados. Los emojis solo viven en pantalla."""
    return re.sub(r"\s+", " ", _EMOJI_RE.sub("", text)).strip()


def tts_text(line: dict) -> str:
    """El texto hablado es `tts` si existe; si no, `cap`. Siempre sin emojis."""
    return strip_emojis(line.get("tts") or line["cap"])


def sha_key(*parts) -> str:
    raw = json.dumps(parts, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


# --- Audio -----------------------------------------------------------------

def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def probe_duration(path: Path) -> float:
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)])
    return float(out.stdout.strip())


def decode_mono(path: Path, sr: int = 16000):
    """Decodifica cualquier audio a float32 mono (numpy) vía ffmpeg."""
    import numpy as np

    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
        check=True,
        capture_output=True,
    )
    return np.frombuffer(proc.stdout, dtype=np.float32), sr
