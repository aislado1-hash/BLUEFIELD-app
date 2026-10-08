#!/usr/bin/env python3
"""Pipeline completo: ficha JSON -> renders/<id>.mp4

    python build/run.py short_001 [--provider auto|ai33|local] [--quality draft|looks|delivery]
                                  [--no-render] [--frames 0,3,8,15,21,29,33]

 1. leer + validar la ficha              (build/validate.py --stage spec)
 2. generar TTS que falte (caché hash)   (build/voices.py)
 3. medir duraciones / timing palabras   (build/voices.py)
 4. construir composición HTML + GSAP    (build/engine.mjs)
 5. preparar audio (voz, música, SFX)    (build/audio.py)
 6. validar assets y duración            (build/validate.py --stage assets)
 7. npx hyperframes check
 8. npx hyperframes render (1080x1920 @ fps de la ficha)
 9. extraer frames de control del MP4    (renders/<id>_frames/)
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.common import DIST, RENDERS, ROOT, load_spec, log, probe_duration  # noqa: E402

PY = sys.executable


def step(name: str, cmd: list[str], cwd: Path = ROOT) -> None:
    log("run", f"── {name}: {' '.join(str(c) for c in cmd)}")
    t0 = time.time()
    proc = subprocess.run(cmd, cwd=cwd)
    if proc.returncode != 0:
        log("run", f"FALLO en '{name}' (código {proc.returncode})")
        sys.exit(proc.returncode)
    log("run", f"   {name} OK ({time.time() - t0:.1f}s)")


def extract_frames(mp4: Path, times: list[float], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    dur = probe_duration(mp4)
    for t in times:
        tt = min(t, dur - 0.05)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{tt:.3f}", "-i", str(mp4), "-frames:v", "1",
                        str(out_dir / f"t{t:05.1f}s.png")], check=True)
    # hoja de contacto
    pngs = sorted(out_dir.glob("t*.png"))
    inputs = sum((["-i", str(p)] for p in pngs), [])
    filt = "".join(f"[{i}:v]scale=360:-1[v{i}];" for i in range(len(pngs)))
    filt += "".join(f"[v{i}]" for i in range(len(pngs))) + f"hstack=inputs={len(pngs)}"
    subprocess.run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", filt, str(out_dir / "contact_sheet.jpg")],
                   check=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("short_id")
    ap.add_argument("--provider", default="auto", choices=["auto", "ai33", "local"])
    ap.add_argument("--quality", default="looks", choices=["draft", "looks", "delivery"])
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--frames", default="0,3,8,15,21,29,33")
    args = ap.parse_args()
    sid = args.short_id
    t0 = time.time()

    step("1. validar ficha", [PY, "build/validate.py", sid, "--stage", "spec", "--provider", args.provider])
    step("2-3. voces TTS + timing", [PY, "build/voices.py", sid, "--provider", args.provider])
    step("4. composición", ["node", "build/engine.mjs", sid])
    step("5. audio", [PY, "build/audio.py", sid])
    step("6. validar assets", [PY, "build/validate.py", sid, "--stage", "assets", "--provider", args.provider])
    project = DIST / sid
    hf = ["npx", "--prefix", str(ROOT), "hyperframes"]
    step("7. hyperframes check", [*hf, "check"], cwd=project)
    if args.no_render:
        return 0

    spec = load_spec(sid)
    fps = (spec.get("format") or {}).get("fps", 60)
    RENDERS.mkdir(exist_ok=True)
    mp4 = RENDERS / f"{sid}.mp4"
    step("8. hyperframes render", [*hf, "render", "--fps", str(fps), "--quality", args.quality, "--output", str(mp4)],
         cwd=project)

    times = [float(x) for x in args.frames.split(",") if x]
    extract_frames(mp4, times, RENDERS / f"{sid}_frames")
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                            "stream=codec_type,width,height,r_frame_rate:format=duration,size", "-of", "json", str(mp4)],
                           capture_output=True, text=True, check=True)
    info = json.loads(probe.stdout)
    log("run", f"✔ {mp4.relative_to(ROOT)} · {float(info['format']['duration']):.2f}s · "
               f"{int(info['format']['size']) / 1e6:.1f} MB · total {time.time() - t0:.0f}s")
    for s in info["streams"]:
        log("run", f"   stream {s['codec_type']}: " + (f"{s['width']}x{s['height']} @ {s['r_frame_rate']}"
                                                       if s["codec_type"] == "video" else "ok"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
