# enrutador-modelo

Mod para Claude Code que elige el modelo según la tarea:

| Tarea | Modelo |
| --- | --- |
| Arquitectura, sistemas nuevos | Fable 5.1 |
| Código, depuración, bases de datos, auditorías, propuestas, diseño web | Opus 5.5 |
| Presentaciones, evaluaciones, cuentas de cobro, correos, informes | Sonnet 5.5 |
| Correcciones, renombrar, reservar salas | Haiku 5.5 |

Primero clasifica por palabras clave (sin costo). Si no hay coincidencia, le pregunta a Haiku. Ante la duda usa Opus. Los subagentes no cambian.

El selector de modelo de la app no se mueve: el cambio se hace en cada turno. La etiqueta de abajo (`🧠 Responde: Opus · criterio`) dice qué modelo está respondiendo. Cada vez que cambia salen un aviso de 12 segundos y una notificación del sistema, pensados para el celular, donde esa etiqueta no siempre se ve.

Solo funciona en sesiones de Claude Code que corren en el computador donde está instalado (también cuando se siguen desde el celular). No aplica en Claude chat, Cowork, Claude Design ni la extensión de Chrome.

Comandos:
- `/modelo fable | opus | sonnet | haiku` fija el modelo a mano.
- `/modelo auto` vuelve al modo automático.

## Instalar

```
/plugin marketplace add jorgeicone/docadmin-clase-v2
/plugin install enrutador-modelo@icone-mods
```

## Pruebas

```
claude plugin validate mods/enrutador-modelo
claude plugin test mods/enrutador-modelo
```

## Palabras que activan cada modelo

Se revisan en este orden y gana la primera que coincide. No importan mayúsculas ni tildes. Las palabras de 4 letras o menos deben aparecer completas (`api` no activa "capital"); las demás valen como inicio de palabra (`error` activa "errores", `resuelv` activa "resuélvelo"). Salieron de los mensajes reales de Jorge, con sus verbos y sus errores de tecleo.

| Orden | Modelo | Motivo | Palabras |
| --- | --- | --- | --- |
| 1 | Fable 5.1 | arquitectura | 107 |
| 2 | Haiku 5.5 | tarea simple (solo al inicio del mensaje) | 58 |
| 3 | Opus 5.5 | código | 114 |
| 4 | Opus 5.5 | criterio | 52 |
| 5 | Sonnet 5.5 | contenido | 110 |
| 6 | Haiku 5.5 | tarea simple (en cualquier parte) | 82 |

Si ninguna coincide, un mensaje corto (menos de 40 letras) sigue con el modelo anterior; si no, Haiku lo clasifica; ante la duda, Opus.

### Fable 5.1 · arquitectura
`arquitectura`, `arquitecto`, `arquitectonic`, `desde cero`, `ecosistema de`, `un ecosistema`, `nuevo ecosistema`, `modelo de datos`, `esquema de la base`, `esquema de base`, `estructura del proyecto`, `estructura del sistema`, `estructura de la plataforma`, `estructura de la aplicacion`, `disena el sistema`, `disena la plataforma`, `disena una plataforma`, `disena la app`, `disena una app`, `disena la aplicacion`, `disena una aplicacion`, `disena un sistema`, `disenemos el sistema`, `disenemos la plataforma`, `sistema nuevo`, `sistema completo`, `sistema integral`, `plataforma nueva`, `plataforma completa`, `nueva plataforma`, `nuevo sistema`, `nueva aplicacion`, `aplicacion nueva`, `app nueva`, `producto nuevo`, `proyecto nuevo`, `plan maestro`, `hoja de ruta`, `roadmap`, `vision de producto`, `vision tecnica`, `de punta a punta`, `extremo a extremo`, `end to end`, `monorepo`, `microservicio`, `multitenant`, `multi tenant`, `multiusuario`, `multiempresa`, `escalabilidad`, `escalable`, `escalar el sistema`, `alta disponibilidad`, `infraestructura`, `topologia`, `diagrama de arquitectura`, `diagrama del sistema`, `diagrama de componentes`, `flujo de datos`, `flujos de datos`, `patron de diseno`, `patrones de diseno`, `decision de arquitectura`, `decisiones de arquitectura`, `decision tecnica`, `decisiones tecnicas`, `tradeoff`, `trade off`, `pros y contras`, `alternativas de diseno`, `comparar enfoques`, `comparemos enfoques`, `evaluar enfoques`, `enfoque tecnico`, `migracion completa`, `migrar todo`, `migremos todo`, `migrar la plataforma`, `rediseno`, `redisenar`, `redisenemos`, `reestructur`, `refundar`, `replantear`, `replanteemos`, `repensar`, `repensemos`, `reorganizar todo`, `reorganizar el sistema`, `integrar todos los sistemas`, `integracion de sistemas`, `interoperabilidad`, `gobierno de datos`, `gobernanza`, `capas del sistema`, `separacion de responsabilidades`, `modelo de dominio`, `ecosistema digital`, `como estructuramos`, `como organizamos el sistema`, `como deberia estructurarse`, `base tecnica`, `stack tecnologico`, `elegir el stack`, `que stack`, `stack`

### Opus 5.5 · código
`bug`, `bugs`, `error`, `falla`, `fallo`, `no funciona`, `no funcion`, `no carga`, `no abre`, `no sale`, `no aparece`, `no se ve`, `no responde`, `no guarda`, `no deja`, `no me deja`, `se rompe`, `se rompio`, `se cae`, `se cayo`, `se dano`, `se colgo`, `se congela`, `pantalla en blanco`, `incognito`, `depura`, `debug`, `supabase`, `sql`, `query`, `base de datos`, `tablas`, `rls`, `trigger`, `migracion de la base`, `javascript`, `js`, `typescript`, `ts`, `css`, `html`, `react`, `alpine`, `node`, `python`, `json`, `regex`, `worker`, `cloudflare`, `api`, `endpoint`, `webhook`, `wompi`, `token`, `clave de api`, `deploy`, `desplieg`, `despleg`, `despliegue`, `github`, `git`, `commit`, `push`, `pull request`, `repositorio`, `repo`, `rama`, `merge`, `conflicto`, `lighthouse`, `rendimiento`, `lento`, `optimiza`, `refactor`, `codigo`, `funcion`, `script`, `mod`, `hook`, `plugin`, `skill`, `mcp`, `test`, `prueba unitaria`, `realtime`, `tiempo real`, `aula viva`, `docadmin`, `resuelv`, `resulv`, `resolv`, `soluciona`, `solucion`, `brecha`, `pendientes de auditoria`, `responsive`, `animacion`, `dominio`, `subdominio`, `dns`, `hostinger`, `netlify`, `publica`, `publicalo`, `publicar`, `sube a`, `subamos`, `seguridad`, `vulnerabilidad`, `permisos`, `login`, `sesion de usuario`, `cookie`, `cache`

### Opus 5.5 · criterio
`auditori`, `audita`, `auditemos`, `corre el kit`, `kit de auditorias`, `propuesta`, `cotizacion`, `cotiza`, `estrategia`, `estrategico`, `precio`, `tarifa`, `presupuesto`, `plan comercial`, `modelo comercial`, `gamificacion`, `diseno web`, `landing`, `pagina web`, `sitio web`, `analiza`, `analisis`, `diagnostico`, `evalua`, `revisa`, `recomendacion`, `recomiendas`, `que opinas`, `opinion`, `critica`, `prioriza`, `prioridades`, `riesgo`, `viabilidad`, `factible`, `conviene`, `decision`, `negociacion`, `contrato`, `clausula`, `legal`, `juridico`, `tributario`, `impuestos`, `coherencia`, `brecha de`, `mejora`, `optimiza el`, `posicionamiento`, `competencia`, `benchmark`, `diferenciador`

### Sonnet 5.5 · contenido
`presentacion`, `diapositiva`, `slides`, `deck`, `pptx`, `material`, `material de repaso`, `evaluacion`, `examen`, `quiz`, `trivia`, `rubrica`, `caso de estudio`, `casos de estudio`, `cronograma`, `calendario`, `agenda`, `modulo`, `clase`, `taller`, `curso`, `diplomado`, `syllabus`, `programa del curso`, `guia`, `instructivo`, `manual`, `paso a paso`, `tutorial`, `cuenta de cobro`, `cobrale`, `cobro`, `factura`, `informe`, `reporte`, `resumen`, `resumir`, `sintesis`, `acta`, `minuta`, `conclusion`, `correo`, `email`, `mail`, `mensaje`, `whatsapp`, `redacta`, `escribe`, `texto`, `copy`, `contenido`, `carrusel`, `post`, `publicacion`, `linkedin`, `instagram`, `tiktok`, `redes sociales`, `newsletter`, `boletin`, `guion`, `discurso`, `pitch`, `eslogan`, `slogan`, `descripcion`, `biografia`, `perfil`, `hoja de vida`, `carta`, `oficio`, `comunicado`, `invitacion`, `certificado`, `constancia`, `diploma`, `racional`, `conciliacion`, `metricas`, `indicador`, `kpi`, `estadistica`, `notas`, `asistencia`, `calificacion`, `estudiantes`, `alumnos`, `participantes`, `encuesta`, `formulario`, `contexto`, `traduce`, `traduccion`, `ingles`, `reescribe`, `parafrasea`, `tono`, `voz de marca`, `subtitulos`, `transcripcion`, `transcribe`, `imagen`, `imagenes`, `foto`, `logo`, `ilustracion`, `portada`, `infografia`, `pdf`, `excel`

### Haiku 5.5 · tarea simple, al inicio del mensaje
`corrige tilde`, `corrige tildes`, `corrige ortografia`, `corrige typo`, `corrige coma`, `corrige puntuacion`, `corrige mayuscula`, `corrige espacio`, `arregla tilde`, `arregla tildes`, `arregla ortografia`, `arregla typo`, `arregla coma`, `arregla puntuacion`, `arregla mayuscula`, `arregla espacio`, `renombra`, `cambia titulo`, `cambia texto`, `cambia nombre`, `cambia color`, `cambia fecha`, `cambia hora`, `cambia numero`, `cambia palabra`, `cambia frase`, `cambia icono`, `cambia emoji`, `cambia link`, `cambia enlace`, `cambia url`, `cambia telefono`, `copia`, `copiame`, `pega`, `ordena`, `suma`, `resta`, `convierte`, `pasa a mayuscula`, `pasa a minuscula`, `que hora`, `que dia`, `que fecha`, `que mes`, `que ano`, `cuanto es`, `cuantos`, `cuantas`, `cuando es`, `cuando fue`, `donde esta`, `donde queda`, `como se escribe`, `como se dice`, `como se llama`, `que significa`, `significado de`

### Haiku 5.5 · tarea simple, en cualquier parte
`reserva la sala`, `reserva una sala`, `reservar la sala`, `reservar una sala`, `cancela la sala`, `cancelar la sala`, `libera la sala`, `liberar la sala`, `reserva sala`, `cancela sala`, `libera sala`, `reservame la sala`, `cancelame la sala`, `dame el enlace`, `dame el link`, `dame los enlaces`, `dame los links`, `dame un enlace`, `dame un link`, `dame un nuevo enlace`, `dame otro enlace`, `regalame el enlace`, `regalame los enlaces`, `regalame el link`, `regalame los links`, `dame la url`, `dame el nombre`, `dame los nombres`, `dame la fecha`, `dame la hora`, `dame el telefono`, `dame el numero`, `dame la direccion`, `pasame el enlace`, `pasame el link`, `pasame la url`, `pasame el nombre`, `muestrame el enlace`, `cual es el enlace`, `cual es el link`, `cual es la url`, `cual es el nombre`, `cual es la fecha`, `cual es la hora`, `cual es el telefono`, `en que carpeta`, `donde guardaste`, `donde quedo`, `cuanto falta`, `cuantos dias faltan`, `cuantas horas`, `que dia es`, `que hora es`, `que fecha es`, `hora actual`, `fecha de hoy`, `fecha actual`, `dia de la semana`, `cuenta cuantos`, `lista los nombres`, `enumera`, `numera`, `sumame`, `multiplica`, `divide`, `porcentaje de`, `promedio de`, `sinonimo`, `antonimo`, `abreviatura`, `sigla`, `definicion de`, `ordena alfabeticamente`, `alfabeticamente`, `formato de fecha`, `mayuscula`, `minuscula`, `tilde`, `ortografia`, `typo`, `puntuacion`, `emoji`
