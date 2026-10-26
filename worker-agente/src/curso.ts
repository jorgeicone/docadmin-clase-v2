// Datos del curso para un turno del agente. Se cargan perezosamente y se
// guardan en memoria durante el turno, así varias herramientas no repiten
// consultas. Todo pasa por Pg, que usa el JWT del docente (RLS).
import { Pg, lista } from "./supabase";

export interface Estudiante { id: string; cedula: string; name: string; email: string | null }
export interface Grupo { id: string; name: string; leader_student_id: string | null; notes: string | null }
export interface Actividad {
  id: string; name: string; type: string; weight: number | null; max_points: number | null;
  date: string | null; topic: string | null; description: string | null; rubric: unknown;
}
export interface Nota {
  id: string; activity_id: string; student_id: string; group_id: string | null; value: number | null;
  status: string | null; observation: string | null; desglose: string | null;
}
export interface SesionPlan { id: string; number: number | null; date: string | null; topic: string | null; type: string | null; notes: string | null; duration_hours: number | null }

export class Curso {
  private cache = new Map<string, Promise<unknown>>();
  constructor(private pg: Pg, public readonly id: string) {}

  private memo<T>(clave: string, f: () => Promise<T>): Promise<T> {
    if (!this.cache.has(clave)) this.cache.set(clave, f());
    return this.cache.get(clave) as Promise<T>;
  }
  /** Borra la caché tras una escritura confirmada en el navegador. */
  invalidar() { this.cache.clear(); }

  info() {
    return this.memo("info", async () => {
      const [c] = await this.pg.select<Record<string, unknown>>("v5_courses",
        `id=eq.${this.id}&select=id,name,code,credits,start_date,end_date,sessions_per_week,hours_per_session`);
      return c ?? null;
    });
  }
  estudiantes() {
    return this.memo("est", () => this.pg.select<Estudiante>("v5_students",
      `course_id=eq.${this.id}&select=id,cedula,name,email&order=name`));
  }
  grupos() {
    return this.memo("grp", () => this.pg.select<Grupo>("v5_groups",
      `course_id=eq.${this.id}&select=id,name,leader_student_id,notes&order=name`));
  }
  miembros() {
    return this.memo("mem", async () => {
      const g = await this.grupos();
      if (!g.length) return [] as { group_id: string; student_id: string }[];
      return this.pg.select<{ group_id: string; student_id: string }>("v5_group_members",
        `group_id=in.${lista(g.map((x) => x.id))}&select=group_id,student_id`);
    });
  }
  actividades() {
    return this.memo("act", () => this.pg.select<Actividad>("v5_activities",
      `course_id=eq.${this.id}&select=id,name,type,weight,max_points,date,topic,description,rubric&order=date.asc.nullslast`));
  }
  notas() {
    return this.memo("notas", async () => {
      const a = await this.actividades();
      if (!a.length) return [] as Nota[];
      return this.pg.select<Nota>("v5_grades",
        `activity_id=in.${lista(a.map((x) => x.id))}&select=id,activity_id,student_id,group_id,value,status,observation,desglose`);
    });
  }
  sesionesPlan() {
    return this.memo("plan", () => this.pg.select<SesionPlan>("v5_sessions",
      `course_id=eq.${this.id}&select=id,number,date,topic,type,notes,duration_hours&order=number.asc.nullslast`));
  }
}

/** Minúsculas y sin tildes, para buscar nombres como los escribe un docente. */
export const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Busca estudiantes por cédula o por palabras del nombre, en cualquier orden. */
export function buscar(estudiantes: Estudiante[], texto: string): Estudiante[] {
  const q = normalizar(texto);
  if (!q) return [];
  const digitos = q.replace(/[\s.\-]/g, "");
  if (/^\d+$/.test(digitos)) {
    const exacta = estudiantes.filter((e) => e.cedula === digitos);
    return exacta.length ? exacta : estudiantes.filter((e) => e.cedula.includes(digitos));
  }
  const palabras = q.split(/\s+/).filter(Boolean);
  return estudiantes.filter((e) => {
    const n = normalizar(e.name);
    return palabras.every((p) => n.includes(p));
  });
}
