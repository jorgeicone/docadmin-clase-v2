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
export const SUST_LABELS = [
  { min:17, label:'Excelente 🌟', cls:'chip-green'  },
  { min:13, label:'Bueno 👍',     cls:'chip-cyan'   },
  { min: 9, label:'Regular ⚠️',  cls:'chip-yellow' },
  { min: 0, label:'Insuficiente ❌', cls:'chip-red' }
];
export function sustLabel(scaled){ return SUST_LABELS.find(l=>scaled>=l.min) || SUST_LABELS[SUST_LABELS.length-1]; }
