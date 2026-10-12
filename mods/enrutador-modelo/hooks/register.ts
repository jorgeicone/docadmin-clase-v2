import type { EngineInterface, Register } from 'claude-code'

type Nivel = 'fable' | 'opus' | 'sonnet' | 'haiku'
type Ruta = { nivel: Nivel; motivo: string }

const MODELOS: Record<Nivel, { id: string; nombre: string }> = {
  fable: { id: 'claude-fable-5-1', nombre: 'Fable' },
  opus: { id: 'claude-opus-5-5', nombre: 'Opus' },
  sonnet: { id: 'claude-sonnet-5-5', nombre: 'Sonnet' },
  haiku: { id: 'claude-haiku-5-5', nombre: 'Haiku' },
}

// Reglas por palabras clave, en orden: la primera que coincide gana.
const REGLAS: { nivel: Nivel; motivo: string; patron: RegExp }[] = [
  {
    nivel: 'fable',
    motivo: 'arquitectura',
    patron: /arquitectura|desde cero|ecosistema|modelo de datos|esquema de (la )?base|estructura del (proyecto|sistema)|disen(a|ar|o) (el|la|un|una) (sistema|plataforma|app|aplicacion)/,
  },
  {
    nivel: 'haiku',
    motivo: 'tarea simple',
    patron: /^(corrige|arregla) (la |las |el |los )?(tilde|tildes|ortografia|typo|coma)|^renombra|^cambia (el|la) (titulo|texto|nombre|color|fecha)\b|(reserva|cancela|libera) (la |una )?sala|^que (hora|dia|fecha)/,
  },
  {
    nivel: 'opus',
    motivo: 'código',
    patron: /\b(bug|error|falla|no funciona|no carga|se rompe|supabase|sql|javascript|js|css|codigo|funcion|refactor|api|deploy|script|mod|hook|test|realtime|tiempo real|aula viva|docadmin|base de datos)\b/,
  },
  {
    nivel: 'opus',
    motivo: 'criterio',
    patron: /auditori|corre el kit|propuesta|cotizacion|estrategia|precio|gamificacion|diseno web|landing|pagina web|sitio web/,
  },
  {
    nivel: 'sonnet',
    motivo: 'contenido',
    patron: /presentacion|material|evaluacion|quiz|rubrica|caso de estudio|cronograma|modulo|cuenta de cobro|cobrale|correo|informe|racional|conciliacion|metricas|resumen/,
  },
]

const PREGUNTA = `Clasifica la tarea que pide este mensaje. Responde SOLO una palabra:
ARQUITECTURA (diseñar un sistema o plataforma nueva, decisiones de estructura grandes)
CODIGO (programar, depurar, bases de datos, apps)
CRITERIO (auditorías, estrategia, propuestas comerciales, diseño web)
CONTENIDO (presentaciones, material de clase, evaluaciones, documentos, cobros, correos)
SIMPLE (corregir texto, renombrar, preguntas rápidas)
SIGUE (continúa la tarea anterior sin cambiar de tema)`

const DESDE_HAIKU: Record<string, Ruta> = {
  ARQUITECTURA: { nivel: 'fable', motivo: 'arquitectura' },
  CODIGO: { nivel: 'opus', motivo: 'código' },
  CRITERIO: { nivel: 'opus', motivo: 'criterio' },
  CONTENIDO: { nivel: 'sonnet', motivo: 'contenido' },
  SIMPLE: { nivel: 'haiku', motivo: 'tarea simple' },
}

const normaliza = (texto: string) =>
  texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

export const porPalabras = (texto: string): Ruta | undefined => {
  const t = normaliza(texto)
  const regla = REGLAS.find(r => r.patron.test(t))
  return regla && { nivel: regla.nivel, motivo: regla.motivo }
}

function muestra($: EngineInterface, ruta: Ruta, aviso: boolean) {
  const nombre = MODELOS[ruta.nivel].nombre
  $.ui.status(`🧠 ${nombre} · ${ruta.motivo}`)
  if (aviso) $.ui.toast(`Modelo: ${nombre} (${ruta.motivo})`)
}

export const register: Register = on => {
  let ruta: Ruta | undefined
  let manual: Nivel | undefined

  const actual = (): Ruta =>
    manual ? { nivel: manual, motivo: 'fijado a mano' } : ruta ?? { nivel: 'opus', motivo: 'por defecto' }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'modelo',
      description: 'Fija el modelo (fable, opus, sonnet, haiku) o vuelve al modo automático (auto)',
    })
    muestra($, actual(), false)
    return next(e)
  })

  on('command.run', { command: 'modelo' }, async ($, e) => {
    const pedido = normaliza(e.args)
    if (pedido === 'auto' || pedido === '') {
      manual = undefined
      muestra($, actual(), false)
      return { text: 'Modo automático: el modelo se elige según cada tarea.' }
    }
    if (!(pedido in MODELOS)) {
      return { text: 'Usa: /modelo fable | opus | sonnet | haiku | auto', exitCode: 1 }
    }
    manual = pedido as Nivel
    muestra($, actual(), false)
    return { text: `Modelo fijado en ${MODELOS[manual].nombre} hasta que escribas /modelo auto.` }
  })

  on('prompt.submit', async ($, e, next) => {
    const texto = e.text.trim()
    if (manual || texto.startsWith('/')) return next(e)

    const antes = ruta?.nivel
    const porRegla = porPalabras(texto)

    if (porRegla) {
      ruta = porRegla
    } else if (ruta && texto.length < 40) {
      // respuestas cortas ("sí", "dale", "así vamos") siguen con el mismo modelo
    } else {
      const r = await $.model.complete({
        model: 'haiku',
        system: PREGUNTA,
        prompt: `Tarea anterior: ${ruta?.motivo ?? 'ninguna'}\nMensaje: ${texto.slice(0, 2000)}`,
        maxTokens: 10,
        effort: 'low',
        timeoutMs: 8000,
      })
      const palabra = r.isAnswered ? r.text.trim().toUpperCase().replace(/[^A-Z]/g, '') : ''
      if (palabra !== 'SIGUE' || !ruta) {
        // ante la duda, el modelo fuerte
        ruta = DESDE_HAIKU[palabra] ?? { nivel: 'opus', motivo: 'por defecto' }
      }
    }

    muestra($, actual(), ruta?.nivel !== antes)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const nivel = e.agentId ? undefined : manual ?? ruta?.nivel
    return yield* next(nivel ? { ...e, model: MODELOS[nivel].id } : e)
  })
}
