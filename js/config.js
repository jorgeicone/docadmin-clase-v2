// Config global — sin secretos. Solo URLs públicas y la anon key.
export const SUPABASE_URL  = 'https://nvgkhdrrxqdgxktfkioa.supabase.co';
export const SUPABASE_ANON = 'sb_publishable_d1RrtE7S-9a8e8mGKRRjxQ_4HU_nkDl';
export const WORKER_URL    = 'https://claude-proxy.jorgehugoperez.workers.dev';

// Convenciones del modelo
export const ATTENDANCE_STATUS = { P:'Presente', T:'Tarde', A:'Ausente' };
export const ACTIVITY_TYPES = {
  individual:    'Nota individual (0-5)',
  group:         'Nota grupal',
  sustentacion:  'Sustentación (con criterios)',
  attendance:    'Asistencia',
};
// Labels basadas en porcentaje (no en valor absoluto) para soportar
// rúbricas con cualquier escala (ej: /10, /20, /50).
export const SUST_LABELS = [
  { minPct:85, label:'Excelente 🌟', cls:'chip-green'  },
  { minPct:65, label:'Bueno 👍',     cls:'chip-cyan'   },
  { minPct:45, label:'Regular ⚠️',  cls:'chip-yellow' },
  { minPct: 0, label:'Insuficiente ❌', cls:'chip-red' }
];
export function sustLabel(value, max){
  const m = max || 20;  // fallback para sustentaciones viejas
  const pct = m > 0 ? (value / m) * 100 : 0;
  return SUST_LABELS.find(l => pct >= l.minPct) || SUST_LABELS[SUST_LABELS.length-1];
}
