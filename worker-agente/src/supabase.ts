// Acceso a Supabase con el JWT del docente: PostgREST aplica RLS, así que el
// agente solo ve y valida datos de los cursos de quien hace la petición.
import type { Env } from "./env";

export interface Usuario { id: string; email?: string }

export class ErrorHttp extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function usuarioDesdeJwt(env: Env, jwt: string): Promise<Usuario> {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON, Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) throw new ErrorHttp(401, "Sesión inválida o expirada");
  const u = (await r.json()) as { id?: string; email?: string };
  if (!u.id) throw new ErrorHttp(401, "Sesión inválida o expirada");
  return { id: u.id, email: u.email };
}

/** Cliente PostgREST mínimo que siempre envía el JWT del docente. */
export class Pg {
  constructor(private env: Env, private jwt: string) {}

  async select<T = Record<string, unknown>>(tabla: string, query: string): Promise<T[]> {
    const r = await fetch(`${this.env.SUPABASE_URL}/rest/v1/${tabla}?${query}`, {
      headers: { apikey: this.env.SUPABASE_ANON, Authorization: `Bearer ${this.jwt}` },
    });
    if (!r.ok) throw new Error(`Supabase ${tabla}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return (await r.json()) as T[];
  }
}

/** Valor seguro para un filtro `in.(...)` de PostgREST. */
export const lista = (ids: string[]) => `(${ids.map((i) => `"${i.replace(/"/g, "")}"`).join(",")})`;

/** Llamadas restantes del plan, según el Worker existente (fuente de verdad del plan). */
export async function llamadasRestantes(env: Env, jwt: string): Promise<number> {
  const r = await fetch(`${env.LEGACY_WORKER_URL}/plan`, { headers: { Authorization: `Bearer ${jwt}` } });
  if (!r.ok) throw new ErrorHttp(502, "No se pudo consultar el plan");
  const p = (await r.json()) as { calls_remaining?: number };
  return typeof p.calls_remaining === "number" ? p.calls_remaining : 0;
}

/** Descuenta una llamada IA del plan con la misma función que usa el Worker existente. */
export async function descontarLlamada(env: Env, userId: string): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/increment_ai_calls`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: userId }),
  });
}
