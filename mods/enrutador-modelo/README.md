# enrutador-modelo

Mod para Claude Code que elige el modelo según la tarea:

| Tarea | Modelo |
| --- | --- |
| Arquitectura, sistemas nuevos | Fable 5.1 |
| Código, depuración, bases de datos, auditorías, propuestas, diseño web | Opus 5.5 |
| Presentaciones, evaluaciones, cuentas de cobro, correos, informes | Sonnet 5.5 |
| Correcciones, renombrar, reservar salas | Haiku 5.5 |

Primero clasifica por palabras clave (sin costo). Si no hay coincidencia, le pregunta a Haiku. Ante la duda usa Opus. Los subagentes no cambian.

El selector de modelo de la app no se mueve: el cambio se hace en cada turno. La etiqueta de abajo (`🧠 Responde: Opus · criterio`) dice qué modelo está respondiendo, y un aviso sale cada vez que cambia.

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
