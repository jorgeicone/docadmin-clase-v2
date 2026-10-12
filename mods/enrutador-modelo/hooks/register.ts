import type { EngineInterface, Register } from 'claude-code'

type Nivel = 'fable' | 'opus' | 'sonnet' | 'haiku'
type Ruta = { nivel: Nivel; motivo: string }

const MODELOS: Record<Nivel, { id: string; nombre: string }> = {
  fable: { id: 'claude-fable-5-1', nombre: 'Fable' },
  opus: { id: 'claude-opus-5-5', nombre: 'Opus' },
  sonnet: { id: 'claude-sonnet-5-5', nombre: 'Sonnet' },
  haiku: { id: 'claude-haiku-5-5', nombre: 'Haiku' },
}

type Grupo = { nivel: Nivel; motivo: string; palabras: string[]; alInicio?: boolean }

// Palabras que activan cada modelo, escritas sin tildes ni ñ (el texto se normaliza igual).
// Las de 4 letras o menos deben aparecer completas ("api" no activa "capital");
// las demás valen como inicio de palabra ("error" activa "errores"; "resuelv" activa "resuelvelo").
// Salieron de los mensajes reales de Jorge: sus verbos ("resuelve", "regalame", "construyeme")
// y sus errores de tecleo ("resulve") están incluidos.
const FABLE = [
  'arquitectura', 'arquitecto', 'arquitectonic', 'desde cero', 'ecosistema de', 'un ecosistema', 'nuevo ecosistema', 'modelo de datos',
  'esquema de la base', 'esquema de base', 'estructura del proyecto', 'estructura del sistema',
  'estructura de la plataforma', 'estructura de la aplicacion', 'disena el sistema', 'disena la plataforma',
  'disena una plataforma', 'disena la app', 'disena una app', 'disena la aplicacion', 'disena una aplicacion',
  'disena un sistema', 'disenemos el sistema', 'disenemos la plataforma', 'sistema nuevo', 'sistema completo',
  'sistema integral', 'plataforma nueva', 'plataforma completa', 'nueva plataforma', 'nuevo sistema',
  'nueva aplicacion', 'aplicacion nueva', 'app nueva', 'producto nuevo', 'proyecto nuevo', 'plan maestro',
  'hoja de ruta', 'roadmap', 'vision de producto', 'vision tecnica', 'de punta a punta', 'extremo a extremo',
  'end to end', 'monorepo', 'microservicio', 'multitenant', 'multi tenant', 'multiusuario', 'multiempresa',
  'escalabilidad', 'escalable', 'escalar el sistema', 'alta disponibilidad', 'infraestructura', 'topologia',
  'diagrama de arquitectura', 'diagrama del sistema', 'diagrama de componentes', 'flujo de datos',
  'flujos de datos', 'patron de diseno', 'patrones de diseno', 'decision de arquitectura',
  'decisiones de arquitectura', 'decision tecnica', 'decisiones tecnicas', 'tradeoff', 'trade off',
  'pros y contras', 'alternativas de diseno', 'comparar enfoques', 'comparemos enfoques', 'evaluar enfoques',
  'enfoque tecnico', 'migracion completa', 'migrar todo', 'migremos todo', 'migrar la plataforma',
  'rediseno', 'redisenar', 'redisenemos', 'reestructur', 'refundar', 'replantear', 'replanteemos',
  'repensar', 'repensemos', 'reorganizar todo', 'reorganizar el sistema', 'integrar todos los sistemas',
  'integracion de sistemas', 'interoperabilidad', 'gobierno de datos', 'gobernanza', 'capas del sistema',
  'separacion de responsabilidades', 'modelo de dominio', 'ecosistema digital', 'como estructuramos',
  'como organizamos el sistema', 'como deberia estructurarse', 'base tecnica', 'stack tecnologico',
  'elegir el stack', 'que stack', 'stack',
]

const OPUS_CODIGO = [
  'bug', 'bugs', 'error', 'falla', 'fallo', 'no funciona', 'no funcion', 'no carga', 'no abre',
  'no sale', 'no aparece', 'no se ve', 'no responde', 'no guarda', 'no deja', 'no me deja', 'se rompe',
  'se rompio', 'se cae', 'se cayo', 'se dano', 'se colgo', 'se congela', 'pantalla en blanco',
  'incognito', 'depura', 'debug', 'supabase', 'sql', 'query', 'base de datos', 'tablas', 'rls', 'trigger',
  'migracion de la base', 'javascript', 'js', 'typescript', 'ts', 'css', 'html', 'react', 'alpine', 'node',
  'python', 'json', 'regex', 'worker', 'cloudflare', 'api', 'endpoint', 'webhook', 'wompi', 'token',
  'clave de api', 'deploy', 'desplieg', 'despleg', 'despliegue', 'github', 'git', 'commit', 'push',
  'pull request', 'repositorio', 'repo', 'rama', 'merge', 'conflicto', 'lighthouse', 'rendimiento',
  'lento', 'optimiza', 'refactor', 'codigo', 'funcion', 'script', 'mod', 'hook', 'plugin', 'skill', 'mcp',
  'test', 'prueba unitaria', 'realtime', 'tiempo real', 'aula viva', 'docadmin', 'resuelv', 'resulv',
  'resolv', 'soluciona', 'solucion', 'brecha', 'pendientes de auditoria', 'responsive', 'animacion',
  'dominio', 'subdominio', 'dns', 'hostinger', 'netlify', 'publica', 'publicalo', 'publicar', 'sube a',
  'subamos', 'seguridad', 'vulnerabilidad', 'permisos', 'login', 'sesion de usuario', 'cookie', 'cache',
]

const OPUS_CRITERIO = [
  'auditori', 'audita', 'auditemos', 'corre el kit', 'kit de auditorias', 'propuesta', 'cotizacion',
  'cotiza', 'estrategia', 'estrategico', 'precio', 'tarifa', 'presupuesto', 'plan comercial',
  'modelo comercial', 'gamificacion', 'diseno web', 'landing', 'pagina web', 'sitio web', 'analiza',
  'analisis', 'diagnostico', 'evalua', 'revisa', 'recomendacion', 'recomiendas', 'que opinas', 'opinion',
  'critica', 'prioriza', 'prioridades', 'riesgo', 'viabilidad', 'factible', 'conviene', 'decision',
  'negociacion', 'contrato', 'clausula', 'legal', 'juridico', 'tributario', 'impuestos', 'coherencia',
  'brecha de', 'mejora', 'optimiza el', 'posicionamiento', 'competencia', 'benchmark', 'diferenciador',
]

const SONNET = [
  'presentacion', 'diapositiva', 'slides', 'deck', 'pptx', 'material', 'material de repaso', 'evaluacion',
  'examen', 'quiz', 'trivia', 'rubrica', 'caso de estudio', 'casos de estudio', 'cronograma', 'calendario',
  'agenda', 'modulo', 'clase', 'taller', 'curso', 'diplomado', 'syllabus', 'programa del curso', 'guia',
  'instructivo', 'manual', 'paso a paso', 'tutorial', 'cuenta de cobro', 'cobrale', 'cobro', 'factura',
  'informe', 'reporte', 'resumen', 'resumir', 'sintesis', 'acta', 'minuta', 'conclusion', 'correo',
  'email', 'mail', 'mensaje', 'whatsapp', 'redacta', 'escribe', 'texto', 'copy', 'contenido', 'carrusel',
  'post', 'publicacion', 'linkedin', 'instagram', 'tiktok', 'redes sociales', 'newsletter', 'boletin',
  'guion', 'discurso', 'pitch', 'eslogan', 'slogan', 'descripcion', 'biografia', 'perfil', 'hoja de vida',
  'carta', 'oficio', 'comunicado', 'invitacion', 'certificado', 'constancia', 'diploma', 'racional',
  'conciliacion', 'metricas', 'indicador', 'kpi', 'estadistica', 'notas', 'asistencia', 'calificacion',
  'estudiantes', 'alumnos', 'participantes', 'encuesta', 'formulario', 'contexto', 'traduce',
  'traduccion', 'ingles', 'reescribe', 'parafrasea', 'tono', 'voz de marca', 'subtitulos', 'transcripcion',
  'transcribe', 'imagen', 'imagenes', 'foto', 'logo', 'ilustracion', 'portada', 'infografia', 'pdf', 'excel',
]

// Tareas pequeñas que Haiku resuelve bien. Las de HAIKU_INICIO solo cuentan al comenzar el mensaje.
const HAIKU_INICIO = [
  'corrige tilde', 'corrige tildes', 'corrige ortografia', 'corrige typo', 'corrige coma',
  'corrige puntuacion', 'corrige mayuscula', 'corrige espacio', 'arregla tilde', 'arregla tildes',
  'arregla ortografia', 'arregla typo', 'arregla coma', 'arregla puntuacion', 'arregla mayuscula',
  'arregla espacio', 'renombra', 'cambia titulo', 'cambia texto', 'cambia nombre', 'cambia color',
  'cambia fecha', 'cambia hora', 'cambia numero', 'cambia palabra', 'cambia frase', 'cambia icono',
  'cambia emoji', 'cambia link', 'cambia enlace', 'cambia url', 'cambia telefono', 'copia', 'copiame',
  'pega', 'ordena', 'suma', 'resta', 'convierte', 'pasa a mayuscula', 'pasa a minuscula', 'que hora',
  'que dia', 'que fecha', 'que mes', 'que ano', 'cuanto es', 'cuantos', 'cuantas', 'cuando es',
  'cuando fue', 'donde esta', 'donde queda', 'como se escribe', 'como se dice', 'como se llama',
  'que significa', 'significado de',
]

const HAIKU_LIBRE = [
  'reserva la sala', 'reserva una sala', 'reservar la sala', 'reservar una sala', 'cancela la sala',
  'cancelar la sala', 'libera la sala', 'liberar la sala', 'reserva sala', 'cancela sala', 'libera sala',
  'reservame la sala', 'cancelame la sala', 'dame el enlace', 'dame el link', 'dame los enlaces',
  'dame los links', 'dame un enlace', 'dame un link', 'dame un nuevo enlace', 'dame otro enlace',
  'regalame el enlace', 'regalame los enlaces', 'regalame el link', 'regalame los links', 'dame la url', 'dame el nombre', 'dame los nombres', 'dame la fecha', 'dame la hora',
  'dame el telefono', 'dame el numero', 'dame la direccion', 'pasame el enlace', 'pasame el link',
  'pasame la url', 'pasame el nombre', 'muestrame el enlace', 'cual es el enlace', 'cual es el link',
  'cual es la url', 'cual es el nombre', 'cual es la fecha', 'cual es la hora', 'cual es el telefono',
  'en que carpeta', 'donde guardaste', 'donde quedo', 'cuanto falta', 'cuantos dias faltan',
  'cuantas horas', 'que dia es', 'que hora es', 'que fecha es', 'hora actual', 'fecha de hoy',
  'fecha actual', 'dia de la semana', 'cuenta cuantos', 'lista los nombres', 'enumera', 'numera',
  'sumame', 'multiplica', 'divide', 'porcentaje de', 'promedio de', 'sinonimo', 'antonimo',
  'abreviatura', 'sigla', 'definicion de', 'ordena alfabeticamente', 'alfabeticamente',
  'formato de fecha', 'mayuscula', 'minuscula', 'tilde', 'ortografia', 'typo', 'puntuacion', 'emoji',
]

const escapa = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')

// Al inicio del mensaje se tolera un artículo tras el verbo: "corrige tilde" acepta "corrige la tilde".
const conArticulo = (p: string) => {
  const [verbo, ...resto] = p.split(' ')
  return resto.length
    ? `${escapa(verbo)}(?:\\s+(?:el|la|los|las|un|una|mi|tu|su))?\\s+${escapa(resto.join(' '))}`
    : escapa(verbo)
}

// Cada lista se vuelve un solo patrón: palabras cortas completas, el resto como inicio de palabra.
const patronDe = (palabras: string[], alInicio = false): RegExp => {
  const forma = alInicio ? conArticulo : escapa
  const cortas = palabras.filter(p => !p.includes(' ') && p.length <= 4).map(forma)
  const largas = palabras.filter(p => p.includes(' ') || p.length > 4).map(forma)
  const partes = [
    ...(cortas.length ? [`(?:${cortas.join('|')})s?\\b`] : []),
    ...(largas.length ? [`(?:${largas.join('|')})`] : []),
  ]
  return new RegExp(`${alInicio ? '^' : '\\b'}(?:${partes.join('|')})`)
}

// Reglas en orden: la primera que coincide gana.
const GRUPOS: Grupo[] = [
  { nivel: 'fable', motivo: 'arquitectura', palabras: FABLE },
  { nivel: 'haiku', motivo: 'tarea simple', palabras: HAIKU_INICIO, alInicio: true },
  { nivel: 'opus', motivo: 'código', palabras: OPUS_CODIGO },
  { nivel: 'opus', motivo: 'criterio', palabras: OPUS_CRITERIO },
  { nivel: 'sonnet', motivo: 'contenido', palabras: SONNET },
  { nivel: 'haiku', motivo: 'tarea simple', palabras: HAIKU_LIBRE },
]

const REGLAS = GRUPOS.map(g => ({ nivel: g.nivel, motivo: g.motivo, patron: patronDe(g.palabras, g.alInicio) }))

/** Cuántas palabras activan cada modelo (para las pruebas y el README). */
export const palabrasPorModelo = (): Record<Nivel, number> => {
  const total: Record<Nivel, number> = { fable: 0, opus: 0, sonnet: 0, haiku: 0 }
  for (const g of GRUPOS) total[g.nivel] += g.palabras.length
  return total
}

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
  // el selector de la app no cambia: esta etiqueta dice qué modelo responde
  $.ui.status(`🧠 Responde: ${nombre} · ${ruta.motivo}`)
  if (!aviso) return
  const texto = `Ahora responde ${nombre} (${ruta.motivo})`
  // 12 s para alcanzar a leerlo desde el celular, donde la etiqueta de abajo no siempre se ve
  $.ui.toast(texto, { timeoutMs: 12000 })
  // y una notificación del sistema, por si la pantalla no muestra ni la etiqueta ni el aviso
  $.ui.notify(texto, { title: 'Enrutador de modelo' }).catch(() => {})
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
