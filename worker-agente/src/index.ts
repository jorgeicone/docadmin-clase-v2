// Worker docadmin-agente
//   POST /agente   chat con herramientas, responde en Server-Sent Events
//   GET  /archivo  descarga de archivos generados (enlace firmado, vence en 24 h)
//   GET  /salud    comprobación simple
import * as z from "zod/v4";
import { correrTurno } from "./agent";
import type { Env } from "./env";
import { servirArchivo } from "./files";
import { ErrorHttp, usuarioDesdeJwt } from "./supabase";
import type { Evento } from "./tools";

const Peticion = z.object({
  course_id: z.string().uuid(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(20000),
  })).min(1).max(40),
});

function cors(env: Env, req: Request): Record<string, string> {
  const origen = req.headers.get("Origin") ?? "";
  const permitidos = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  if (!permitidos.includes(origen)) return {};
  return {
    "Access-Control-Allow-Origin": origen,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const jsonError = (status: number, mensaje: string, h: Record<string, string>) =>
  new Response(JSON.stringify({ error: mensaje }), { status, headers: { ...h, "Content-Type": "application/json" } });

async function agente(req: Request, env: Env, ctx: ExecutionContext, h: Record<string, string>): Promise<Response> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return jsonError(401, "Falta la sesión", h);
  const usuario = await usuarioDesdeJwt(env, jwt);

  const cuerpo = Peticion.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) return jsonError(400, "Petición inválida", h);
  const { course_id, messages } = cuerpo.data;
  if (messages[messages.length - 1].role !== "user") return jsonError(400, "El último mensaje debe ser del docente", h);

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const escritor = writable.getWriter();
  const enc = new TextEncoder();
  const corte = new AbortController();
  let cerrado = false;
  const emitir = (e: Evento) => {
    if (cerrado) return;
    escritor.write(enc.encode(`data: ${JSON.stringify(e)}\n\n`)).catch(() => { cerrado = true; corte.abort(); });
  };

  ctx.waitUntil((async () => {
    try {
      await correrTurno(env, {
        jwt, userId: usuario.id, courseId: course_id, mensajes: messages,
        origen: new URL(req.url).origin, emitir, signal: corte.signal,
      });
    } catch (err) {
      if (!corte.signal.aborted) {
        console.error("agente", err);
        emitir({ tipo: "error", mensaje: "Ocurrió un error al procesar la solicitud. Intenta de nuevo en un momento." });
      }
    } finally {
      emitir({ tipo: "fin" });
      cerrado = true;
      await escritor.close().catch(() => {});
    }
  })());

  return new Response(readable, {
    headers: { ...h, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const h = cors(env, req);
    try {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
      if (req.method === "POST" && url.pathname === "/agente") return await agente(req, env, ctx, h);
      if (req.method === "GET" && url.pathname === "/archivo") return await servirArchivo(env, url);
      if (req.method === "GET" && url.pathname === "/salud") return new Response("ok", { headers: h });
      return jsonError(404, "No encontrado", h);
    } catch (err) {
      if (err instanceof ErrorHttp) return jsonError(err.status, err.message, h);
      console.error(err);
      return jsonError(500, "Error interno", h);
    }
  },
};
