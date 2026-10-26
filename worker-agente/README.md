# docadmin-agente — Worker del agente (camino 1)

Worker de Cloudflare que convierte el **AI Chat** de ICONE.DocAdmin en un agente con herramientas. Es un servicio **nuevo y separado** de `claude-proxy`: el Worker actual sigue igual y la ingesta IA, el plan del semestre y los pagos no cambian.

## Qué hace

| Herramienta | Qué hace | ¿Escribe? |
|---|---|---|
| `consultar_curso` | Resumen, estudiantes, grupos, actividades, notas, asistencia, plan, sustentaciones | No |
| `buscar_estudiante` | Por cédula o nombre, sin importar tildes ni orden | No |
| `proponer_notas` | Valida escala, actividad y estudiantes; propone notas | **Propone** |
| `proponer_actividad` | Propone una actividad individual o grupal | **Propone** |
| `proponer_asistencia` | Propone P/T/A de una fecha (reemplaza si ya existe) | **Propone** |
| `proponer_sesion_plan` | Propone una sesión del plan del semestre | **Propone** |
| `generar_archivo` | Excel, PowerPoint, Word o PDF con Agent Skills | No (da un enlace) |
| `web_search`, `web_fetch` | Búsqueda y lectura web de Anthropic | No |

**El modelo nunca escribe en la base.** Las herramientas `proponer_*` devuelven una propuesta. El navegador la muestra como tarjeta; solo si el docente pulsa **Confirmar**, `js/chat-agente.js` la guarda con la sesión de Supabase del docente, igual que las demás vistas. Todas las lecturas del Worker van con el JWT del docente, así que RLS limita el acceso a sus cursos.

Cada petición al modelo descuenta **una llamada IA** del plan con la misma función `increment_ai_calls` que usa `claude-proxy`. Antes de empezar se consulta `GET /plan` del Worker existente; si no quedan llamadas, no se llama al modelo.

## Rutas

| Ruta | Uso |
|---|---|
| `POST /agente` | Cuerpo `{ course_id, messages: [{ role, content }] }`, cabecera `Authorization: Bearer <JWT Supabase>`. Responde en Server-Sent Events. |
| `GET /archivo?id&n&exp&sig` | Descarga un archivo generado. Enlace firmado con HMAC, vence en 24 horas. |
| `GET /salud` | Devuelve `ok`. |

Eventos SSE (`data: {json}`): `texto`, `herramienta`, `propuesta`, `archivo`, `uso`, `error`, `fin`.

## Desplegar

Requisitos: Node 20+, una cuenta de Cloudflare y una API key de Anthropic.

```bash
cd worker-agente
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put SUPABASE_SERVICE_KEY     # la misma que usa claude-proxy
npx wrangler secret put FILE_SIGNING_SECRET      # p. ej. la salida de: openssl rand -hex 32
npm run deploy
```

Wrangler imprime la URL, por ejemplo `https://docadmin-agente.<cuenta>.workers.dev`. Pruébala:

```bash
curl https://docadmin-agente.<cuenta>.workers.dev/salud
```

Luego actívalo en la app: pega esa URL en `AGENT_URL` dentro de `js/config.js`, sube el cambio y GitHub Pages lo publica. Con `AGENT_URL` vacío el chat sigue funcionando como antes.

## Configuración (`wrangler.toml`)

| Variable | Valor por defecto | Para qué |
|---|---|---|
| `MODEL` | `claude-opus-5-5` | Modelo del agente |
| `EFFORT` | `medium` | Profundidad de razonamiento: `low`, `medium`, `high` |
| `MAX_ITERATIONS` | `10` | Tope de pasos (peticiones al modelo) por mensaje |
| `ALLOWED_ORIGINS` | GitHub Pages y `localhost:8765` | Orígenes con permiso de CORS |
| `CUSTOM_SKILL_IDS` | vacío | Skills propias para `generar_archivo`, separadas por coma |

Para subir una skill propia (una carpeta con `SKILL.md`):

```bash
ANTHROPIC_API_KEY=... npm run subir-skill -- ruta/a/mi-skill
```

Copia el id que imprime en `CUSTOM_SKILL_IDS` y vuelve a desplegar.

## Desarrollo

```bash
npm run typecheck   # TypeScript del Worker y de los scripts
npm test            # pruebas con la API de Anthropic y Supabase simuladas
npm run dev         # Worker local en http://localhost:8787 (crea .dev.vars con los secrets)
```

Las pruebas simulan el streaming de la Messages API y PostgREST. Comprueban la búsqueda de estudiantes, la validación de notas y asistencia, que el Worker no hace ninguna escritura, el descuento de llamadas, la firma de enlaces y el corte cuando el plan no tiene llamadas.

## Pendiente para completar el camino 1

- Gmail y Calendar del docente (requiere activar Google en Supabase Auth con los permisos `gmail.send` y `calendar.events`).
- Pasar los planes de "llamadas" a presupuesto de tokens. El evento `uso` ya informa los tokens de cada mensaje.
- Rutinas semanales con Cron Triggers.
- Guardar el historial del chat en una tabla `v5_chats` (hoy vive en memoria, como el chat anterior).
