// Herramientas del agente. Dos clases:
//  - Lectura: consultan el curso con el JWT del docente y corren solas.
//  - Propuesta: validan contra la base y devuelven una propuesta. NO escriben.
//    El navegador muestra la propuesta y, solo si el docente pulsa Confirmar,
//    la ejecuta con su propia sesión de Supabase (RLS). El modelo nunca escribe.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { Curso, buscar, normalizar } from "./curso";

export type Evento =
  | { tipo: "texto"; texto: string }
  | { tipo: "herramienta"; nombre: string; estado: "inicio" | "fin"; resumen?: string }
  | { tipo: "propuesta"; propuesta: Propuesta }
  | { tipo: "archivo"; nombre: string; url: string }
  | { tipo: "uso"; entrada: number; salida: number; llamadas: number }
  | { tipo: "error"; mensaje: string }
  | { tipo: "fin" };

export type Propuesta =
  | { id: string; tipo: "notas"; resumen: string; actividad: { id: string; name: string; max_points: number | null };
      filas: { student_id: string; group_id: string | null; nombre: string; valor: number; observacion: string | null; anterior: number | null }[] }
  | { id: string; tipo: "actividad"; resumen: string;
      datos: { name: string; type: "individual" | "group"; max_points: number; weight: number | null; date: string | null; topic: string | null; description: string | null } }
  | { id: string; tipo: "asistencia"; resumen: string; existente_id: string | null; fecha: string; tema: string | null;
      filas: { student_id: string; nombre: string; estado: "P" | "T" | "A"; observacion: string | null }[] }
  | { id: string; tipo: "sesion_plan"; resumen: string;
      datos: { number: number | null; date: string; topic: string; type: string; notes: string | null; duration_hours: number | null } };

export interface Contexto {
  curso: Curso;
  emitir: (e: Evento) => void;
}

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato AAAA-MM-DD");
const json = (x: unknown) => JSON.stringify(x);
const uid = () => crypto.randomUUID();

export function herramientasCurso(ctx: Contexto) {
  const { curso, emitir } = ctx;

  const consultarCurso = betaZodTool({
    name: "consultar_curso",
    description:
      "Lee datos del curso activo. Secciones: resumen (curso y conteos), estudiantes, grupos (con integrantes), " +
      "actividades (con cuántos estudiantes tienen nota y promedio), notas (de una actividad: usa actividad_id), " +
      "asistencia (sesiones con P/T/A), plan (sesiones del plan del semestre), sustentaciones (rúbrica y resultados por grupo).",
    inputSchema: z.object({
      seccion: z.enum(["resumen", "estudiantes", "grupos", "actividades", "notas", "asistencia", "plan", "sustentaciones"]),
      actividad_id: z.string().optional().describe("Obligatorio para la sección notas"),
    }),
    run: async ({ seccion, actividad_id }) => {
      switch (seccion) {
        case "resumen": {
          const [info, est, grp, act, plan] = await Promise.all([curso.info(), curso.estudiantes(), curso.grupos(), curso.actividades(), curso.sesionesPlan()]);
          if (!info) return "No encontré el curso o no pertenece a este docente.";
          const porTipo: Record<string, number> = {};
          act.forEach((a) => (porTipo[a.type] = (porTipo[a.type] ?? 0) + 1));
          return json({ curso: info, estudiantes: est.length, grupos: grp.length, actividades_por_tipo: porTipo, sesiones_plan: plan.length });
        }
        case "estudiantes": {
          const est = await curso.estudiantes();
          return json(est.map((e) => ({ id: e.id, cedula: e.cedula, nombre: e.name, email: e.email })));
        }
        case "grupos": {
          const [grp, mem, est] = await Promise.all([curso.grupos(), curso.miembros(), curso.estudiantes()]);
          const nombre = (id: string | null) => est.find((e) => e.id === id)?.name ?? null;
          return json(grp.map((g) => ({
            id: g.id, nombre: g.name, lider: nombre(g.leader_student_id), notas: g.notes,
            integrantes: mem.filter((m) => m.group_id === g.id).map((m) => ({ id: m.student_id, nombre: nombre(m.student_id) })),
          })));
        }
        case "actividades": {
          const [act, notas, est] = await Promise.all([curso.actividades(), curso.notas(), curso.estudiantes()]);
          return json(act.map((a) => {
            const n = notas.filter((x) => x.activity_id === a.id && x.value != null);
            const prom = n.length ? +(n.reduce((s, x) => s + (x.value ?? 0), 0) / n.length).toFixed(2) : null;
            return { id: a.id, nombre: a.name, tipo: a.type, fecha: a.date, tema: a.topic, escala_max: a.max_points, peso: a.weight,
              calificados: `${n.length}/${est.length}`, promedio: prom };
          }));
        }
        case "notas": {
          if (!actividad_id) return "Falta actividad_id. Consulta primero la sección actividades.";
          const [act, notas, est] = await Promise.all([curso.actividades(), curso.notas(), curso.estudiantes()]);
          const a = act.find((x) => x.id === actividad_id);
          if (!a) return "Esa actividad no existe en este curso.";
          const n = notas.filter((x) => x.activity_id === a.id);
          return json({
            actividad: { id: a.id, nombre: a.name, tipo: a.type, escala_max: a.max_points },
            notas: est.map((e) => {
              const g = n.find((x) => x.student_id === e.id);
              return { estudiante_id: e.id, nombre: e.name, valor: g?.value ?? null, estado: g?.status ?? null, observacion: g?.observation ?? null };
            }),
          });
        }
        case "asistencia": {
          const [act, notas, est] = await Promise.all([curso.actividades(), curso.notas(), curso.estudiantes()]);
          const sesiones = act.filter((a) => a.type === "attendance");
          const porEst = est.map((e) => {
            const r = notas.filter((x) => x.student_id === e.id && sesiones.some((s) => s.id === x.activity_id));
            const c = (st: string) => r.filter((x) => x.status === st).length;
            return { id: e.id, nombre: e.name, P: c("P"), T: c("T"), A: c("A"), pct: sesiones.length ? Math.round(((c("P") + c("T") * 0.5) / sesiones.length) * 100) : null };
          });
          return json({
            sesiones: sesiones.map((s) => {
              const r = notas.filter((x) => x.activity_id === s.id);
              return { id: s.id, fecha: s.date, tema: s.topic, P: r.filter((x) => x.status === "P").length, T: r.filter((x) => x.status === "T").length, A: r.filter((x) => x.status === "A").length };
            }),
            por_estudiante: porEst,
          });
        }
        case "plan": {
          const plan = await curso.sesionesPlan();
          return json(plan.map((s) => ({ numero: s.number, fecha: s.date, tema: s.topic, tipo: s.type, notas: s.notes, horas: s.duration_hours })));
        }
        case "sustentaciones": {
          const [act, notas, grp] = await Promise.all([curso.actividades(), curso.notas(), curso.grupos()]);
          return json(act.filter((a) => a.type === "sustentacion").map((a) => {
            const n = notas.filter((x) => x.activity_id === a.id);
            return {
              id: a.id, nombre: a.name, fecha: a.date, escala_max: a.max_points, rubrica: a.rubric,
              por_grupo: grp.map((g) => {
                const ng = n.filter((x) => x.group_id === g.id);
                return { grupo: g.name, valor: ng[0]?.value ?? null, desglose: ng[0]?.desglose ?? null };
              }).filter((x) => x.valor != null),
              sin_sustentar: grp.filter((g) => !n.some((x) => x.group_id === g.id)).map((g) => g.name),
            };
          }));
        }
      }
    },
  });

  const buscarEstudiante = betaZodTool({
    name: "buscar_estudiante",
    description: "Busca estudiantes del curso por cédula o por palabras del nombre (sin importar tildes ni orden). Devuelve id, cédula, nombre y grupo.",
    inputSchema: z.object({ texto: z.string().min(1) }),
    run: async ({ texto }) => {
      const [est, mem, grp] = await Promise.all([curso.estudiantes(), curso.miembros(), curso.grupos()]);
      const r = buscar(est, texto).slice(0, 15);
      if (!r.length) return `Ningún estudiante coincide con "${texto}".`;
      return json(r.map((e) => {
        const gid = mem.find((m) => m.student_id === e.id)?.group_id;
        return { id: e.id, cedula: e.cedula, nombre: e.name, grupo: grp.find((g) => g.id === gid)?.name ?? null };
      }));
    },
  });

  const proponerNotas = betaZodTool({
    name: "proponer_notas",
    description:
      "Propone registrar o corregir notas en una actividad individual o grupal. No escribe: el docente confirma en pantalla. " +
      "Usa ids reales obtenidos con consultar_curso o buscar_estudiante. Para asistencia usa proponer_asistencia; las sustentaciones se califican en su vista.",
    inputSchema: z.object({
      actividad_id: z.string(),
      notas: z.array(z.object({
        estudiante_id: z.string(),
        valor: z.number(),
        observacion: z.string().optional(),
      })).min(1).max(200),
    }),
    run: async ({ actividad_id, notas }) => {
      const [act, est, mem, previas] = await Promise.all([curso.actividades(), curso.estudiantes(), curso.miembros(), curso.notas()]);
      const a = act.find((x) => x.id === actividad_id);
      if (!a) return "Esa actividad no existe en este curso. Consulta la sección actividades.";
      if (a.type === "attendance") return "Esa actividad es de asistencia. Usa proponer_asistencia.";
      if (a.type === "sustentacion") return "Las sustentaciones se califican por criterios en la vista Sustentación. Indícale al docente que lo haga allí.";
      const max = a.max_points ?? 5;
      const errores: string[] = [];
      const filas: Extract<Propuesta, { tipo: "notas" }>["filas"] = [];
      for (const n of notas) {
        const e = est.find((x) => x.id === n.estudiante_id);
        if (!e) { errores.push(`estudiante ${n.estudiante_id} no pertenece al curso`); continue; }
        if (n.valor < 0 || n.valor > max) { errores.push(`${e.name}: ${n.valor} está fuera de la escala 0-${max}`); continue; }
        const prev = previas.find((x) => x.activity_id === a.id && x.student_id === e.id);
        filas.push({ student_id: e.id, group_id: mem.find((m) => m.student_id === e.id)?.group_id ?? null, nombre: e.name,
          valor: n.valor, observacion: n.observacion ?? null, anterior: prev?.value ?? null });
      }
      if (errores.length) return `No propuse nada. Corrige esto: ${errores.join("; ")}`;
      const p: Propuesta = { id: uid(), tipo: "notas", resumen: `${filas.length} nota(s) en "${a.name}" (escala 0-${max})`,
        actividad: { id: a.id, name: a.name, max_points: a.max_points }, filas };
      emitir({ tipo: "propuesta", propuesta: p });
      return `Propuesta ${p.id} enviada al docente para confirmar: ${p.resumen}. Aún no está guardada; dile que la revise y pulse Confirmar.`;
    },
  });

  const proponerActividad = betaZodTool({
    name: "proponer_actividad",
    description: "Propone crear una actividad calificable individual o grupal. No escribe: el docente confirma en pantalla.",
    inputSchema: z.object({
      nombre: z.string().min(2).max(200),
      tipo: z.enum(["individual", "group"]),
      escala_max: z.number().positive().max(1000).describe("Nota máxima, normalmente 5"),
      peso: z.number().min(0).max(100).optional().describe("Porcentaje de la nota final"),
      fecha: fecha.optional(),
      tema: z.string().optional(),
      descripcion: z.string().optional(),
    }),
    run: async (i) => {
      const act = await curso.actividades();
      const dup = act.find((a) => normalizar(a.name) === normalizar(i.nombre));
      if (dup) return `Ya existe una actividad llamada "${dup.name}" (id ${dup.id}). Pregunta al docente si quiere otra con ese nombre.`;
      const p: Propuesta = { id: uid(), tipo: "actividad", resumen: `Crear actividad "${i.nombre}" (${i.tipo === "group" ? "grupal" : "individual"}, 0-${i.escala_max})`,
        datos: { name: i.nombre, type: i.tipo, max_points: i.escala_max, weight: i.peso ?? null, date: i.fecha ?? null, topic: i.tema ?? null, description: i.descripcion ?? null } };
      emitir({ tipo: "propuesta", propuesta: p });
      return `Propuesta ${p.id} enviada al docente para confirmar: ${p.resumen}.`;
    },
  });

  const proponerAsistencia = betaZodTool({
    name: "proponer_asistencia",
    description:
      "Propone registrar la asistencia de una fecha: P presente, T tarde, A ausente. Si ya hay asistencia ese día, la propuesta la reemplaza. No escribe: el docente confirma.",
    inputSchema: z.object({
      fecha,
      tema: z.string().optional(),
      registros: z.array(z.object({ estudiante_id: z.string(), estado: z.enum(["P", "T", "A"]), observacion: z.string().optional() })).min(1).max(300),
    }),
    run: async ({ fecha: f, tema, registros }) => {
      const [act, est] = await Promise.all([curso.actividades(), curso.estudiantes()]);
      const filas: Extract<Propuesta, { tipo: "asistencia" }>["filas"] = [];
      const malos: string[] = [];
      for (const r of registros) {
        const e = est.find((x) => x.id === r.estudiante_id);
        if (!e) malos.push(r.estudiante_id); else filas.push({ student_id: e.id, nombre: e.name, estado: r.estado, observacion: r.observacion ?? null });
      }
      if (malos.length) return `No propuse nada: ${malos.length} id(s) no pertenecen al curso (${malos.slice(0, 5).join(", ")}).`;
      const existente = act.find((a) => a.type === "attendance" && a.date === f) ?? null;
      const c = (s: string) => filas.filter((x) => x.estado === s).length;
      const p: Propuesta = { id: uid(), tipo: "asistencia", existente_id: existente?.id ?? null, fecha: f, tema: tema ?? null, filas,
        resumen: `${existente ? "Reemplazar" : "Registrar"} asistencia del ${f}: ${c("P")} P, ${c("T")} T, ${c("A")} A` };
      emitir({ tipo: "propuesta", propuesta: p });
      return `Propuesta ${p.id} enviada al docente para confirmar: ${p.resumen}.`;
    },
  });

  const proponerSesionPlan = betaZodTool({
    name: "proponer_sesion_plan",
    description: "Propone agregar una sesión al plan del semestre. No escribe: el docente confirma.",
    inputSchema: z.object({
      fecha,
      tema: z.string().min(2),
      numero: z.number().int().positive().optional(),
      tipo: z.string().optional().describe("magistral, taller, evaluacion, sustentacion…"),
      notas: z.string().optional(),
      horas: z.number().positive().max(12).optional(),
    }),
    run: async (i) => {
      const plan = await curso.sesionesPlan();
      const numero = i.numero ?? (plan.reduce((m, s) => Math.max(m, s.number ?? 0), 0) + 1);
      const p: Propuesta = { id: uid(), tipo: "sesion_plan", resumen: `Sesión ${numero} el ${i.fecha}: ${i.tema}`,
        datos: { number: numero, date: i.fecha, topic: i.tema, type: i.tipo ?? "magistral", notes: i.notas ?? null, duration_hours: i.horas ?? null } };
      emitir({ tipo: "propuesta", propuesta: p });
      return `Propuesta ${p.id} enviada al docente para confirmar: ${p.resumen}.`;
    },
  });

  return [consultarCurso, buscarEstudiante, proponerNotas, proponerActividad, proponerAsistencia, proponerSesionPlan];
}
