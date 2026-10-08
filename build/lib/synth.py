"""Síntesis procedural (numpy) de SFX y música de fondo — sin assets externos ni red.

Todo es determinista (semillas fijas). Sustituible por ficheros reales: si existe
assets/sfx/<nombre>.wav o assets/music/<estilo>.wav, build/audio.py los usa en su lugar.
"""
from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

SR = 48000


def write_wav(path: Path, x: np.ndarray, sr: int = SR) -> None:
    """Escribe float [-1,1] (mono o (n,2)) como WAV 16-bit estéreo."""
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    x = np.clip(x, -1, 1)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((x * 32767).astype("<i2").tobytes())


def _t(d):
    return np.arange(int(d * SR)) / SR


def _env(n, a, d_curve):
    """Ataque lineal a (s) + caída exponencial con constante d_curve (s)."""
    t = np.arange(n) / SR
    att = np.clip(t / max(a, 1e-4), 0, 1)
    return att * np.exp(-np.maximum(t - a, 0) / d_curve)


def _lp(x, cutoff):
    """Paso bajo de un polo (cutoff escalar o array por muestra)."""
    cutoff = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def _norm(x, peak=0.9):
    m = np.max(np.abs(x)) or 1
    return x / m * peak


# ---------------------------------------------------------------- SFX

def sfx(name: str) -> np.ndarray:
    rng = np.random.default_rng(abs(hash(name)) % (2**32) if False else sum(map(ord, name)))
    if name == "tick":
        t = _t(0.05)
        x = np.sin(2 * np.pi * 2400 * t) * _env(len(t), 0.0005, 0.008) + rng.normal(0, 0.3, len(t)) * _env(len(t), 0.0002, 0.003)
    elif name == "pop":
        t = _t(0.12)
        f = 950 * np.exp(-t * 28) + 260
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(len(t), 0.002, 0.035)
    elif name == "beep":
        t = _t(0.18)
        x = (np.sin(2 * np.pi * 1320 * t) + 0.3 * np.sin(2 * np.pi * 2640 * t)) * _env(len(t), 0.005, 0.06)
    elif name == "whoosh":
        d = 0.55
        t = _t(d)
        n = rng.normal(0, 1, len(t))
        shape = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 2
        x = _lp(n, 300 + 5000 * shape) - _lp(n, 120 + 600 * shape)
        x *= shape
    elif name == "boom":
        t = _t(1.6)
        f = 38 + 70 * np.exp(-t * 9)
        body = np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(len(t), 0.003, 0.55)
        click = _lp(rng.normal(0, 1, len(t)), 1800) * _env(len(t), 0.001, 0.03)
        x = np.tanh(1.8 * (body + 0.6 * click))
    elif name == "riser":
        d = 1.2
        t = _t(d)
        f = 180 * (2 ** (t / d * 3))
        saw = 2 * ((np.cumsum(f) / SR) % 1) - 1
        noise = _lp(rng.normal(0, 1, len(t)), 800 + 7000 * (t / d))
        x = (0.4 * _lp(saw, 600 + 4000 * t / d) + 0.5 * noise) * (t / d) ** 2.2
        x[-int(0.02 * SR):] *= np.linspace(1, 0, int(0.02 * SR))
    elif name == "chime":
        t = _t(1.3)
        x = sum(a * np.sin(2 * np.pi * f * t) * _env(len(t), 0.003, dc)
                for f, a, dc in [(1318.5, 1, 0.5), (1975.5, 0.6, 0.35), (2637, 0.35, 0.25), (3951, 0.15, 0.15)])
    elif name == "sparkle":
        t = _t(0.8)
        x = np.zeros(len(t))
        for k in range(14):
            st = int(rng.uniform(0, 0.55) * SR)
            f = rng.uniform(2500, 6000)
            seg = _t(0.12)
            p = np.sin(2 * np.pi * f * seg) * _env(len(seg), 0.001, 0.03) * rng.uniform(0.3, 1)
            x[st:st + len(seg)] += p[: len(x) - st]
    elif name == "glitch":
        t = _t(0.32)
        x = np.zeros(len(t))
        pos = 0
        while pos < len(t):
            seg = int(rng.uniform(0.012, 0.045) * SR)
            kind = rng.integers(0, 3)
            tt = np.arange(seg) / SR
            if kind == 0:
                chunk = np.sign(np.sin(2 * np.pi * rng.uniform(80, 900) * tt))
            elif kind == 1:
                chunk = np.round(rng.normal(0, 1, seg) * 3) / 3
            else:
                chunk = np.zeros(seg)
            x[pos:pos + seg] = chunk[: len(x) - pos] * rng.uniform(0.3, 0.9)
            pos += seg
    elif name == "buzz":
        t = _t(0.5)
        carrier = np.tanh(3 * np.sin(2 * np.pi * 165 * t))
        gate = ((t % 0.25) < 0.17).astype(float)
        x = _lp(carrier * gate, 1200) * 0.9
    else:
        raise ValueError(f"SFX desconocido: {name}")
    return _norm(x, 0.85)


# -------------------------------------------------------------- MÚSICA

# Progresión en La menor: Am – F – C – G (frecuencias de la fundamental en Hz)
_CHORDS = [(220.0, [0, 3, 7]), (174.61, [0, 4, 7]), (261.63, [0, 4, 7]), (196.0, [0, 4, 7])]


def _pad(t, root, intervals):
    x = np.zeros_like(t)
    for semis in intervals:
        f = root * 2 ** (semis / 12)
        for det in (-0.12, 0.0, 0.11):
            ph = 2 * np.pi * f * (1 + det / 100) * t
            x += 2 * ((ph / (2 * np.pi)) % 1) - 1  # sierra
    return x / (3 * len(intervals))


def music(cues: dict, bpm: float = 96) -> np.ndarray:
    """Bed cinematográfico que sigue las secciones del Short.

    Modos por sección: intro | groove | tension | hit | drop | outro.
    El ducking bajo la voz NO se hace aquí: lo aplica HyperFrames (data-automation).
    """
    dur = cues["duration"]
    n = int(dur * SR)
    t = np.arange(n) / SR
    beat = 60 / bpm
    bar = beat * 4

    # Capas a resolución completa
    chord_idx = (t // (bar * 1)).astype(int) % len(_CHORDS)
    pad = np.zeros(n)
    sub = np.zeros(n)
    for ci, (root, iv) in enumerate(_CHORDS):
        m = chord_idx == ci
        pad[m] = _pad(t[m], root, iv)
        sub[m] = np.sin(2 * np.pi * root / 4 * t[m])
    pad = _lp(pad, 900)
    drone = np.sin(2 * np.pi * 55 * t) * 0.6 + np.sin(2 * np.pi * 55.4 * t) * 0.4

    def hits(period, offset, length, fn):
        out = np.zeros(n)
        k = 0
        while True:
            st = offset + k * period
            if st >= dur:
                break
            i0 = int(st * SR)
            seg = fn(length)
            out[i0:i0 + len(seg)] += seg[: n - i0]
            k += 1
        return out

    def kick_fn(L):
        tt = _t(L)
        f = 45 + 110 * np.exp(-tt * 30)
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(len(tt), 0.002, 0.16)

    rng = np.random.default_rng(3)

    def hat_fn(L):
        tt = _t(L)
        return (rng.normal(0, 1, len(tt)) - _lp(rng.normal(0, 1, len(tt)), 6000)) * _env(len(tt), 0.001, 0.02)

    kick = hits(beat, 0, 0.4, kick_fn)
    heart = hits(beat * 2, 0, 0.4, kick_fn) + 0.7 * hits(beat * 2, 0.28, 0.4, kick_fn)
    hats = hits(beat / 2, beat / 4, 0.08, hat_fn)

    # Ganancias por sección (curvas suavizadas)
    layers = {k: np.zeros(n) for k in ("pad", "sub", "drone", "kick", "heart", "hats")}
    mix = {
        "intro":   dict(pad=0.7, sub=0.5, drone=0.3, kick=0.0, heart=0.0, hats=0.0),
        "groove":  dict(pad=0.6, sub=0.6, drone=0.0, kick=0.55, heart=0.0, hats=0.25),
        "tension": dict(pad=0.25, sub=0.2, drone=0.8, kick=0.0, heart=0.8, hats=0.1),
        "hit":     dict(pad=0.7, sub=0.7, drone=0.4, kick=0.6, heart=0.0, hats=0.3),
        "drop":    dict(pad=0.0, sub=0.0, drone=0.12, kick=0.0, heart=0.0, hats=0.0),
        "outro":   dict(pad=0.8, sub=0.7, drone=0.0, kick=0.75, heart=0.0, hats=0.4),
    }
    for sec in cues["sections"]:
        g = mix.get(sec["music"], mix["groove"])
        a, b = int(sec["start"] * SR), int(sec["end"] * SR)
        for k in layers:
            layers[k][a:b] = g[k]
    sm = int(0.12 * SR)
    kernel = np.ones(sm) / sm
    for k in layers:
        layers[k] = np.convolve(layers[k], kernel, mode="same")

    x = (layers["pad"] * pad * 0.9 + layers["sub"] * sub * 0.45 + layers["drone"] * drone * 0.35
         + layers["kick"] * kick * 0.8 + layers["heart"] * heart * 0.9 + layers["hats"] * hats * 0.12)

    # Impactos musicales al entrar en "hit" y "outro"
    for sec in cues["sections"]:
        if sec["music"] in ("hit", "outro"):
            i0 = int(sec["start"] * SR)
            imp = sfx("boom") * 0.5
            x[i0:i0 + len(imp)] += imp[: n - i0]

    # Estéreo ligero: pad desplazado
    left = x + 0.08 * np.roll(layers["pad"] * pad, 480)
    right = x + 0.08 * np.roll(layers["pad"] * pad, -480)
    st = np.stack([left, right], axis=1)
    st = np.tanh(st * 1.2)
    fade = int(0.05 * SR)
    st[:fade] *= np.linspace(0, 1, fade)[:, None]
    return st / (np.max(np.abs(st)) or 1) * 0.8
