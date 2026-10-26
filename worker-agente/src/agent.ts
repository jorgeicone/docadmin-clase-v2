// Bucle del agente: Tool Runner con streaming. Cada petición al modelo
// descuenta una llamada del plan del docente, igual que el chat anterior.
import Anthropic from "@anthropic-ai/sdk";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type { Env } from "./env";
import { Curso } from "./curso";
import { herramientaArchivo } from "./files";
import { SISTEMA_DOCADMIN, contextoDelTurno } from "./prompt";
import { Pg, descontarLlamada, llamadasRestantes } from "./supabase";
import { herramientasCurso, type Evento } from "./tools";

export interface MensajeChat { role: "user" | "assistant"; content: string }

export interface Turno {
  jwt: string;
  userId: string;
  courseId: string;
  mensajes: MensajeChat[];
  origen: string;
  emitir: (e: Evento) => void;
  signal?: AbortSignal;
}

const NOMBRES: Record<string, string> = {
  consultar_curso: "Consultando el curso",
  buscar_estudiante: "Buscando estudiante",
  proponer_notas: "Preparando notas",
  proponer_actividad: "Preparando actividad",
  proponer_asistencia: "Preparando asistencia",
  proponer_sesion_plan: "Preparando sesión del plan",
  generar_archivo: "Generando archivo",
  web_search: "Buscando en la web",
  web_fetch: "Leyendo página web",
};

/** Envuelve una herramienta para avisar al navegador cuándo empieza y termina. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function conAviso(t: BetaRunnableTool<any>, emitir: (e: Evento) => void): BetaRunnableTool<any> {
  const original = t.run;
  return {
    ...t,
    run: async (args: unknown, c?: Parameters<typeof original>[1]) => {
      emitir({ tipo: "herramienta", nombre: NOMBRES[t.name] ?? t.name, estado: "inicio" });
      try {
        const r = await original(args, c);
        emitir({ tipo: "herramienta", nombre: NOMBRES[t.name] ?? t.name, estado: "fin" });
        return r;
      } catch (e) {
        emitir({ tipo: "herramienta", nombre: NOMBRES[t.name] ?? t.name, estado: "fin", resumen: "falló" });
        throw e;
      }
    },
  };
}

export async function correrTurno(env: Env, t: Turno, client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })): Promise<void> {
  const { emitir } = t;
  let restantes = await llamadasRestantes(env, t.jwt);
  if (restantes <= 0) {
    emitir({ tipo: "error", mensaje: "Se agotaron las llamadas IA de tu plan este mes. Puedes ampliar el plan desde el menú." });
    return;
  }

  const curso = new Curso(new Pg(env, t.jwt), t.courseId);
  const info = await curso.info();
  if (!info) {
    emitir({ tipo: "error", mensaje: "No encontré ese curso en tu cuenta." });
    return;
  }

  const ctx = { curso, emitir };
  const tools = [
    ...herramientasCurso(ctx),
    herramientaArchivo(env, client, t.origen, ctx),
  ].map((x) => conAviso(x, emitir));

  const runner = client.beta.messages.toolRunner(
    {
      model: env.MODEL,
      max_tokens: 32000,
      output_config: { effort: env.EFFORT as "low" | "medium" | "high" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thread: false,
      max_iterations: Number(env.MAX_ITERATIONS) || 10,
      system: [
        { type: "text", text: SISTEMA_DOCADMIN, cache_control: { type: "ephemeral" } },
        { type: "text", text: contextoDelTurno(info as { name?: unknown; code?: unknown }, new Date()) },
      ],
      tools: [
        ...tools,
        { type: "web_search_20260209", name: "web_search", max_uses: 3 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 },
      ],
      messages: t.mensajes.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    },
    { signal: t.signal },
  );

  let entrada = 0, salida = 0, llamadas = 0;
  for await (const stream of runner) {
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        emitir({ tipo: "texto", texto: ev.delta.text });
      } else if (ev.type === "content_block_start" && ev.content_block.type === "server_tool_use") {
        emitir({ tipo: "herramienta", nombre: NOMBRES[ev.content_block.name] ?? ev.content_block.name, estado: "inicio" });
      }
    }
    const msg = await stream.finalMessage();
    llamadas++;
    restantes--;
    entrada += (msg.usage.input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
    salida += msg.usage.output_tokens ?? 0;
    await descontarLlamada(env, t.userId);

    if (msg.stop_reason === "refusal") {
      emitir({ tipo: "error", mensaje: "La solicitud fue rechazada por las políticas de seguridad del modelo." });
      break;
    }
    if (msg.stop_reason === "pause_turn") {
      runner.pushMessages({ role: "assistant", content: msg.content });
    }
    const quiereSeguir = msg.stop_reason === "tool_use" || msg.stop_reason === "pause_turn";
    if (quiereSeguir && restantes <= 0) {
      emitir({ tipo: "error", mensaje: "Se agotaron las llamadas IA de tu plan en medio de la tarea. Lo hecho hasta aquí queda en pantalla." });
      break;
    }
  }
  emitir({ tipo: "uso", entrada, salida, llamadas });
}
