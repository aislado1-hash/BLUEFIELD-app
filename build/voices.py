#!/usr/bin/env python3
"""Paso TTS: genera (o reutiliza de caché) la voz de cada línea y mide su timing.

    python build/voices.py short_001 [--provider auto|ai33|local]

Salida: audio/<id>/voices.json con duración, inicio/fin real de habla y timing
por palabra de cada línea. La caché vive en voices/cache/<hash>.mp3, donde
hash = (proveedor, voz, velocidad, texto). Si existe, NO se llama a AI33.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import ai33, tts_local  # noqa: E402
from lib.common import (AUDIO_DIR, ROOT, VOICES_CACHE, decode_mono, load_env, load_spec, log,  # noqa: E402
                        probe_duration, sha_key, strip_emojis, tts_text)

PLACEHOLDER = "REPLACE_"


def resolve_provider(requested: str) -> str:
    if requested == "auto":
        requested = os.environ.get("TTS_PROVIDER", "auto")
    if requested == "auto":
        return "ai33" if ai33.available() else "local"
    return requested


def cache_key(provider: str, char: dict, text: str) -> str:
    if provider == "ai33":
        return sha_key("ai33", char["voice_id"], float(char.get("speed", 1.0)), text,
                       os.environ.get("AI33_MODEL_ID", ""))
    return sha_key("local", char.get("localVoice", {}), float(char.get("speed", 1.0)), text)


def speech_bounds(path: Path) -> tuple[float, float]:
    """Inicio/fin de habla real (recorta silencios del TTS) por energía RMS en ventanas de 10 ms."""
    import numpy as np

    pcm, sr = decode_mono(path)
    hop = sr // 100
    n = len(pcm) // hop
    if n == 0:
        return 0.0, len(pcm) / sr
    rms = np.sqrt(np.mean(pcm[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    voiced = np.where(db > db.max() - 38)[0]
    if len(voiced) == 0:
        return 0.0, n / 100
    return float(voiced[0]) / 100, float(voiced[-1] + 1) / 100


_PAUSE = [(re.compile(r"(\.\.\.|…)$"), 0.55), (re.compile(r"[.!?]$"), 0.4), (re.compile(r"[,;:]$"), 0.25)]


def estimate_words(cap: str, start: float, end: float) -> list[dict]:
    """Timing por palabra ESTIMADO (proporcional a letras + pausas de puntuación).

    Se usa cuando el proveedor no devuelve alineación. Los tokens que son solo emoji
    aparecen junto con la palabra anterior (no se pronuncian).
    """
    tokens = cap.split()
    weights, pauses = [], []
    for tok in tokens:
        spoken = re.sub(r"[^\wáéíóúüñÁÉÍÓÚÜÑ]", "", strip_emojis(tok))
        weights.append(len(spoken) + 1.5 if spoken else 0.0)
        pauses.append(next((p for rx, p in _PAUSE if rx.search(strip_emojis(tok))), 0.0) if spoken else 0.0)
    units = sum(weights) + sum(pauses[:-1]) * 4
    span = max(end - start, 0.05)
    per = span / units if units else 0
    t, words = start, []
    for tok, w, p in zip(tokens, weights, pauses):
        if w == 0:  # emoji: acompaña a la palabra anterior
            words.append({"w": tok, "start": round(words[-1]["start"] if words else t, 3),
                          "end": round(words[-1]["end"] if words else t, 3)})
            continue
        dur = w * per
        words.append({"w": tok, "start": round(t, 3), "end": round(t + dur, 3)})
        t += dur + p * 4 * per
    return words


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("short_id")
    ap.add_argument("--provider", default="auto", choices=["auto", "ai33", "local"])
    args = ap.parse_args()

    load_env()
    spec = load_spec(args.short_id)
    provider = resolve_provider(args.provider)
    if provider == "local":
        log("tts", "AVISO: usando TTS LOCAL de prueba (espeak-ng). Define AI33_API_KEY en .env para AI33.")
        if not tts_local.available():
            log("tts", "ERROR: espeak-ng no está instalado")
            return 1

    VOICES_CACHE.mkdir(parents=True, exist_ok=True)
    index_path = VOICES_CACHE / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {}

    out = {"short": spec["id"], "provider": provider, "lines": {}}
    generated = cached = 0
    for line in spec["lines"]:
        char = spec["characters"][line["character"]]
        text = tts_text(line)
        if provider == "ai33" and str(char.get("voice_id", "")).startswith(PLACEHOLDER):
            log("tts", f"ERROR: {line['character']} tiene voice_id de ejemplo; sustitúyelo en la ficha")
            return 1
        key = cache_key(provider, char, text)
        path = VOICES_CACHE / f"{key}.mp3"
        meta = {}
        if path.exists() and path.stat().st_size > 0:
            cached += 1
        else:
            t0 = time.time()
            if provider == "ai33":
                meta = ai33.synthesize(text, char["voice_id"], float(char.get("speed", 1.0)), path)
            else:
                meta = tts_local.synthesize(text, char.get("localVoice", {}), float(char.get("speed", 1.0)), path)
            generated += 1
            index[key] = {"provider": provider, "character": line["character"], "text": text,
                          "voice": char.get("voice_id") if provider == "ai33" else char.get("localVoice"),
                          "speed": char.get("speed", 1.0), "task_id": meta.get("task_id")}
            log("tts", f"{line['id']} generado en {time.time() - t0:.1f}s  «{text}»")

        duration = probe_duration(path)
        s0, s1 = speech_bounds(path)
        out["lines"][line["id"]] = {
            "file": str(path.relative_to(ROOT)),
            "hash": key,
            "text": text,
            "duration": round(duration, 3),
            "speechStart": round(s0, 3),
            "speechEnd": round(s1, 3),
            # TODO(word-timing): si AI33 devuelve alineación (meta["alignment"]) usarla aquí.
            "wordTiming": "estimated",
            "words": estimate_words(line["cap"], s0, s1),
        }

    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2))
    dest = AUDIO_DIR / spec["id"] / "voices.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    total = sum(v["duration"] for v in out["lines"].values())
    log("tts", f"{len(out['lines'])} líneas · {generated} generadas · {cached} desde caché · "
               f"{total:.1f}s de voz · proveedor={provider}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
