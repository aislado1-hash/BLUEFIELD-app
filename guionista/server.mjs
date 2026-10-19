// Guionista: genera guiones de fútbol en formato chat con la API de Claude.
// Servidor mínimo (sin frameworks): sirve la interfaz y transmite el guion por SSE.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(here, "..", ".env"));
} catch {
  // sin .env: se usan las variables de entorno del sistema
}

const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const MAESTRO = await readFile(path.join(here, "prompt-maestro.md"), "utf8");
const INDEX = await readFile(path.join(here, "public", "index.html"));

const client = new Anthropic();

// Sección 21 del prompt maestro, rellenada con los datos del formulario.
function datosHistoria(d) {
  const opcional = (v) => (v && v.trim() ? v.trim() : "(no especificado)");
  return [
    "21. DATOS PARA CREAR LA HISTORIA",
    `Título: ${d.titulo.trim()}`,
    `Contexto: ${d.contexto.trim()}`,
    `Duración objetivo (opcional): ${opcional(d.duracion)}`,
    `Personajes obligatorios (opcional): ${opcional(d.personajes)}`,
    `Final deseado (opcional): ${opcional(d.final)}`,
    `Eventos disponibles en Chat Video Maker (opcional): ${opcional(d.eventos)}`,
  ].join("\n");
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

function mensajeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "API key inválida o ausente (ANTHROPIC_API_KEY).";
  if (err instanceof Anthropic.RateLimitError) return "Límite de uso de la API alcanzado. Prueba en un momento.";
  if (err instanceof Anthropic.BadRequestError) return `Petición rechazada por la API: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `Error de la API (${err.status ?? "red"}): ${err.message}`;
  return err?.message || String(err);
}

async function generar(req, res) {
  let d;
  try {
    d = await leerJson(req);
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: err.message }));
  }
  if (!d.titulo?.trim() || !d.contexto?.trim()) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "El título y el contexto son obligatorios." }));
  }
  const effort = EFFORTS.includes(d.effort) ? d.effort : "high";

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const enviar = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort },
    // El prompt maestro es fijo: se cachea para abaratar las siguientes generaciones.
    system: [{ type: "text", text: MAESTRO, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: datosHistoria(d) }],
  });
  res.on("close", () => stream.abort());

  try {
    enviar({ tipo: "estado", texto: "Pensando la historia…" });
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        enviar({ tipo: "texto", texto: ev.delta.text });
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      enviar({ tipo: "error", texto: "Claude ha rechazado esta petición. Reformula el contexto e inténtalo de nuevo." });
    } else {
      enviar({
        tipo: "fin",
        stop_reason: final.stop_reason,
        modelo: final.model,
        uso: final.usage,
      });
    }
  } catch (err) {
    if (!res.destroyed) enviar({ tipo: "error", texto: mensajeError(err) });
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(INDEX);
  }
  if (req.method === "GET" && req.url === "/api/estado") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ modelo: MODEL, apiKey: Boolean(process.env.ANTHROPIC_API_KEY) }));
  }
  if (req.method === "POST" && req.url === "/api/generar") return generar(req, res);
  res.writeHead(404);
  res.end("No encontrado");
});

server.listen(PORT, () => {
  console.log(`Guionista listo en http://localhost:${PORT} (modelo ${MODEL})`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn("Aviso: falta ANTHROPIC_API_KEY en .env");
});
