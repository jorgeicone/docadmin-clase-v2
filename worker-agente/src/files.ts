// Archivos (Excel, PowerPoint, Word, PDF) con Agent Skills + code execution.
// El archivo se crea en el contenedor de Anthropic; el Worker solo entrega un
// enlace firmado que vence, y lo sirve desde la Files API al hacer clic.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import type { Env } from "./env";
import type { Contexto } from "./tools";

const SKILL_POR_FORMATO = { xlsx: "xlsx", pptx: "pptx", docx: "docx", pdf: "pdf" } as const;
const VIGENCIA_SEG = 24 * 3600;

/** Recorre la respuesta y junta los file_id que produjo la ejecución de código. */
export function idsDeArchivos(contenido: unknown): string[] {
  const ids = new Set<string>();
  const visitar = (x: unknown) => {
    if (Array.isArray(x)) return x.forEach(visitar);
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (o.type === "bash_code_execution_output" && typeof o.file_id === "string") ids.add(o.file_id);
      Object.values(o).forEach(visitar);
    }
  };
  visitar(contenido);
  return [...ids];
}

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function firmar(secreto: string, texto: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto)));
}

export async function enlaceFirmado(env: Env, origen: string, fileId: string, nombre: string, ahora = Date.now()): Promise<string> {
  const exp = Math.floor(ahora / 1000) + VIGENCIA_SEG;
  const sig = await firmar(env.FILE_SIGNING_SECRET, `${fileId}.${nombre}.${exp}`);
  const q = new URLSearchParams({ id: fileId, n: nombre, exp: String(exp), sig });
  return `${origen}/archivo?${q}`;
}

export async function verificarEnlace(env: Env, q: URLSearchParams, ahora = Date.now()): Promise<{ id: string; nombre: string } | null> {
  const id = q.get("id"), nombre = q.get("n"), exp = q.get("exp"), sig = q.get("sig");
  if (!id || !nombre || !exp || !sig) return null;
  if (Number(exp) < Math.floor(ahora / 1000)) return null;
  const esperada = await firmar(env.FILE_SIGNING_SECRET, `${id}.${nombre}.${exp}`);
  if (esperada.length !== sig.length) return null;
  let dif = 0;
  for (let i = 0; i < sig.length; i++) dif |= esperada.charCodeAt(i) ^ sig.charCodeAt(i);
  return dif === 0 ? { id, nombre } : null;
}

/** GET /archivo — entrega el archivo si el enlace es válido y no venció. */
export async function servirArchivo(env: Env, url: URL): Promise<Response> {
  const ok = await verificarEnlace(env, url.searchParams);
  if (!ok) return new Response("Enlace vencido o inválido. Pide el archivo de nuevo en el chat.", { status: 403 });
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const r = await client.beta.files.download(ok.id);
  const nombreSeguro = ok.nombre.replace(/[^\w.\- ]/g, "_");
  return new Response(r.body, {
    headers: {
      "Content-Type": r.headers.get("content-type") ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${nombreSeguro}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export function herramientaArchivo(env: Env, client: Anthropic, origen: string, ctx: Contexto) {
  const propias = env.CUSTOM_SKILL_IDS.split(",").map((s) => s.trim()).filter(Boolean);
  return betaZodTool({
    name: "generar_archivo",
    description:
      "Genera un archivo descargable: xlsx (Excel), pptx (PowerPoint), docx (Word) o pdf. Pásale en 'datos' toda la información " +
      "que debe contener (consúltala antes con consultar_curso) y en 'instrucciones' la estructura y el formato. Tarda entre 30 s y 2 min.",
    inputSchema: z.object({
      formato: z.enum(["xlsx", "pptx", "docx", "pdf"]),
      nombre_archivo: z.string().min(1).max(120).describe("Nombre sin extensión, p. ej. consolidado-notas-cd360"),
      instrucciones: z.string().min(10),
      datos: z.string().describe("Datos en JSON o texto que debe llevar el archivo"),
    }),
    run: async ({ formato, nombre_archivo, instrucciones, datos }) => {
      const skills = [
        { type: "anthropic" as const, skill_id: SKILL_POR_FORMATO[formato], version: "latest" },
        ...propias.map((id) => ({ type: "custom" as const, skill_id: id, version: "latest" })),
      ];
      const pedido = `Crea un archivo ${formato} llamado "${nombre_archivo}.${formato}" y guárdalo en la carpeta de salida.\n\n` +
        `Instrucciones:\n${instrucciones}\n\nDatos:\n${datos}\n\nIdioma: español de Colombia.`;
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: pedido }];
      let containerId: string | undefined;
      const ids = new Set<string>();
      for (let i = 0; i < 4; i++) {
        const r = await client.beta.messages.create({
          model: env.MODEL,
          max_tokens: 16000,
          betas: ["code-execution-2025-08-25"],
          container: containerId ? { id: containerId, skills } : { skills },
          tools: [{ type: "code_execution_20260521", name: "code_execution" }],
          messages,
        });
        containerId = r.container?.id ?? containerId;
        idsDeArchivos(r.content).forEach((x) => ids.add(x));
        if (r.stop_reason === "refusal") return "No se pudo generar el archivo: la solicitud fue rechazada.";
        if (r.stop_reason !== "pause_turn") break;
        messages.push({ role: "assistant", content: r.content });
      }
      if (!ids.size) return "No se produjo ningún archivo. Intenta con instrucciones más concretas.";
      const enlaces: string[] = [];
      for (const id of ids) {
        const meta = await client.beta.files.retrieveMetadata(id);
        const url = await enlaceFirmado(env, origen, id, meta.filename);
        ctx.emitir({ tipo: "archivo", nombre: meta.filename, url });
        enlaces.push(meta.filename);
      }
      return `Archivo(s) listo(s) y ya visibles para el docente con botón de descarga: ${enlaces.join(", ")}. El enlace vence en 24 horas.`;
    },
  });
}
