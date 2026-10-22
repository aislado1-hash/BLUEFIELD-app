"""Chat Video Maker LOCAL v36 — servidor local (AI33 TTS + Remotion)."""
import base64, hashlib, json, mimetypes, os, re, shutil, subprocess, sys, tempfile, threading, time, unicodedata, uuid, webbrowser
import urllib.error, urllib.parse, urllib.request
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

VERSION = "v36"
ROOT = Path(__file__).resolve().parent
WEB = ROOT / "index.html"
SHARED = ROOT / "shared"
PUBLIC = ROOT / "public"
TTS_DIR = PUBLIC / "tts"; TTS_DIR.mkdir(parents=True, exist_ok=True)          # audios de versiones antiguas
PROJECTS_ROOT = PUBLIC / "projects"; PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
LIBRARY = PUBLIC / "library"; (LIBRARY / "assets").mkdir(parents=True, exist_ok=True)
LIBRARY_JSON = LIBRARY / "characters.json"
VOICES_JSON = LIBRARY / "voices.json"      # voces guardadas (nombre → Voice ID + velocidad)
RENDER_TMP = ROOT / ".render_tmp"
SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")

JOBS = {}
PORT = None
RENDER_LOCK = threading.Lock()


# ───────────────────────── utilidades ─────────────────────────

def strip_emojis_for_tts(text):
    """Quita emojis solo del texto que se envía a AI33; el guion visual no cambia."""
    s = str(text or "")
    s = re.sub(r"[\U0001F1E6-\U0001F1FF\U0001F300-\U0001FAFF☀-➿⌀-⏿⬀-⯿]", "", s)
    s = re.sub(r"[︎️‍⃣\U0001F3FB-\U0001F3FF]", "", s)
    return re.sub(r"\s{2,}", " ", s).strip()


def safe_slug(name):
    text = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode("ascii").lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-") or "proyecto"
    base = text; i = 2
    while (PROJECTS_ROOT / text).exists():
        text = f"{base}-{i}"; i += 1
    return text


def project_dir(slug):
    if not slug: raise RuntimeError("No hay proyecto activo.")
    slug = str(slug)
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", slug): raise RuntimeError("Proyecto no válido.")
    d = PROJECTS_ROOT / slug
    d.mkdir(parents=True, exist_ok=True); (d / "tts").mkdir(exist_ok=True); (d / "assets").mkdir(exist_ok=True)
    return d


def project_characters(exclude=""):
    """Personajes con voz guardados en otros proyectos: el más reciente de cada nombre."""
    found = {}
    dirs = sorted([x for x in PROJECTS_ROOT.iterdir() if x.is_dir() and x.name != exclude], key=lambda x: x.stat().st_mtime, reverse=True)
    for d in dirs:
        try: data = json.loads((d / "project.json").read_text(encoding="utf-8"))
        except Exception: continue
        for c in data.get("chars") or []:
            name = str((c or {}).get("name") or "").strip()
            if not name or not str(c.get("ai33Voice") or "").strip() or name.lower() in found: continue
            found[name.lower()] = {"projectSlug": d.name, "projectName": data.get("projectName") or d.name, "character": c}
    return list(found.values())


def copy_project_asset(slug, url):
    """Copia al proyecto actual un archivo de assets de otro proyecto (para no depender de él). Devuelve la nueva ruta."""
    m = re.fullmatch(r"/projects/([a-zA-Z0-9_-]+)/assets/([A-Za-z0-9_.-]+)", str(url or ""))
    if not m or m.group(1) == slug or m.group(2).startswith("."): return url
    src = PROJECTS_ROOT / m.group(1) / "assets" / m.group(2)
    if not src.is_file(): return url
    dst = project_dir(slug) / "assets" / m.group(2)
    if not dst.exists(): shutil.copyfile(src, dst)
    return f"/projects/{slug}/assets/{m.group(2)}"


def sanitize_filename(name):
    text = re.sub(r'[<>:"/\\|?*]', '_', str(name or 'video')).strip().rstrip('.')
    return text or 'video'


EXT_BY_MIME = {
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/bmp": "bmp", "image/svg+xml": "svg",
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/ogg": "ogg",
    "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/webm": "webm",
}


def store_data_url(slug, data_url, prefix):
    """Guarda un data URL como archivo en public/projects/<slug>/assets y devuelve su ruta web."""
    if not isinstance(data_url, str) or not data_url.startswith("data:") or "," not in data_url:
        raise RuntimeError("Archivo no válido.")
    header, b64 = data_url.split(",", 1)
    mime = header[5:].split(";", 1)[0].lower()
    ext = EXT_BY_MIME.get(mime)
    if not ext: raise RuntimeError(f"Formato no compatible: {mime or 'desconocido'}")
    raw = base64.b64decode(b64)
    digest = hashlib.sha1(raw).hexdigest()[:12]
    d = project_dir(slug) / "assets"
    name = f"{prefix}-{digest}.{ext}"
    fp = d / name
    if not fp.exists(): fp.write_bytes(raw)
    return f"/projects/{slug}/assets/{name}"


def externalize_assets(payload):
    """Convierte imágenes/sonidos incrustados (base64) en archivos del proyecto.
    Así project.json y las props del render quedan pequeños. Compatible con proyectos antiguos."""
    slug = str(payload.get("projectSlug") or "")
    if not slug: return payload
    for c in payload.get("chars") or []:
        if isinstance(c, dict) and str(c.get("image") or "").startswith("data:"):
            c["image"] = store_data_url(slug, c["image"], "char")
    if str(payload.get("music") or "").startswith("data:"):
        payload["music"] = store_data_url(slug, payload["music"], "music")
    if str(payload.get("sound") or "").startswith("data:"):
        payload["sound"] = store_data_url(slug, payload["sound"], "sound")
    if str(payload.get("bgImage") or "").startswith("data:"):
        payload["bgImage"] = store_data_url(slug, payload["bgImage"], "background")
    return payload


def save_project_json(payload):
    slug = str(payload.get("projectSlug") or "")
    d = project_dir(slug)
    data = externalize_assets(dict(payload))
    data.pop("api_key", None)
    data["projectSlug"] = slug
    data["projectName"] = str(payload.get("projectName") or slug)
    data["version"] = VERSION
    data["updatedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
    tmp = d / "project.json.tmp"
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, d / "project.json")   # escritura atómica: nunca queda un project.json a medias
    return d, data


def ffmpeg():
    p = shutil.which("ffmpeg")
    if p: return p
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception: pass
    try:
        subprocess.run([sys.executable, "-m", "pip", "install", "--user", "imageio-ffmpeg"], check=True)
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def audio_duration(path):
    exe = ffmpeg()
    if not exe or not path or not path.exists(): return None
    try:
        r = subprocess.run([exe, "-i", str(path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", timeout=60)
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr)
        if not m: return None
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    except Exception:
        return None


# ───────────────────────── render Remotion ─────────────────────────

def public_path(rel):
    """Ruta web (/projects/...) → archivo dentro de public/. None si no es local."""
    s = str(rel or "")
    if not s or re.match(r"^(data:|https?:|blob:)", s, re.I): return None
    return PUBLIC / s.replace("\\", "/").lstrip("/")


def asset_refs(payload):
    refs = []
    for m in payload.get("dialogueMessages") or []: refs.append(("audio de mensaje", m.get("audio")))
    for ev in payload.get("groupEvents") or []: refs.append(("audio de evento", ev.get("audio")))
    refs.append(("audio del título inicial", payload.get("initialTitleAudio")))
    for t in payload.get("titleAudios") or []: refs.append(("audio de título", t.get("audio")))
    refs.append(("sonido", payload.get("sound")))
    refs.append(("música de fondo", payload.get("music")))
    refs.append(("fondo", payload.get("bgImage")))
    for c in payload.get("chars") or []: refs.append((f"imagen de {c.get('name', '?')}", c.get("image")))
    return refs


def missing_assets(payload):
    out = []
    for label, ref in asset_refs(payload):
        p = public_path(ref)
        if p is not None and not p.exists(): out.append(f"{label}: {ref}")
    return out


def build_render_public(payload, dest):
    """Carpeta public mínima para Remotion: SOLO los archivos que usa este proyecto.
    Remotion copia la carpeta public entera en cada render; con muchos proyectos y MP4
    eso hacía cada render más lento. Se usan enlaces duros (instantáneos) si es posible."""
    dest.mkdir(parents=True, exist_ok=True)
    for _label, ref in asset_refs(payload):
        src = public_path(ref)
        if src is None or not src.exists(): continue
        try: rel = src.resolve().relative_to(PUBLIC.resolve())
        except ValueError: continue   # fuera de public/: se ignora
        target = dest / rel
        if target.exists(): continue
        target.parent.mkdir(parents=True, exist_ok=True)
        try: os.link(src, target)
        except Exception: shutil.copy2(src, target)
    return dest


SPEEDS = {
    # nombre: (descripción, argumentos extra para remotion)
    "rapido": ("Rápido", ["--x264-preset", "veryfast", "--jpeg-quality", "85"]),
    "equilibrado": ("Equilibrado", []),
    "calidad": ("Máxima calidad", ["--x264-preset", "slow", "--crf", "17", "--jpeg-quality", "95"]),
}


def node_tools():
    node = shutil.which("node")
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not node or not npm or not npx:
        raise RuntimeError("No se encontró Node.js/npm. Instala Node.js LTS y vuelve a abrir INICIAR_CHAT_VIDEO.bat.")
    return npm, npx


def run_remotion(args, job, workdir, stage_label="Renderizando"):
    """Ejecuta Remotion mostrando el progreso en job. Devuelve las últimas líneas del log."""
    cmd = list(args)
    if os.environ.get("CHAT_VIDEO_BROWSER"):
        cmd += ["--browser-executable", os.environ["CHAT_VIDEO_BROWSER"]]
    proc = subprocess.Popen(cmd, cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", bufsize=1)
    tail = []
    for line in proc.stdout:
        line = line.rstrip()
        if not line: continue
        tail.append(line); tail[:] = tail[-80:]
        m = re.search(r"(Rendered|Rendering|Encoded|Encoding|Stitching)\D*?(\d+)\s*/\s*(\d+)", line, re.I)
        if m:
            stage, a, b = m.group(1).lower(), int(m.group(2)), max(1, int(m.group(3)))
            frac = a / b
            pct = round(frac * 85) if stage.startswith("render") else round(85 + frac * 14)
            job.update({"percent": max(job.get("percent", 0), min(99, pct)),
                        "message": f"{stage_label if stage.startswith('render') else 'Codificando'} fotogramas {a}/{b}"})
        elif "bundl" in line.lower():
            job.update({"message": "Preparando el proyecto de Remotion…"})
    proc.wait()
    return proc.returncode, tail


def ensure_node_modules(job):
    npm, _ = node_tools()
    if not (ROOT / "node_modules" / "remotion").exists():
        job.update({"phase": "installing", "message": "Instalando Remotion (solo la primera vez)…"})
        r = subprocess.run([npm, "install"], cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
        if r.returncode != 0:
            raise RuntimeError("No se pudieron instalar las dependencias de Remotion.\n" + r.stdout[-4000:])


def make_workdir():
    RENDER_TMP.mkdir(exist_ok=True)   # dentro de la app: mismo disco → enlaces duros posibles
    return Path(tempfile.mkdtemp(prefix="job_", dir=str(RENDER_TMP)))


def export_video(payload, job):
    _, npx = node_tools()
    ensure_node_modules(job)
    payload = externalize_assets(payload)
    missing = missing_assets(payload)
    if missing:
        raise RuntimeError("Faltan archivos del proyecto:\n" + "\n".join(missing[:20]))

    pdir = project_dir(payload.get("projectSlug"))
    final = pdir / f"{sanitize_filename(payload.get('projectName') or payload.get('projectSlug') or 'chat_video')}.mp4"
    work = make_workdir()
    try:
        public = build_render_public(payload, work / "public")
        props = work / "props.json"
        props.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        partial = work / "render.mp4"
        speed = str(payload.get("renderSpeed") or "rapido")
        extra = SPEEDS.get(speed, SPEEDS["rapido"])[1]
        cpus = max(1, os.cpu_count() or 2)
        cmd = [npx, "remotion", "render", "remotion/index.tsx", "ChatVideo", str(partial),
               "--props", str(props), "--codec", "h264", "--pixel-format", "yuv420p",
               "--audio-codec", "aac", "--audio-bitrate", "192k", "--enforce-audio-track",
               "--public-dir", str(public), "--concurrency", str(cpus), *extra]
        job.update({"phase": "rendering", "percent": 0, "message": "Preparando el render…"})
        code, tail = run_remotion(cmd, job, work)
        if code != 0 or not partial.exists():
            raise RuntimeError("Remotion no pudo completar el render.\n" + "\n".join(tail[-40:]))
        if final.exists(): final.unlink()
        shutil.move(str(partial), str(final))
        return final, payload
    finally:
        shutil.rmtree(work, ignore_errors=True)


def start_export(payload):
    job_id = uuid.uuid4().hex
    job = {"id": job_id, "phase": "starting", "percent": 0, "message": "En cola…", "error": None, "url": None}
    JOBS["render_" + job_id] = job

    def worker():
        if not RENDER_LOCK.acquire(blocking=False):
            job.update({"phase": "error", "error": "Ya hay un render en curso. Espera a que termine.", "message": "Ya hay un render en curso."})
            return
        try:
            t0 = time.time()
            final, saved = export_video(payload, job)
            save_project_json(saved)
            job.update({"phase": "done", "percent": 100, "url": f"/projects/{payload.get('projectSlug')}/video",
                        "message": f"MP4 generado en {time.time() - t0:.0f} s · {final.name}"})
        except Exception as e:
            job.update({"phase": "error", "error": str(e), "message": str(e)})
        finally:
            RENDER_LOCK.release()

    threading.Thread(target=worker, daemon=True).start()
    return job_id


# ───────────────────────── Biblioteca de personajes ─────────────────────────

LIB_FIELDS = ("name", "side", "color", "textColor", "strokeColor", "stroke", "size", "photoX", "photoY", "bubbleX", "bubbleSize", "nameSize", "ai33Voice", "ai33Speed")


def library_load():
    try: return json.loads(LIBRARY_JSON.read_text(encoding="utf-8"))
    except Exception: return []


def library_write(items):
    tmp = LIBRARY_JSON.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, LIBRARY_JSON)


def library_save(char):
    if not isinstance(char, dict) or not str(char.get("name") or "").strip():
        raise RuntimeError("El personaje necesita un nombre.")
    entry = {k: char.get(k) for k in LIB_FIELDS if char.get(k) is not None}
    entry["name"] = str(char["name"]).strip()
    img = str(char.get("image") or "")
    if img.startswith("data:"):
        header, b64 = img.split(",", 1)
        ext = EXT_BY_MIME.get(header[5:].split(";", 1)[0].lower())
        if not ext: raise RuntimeError("Formato de imagen no compatible.")
        raw = base64.b64decode(b64)
        name = f"char-{hashlib.sha1(raw).hexdigest()[:12]}.{ext}"
        (LIBRARY / "assets" / name).write_bytes(raw)
        entry["image"] = f"/library/assets/{name}"
    elif img:
        src = public_path(img)
        if src is not None and src.exists():
            if src.resolve().parent != (LIBRARY / "assets").resolve():
                shutil.copy2(src, LIBRARY / "assets" / src.name)
            entry["image"] = f"/library/assets/{src.name}"
    items = [x for x in library_load() if str(x.get("name", "")).strip().lower() != entry["name"].lower()]
    entry["id"] = safe_slug_plain(entry["name"])
    entry["updatedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
    items.append(entry)
    items.sort(key=lambda x: str(x.get("name", "")).lower())
    library_write(items)
    return entry


# ───────────────────────── Voces guardadas ─────────────────────────

def voices_load():
    try: return json.loads(VOICES_JSON.read_text(encoding="utf-8"))
    except Exception: return []


def voices_save(payload):
    name = str(payload.get("name") or "").strip()
    voice_id = str(payload.get("voice_id") or "").strip()
    if not name: raise RuntimeError("Ponle un nombre a la voz.")
    if not voice_id: raise RuntimeError("Este personaje no tiene Voice ID que guardar.")
    try: speed = float(payload.get("speed") or 1)
    except Exception: speed = 1.0
    entry = {"name": name, "voice_id": voice_id, "speed": speed, "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S")}
    items = [x for x in voices_load() if str(x.get("name", "")).strip().lower() != name.lower()]
    items.append(entry); items.sort(key=lambda x: str(x.get("name", "")).lower())
    tmp = VOICES_JSON.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, VOICES_JSON)
    return entry


def voices_delete(name):
    name = str(name or "").strip().lower()
    items = [x for x in voices_load() if str(x.get("name", "")).strip().lower() != name]
    tmp = VOICES_JSON.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, VOICES_JSON)


def safe_slug_plain(name):
    text = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-") or uuid.uuid4().hex[:8]


# ───────────────────────── AI33 Text-to-Speech ─────────────────────────

def multipart(fields):
    boundary = "----ChatVideoMaker" + uuid.uuid4().hex
    chunks = []
    for name, value in fields:
        chunks.append((f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{str(value)}\r\n").encode("utf-8"))
    chunks.append(f"--{boundary}--\r\n".encode("ascii"))
    return boundary, b"".join(chunks)


def find_audio(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            lk = str(k).lower()
            if isinstance(v, str) and ("audio" in lk or lk in ("url", "download_url", "file_url")):
                if v.startswith("data:audio/") or v.startswith("http://") or v.startswith("https://"):
                    return v
            r = find_audio(v)
            if r: return r
    elif isinstance(obj, list):
        for v in obj:
            r = find_audio(v)
            if r: return r
    return None


def audio_cache_key(text, voice, speed, kind="message"):
    sv = float(speed or 1); speed_value = int(sv) if sv.is_integer() else sv
    raw = json.dumps([str(kind or "message"), str(text or "").strip(), str(voice or "").strip(), speed_value], ensure_ascii=False, separators=(",", ":"))
    # FNV-1a de 32 bits sobre unidades UTF-16: idéntico al cálculo del navegador.
    data = raw.encode("utf-16-le")
    h = 0x811c9dc5
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 0x01000193) & 0xffffffff
    return f"{h:08x}"


def safe_existing_audio(existing_audio, tts_dir):
    if not existing_audio: return None
    s = str(existing_audio).replace("\\", "/").lstrip("/")
    if not s.startswith(f"projects/{tts_dir.parent.name}/tts/"): return None
    fp = PUBLIC / s
    try:
        if fp.exists() and fp.is_file() and fp.parent.resolve() == tts_dir.resolve(): return fp
    except Exception: pass
    return None


# ── Consulta del estado de una tarea (GET Task) ──
# La creación de la tarea sigue yendo a api.ai33.pro exactamente igual que antes.
# Solo para CONSULTAR la tarea: si api.ai33.pro responde 401 (AI33 ahora es OpenSpeaker y su API
# está en api.openspeaker.ai), se prueban las variantes documentadas y se recuerda la que funciona.
TASK_HOSTS = ("https://api.ai33.pro", "https://api.openspeaker.ai")
_task_variant = None   # (host, nombre de cabecera, formato) que funcionó la última vez


def _task_variants(api_key):
    for host in TASK_HOSTS:
        yield (host, "xi-api-key", "{k}")
        yield (host, "Authorization", "{k}")
        yield (host, "Authorization", "Bearer {k}")


def ai33_get_task(task_id, api_key):
    """Devuelve el JSON (bytes) de GET /v1/task/{id}. Lanza HTTPError si ninguna variante es aceptada."""
    global _task_variant
    path = f"/v1/task/{urllib.parse.quote(task_id, safe='')}"
    variants = list(_task_variants(api_key))
    if _task_variant in variants:
        variants.remove(_task_variant); variants.insert(0, _task_variant)
    first_error, tried = None, []
    for attempt in range(3):                  # un 401 justo tras crear la tarea puede ser momentáneo
        for v in variants:
            host, header, fmt = v
            req = urllib.request.Request(host + path, method="GET", headers={
                header: fmt.format(k=api_key), "Accept": "application/json", "User-Agent": "ChatVideoMaker/1.0"})
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = r.read()
                if _task_variant != v:
                    print(f"[AI33] GET Task funciona con {host} · cabecera {header}")
                _task_variant = v
                return data
            except urllib.error.HTTPError as e:
                if e.code not in (401, 403): raise      # 404 = aún no está lista, etc.: lo trata el bucle de siempre
                if first_error is None: first_error = e
                tried.append(f"{host.split('//')[1]}+{header}{' Bearer' if 'Bearer' in fmt else ''}→{e.code}")
            except Exception as e:
                tried.append(f"{host.split('//')[1]}→{type(e).__name__}")
        time.sleep(2)
    print("[AI33] GET Task rechazado en todas las variantes: " + ", ".join(tried[:6]))
    raise first_error


def ai33_tts_message(api_key, text, voice, speed, job, index, total, tts_dir, cache_key, existing_audio=None):
    """Genera UN audio en AI33, espera a que termine, lo descarga y verifica su duración.
    No se pide el siguiente hasta que este está guardado (AI33 solo admite una tarea a la vez)."""
    web_dir = f"/projects/{tts_dir.parent.name}/tts"
    for candidate in (safe_existing_audio(existing_audio, tts_dir), tts_dir / f"message_{cache_key}.mp3"):
        if candidate is not None and candidate.exists():
            duration = audio_duration(candidate)
            if duration and duration > 0:
                job.update({"phase": "ready", "current": index + 1, "total": total, "percent": round(((index + 1) / total) * 100),
                            "message": f"✓ Audio {index + 1} de {total} ya existía; reutilizado."})
                return {"lineIndex": index, "audio": f"{web_dir}/{candidate.name}", "duration": duration, "cacheKey": cache_key, "reused": True}

    job.update({"phase": "generating", "current": index + 1, "total": total, "percent": round((index / total) * 100),
                "message": f"Generando audio {index + 1} de {total}…"})
    boundary, body = multipart([
        ("text", text), ("voice_id", voice), ("speed", max(.15, min(4.0, float(speed or 1)))),
        ("with_transcript", "false"), ("file_name", f"message_{index + 1:04d}.mp3"),
    ])
    req = urllib.request.Request("https://api.ai33.pro/v3/text-to-speech", data=body, method="POST",
                                 headers={"xi-api-key": api_key, "Content-Type": f"multipart/form-data; boundary={boundary}",
                                          "Accept": "application/json", "User-Agent": "ChatVideoMaker/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"AI33 respondió HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:2000]}")
    except Exception as e:
        raise RuntimeError("No se pudo conectar con AI33: " + str(e))
    try:
        obj = json.loads(raw.decode("utf-8"))
    except Exception as e:
        raise RuntimeError("AI33 devolvió una respuesta que no es JSON: " + str(e))
    if not isinstance(obj, dict) or not obj.get("success") or not obj.get("task_id"):
        raise RuntimeError("AI33 no creó la tarea: " + json.dumps(obj, ensure_ascii=False)[:2000])
    task_id = str(obj["task_id"])

    deadline = time.time() + 900
    while time.time() < deadline:
        try:
            pdata = ai33_get_task(task_id, api_key)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            if e.code in (404, 409, 425, 429, 500, 502, 503, 504):
                job.update({"phase": "waiting", "message": f"AI33 está preparando el audio {index + 1} de {total}…"})
                time.sleep(1.5); continue
            raise RuntimeError(f"AI33 GET Task respondió HTTP {e.code}: {detail[:2000]}")
        try:
            task = json.loads(pdata.decode("utf-8"))
        except Exception as e:
            raise RuntimeError("AI33 devolvió un estado de tarea inválido: " + str(e))
        status = str(task.get("status") or "").lower()
        try: prog = max(0, min(100, int(float(task.get("progress")))))
        except Exception: prog = 0
        base = (index / total) * 100; span = (1 / total) * 100
        job.update({"phase": "polling", "current": index + 1, "total": total, "percent": round(base + span * (prog / 100) * 0.8),
                    "message": f"AI33: {status or 'procesando'} · audio {index + 1} de {total} · {prog}%"})
        if status == "error":
            raise RuntimeError("AI33 no pudo generar el audio: " + str(task.get("error_message") or "error desconocido"))
        if status == "done":
            audio_url = (task.get("metadata") or {}).get("audio_url") or find_audio(task)
            if not audio_url:
                raise RuntimeError("AI33 terminó la tarea pero no devolvió metadata.audio_url: " + json.dumps(task, ensure_ascii=False)[:2500])
            job.update({"phase": "downloading", "percent": round(((index + 0.9) / total) * 100), "message": f"Descargando audio {index + 1} de {total}…"})
            lower = str(audio_url).lower()
            ext = "wav" if ".wav" in lower else "ogg" if ".ogg" in lower else "m4a" if (".m4a" in lower or ".mp4" in lower) else "mp3"
            final_path = tts_dir / f"message_{cache_key}.{ext}"
            dl_req = urllib.request.Request(audio_url, headers={"xi-api-key": api_key, "User-Agent": "ChatVideoMaker/1.0"})
            try:
                with urllib.request.urlopen(dl_req, timeout=300) as ar:
                    data = ar.read()
            except urllib.error.HTTPError as e:
                if e.code in (404, 409, 425, 429, 500, 502, 503, 504):
                    time.sleep(1.5); continue
                raise RuntimeError(f"No se pudo descargar el audio de AI33 (HTTP {e.code}): {e.read().decode('utf-8', errors='replace')[:1000]}")
            if not data or len(data) < 256:
                time.sleep(1.5); continue
            final_path.write_bytes(data)
            duration = audio_duration(final_path)
            if not duration or duration <= 0:
                try: final_path.unlink()
                except Exception: pass
                raise RuntimeError(f"El audio {index + 1} se descargó, pero no se pudo leer su duración.")
            job.update({"phase": "ready", "percent": round(((index + 1) / total) * 100), "message": f"✓ Audio {index + 1} de {total} descargado ({duration:.2f}s)."})
            return {"lineIndex": index, "audio": f"{web_dir}/{final_path.name}", "duration": duration, "task_id": task_id, "cacheKey": cache_key, "reused": False}
        time.sleep(1.0)
    raise RuntimeError(f"AI33 no terminó el audio {index + 1} dentro del tiempo de espera (task {task_id}).")


def start_ai33_messages(payload):
    job_id = uuid.uuid4().hex
    job = {"id": job_id, "phase": "starting", "current": 0, "total": 0, "percent": 0, "message": "Preparando audios…", "results": [], "error": None}
    JOBS["tts_" + job_id] = job

    def worker():
        try:
            api_key = (payload.get("api_key") or "").strip()
            messages = payload.get("messages") or []
            if not api_key: raise RuntimeError("Introduce tu API Key de AI33.")
            if not messages: raise RuntimeError("No hay mensajes para generar.")
            tts_dir = project_dir(str(payload.get("projectSlug") or "")) / "tts"
            job["total"] = len(messages)
            results = []
            for i, m in enumerate(messages):
                voice_id = (m.get("voice_id") or "").strip()
                if not voice_id: raise RuntimeError(f"Falta AI33 Voice ID en el elemento {i + 1}.")
                kind = m.get("kind") or "message"
                spoken = strip_emojis_for_tts(m.get("text", "").strip())
                key = audio_cache_key(spoken, voice_id, m.get("speed", 1), kind)
                if not spoken:   # línea solo con emojis: sin voz
                    res = {"lineIndex": i, "audio": None, "duration": 0, "cacheKey": key, "reused": True, "silent": True}
                else:
                    res = ai33_tts_message(api_key, spoken, voice_id, m.get("speed", 1), job, i, len(messages), tts_dir, key, m.get("existingAudio"))
                if m.get("lineIndex") is not None: res["lineIndex"] = int(m.get("lineIndex"))
                if m.get("eventIndex") is not None: res["eventIndex"] = int(m.get("eventIndex"))
                res["kind"] = str(kind)
                results.append(res); job["results"] = results
            job.update({"phase": "done", "percent": 100, "message": f"{len(results)} audios listos en la carpeta del proyecto."})
        except Exception as e:
            job.update({"phase": "error", "error": str(e), "message": str(e)})

    threading.Thread(target=worker, daemon=True).start()
    return job_id


def open_folder(path):
    if os.name == "nt": os.startfile(str(path))
    elif sys.platform == "darwin": subprocess.Popen(["open", str(path)])
    else: subprocess.Popen(["xdg-open", str(path)])


# ───────────────────────── HTTP ─────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):   # consola limpia: solo errores
        if args and str(args[1] if len(args) > 1 else "").startswith(("4", "5")):
            super().log_message(fmt, *args)

    def send_bytes(self, code, ctype, data, extra=None):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(data)

    def send_json(self, code, obj):
        self.send_bytes(code, "application/json; charset=utf-8", json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def send_file(self, fp, ctype=None, download=False):
        """Envía un archivo por partes (no lo carga entero en memoria).
        La cabecera de descarga lleva el nombre en ASCII + UTF-8 (RFC 6266), así funcionan
        nombres con tildes, emojis o comillas tipográficas."""
        if not fp.exists() or not fp.is_file():
            self.send_bytes(404, "text/plain", b"Not found"); return
        size = fp.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", ctype or mimetypes.guess_type(fp.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-store")
        if download:
            ascii_name = unicodedata.normalize("NFKD", fp.name).encode("ascii", "ignore").decode("ascii")
            ascii_name = re.sub(r'[^A-Za-z0-9._ -]+', "_", ascii_name).strip(" ._") or "video"
            if "." not in ascii_name and "." in fp.name: ascii_name += fp.suffix
            self.send_header("Content-Disposition", f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{urllib.parse.quote(fp.name, safe='')}")
        self.end_headers()
        try:
            with open(fp, "rb") as f:
                while True:
                    chunk = f.read(1024 * 1024)
                    if not chunk: break
                    self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass   # el navegador canceló la descarga

    def do_GET(self):
        u = urlparse(self.path); path = u.path; qs = parse_qs(u.query)
        if path == "/":
            html = WEB.read_text(encoding="utf-8")
            slug = qs.get("project", [""])[0]
            if slug:
                try:
                    data = json.loads((project_dir(slug) / "project.json").read_text(encoding="utf-8"))
                    blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
                    html = html.replace("</head>", f"<script>window.__PROJECT_DATA__={blob};</script></head>", 1)
                except Exception: pass
            self.send_bytes(200, "text/html; charset=utf-8", html.encode("utf-8")); return
        if path == "/shared/chatcore.js":
            self.send_file(SHARED / "chatcore.js", "text/javascript; charset=utf-8"); return
        if path == "/projects":
            items = []
            for d in sorted([x for x in PROJECTS_ROOT.iterdir() if x.is_dir()], key=lambda x: x.stat().st_mtime, reverse=True):
                meta = d / "project.json"
                try: data = json.loads(meta.read_text(encoding="utf-8")) if meta.exists() else {}
                except Exception: data = {}
                items.append({"projectSlug": d.name, "projectName": data.get("projectName") or d.name, "updatedAt": data.get("updatedAt", "")})
            self.send_json(200, {"ok": True, "projects": items}); return
        if path == "/projects/characters":
            self.send_json(200, {"ok": True, "characters": project_characters(qs.get("exclude", [""])[0])}); return
        parts = path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "projects" and parts[2] == "video":
            try:
                d = project_dir(parts[1]); meta = json.loads((d / "project.json").read_text(encoding="utf-8"))
                self.send_file(d / f"{sanitize_filename(meta.get('projectName') or parts[1])}.mp4", "video/mp4", download=True)
            except Exception:
                self.send_bytes(404, "text/plain", b"Not found")
            return
        if path == "/voices":
            self.send_json(200, {"ok": True, "voices": voices_load()}); return
        if path == "/library":
            self.send_json(200, {"ok": True, "characters": library_load()}); return
        if len(parts) == 3 and parts[0] == "library" and parts[1] == "assets":
            name = urllib.parse.unquote(parts[2])
            if not SAFE_NAME.match(name) or name.startswith("."):
                self.send_bytes(400, "text/plain", b"Bad name"); return
            self.send_file(LIBRARY / "assets" / name); return
        if len(parts) == 4 and parts[0] == "projects" and parts[2] in ("assets", "tts"):
            name = urllib.parse.unquote(parts[3])
            if not SAFE_NAME.match(name) or name.startswith("."):
                self.send_bytes(400, "text/plain", b"Bad name"); return
            try: self.send_file(project_dir(parts[1]) / parts[2] / name)
            except Exception: self.send_bytes(404, "text/plain", b"Not found")
            return
        if len(parts) == 2 and parts[0] == "tts" and SAFE_NAME.match(parts[1]):   # audios de versiones antiguas
            self.send_file(TTS_DIR / parts[1], "audio/mpeg"); return
        if len(parts) == 3 and parts[0] == "ai33" and parts[1] == "progress":
            job = JOBS.get("tts_" + parts[2])
            self.send_json(200 if job else 404, {"ok": True, **job} if job else {"ok": False, "error": "job"}); return
        if len(parts) == 3 and parts[0] == "export" and parts[1] == "progress":
            job = JOBS.get("render_" + parts[2])
            self.send_json(200 if job else 404, {"ok": True, **job} if job else {"ok": False, "error": "job"}); return
        self.send_bytes(404, "text/plain", b"Not found")

    def do_HEAD(self):
        """Solo para saber si un proyecto ya tiene MP4 generado."""
        parts = urlparse(self.path).path.strip("/").split("/")
        ok = False
        if len(parts) == 3 and parts[0] == "projects" and parts[2] == "video":
            try:
                d = project_dir(parts[1]); meta = json.loads((d / "project.json").read_text(encoding="utf-8"))
                ok = (d / f"{sanitize_filename(meta.get('projectName') or parts[1])}.mp4").exists()
            except Exception: ok = False
        self.send_response(200 if ok else 404); self.send_header("Content-Length", "0"); self.end_headers()

    def _same_origin(self):
        """Bloquea peticiones POST hechas desde otras webs abiertas en el navegador."""
        origin = self.headers.get("Origin")
        return not origin or origin in (f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}")

    def do_POST(self):
        if not self._same_origin():
            self.send_json(403, {"ok": False, "error": "Origen no permitido."}); return
        n = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(n) if n else b""
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            self.send_json(400, {"ok": False, "error": "JSON no válido."}); return
        try:
            if self.path == "/projects/create":
                name = str(payload.get("name") or "").strip()
                if not name: raise RuntimeError("Escribe un nombre para el proyecto.")
                slug = safe_slug(name); d = project_dir(slug)
                now = time.strftime("%Y-%m-%d %H:%M:%S")
                meta = {"projectSlug": slug, "projectName": name, "version": VERSION, "createdAt": now, "updatedAt": now}
                (d / "project.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
                self.send_json(200, {"ok": True, **meta}); return
            if self.path in ("/projects/upload-asset", "/projects/upload-background"):
                slug = str(payload.get("projectSlug") or "").strip()
                kind = str(payload.get("kind") or "background")
                if kind not in ("background", "char", "sound", "music"): raise RuntimeError("Tipo de archivo no válido.")
                data = str(payload.get("data") or "")
                if kind in ("background", "char") and not data.startswith("data:image/"): raise RuntimeError("La imagen no es válida.")
                if kind in ("sound", "music") and not data.startswith("data:audio/"): raise RuntimeError("El audio no es válido.")
                self.send_json(200, {"ok": True, "url": store_data_url(slug, data, kind)}); return
            if self.path == "/projects/copy-asset":
                slug = str(payload.get("projectSlug") or "").strip()
                self.send_json(200, {"ok": True, "url": copy_project_asset(slug, payload.get("url"))}); return
            if self.path == "/projects/save":
                d, _ = save_project_json(payload)
                self.send_json(200, {"ok": True, "path": str(d)}); return
            if self.path == "/export":
                self.send_json(200, {"ok": True, "job": start_export(payload)}); return
            if self.path == "/voices/save":
                self.send_json(200, {"ok": True, "voice": voices_save(payload)}); return
            if self.path == "/voices/delete":
                voices_delete(payload.get("name")); self.send_json(200, {"ok": True}); return
            if self.path == "/library/save":
                self.send_json(200, {"ok": True, "character": library_save(payload.get("character"))}); return
            if self.path == "/library/delete":
                name = str(payload.get("name") or "").strip().lower()
                library_write([x for x in library_load() if str(x.get("name", "")).strip().lower() != name])
                self.send_json(200, {"ok": True}); return
            if self.path == "/projects/open-folder":
                folder = project_dir(str(payload.get("projectSlug") or ""))
                open_folder(folder)
                self.send_json(200, {"ok": True, "path": str(folder)}); return
            if self.path == "/ai33/open-folder":
                slug = str(payload.get("projectSlug") or "")
                folder = project_dir(slug) / "tts" if slug else TTS_DIR
                open_folder(folder)
                self.send_json(200, {"ok": True, "path": str(folder)}); return
            if self.path == "/ai33/messages":
                self.send_json(200, {"ok": True, "job": start_ai33_messages(payload)}); return
            self.send_bytes(404, "text/plain", b"Not found")
        except Exception as e:
            self.send_json(400, {"ok": False, "error": str(e)})


if __name__ == "__main__":
    port = int(os.environ.get("CHAT_VIDEO_PORT", "0") or 0)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    PORT = server.server_port
    url = f"http://127.0.0.1:{PORT}/"
    if not os.environ.get("CHAT_VIDEO_NO_BROWSER"):
        threading.Timer(.8, lambda: webbrowser.open(url)).start()
    print(f"Chat Video Maker LOCAL {VERSION} · AI33 + Remotion: {url}")
    server.serve_forever()
