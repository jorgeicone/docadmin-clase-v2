import { test, expect } from 'claude-code/testing'
import { porPalabras } from './register'

const casos: [string, string | undefined][] = [
  ['Diseña la arquitectura de la nueva plataforma de ICONE Viva', 'fable'],
  ['Quiero montar un ecosistema de IA para la Fundación desde cero', 'fable'],
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
]

for (const [texto, esperado] of casos) {
  test(`"${texto}" → ${esperado ?? 'sin regla'}`, async () => {
    expect(porPalabras(texto)?.nivel).toBe(esperado)
  })
}
