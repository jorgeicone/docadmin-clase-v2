import { test, expect } from 'claude-code/testing'
import { porPalabras, palabrasPorModelo } from './register'

// Los tres últimos bloques son mensajes reales de Jorge, con sus giros y errores de tecleo.
const casos: [string, string | undefined][] = [
  ['Diseña la arquitectura de la nueva plataforma de ICONE Viva', 'fable'],
  ['Quiero montar un ecosistema de IA para la Fundación desde cero', 'fable'],
  ['diseña la arquitectura de un sistema de inscripciones', 'fable'],
  ['El aula viva no carga en el celular, revisa el error', 'opus'],
  ['Arregla la consulta de Supabase en DocAdmin', 'opus'],
  ['Corre el kit de auditorías sobre la presentación del módulo 3', 'opus'],
  ['Arma la propuesta para el cliente nuevo', 'opus'],
  ['Prepara la presentación del módulo 2', 'sonnet'],
  ['Hazme la cuenta de cobro del Poli de septiembre', 'sonnet'],
  ['Corrige la tilde del título', 'haiku'],
  ['Renombra el archivo de repaso', 'haiku'],
  ['Reserva la sala para el jueves', 'haiku'],
  ['sí, así vamos', undefined],
  // reales
  ['listos resuelvelo de una bloque 6', 'opus'],
  ['resulve lo de los goleadores', 'opus'],
  ['subamos a gifhub y me das lo enlaces', 'opus'],
  ['porque cuando ingreso en la web, no sale nada?', 'opus'],
  ['audítame esta aplicación', 'opus'],
  ['dame contexto para irme a una nueva sesion', 'sonnet'],
  ['regalame contexto para irme a otra sesion', 'sonnet'],
  ['dame el enlace', 'haiku'],
  ['regalame los enlaces', 'haiku'],
  ['dame un nuevo enlace', 'haiku'],
  ['donde quedo el boton', 'haiku'],
  ['validacion', undefined],
  // una regla de arquitectura no debe ganar por la marca "ecosistema ICONE"
  ['audita toda la aplicación del ecosistema ICONE', 'opus'],
]

for (const [texto, esperado] of casos) {
  test(`"${texto}" → ${esperado ?? 'sin regla'}`, async () => {
    expect(porPalabras(texto)?.nivel).toBe(esperado)
  })
}

test('cada modelo tiene al menos 100 palabras que lo activan', async () => {
  const total = palabrasPorModelo()
  for (const nivel of ['fable', 'opus', 'sonnet', 'haiku'] as const) {
    expect(total[nivel]).toBeGreaterThanOrEqual(100)
  }
})
