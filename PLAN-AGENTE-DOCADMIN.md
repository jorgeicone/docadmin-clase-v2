# 🤖 Plan técnico — DocAdmin como agente (tres caminos)

**Fecha:** 26 de octubre de 2026
**Autor:** Sesión Claude Code con Jorge Hugo Pérez Gaona
**Objetivo:** que ICONE.DocAdmin haga, desde la propia app, lo que hoy hace una sesión de Claude Code: operar el curso con herramientas, producir archivos, conectarse a Google y GitHub, correr rutinas programadas y usar las skills de ICONE.
**Documentación verificada:** Claude API (Tool Runner, Agent Skills, servidor de búsqueda), Managed Agents (beta `managed-agents-2026-04-01`) y Claude Agent SDK, a fecha de hoy.

---

## 0. Punto de partida y lo común a los tres caminos

### Qué hace la app hoy

```
chat.js ──POST /──▶ Worker claude-proxy ──▶ Anthropic Messages API ──▶ texto
          (messages + system con TODO el curso, max_tokens 2048, sin tools)
```

- El chat mete el curso completo en el `system` y recibe texto. No puede registrar una nota, crear una sesión, generar un Excel ni mandar un correo.
- El Worker ya valida el JWT de Supabase, aplica el límite de plan por "llamadas" y expone `/fetch-url`. Eso se reutiliza en los tres caminos.
- La ingesta IA y el plan del semestre también son una sola llamada cada uno.

### Qué tiene una sesión de Claude Code que la app no tiene

La diferencia es el **arnés**, no el modelo: un bucle donde el modelo llama herramientas hasta terminar, con permisos, un sandbox y conectores autenticados.

| Capacidad de la sesión | Camino 1 (Worker) | Camino 2 (Managed Agents) | Camino 3 (Agent SDK) |
|---|---|---|---|
| Bucle de herramientas | ✅ Tool Runner | ✅ Anthropic lo corre | ✅ el SDK lo corre |
| Leer y escribir el curso (Supabase) | ✅ tools propias con JWT | ✅ custom tools con JWT | ✅ tools MCP en proceso con JWT |
| Búsqueda web | ✅ `web_search` servidor | ✅ toolset (apagada por defecto) | ✅ `WebSearch` |
| Generar Excel, PPTX, PDF, DOCX | ✅ Agent Skills + code execution | ✅ skills `xlsx`, `pptx`, `pdf`, `docx` | ✅ skills del repo + bash |
| Bash y archivos | ❌ | ✅ sandbox por sesión | ✅ contenedor tuyo |
| Git y GitHub | ❌ | ✅ repo montado + MCP GitHub | ✅ `Bash` + MCP GitHub |
| Skills de ICONE (cuentas de cobro, presentaciones, auditorías…) | ✅ subidas a la Skills API | ✅ `.claude/skills` del repo montado o Skills API | ✅ `.claude/skills` del workspace |
| Subagentes | ❌ (varias llamadas) | ✅ `multiagent` | ✅ `agents` |
| Rutinas programadas | Cron Trigger de Cloudflare | ✅ deployments con cron | cron del servidor |
| Gmail, Calendar, Drive del docente | ✅ tools con OAuth propio | ✅ vault `mcp_oauth` o custom tools | ✅ tools MCP con OAuth propio |
| Confirmación antes de actuar | ✅ en el `run()` de la tool | ✅ `permission_policy` + `tool_confirmation` | ✅ `canUseTool` |
| Quién opera la infraestructura | Cloudflare (ya está) | Anthropic | Tú |
| Estado | GA (runner en beta del SDK) | **Beta** | GA |

### Decisiones comunes

1. **Modelo:** `claude-opus-5-5` para el agente. Thinking siempre activo (no se envía `thinking`), `output_config.effort` explícito (`medium` para chat, `high` para ingesta y plan). Streaming siempre. `tool_choice` forzado devuelve 400 en este modelo: se guía desde el prompt.
2. **Fallback ante rechazo:** `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"`. Revisar `stop_reason === "refusal"` antes de leer `content`.
3. **Identidad y aislamiento:** toda acción sobre el curso corre con el **JWT del docente** contra PostgREST. RLS ya garantiza que solo ve sus cursos. La `SUPABASE_SERVICE_KEY` no se usa para acciones del usuario.
4. **Confirmar lo irreversible:** registrar notas, crear sesiones, enviar correos y crear eventos piden confirmación en la UI antes de ejecutarse. Consultas corren solas.
5. **Contexto bajo demanda:** se deja de inyectar el curso completo en el `system`. El agente consulta lo que necesita con tools. El `system` queda estable y cacheado con `cache_control`.
6. **Costos:** los planes pasan de "llamadas" a **presupuesto de tokens por mes** (el Worker ya lleva el conteo por usuario; cambia la unidad). Una tarea agéntica son muchas llamadas.
7. **Frontend:** `chat.js` pasa de "⏳ Pensando…" a un flujo de eventos: texto en streaming, tarjeta por cada herramienta ("Consultando asistencia…", "Registrando 3 notas…"), botón Confirmar/Cancelar cuando la tool lo pide, y enlaces a archivos generados.
8. **Google del docente:** Supabase Auth con proveedor Google y scopes `gmail.send`, `calendar.events`, `drive.file`. El `provider_refresh_token` se guarda del lado del servidor (tabla `v5_integrations`, RLS por `user_id`) y nunca llega al navegador.

### Catálogo de herramientas (igual en los tres caminos)

| Tool | Acción | Confirma |
|---|---|---|
| `consultar_curso` | resumen, estudiantes, grupos, actividades, asistencia, sustentaciones | no |
| `buscar_estudiante` | por nombre o cédula (fuzzy) | no |
| `registrar_nota` | una o varias notas en una actividad | **sí** |
| `crear_actividad` | tipo, escala, peso, fecha | **sí** |
| `registrar_asistencia` | sesión + lista P/T/A | **sí** |
| `crear_sesion_plan` | sesión del plan del semestre | **sí** |
| `fetch_url` | ya existe en el Worker | no |
| `web_search` | tool de servidor de Anthropic | no |
| `generar_archivo` | Excel, PPTX, PDF, DOCX vía skills | no |
| `enviar_correo` | Gmail del docente | **sí** |
| `crear_evento` | Calendar del docente | **sí** |

---

## Camino 1 — Tool use dentro del Worker que ya tienes

**Qué resuelve:** la IA deja de describir el curso y empieza a operarlo. Sin infraestructura nueva.
**Qué no resuelve:** bash, git, subagentes con estado, rutinas largas.
**Tiempo estimado:** 2 semanas.

```
chat.js ──SSE──▶ Worker (toolRunner, stream:true)
                   ├── tools Supabase  ── PostgREST con JWT del docente (RLS)
                   ├── web_search_20260209 (servidor Anthropic)
                   ├── fetch_url (ya existe)
                   ├── Google APIs con refresh_token del docente
                   └── Agent Skills + code_execution ──▶ Files API ──▶ Supabase Storage
```

### 1.1 El bucle en el Worker (TypeScript)

```ts
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export async function chatAgente(env, jwt: string, courseId: string, messages, send: (ev) => void) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const pg = supabaseFetch(env.SUPABASE_URL, env.SUPABASE_ANON, jwt); // PostgREST con el JWT del docente

  const consultarCurso = betaZodTool({
    name: "consultar_curso",
    description: "Lee datos del curso activo: estudiantes, grupos, actividades, notas, asistencia o sustentaciones.",
    inputSchema: z.object({
      seccion: z.enum(["resumen", "estudiantes", "grupos", "actividades", "notas", "asistencia", "sustentaciones"]),
      filtro: z.string().optional().describe("nombre, cédula o actividad para acotar"),
    }),
    run: async ({ seccion, filtro }) => JSON.stringify(await pg.leer(courseId, seccion, filtro)),
    eager_input_streaming: true,
  });

  const registrarNota = betaZodTool({
    name: "registrar_nota",
    description: "Registra notas en una actividad. Requiere confirmación del docente.",
    inputSchema: z.object({
      activity_id: z.string(),
      notas: z.array(z.object({ student_id: z.string(), value: z.number() })),
    }),
    run: async (input) => {
      const ok = await pedirConfirmacion(send, "registrar_nota", input); // bloquea hasta que el docente responde
      if (!ok) return "El docente canceló la acción.";
      await pg.upsert("v5_grades", input.notas.map(n => ({ ...n, activity_id: input.activity_id })));
      return `Registradas ${input.notas.length} notas.`;
    },
    eager_input_streaming: true,
  });

  const runner = client.beta.messages.toolRunner({
    model: "claude-opus-5-5",
    max_tokens: 64000,
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM_DOCADMIN, cache_control: { type: "ephemeral" } }],
    tools: [consultarCurso, registrarNota, /* ...resto del catálogo */,
            { type: "web_search_20260209", name: "web_search", max_uses: 3 }],
    messages,
    stream: true,
  });

  for await (const stream of runner) {
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") send({ texto: ev.delta.text });
      if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") send({ tool: ev.content_block.name });
    }
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "pause_turn") runner.pushMessages({ role: "assistant", content: msg.content });
    if (msg.stop_reason === "refusal") { send({ error: "La solicitud fue rechazada por seguridad." }); break; }
  }
  return runner.done();
}
```

Puntos que no se pueden omitir:

- El runner **no reanuda `pause_turn`** solo. Tras cada iteración se revisa y se vuelve a empujar el turno (está en el código).
- Con `eager_input_streaming` el servidor ya no valida el JSON de la tool. El runner con Zod valida antes de ejecutar; si el JSON no parsea, se reintenta una vez.
- Las tools de escritura **confirman dentro de `run()`**. La confirmación viaja por el mismo SSE: el Worker emite `{confirmar: {...}}`, el navegador responde a `POST /confirmar/:id`, y la promesa se resuelve.

### 1.2 Archivos (Excel, PPTX, PDF, DOCX) con Agent Skills

Los archivos se producen en el contenedor de Anthropic, no en el Worker:

```ts
const resp = await client.beta.messages.create({
  model: "claude-opus-5-5",
  max_tokens: 16000,
  betas: ["code-execution-2025-08-25"],
  container: { skills: [
    { type: "anthropic", skill_id: "xlsx", version: "latest" },
    { type: "custom", skill_id: env.SKILL_CUENTA_COBRO_ID, version: "latest" }, // skill de ICONE subida
  ]},
  tools: [{ type: "code_execution_20260521", name: "code_execution" }],
  messages: [{ role: "user", content: `Genera el consolidado de notas en Excel con estos datos: ${JSON.stringify(datos)}` }],
});
// Buscar los file_id en resp.content → client.beta.files.download(fileId) → subir a Supabase Storage → enlace en el chat
```

Las skills de ICONE se suben una vez con la Skills API (sin cabecera beta) y se referencian por `skill_id`:

```ts
import { toFile } from "@anthropic-ai/sdk";
const skill = await client.skills.create({
  files: [await toFile(fs.createReadStream("skills/cuenta-de-cobro/SKILL.md"), "cuenta-de-cobro/SKILL.md", { type: "text/markdown" })],
});
console.log(skill.id, skill.latest_version_id); // guardar como secret del Worker
```

### 1.3 Frontend: cambios en `js/chat.js`

1. Reemplazar el `fetch` único por `EventSource` o `fetch` con lectura de stream. Renderizar deltas de texto en vivo.
2. Tarjeta por tool: nombre legible, estado (corriendo/listo), y el resultado resumido.
3. Componente de confirmación: tabla con lo que se va a escribir, botones Confirmar / Cancelar, timeout de 2 minutos.
4. Historial: guardar `messages` completos (incluidos `tool_use` y `tool_result`) en `v5_chats` para retomar la conversación.
5. Quitar el aviso "cada mensaje consume 1 llamada". Mostrar consumo del mes en tokens.

### 1.4 Rutinas en el camino 1

Cloudflare **Cron Triggers** en el mismo Worker: cada lunes 7:00 corre el agente por cada curso activo con el prompt "informe semanal de asistencia y riesgo", guarda el resultado en `v5_reports` y notifica por correo. Sin confirmaciones: en rutinas solo se permiten tools de lectura y `generar_archivo`.

### 1.5 Límites del camino 1

- Un turno largo (varias tools + archivo) puede superar el tiempo de un Worker. Si pasa, mover el bucle a un **Durable Object** o saltar al camino 2.
- No hay bash ni git. Lo que requiera "tocar archivos del repo" se queda para los caminos 2 y 3.
- El conector MCP de la Messages API (`mcp_servers` + `mcp_toolset`, beta `mcp-client-2025-11-20`) existe, pero usa un solo token para todos. Para Supabase conviene tools propias con el JWT de cada docente, que es lo que mantiene RLS.

---

## Camino 2 — Managed Agents (Anthropic corre el bucle y el sandbox)

**Qué resuelve:** sandbox con bash y archivos por sesión, skills, MCP, rutinas programadas, presupuesto por sesión, trazas en la Console. Sin servidores propios.
**Qué pide:** aceptar que está en **beta**, y adaptar el Worker a un flujo de eventos (sesión con estado).
**Tiempo estimado:** 3 a 4 semanas, con el camino 1 ya hecho.

```
chat.js ──SSE──▶ Worker ──▶ POST /v1/sessions (agent + env + vault del docente)
                    ▲            │ stream de eventos
                    │            ├── agent.message ──────────▶ texto al chat
                    │            ├── agent.custom_tool_use ──▶ Worker ejecuta con JWT ──▶ user.custom_tool_result
                    │            ├── agent.tool_use (ask) ───▶ confirmación en UI ──▶ user.tool_confirmation
                    │            └── archivos en /mnt/session/outputs ──▶ files.list ──▶ Storage
                    └── deployments (cron) para rutinas
```

### 2.1 Configuración única (script de setup, nunca en el request)

```ts
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const env = await client.beta.environments.create({
  name: "docadmin-prod",
  config: { type: "cloud", networking: {
    type: "limited", allow_package_managers: true, allow_mcp_servers: true,
    allowed_hosts: ["nvgkhdrrxqdgxktfkioa.supabase.co", "www.googleapis.com", "gmail.googleapis.com"],
  }},
});

const agent = await client.beta.agents.create({
  name: "DocAdmin Agente",
  model: { id: "claude-opus-5-5", effort: "medium" },
  system: SYSTEM_DOCADMIN,
  tools: [
    { type: "agent_toolset_20260401",
      default_config: { enabled: true, permission_policy: { type: "auto" } },
      configs: [
        { name: "bash", permission_policy: { type: "always_ask" } },
        { name: "web_search", enabled: true, allowed_domains: ["*.edu.co", "*.gov.co"] },
        { name: "web_fetch", enabled: false },
      ]},
    // Las acciones sobre el curso son custom tools: las ejecuta el Worker con el JWT del docente.
    { type: "custom", name: "consultar_curso", description: "...", input_schema: SCHEMA_CONSULTAR },
    { type: "custom", name: "registrar_nota",  description: "...", input_schema: SCHEMA_NOTA },
    // ...resto del catálogo
  ],
  skills: [
    { type: "anthropic", skill_id: "xlsx" }, { type: "anthropic", skill_id: "pptx" },
    { type: "anthropic", skill_id: "pdf" },  { type: "anthropic", skill_id: "docx" },
    { type: "custom", skill_id: SKILL_CUENTA_COBRO_ID, version: "latest" },
  ],
});
// Guardar agent.id, agent.version y env.id como secrets del Worker (o con `ant apply` + claude-lock.json)
```

Las skills de ICONE también pueden llegar **desde el repo**: si la sesión monta `github_repository` con este repositorio, el agente lee `.claude/skills/<nombre>/SKILL.md` al arrancar. Basta mover las skills actuales a esa carpeta.

### 2.2 Por cada conversación (en el Worker)

```ts
const session = await client.beta.sessions.create({
  agent: { type: "agent", id: AGENT_ID, version: AGENT_VERSION },
  environment_id: ENV_ID,
  title: `Curso ${courseId} · ${docente.email}`,
  vault_ids: [vaultDelDocente],                 // credencial OAuth de Google del docente (ver 2.4)
  budget: { type: "limit", max_list_cost: { amount: "200", currency: "USD" } }, // US$2,00 por sesión
  metadata: { user_id: docente.id, course_id: courseId },
  initial_events: [{ type: "user.message", content: [{ type: "text", text: pregunta }] }],
});
await pg.insert("v5_chats", { user_id: docente.id, course_id: courseId, session_id: session.id });

const stream = await client.beta.sessions.events.stream(session.id);
for await (const ev of stream) {
  switch (ev.type) {
    case "agent.message":
      for (const b of ev.content) if (b.type === "text") send({ texto: b.text });
      break;
    case "agent.custom_tool_use": {                       // la sesión queda idle hasta que respondemos
      const out = await ejecutarTool(ev.name, ev.input, jwt, send); // confirma en UI si la tool lo exige
      await client.beta.sessions.events.send(session.id, { events: [
        { type: "user.custom_tool_result", custom_tool_use_id: ev.id, content: [{ type: "text", text: out }] }]});
      break;
    }
    case "agent.tool_use":
    case "agent.mcp_tool_use":
      if (ev.evaluated_permission === "ask") {            // bash u otra llamada que el servidor no resolvió
        const ok = await pedirConfirmacion(send, ev.name, ev.input);
        await client.beta.sessions.events.send(session.id, { events: [
          { type: "user.tool_confirmation", tool_use_id: ev.id, result: ok ? "allow" : "deny" }]});
      }
      break;
    case "session.status_idle":
      if (ev.stop_reason.type !== "requires_action") return await recogerArchivos(session.id);
      break;
    case "session.status_terminated":
      return;
  }
}
```

Para el siguiente mensaje del docente se reutiliza `session_id` con `events.send` de tipo `user.message`. Reglas que importan:

- **Abrir el stream antes de enviar** el mensaje, o los primeros eventos llegan en bloque.
- **Si el stream se cae** con una custom tool pendiente, la sesión queda bloqueada: al reconectar, listar `events.list`, deduplicar por id y resolver lo pendiente.
- `tool_use_id` y `custom_tool_use_id` reciben el **id del evento** (`sevt_…`), no un `toolu_…`.
- Si nadie está mirando (rutinas), responder `deny` a lo que pida confirmación; nunca `allow` automático.

### 2.3 Archivos de salida

```ts
async function recogerArchivos(sessionId) {
  const files = await client.beta.files.list({ scope_id: sessionId, betas: ["managed-agents-2026-04-01"] });
  for (const f of files.data) {
    const bin = await client.beta.files.download(f.id);
    await storage.subir(`reportes/${sessionId}/${f.filename}`, await bin.arrayBuffer()); // Supabase Storage
    send({ archivo: { nombre: f.filename, url: storage.urlFirmada(...) } });
  }
}
```

Hay 1 a 3 segundos de retraso entre `status_idle` y que aparezcan los archivos; reintentar una vez si la lista viene vacía.

### 2.4 Credenciales por docente (vaults)

- **Un vault por docente** (`client.beta.vaults.create`). Dentro, una credencial `mcp_oauth` para el servidor MCP de Google con `access_token`, `refresh_token`, `client_id` y `token_endpoint` de Google. Anthropic refresca el token solo. El agente declara el servidor en `mcp_servers` sin auth; el vault se adjunta en `vault_ids` al crear la sesión.
- Si no se quiere depender de un servidor MCP de Google, las acciones de Gmail y Calendar se mantienen como **custom tools** ejecutadas por el Worker con el `refresh_token` guardado en `v5_integrations`. Es lo mismo que en el camino 1 y la credencial nunca entra al sandbox.
- Supabase **no** va en el vault: el JWT del docente expira cada hora. Las tools de curso son custom tools (el Worker tiene el JWT).

### 2.5 Rutinas con deployments

```ts
const dep = await client.beta.deployments.create({
  name: "Informe semanal de asistencia",
  agent: AGENT_ID,
  environment_id: ENV_ID,
  initial_events: [{ type: "user.message", content: [{ type: "text",
    text: "Genera el informe semanal de asistencia y riesgo de cada curso activo del docente y guárdalo en /mnt/session/outputs." }]}],
  schedule: { type: "cron", expression: "0 7 * * 1", timezone: "America/Bogota" },
  budget: { type: "limit", max_list_cost: { amount: "300", currency: "USD" } },
});
```

Un deployment por docente que active rutinas (el curso se resuelve con una custom tool). El Worker recibe el **webhook** `session.status_idled`, recoge los archivos, los guarda en Storage y envía el correo. Probar con `deployments.run(id)` antes de dejar el cron.

### 2.6 Lo que hay que aceptar

- Es **beta**: la API puede cambiar; hay que fijar `agent.version` y leer el changelog.
- Cada sesión tiene traza en la Console (`https://platform.claude.com/workspaces/{workspace}/sessions/{id}`), útil para soporte y auditoría.
- El presupuesto por sesión es un **tope duro**: al llegar, la sesión queda `idle` con `budget_reached` y se puede ampliar o cerrar desde la app.

---

## Camino 3 — Claude Agent SDK en tu propio servidor

**Qué resuelve:** literalmente Claude Code como librería: Read, Write, Edit, Bash, Glob, Grep, WebSearch, MCP, subagentes, hooks, sesiones reanudables y las skills del `.claude/` del workspace. Máximo control.
**Qué pide:** operar un contenedor por docente (Node 18+), aislamiento, disco, secretos, actualizaciones.
**Tiempo estimado:** 4 a 6 semanas.

```
chat.js ──WebSocket/SSE──▶ Worker ──▶ servidor Node (Fly.io / Railway / Cloud Run)
                                        └── contenedor por docente
                                            ├── query() del Agent SDK
                                            ├── workspace /work/<user_id>/  (.claude/skills de ICONE, archivos del curso)
                                            ├── MCP en proceso: tools Supabase con JWT
                                            └── canUseTool ──▶ confirmación en UI
```

### 3.1 El agente

```ts
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export async function* agenteDocente({ userId, jwt, courseId, prompt, sessionId }) {
  const pg = supabaseFetch(SUPABASE_URL, SUPABASE_ANON, jwt);

  const docadmin = createSdkMcpServer({
    name: "docadmin",
    version: "1.0.0",
    tools: [
      tool("consultar_curso", "Lee datos del curso activo", { seccion: z.string(), filtro: z.string().optional() },
        async ({ seccion, filtro }) => ({ content: [{ type: "text", text: JSON.stringify(await pg.leer(courseId, seccion, filtro)) }] }),
        { annotations: { readOnlyHint: true } }),
      tool("registrar_nota", "Registra notas (requiere confirmación)", { activity_id: z.string(), notas: z.array(z.object({ student_id: z.string(), value: z.number() })) },
        async (input) => { await pg.upsert("v5_grades", ...); return { content: [{ type: "text", text: "Notas registradas." }] }; }),
      // ...resto del catálogo, incluidos enviar_correo y crear_evento con el refresh_token del docente
    ],
  });

  for await (const msg of query({
    prompt,
    options: {
      model: "claude-opus-5-5",
      cwd: `/work/${userId}`,                       // workspace aislado del docente, con .claude/skills de ICONE
      settingSources: ["project"],                  // carga skills y CLAUDE.md del workspace
      mcpServers: { docadmin },
      allowedTools: ["Read", "Glob", "Grep", "WebSearch", "mcp__docadmin__consultar_curso"],
      disallowedTools: ["Bash(rm *)", "Bash(git push *)"],
      permissionMode: "default",                    // lo no permitido pasa por canUseTool
      canUseTool: pedirConfirmacionUI,              // firma exacta en la doc "Handle approvals and user input"
      maxTurns: 40,
      resume: sessionId,                            // retoma la conversación anterior del docente
      systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_DOCADMIN },
    },
  })) yield msg;                                    // el servidor lo reenvía por WebSocket al navegador
}
```

Notas de la doc que cambian decisiones:

- `allowedTools` **no restringe**: solo auto-aprueba. Lo que no está listado cae en `canUseTool`. Para quitar una tool del todo se usa `disallowedTools` con el nombre pelado.
- Nunca `bypassPermissions` en producción multiusuario. `acceptEdits` solo dentro del workspace del docente.
- El SDK trae el binario de Claude Code como dependencia opcional de npm: en el Dockerfile **no** usar `npm ci --omit=optional`.
- La autenticación es por **API key de Anthropic** (`ANTHROPIC_API_KEY`), nunca login de claude.ai de los docentes.
- La marca: el producto se llama DocAdmin "Powered by Claude"; no puede presentarse como Claude Code.

### 3.2 Servidor y aislamiento

1. Imagen Docker con Node 20, el SDK y las skills de ICONE copiadas a `/work/_plantilla/.claude/skills/`.
2. Al primer uso de un docente se crea `/work/<user_id>/` desde la plantilla. Un proceso por petición, `cwd` fijo, sin acceso a otros workspaces (usuario del sistema sin privilegios, cuotas de disco).
3. Endpoint `POST /agente` que valida el JWT de Supabase y abre WebSocket; el Worker solo hace de proxy autenticado.
4. Sesiones: `listSessions({ dir })` y `resume` para retomar; una tabla `v5_chats` guarda `sessionId` por conversación.
5. Hooks `PreToolUse` para auditoría: cada tool con su input va a `v5_ai_uploads` (ya existe para trazabilidad).
6. Rutinas: cron del propio servidor o Cron Trigger de Cloudflare que llama a `POST /agente` con `permissionMode: "dontAsk"` y solo tools de lectura.

### 3.3 Lo que hay que aceptar

- Pagas servidor **y** tokens. Un contenedor con 2 GB de RAM soporta varios docentes a la vez, pero hay que medir.
- Tú respondes por el aislamiento entre docentes, el parcheo del sistema y las versiones del SDK.
- Es el único camino donde el agente edita archivos reales y corre git contra tus repos con control total.

---

## Comparación rápida

| Criterio | Camino 1 · Worker | Camino 2 · Managed Agents | Camino 3 · Agent SDK |
|---|---|---|---|
| Esfuerzo inicial | Bajo (2 sem) | Medio (3-4 sem) | Alto (4-6 sem) |
| Infra propia | Ninguna nueva | Ninguna | Servidor + contenedores |
| Bash, archivos, git | No | Sí (sandbox Anthropic) | Sí (tu contenedor) |
| Rutinas | Cron Trigger | Deployments nativos | Cron propio |
| Confirmaciones | En `run()` | `permission_policy` + eventos | `canUseTool` |
| Tope de gasto | Tokens que cuentas tú | `budget` por sesión (duro) | Lo que midas tú |
| Trazabilidad | Logs del Worker | Console de Anthropic | Hooks + tus logs |
| Riesgo de cambio de API | Bajo | Medio (beta) | Bajo |
| Control total | Medio | Medio | Alto |

---

## Orden recomendado

1. **Semanas 1-2 · Camino 1.** Catálogo de tools sobre Supabase, Tool Runner con streaming, confirmaciones en `chat.js`, skills `xlsx` y `pptx`, cuenta de cobro de ICONE subida a la Skills API, planes por tokens. Esto ya cambia el producto.
2. **Semanas 3-6 · Camino 2 sobre lo anterior.** El mismo catálogo pasa a custom tools del agente; se agregan sandbox, skills del repo, vault de Google por docente y deployments para rutinas. El Worker queda como orquestador de eventos.
3. **Camino 3 solo si aparece la necesidad**: editar repos de docentes, correr código de estudiantes, o salir de la beta de Managed Agents. El catálogo de tools se reutiliza tal cual como servidor MCP en proceso.

Lo que se construye en el camino 1 (tools, confirmaciones, SSE en el chat, planes por tokens, integración Google) **se reutiliza íntegro** en los otros dos. No hay trabajo perdido.

---

## Cambios en el modelo de negocio

| Plan actual | Unidad actual | Propuesta |
|---|---|---|
| Trial | 50 llamadas | 300 000 tokens / mes |
| Starter | 200 llamadas | 2 M tokens / mes |
| Pro | 1 000 llamadas | 10 M tokens / mes + rutinas |
| Premium | 9 999 llamadas | 50 M tokens / mes + rutinas + Google |

Referencia de precio público de Opus 5.5: US$4 por millón de tokens de entrada y US$20 por millón de salida; lecturas de caché a US$0,20. El Worker ya registra uso por usuario; solo cambia la unidad y se suma `usage` de cada respuesta.

---

## Riesgos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| El agente escribe algo que el docente no quería | Toda escritura confirma en UI; en rutinas solo lectura |
| Fuga de datos entre docentes | JWT propio por acción, RLS ya probado, workspace por docente en el camino 3 |
| Costo fuera de control | Tope de tokens por plan (1), `budget` por sesión (2), `maxTurns` (3) |
| Managed Agents cambia en beta | Fijar `agent.version`; el camino 1 sigue funcionando como respaldo |
| Prompt injection desde Excel/PDF subidos | Las tools de escritura confirman; `web_fetch` apagado; dominios de búsqueda acotados |
| Tiempo de ejecución del Worker | Streaming; Durable Object si hace falta; o camino 2 |
