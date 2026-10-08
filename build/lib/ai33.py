"""Cliente AI33 Text-to-Speech v3 (asíncrono: crear tarea → polling → descargar).

    POST {AI33_BASE_URL}/v3/text-to-speech      -> devuelve un task_id
    GET  {AI33_BASE_URL}/v1/task/<task_id>      -> estado + URL del audio

La API key se lee SOLO de la variable AI33_API_KEY (cargada desde .env). Nunca se
escribe en código, en la ficha JSON ni en logs.

NOTA: los nombres exactos de campos de la respuesta no se pudieron verificar contra
la API real desde este entorno (red bloqueada), así que el parser es tolerante: busca
el task_id, el estado y la URL del audio en las claves habituales y, si hace falta,
recorre el JSON entero. Ajustable sin tocar código vía .env:
    AI33_AUTH_HEADER   (por defecto "xi-api-key"; usa "Authorization" para Bearer)
    AI33_MODEL_ID      (opcional; se envía como model_id)
    AI33_EXTRA_JSON    (JSON que se fusiona en el cuerpo del POST)
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

DONE = {"done", "completed", "complete", "success", "succeeded", "finished"}
FAILED = {"failed", "error", "errored", "cancelled", "canceled"}
AUDIO_EXT = (".mp3", ".wav", ".m4a", ".ogg", ".opus", ".aac")


class AI33Error(RuntimeError):
    pass


def available() -> bool:
    return bool(os.environ.get("AI33_API_KEY"))


def _headers() -> dict:
    key = os.environ.get("AI33_API_KEY")
    if not key:
        raise AI33Error("Falta AI33_API_KEY en .env")
    header = os.environ.get("AI33_AUTH_HEADER", "xi-api-key")
    value = f"Bearer {key}" if header.lower() == "authorization" else key
    return {header: value, "Content-Type": "application/json", "Accept": "application/json"}


def _request(method: str, url: str, body: dict | None = None, timeout: int = 60) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=_headers())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:  # el cuerpo de error no contiene la key
        detail = e.read().decode("utf-8", "replace")[:400]
        raise AI33Error(f"{method} {url} -> HTTP {e.code}: {detail}") from None
    except urllib.error.URLError as e:
        raise AI33Error(f"{method} {url} -> {e.reason}") from None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise AI33Error(f"{method} {url} -> respuesta no JSON") from None


def _walk(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k, v
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)


def _find(obj, keys):
    for k, v in _walk(obj):
        if k in keys and isinstance(v, (str, int)) and v != "":
            return v
    return None


def _find_audio_url(obj):
    preferred = _find(obj, {"audio_url", "audioUrl", "output_url", "outputUrl", "file_url", "url", "audio"})
    if isinstance(preferred, str) and preferred.startswith("http"):
        return preferred
    for _, v in _walk(obj):
        if isinstance(v, str) and v.startswith("http") and v.split("?")[0].lower().endswith(AUDIO_EXT):
            return v
    return None


def synthesize(text: str, voice_id: str, speed: float, out_path: Path,
               poll_interval: float = 1.5, timeout: float = 180) -> dict:
    base = os.environ.get("AI33_BASE_URL", "https://api.ai33.pro").rstrip("/")
    body = {"text": text, "voice_id": voice_id, "speed": speed}
    if os.environ.get("AI33_MODEL_ID"):
        body["model_id"] = os.environ["AI33_MODEL_ID"]
    if os.environ.get("AI33_EXTRA_JSON"):
        body.update(json.loads(os.environ["AI33_EXTRA_JSON"]))

    created = _request("POST", f"{base}/v3/text-to-speech", body)
    task_id = _find(created, {"task_id", "taskId", "id"})
    url = _find_audio_url(created)
    if not task_id and not url:
        raise AI33Error(f"Respuesta sin task_id: {json.dumps(created)[:300]}")

    deadline = time.time() + timeout
    last = created
    while not url:
        if time.time() > deadline:
            raise AI33Error(f"Timeout esperando la tarea {task_id}")
        time.sleep(poll_interval)
        last = _request("GET", f"{base}/v1/task/{task_id}")
        status = str(_find(last, {"status", "state"}) or "").lower()
        if status in FAILED:
            raise AI33Error(f"Tarea {task_id} falló: {json.dumps(last)[:300]}")
        if status in DONE or not status:
            url = _find_audio_url(last)
            if status in DONE and not url:
                raise AI33Error(f"Tarea {task_id} terminada sin URL de audio: {json.dumps(last)[:300]}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".download")
    with urllib.request.urlopen(url, timeout=120) as resp:  # URL firmada: sin cabecera de auth
        tmp.write_bytes(resp.read())
    tmp.replace(out_path)
    return {"task_id": task_id, "alignment": _find(last, {"alignment", "words", "timestamps"})}
