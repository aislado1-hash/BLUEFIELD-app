#!/usr/bin/env python3
"""Validación de una ficha antes de renderizar.

    python build/validate.py short_001 --stage spec      # antes del TTS
    python build/validate.py short_001 --stage assets    # tras voces + composición + audio

Errores => código de salida 1. Avisos => se imprimen pero no bloquean.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.common import (AUDIO_DIR, DIST, GOALS, PROMOTION_TYPES, ROOT, SCENE_TYPES, SFX_NAMES, load_env,  # noqa: E402
                        log, spec_path)

REQUIRED = ["id", "title", "targetDuration", "characters", "lines", "scenes", "goal", "promotion"]
DURATION_TOLERANCE = 3.0  # s alrededor de targetDuration


class Report:
    def __init__(self):
        self.errors, self.warnings = [], []

    def err(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)

    def done(self, stage: str) -> int:
        for w in self.warnings:
            log(f"validate:{stage}", f"AVISO  {w}")
        for e in self.errors:
            log(f"validate:{stage}", f"ERROR  {e}")
        log(f"validate:{stage}", "OK" if not self.errors else f"{len(self.errors)} error(es)")
        return 1 if self.errors else 0


def check_spec(spec: dict, r: Report, provider: str) -> None:
    for k in REQUIRED:
        if k not in spec:
            r.err(f"falta el campo obligatorio '{k}'")
    if r.errors:
        return
    if spec["goal"] not in GOALS:
        r.err(f"goal '{spec['goal']}' no válido ({', '.join(sorted(GOALS))})")
    ptype = (spec.get("promotion") or {}).get("type")
    if ptype not in PROMOTION_TYPES:
        r.err(f"promotion.type '{ptype}' no válido ({', '.join(sorted(PROMOTION_TYPES))})")

    chars = spec["characters"]
    for name, c in chars.items():
        if not c.get("voice_id"):
            r.err(f"personaje {name} sin voice_id")
        elif str(c["voice_id"]).startswith("REPLACE_"):
            (r.err if provider == "ai33" else r.warn)(f"personaje {name}: voice_id de ejemplo ({c['voice_id']})")
        sp = c.get("speed", 1.0)
        if not isinstance(sp, (int, float)) or not 0.5 <= sp <= 2.0:
            r.err(f"personaje {name}: speed {sp} fuera de rango [0.5, 2.0]")
        if not re.match(r"^#[0-9a-fA-F]{6}$", c.get("color", "")):
            r.warn(f"personaje {name}: color no definido como #RRGGBB")

    ids = set()
    for line in spec["lines"]:
        lid = line.get("id")
        if not lid or lid in ids:
            r.err(f"línea con id vacío o duplicado: {lid}")
        ids.add(lid)
        if line.get("character") not in chars:
            r.err(f"línea {lid}: personaje '{line.get('character')}' no existe en characters")
        if not line.get("cap"):
            r.err(f"línea {lid}: falta 'cap' (texto en pantalla)")
        e = line.get("energy", 0.3)
        if not isinstance(e, (int, float)) or not 0 <= e <= 1:
            r.err(f"línea {lid}: energy {e} fuera de [0, 1]")
        for s in line.get("sfx", []):
            if s.get("name") not in SFX_NAMES:
                r.err(f"línea {lid}: SFX desconocido '{s.get('name')}'")

    used = []
    for i, sc in enumerate(spec["scenes"]):
        if sc.get("type") not in SCENE_TYPES:
            r.err(f"escena {i}: tipo '{sc.get('type')}' no implementado ({', '.join(sorted(SCENE_TYPES))})")
        refs = sc.get("lines", []) + ([sc["line"]] if sc.get("line") else [])
        if not refs:
            r.err(f"escena {i} ({sc.get('type')}): no referencia ninguna línea")
        for ref in refs:
            if ref not in ids:
                r.err(f"escena {i}: línea '{ref}' no existe")
            used.append(ref)
    for lid in ids - set(used):
        r.warn(f"línea {lid} no se usa en ninguna escena")
    for lid in {u for u in used if used.count(u) > 1}:
        r.err(f"línea {lid} usada en más de una escena")


def check_assets(spec: dict, r: Report) -> None:
    vpath = AUDIO_DIR / spec["id"] / "voices.json"
    if not vpath.exists():
        r.err("no existe audio/<id>/voices.json (ejecuta build/voices.py)")
        return
    voices = json.loads(vpath.read_text())
    for line in spec["lines"]:
        v = voices["lines"].get(line["id"])
        if not v:
            r.err(f"línea {line['id']}: sin audio generado")
        elif not (ROOT / v["file"]).exists():
            r.err(f"línea {line['id']}: falta {v['file']}")
    if voices.get("provider") != "ai33":
        r.warn(f"las voces se generaron con el proveedor '{voices.get('provider')}', no con AI33")

    out = DIST / spec["id"]
    index = out / "index.html"
    if not index.exists():
        r.err("no existe la composición (ejecuta build/engine.mjs)")
        return
    html = index.read_text(encoding="utf-8")
    for ref in sorted(set(re.findall(r'(?:src|url)\(?=?"([^"#:]+?\.(?:wav|mp3|js|otf|ttf|png|jpg|svg))"', html))):
        if not (out / ref).exists():
            r.err(f"asset referenciado y ausente: {ref}")

    cues = json.loads((out / "cues.json").read_text())
    dur = cues["duration"]
    target = spec["targetDuration"]
    if abs(dur - target) > DURATION_TOLERANCE:
        r.err(f"duración {dur:.1f}s fuera de {target}±{DURATION_TOLERANCE}s")
    elif abs(dur - target) > 1:
        r.warn(f"duración {dur:.1f}s (objetivo {target}s)")
    if not 15 <= dur <= 60:
        r.err(f"duración {dur:.1f}s no apta para Shorts")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("short_id")
    ap.add_argument("--stage", choices=["spec", "assets"], default="spec")
    ap.add_argument("--provider", default="auto")
    args = ap.parse_args()
    load_env()
    r = Report()
    p = spec_path(args.short_id)
    if not p.exists():
        r.err(f"no existe {p.relative_to(ROOT)}")
        return r.done(args.stage)
    try:
        spec = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        r.err(f"JSON inválido: {e}")
        return r.done(args.stage)
    if spec.get("id") != args.short_id:
        r.err(f"id '{spec.get('id')}' no coincide con el nombre del fichero")
    provider = args.provider
    if provider == "auto":
        provider = os.environ.get("TTS_PROVIDER", "auto")
    if provider == "auto":
        provider = "ai33" if os.environ.get("AI33_API_KEY") else "local"
    check_spec(spec, r, provider)
    if args.stage == "assets" and not r.errors:
        check_assets(spec, r)
    return r.done(args.stage)


if __name__ == "__main__":
    sys.exit(main())
