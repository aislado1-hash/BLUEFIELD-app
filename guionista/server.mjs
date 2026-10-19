// Guionista: genera guiones de fútbol en formato chat con tu cuenta de Claude.
// No usa API key: llama a Claude Code (`claude -p`), que inicia sesión con tu plan Pro/Max.
// Servidor mínimo sin dependencias: sirve la interfaz y transmite el resultado por SSE.
import http from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MAESTRO = path.join(here, "prompt-maestro.md");
const INDEX = await readFile(path.join(here, "public", "index.html"));
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const MODELOS = ["opus", "sonnet"];
const WIN = process.platform === "win32";
const INSTALAR = "Instala Claude Code: abre una terminal y ejecuta «npm install -g @anthropic-ai/claude-code». Después ejecuta «claude auth login».";

// En Windows `claude` es un .cmd y hay que lanzarlo con shell: se entrecomillan los argumentos.
function claude(args) {
  const final = WIN ? args.map((a) => `"${a}"`) : args;
  return spawn("claude", final, {
    shell: WIN,
    cwd: os.tmpdir(), // fuera de cualquier proyecto: no carga CLAUDE.md ajenos
    env: { ...process.env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: "64000" },
    windowsHide: true,
  });
}

function estado() {
  return new Promise((resolve) => {
    let out = "";
    const p = claude(["auth", "status"]);
    p.stdout.on("data", (c) => (out += c));
    p.on("error", () => resolve({ instalado: false, sesion: false }));
    p.on("close", (code) => {
      if (code === 127 || (WIN && code === 1 && !out)) return resolve({ instalado: false, sesion: false });
      try {
        resolve({ instalado: true, sesion: Boolean(JSON.parse(out).loggedIn) });
      } catch {
        resolve({ instalado: true, sesion: false });
      }
    });
  });
}

const texto = (v) => (typeof v === "string" ? v.trim() : "");

// Mensaje del usuario según el modo de trabajo (apartado 24 del prompt maestro).
// Devuelve { mensaje } o { error } si faltan datos obligatorios.
function construirMensaje(d) {
  if (d.modo === "ideas") {
    const n = Math.min(Math.max(parseInt(d.cantidad, 10) || 10, 1), 20);
    return {
      mensaje: [
        "MODO 2 — GENERAR IDEAS",
        `Cantidad de ideas: ${n}`,
        `Petición: ${texto(d.peticion) || "Ideas originales de fútbol, sin requisitos concretos."}`,
      ].join("\n"),
    };
  }
  if (d.modo === "mejorar") {
    if (!texto(d.guion)) return { error: "Pega el guion que quieres mejorar." };
    return {
      mensaje: [
        "MODO 3 — MEJORAR GUION",
        d.corregir
          ? "Quiero también el guion corregido al final."
          : "Solo quiero el análisis y las mejoras, sin reescribir el guion.",
        texto(d.notas) ? `Indicaciones: ${texto(d.notas)}` : "",
        "Guion:",
        texto(d.guion),
      ].filter(Boolean).join("\n"),
    };
  }
  if (!texto(d.titulo) || !texto(d.contexto)) return { error: "El título y el contexto son obligatorios." };
  return {
    mensaje: [
      "MODO 1 — CREAR GUION",
      "21. DATOS PARA CREAR LA HISTORIA",
      `Título: ${texto(d.titulo)}`,
      `Contexto: ${texto(d.contexto)}`,
    ].join("\n"),
  };
}

function leerJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 200_000) reject(new Error("Petición demasiado grande"));
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

async function generar(req, res) {
  let d;
  try {
    d = await leerJson(req);
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: err.message }));
  }
  const { mensaje, error } = construirMensaje(d);
  if (error) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error }));
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const enviar = (obj) => !res.destroyed && res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--system-prompt-file", MAESTRO,
    "--tools", "",
    "--no-session-persistence",
    "--safe-mode",
    "--effort", EFFORTS.includes(d.effort) ? d.effort : "high",
  ];
  if (MODELOS.includes(d.modelo)) args.push("--model", d.modelo);

  const p = claude(args);
  res.on("close", () => p.kill());
  p.stdin.end(mensaje);

  let buffer = "", stderr = "", resultado = null;
  p.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lineas = buffer.split("\n");
    buffer = lineas.pop();
    for (const l of lineas) {
      let ev;
      try {
        ev = JSON.parse(l);
      } catch {
        continue;
      }
      if (ev.type === "stream_event" && ev.event?.type === "content_block_delta" && ev.event.delta?.type === "text_delta") {
        enviar({ tipo: "texto", texto: ev.event.delta.text });
      } else if (ev.type === "result") {
        resultado = ev;
      }
    }
  });
  p.stderr.on("data", (c) => (stderr += c));
  p.on("error", (err) => {
    enviar({ tipo: "error", texto: err.code === "ENOENT" ? `No se encuentra Claude Code. ${INSTALAR}` : err.message });
    res.end();
  });
  p.on("close", (code) => {
    if (res.destroyed) return;
    if (resultado && !resultado.is_error) {
      enviar({ tipo: "fin", stop_reason: resultado.stop_reason, uso: resultado.usage });
    } else {
      const motivo = resultado?.result || stderr.trim() || `Claude Code terminó con código ${code}.`;
      const sinSesion = /log ?in|auth|credential/i.test(motivo);
      enviar({
        tipo: "error",
        texto: code === 127 ? `No se encuentra Claude Code. ${INSTALAR}`
          : sinSesion ? `No has iniciado sesión en Claude Code: ejecuta «claude auth login» en una terminal. (${motivo})`
          : motivo,
      });
    }
    res.end();
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(INDEX);
  }
  if (req.method === "GET" && req.url === "/api/estado") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(await estado()));
  }
  if (req.method === "POST" && req.url === "/api/generar") return generar(req, res);
  res.writeHead(404);
  res.end("No encontrado");
});

server.listen(PORT, async () => {
  console.log(`Guionista listo en http://localhost:${PORT}`);
  const e = await estado();
  if (!e.instalado) console.warn(`Aviso: no se encuentra Claude Code. ${INSTALAR}`);
  else if (!e.sesion) console.warn("Aviso: Claude Code no tiene sesión iniciada. Ejecuta «claude auth login».");
});
