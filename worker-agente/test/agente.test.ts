import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { correrTurno } from "../src/agent";
import { buscar, normalizar } from "../src/curso";
import type { Env } from "../src/env";
import { enlaceFirmado, idsDeArchivos, verificarEnlace } from "../src/files";
import type { Evento } from "../src/tools";

const env: Env = {
  SUPABASE_URL: "https://sb.test", SUPABASE_ANON: "anon", LEGACY_WORKER_URL: "https://legacy.test",
  ALLOWED_ORIGINS: "https://app.test", MODEL: "claude-opus-5-5", EFFORT: "medium", MAX_ITERATIONS: "6",
  CUSTOM_SKILL_IDS: "", ANTHROPIC_API_KEY: "sk-test", SUPABASE_SERVICE_KEY: "service", FILE_SIGNING_SECRET: "secreto",
};

const CURSO = "11111111-1111-4111-8111-111111111111";
const datos: Record<string, unknown[]> = {
  v5_courses: [{ id: CURSO, name: "Comunicación Digital 360", code: "CD360" }],
  v5_students: [
    { id: "s1", cedula: "1001", name: "María José Pérez", email: null },
    { id: "s2", cedula: "1002", name: "Andrés Gómez", email: null },
  ],
  v5_groups: [{ id: "g1", name: "Yoga Serena", leader_student_id: "s1", notes: null }],
  v5_group_members: [{ group_id: "g1", student_id: "s1" }],
  v5_activities: [
    { id: "a1", name: "Taller 1", type: "individual", weight: 10, max_points: 5, date: "2026-10-01", topic: null, description: null, rubric: null },
    { id: "a2", name: "Asistencia 2026-10-20", type: "attendance", weight: null, max_points: 1, date: "2026-10-20", topic: null, description: null, rubric: null },
  ],
  v5_grades: [{ id: "n1", activity_id: "a1", student_id: "s1", group_id: "g1", value: 3.5, status: null, observation: null, desglose: null }],
  v5_sessions: [],
};

let llamadasDescontadas = 0;
function fetchSupabase(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  if (url.origin === "https://legacy.test") return Promise.resolve(Response.json({ calls_remaining: 5 }));
  if (url.pathname.endsWith("/rpc/increment_ai_calls")) { llamadasDescontadas++; return Promise.resolve(new Response(null, { status: 204 })); }
  const auth = new Headers(init?.headers).get("Authorization");
  if (auth !== "Bearer jwt-docente") return Promise.resolve(new Response("sin jwt", { status: 401 }));
  const tabla = url.pathname.split("/").pop()!;
  return Promise.resolve(Response.json(datos[tabla] ?? []));
}

/** Respuesta SSE de la Messages API con los bloques dados. */
function sse(bloques: ({ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown })[], stop: string): Response {
  const ev: string[] = [];
  const push = (type: string, data: unknown) => ev.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...(data as object) })}\n\n`);
  push("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } });
  bloques.forEach((b, index) => {
    if (b.type === "text") {
      push("content_block_start", { index, content_block: { type: "text", text: "" } });
      push("content_block_delta", { index, delta: { type: "text_delta", text: b.text } });
    } else {
      push("content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      push("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    }
    push("content_block_stop", { index });
  });
  push("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } });
  push("message_stop", {});
  return new Response(ev.join(""), { headers: { "content-type": "text/event-stream" } });
}

describe("búsqueda de estudiantes", () => {
  it("ignora tildes, mayúsculas y orden de palabras", () => {
    const est = datos.v5_students as never;
    expect(normalizar("María JOSÉ")).toBe("maria jose");
    expect(buscar(est, "perez maria").map((e: { id: string }) => e.id)).toEqual(["s1"]);
    expect(buscar(est, "1002").map((e: { id: string }) => e.id)).toEqual(["s2"]);
    expect(buscar(est, "zzz")).toEqual([]);
  });
});

describe("archivos", () => {
  it("encuentra los file_id dentro de la respuesta de code execution", () => {
    const contenido = [{ type: "bash_code_execution_tool_result", content: { type: "bash_code_execution_result", content: [{ type: "bash_code_execution_output", file_id: "file_abc" }] } }];
    expect(idsDeArchivos(contenido)).toEqual(["file_abc"]);
  });
  it("acepta un enlace firmado vigente y rechaza uno alterado o vencido", async () => {
    const ahora = Date.UTC(2026, 9, 26);
    const u = new URL(await enlaceFirmado(env, "https://w.test", "file_abc", "notas.xlsx", ahora));
    expect(await verificarEnlace(env, u.searchParams, ahora)).toEqual({ id: "file_abc", nombre: "notas.xlsx" });
    const alterado = new URLSearchParams(u.searchParams); alterado.set("id", "file_otro");
    expect(await verificarEnlace(env, alterado, ahora)).toBeNull();
    expect(await verificarEnlace(env, u.searchParams, ahora + 25 * 3600 * 1000)).toBeNull();
  });
});

describe("turno del agente", () => {
  let eventos: Evento[];
  beforeEach(() => { eventos = []; llamadasDescontadas = 0; vi.stubGlobal("fetch", vi.fn(fetchSupabase)); });
  afterEach(() => vi.unstubAllGlobals());

  function clienteConGuion(respuestas: Response[], pedidos: unknown[]) {
    return new Anthropic({
      apiKey: "sk-test", maxRetries: 0,
      fetch: async (_url, init) => {
        pedidos.push(JSON.parse(String(init?.body)));
        const r = respuestas.shift();
        if (!r) throw new Error("el guion se quedó sin respuestas");
        return r;
      },
    });
  }

  it("consulta, propone notas validadas y no escribe en la base", async () => {
    const pedidos: Record<string, unknown>[] = [];
    const client = clienteConGuion([
      sse([{ type: "text", text: "Reviso. " }, { type: "tool_use", id: "tu1", name: "buscar_estudiante", input: { texto: "andres" } }], "tool_use"),
      sse([{ type: "tool_use", id: "tu2", name: "proponer_notas", input: { actividad_id: "a1", notas: [{ estudiante_id: "s2", valor: 4.2 }] } }], "tool_use"),
      sse([{ type: "text", text: "Listo, revisa y confirma." }], "end_turn"),
    ], pedidos);

    await correrTurno(env, { jwt: "jwt-docente", userId: "u1", courseId: CURSO, mensajes: [{ role: "user", content: "ponle 4,2 a Andrés en el taller 1" }], origen: "https://w.test", emitir: (e) => eventos.push(e) }, client);

    const texto = eventos.filter((e) => e.tipo === "texto").map((e) => (e as { texto: string }).texto).join("");
    expect(texto).toBe("Reviso. Listo, revisa y confirma.");
    const prop = eventos.find((e) => e.tipo === "propuesta") as Extract<Evento, { tipo: "propuesta" }>;
    expect(prop.propuesta.tipo).toBe("notas");
    if (prop.propuesta.tipo === "notas") {
      expect(prop.propuesta.filas).toEqual([{ student_id: "s2", group_id: null, nombre: "Andrés Gómez", valor: 4.2, observacion: null, anterior: null }]);
    }
    expect(eventos.at(-1)).toEqual({ tipo: "uso", entrada: 300, salida: 60, llamadas: 3 });
    expect(llamadasDescontadas).toBe(3);
    // Ninguna petición a Supabase fue de escritura
    const metodos = (fetch as unknown as { mock: { calls: [unknown, RequestInit?][] } }).mock.calls
      .filter(([u]) => String(u).includes("/rest/v1/v5_")).map(([, i]) => i?.method ?? "GET");
    expect(new Set(metodos)).toEqual(new Set(["GET"]));
    // El modelo recibe las herramientas y la configuración esperadas
    expect(pedidos[0].model).toBe("claude-opus-5-5");
    expect(pedidos[0].fallbacks).toBe("default");
    const nombres = (pedidos[0].tools as { name: string }[]).map((t) => t.name);
    expect(nombres).toEqual(expect.arrayContaining(["consultar_curso", "proponer_notas", "generar_archivo", "web_search"]));
    // El resultado de la propuesta vuelve al modelo como tool_result
    const ult = (pedidos[2].messages as { role: string; content: unknown }[]).at(-1)!;
    expect(JSON.stringify(ult.content)).toContain("enviada al docente para confirmar");
  });

  it("rechaza una nota fuera de escala sin crear propuesta", async () => {
    const client = clienteConGuion([
      sse([{ type: "tool_use", id: "tu1", name: "proponer_notas", input: { actividad_id: "a1", notas: [{ estudiante_id: "s1", valor: 7 }] } }], "tool_use"),
      sse([{ type: "text", text: "La escala es 0-5." }], "end_turn"),
    ], []);
    await correrTurno(env, { jwt: "jwt-docente", userId: "u1", courseId: CURSO, mensajes: [{ role: "user", content: "ponle 7" }], origen: "https://w.test", emitir: (e) => eventos.push(e) }, client);
    expect(eventos.some((e) => e.tipo === "propuesta")).toBe(false);
  });

  it("propone asistencia que reemplaza la del mismo día", async () => {
    const client = clienteConGuion([
      sse([{ type: "tool_use", id: "tu1", name: "proponer_asistencia", input: { fecha: "2026-10-20", registros: [{ estudiante_id: "s1", estado: "P" }, { estudiante_id: "s2", estado: "A" }] } }], "tool_use"),
      sse([{ type: "text", text: "Confirma." }], "end_turn"),
    ], []);
    await correrTurno(env, { jwt: "jwt-docente", userId: "u1", courseId: CURSO, mensajes: [{ role: "user", content: "asistencia del 20" }], origen: "https://w.test", emitir: (e) => eventos.push(e) }, client);
    const prop = (eventos.find((e) => e.tipo === "propuesta") as Extract<Evento, { tipo: "propuesta" }>).propuesta;
    expect(prop.tipo).toBe("asistencia");
    if (prop.tipo === "asistencia") expect(prop.existente_id).toBe("a2");
  });

  it("no llama al modelo si el plan no tiene llamadas", async () => {
    vi.stubGlobal("fetch", vi.fn((u: RequestInfo | URL, i?: RequestInit) =>
      String(u).startsWith("https://legacy.test") ? Promise.resolve(Response.json({ calls_remaining: 0 })) : fetchSupabase(u, i)));
    const pedidos: unknown[] = [];
    await correrTurno(env, { jwt: "jwt-docente", userId: "u1", courseId: CURSO, mensajes: [{ role: "user", content: "hola" }], origen: "https://w.test", emitir: (e) => eventos.push(e) }, clienteConGuion([], pedidos));
    expect(pedidos).toHaveLength(0);
    expect(eventos[0].tipo).toBe("error");
  });
});
