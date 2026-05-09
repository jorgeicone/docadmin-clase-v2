// 💬 AI CHAT — conversación con Claude que conoce el curso completo
import { supabase, currentSession } from './supabase-client.js';
import { WORKER_URL, sustLabel } from './config.js';
import { toast } from './toast.js';

let messages = [];               // historial de la conversación (formato Anthropic)
let courseContext = '';          // system prompt construido al entrar
let courseData = null;           // datos crudos para mostrar resumen
let courseId = null;
let sending = false;

const SUGGESTIONS = [
  '¿Cuáles 5 estudiantes tienen peor asistencia?',
  '¿Qué grupos están en riesgo según sustentación?',
  'Resume cómo le fue al grupo Yoga Serena',
  'Dame ideas de actividades para evaluar Customer Journey',
  'Sugiere 3 temas para la próxima clase',
  'Lista los estudiantes que no han sustentado aún',
];

export async function mountChat(root, store){
  courseId = store.activeCourse.id;
  root.innerHTML = `
    <div class="card">
      <div class="card-row" style="justify-content:space-between">
        <h2>💬 AI Chat — ${escape(store.activeCourse.name)}</h2>
        <div style="display:flex;gap:8px">
          <button class="btn btn-out btn-xs" id="chat-refresh">🔄 Refrescar contexto</button>
          <button class="btn btn-out btn-xs" id="chat-clear">🗑 Limpiar</button>
        </div>
      </div>
      <div id="chat-context-info" style="margin-top:8px;font-size:11px;color:var(--ean-gray)">Cargando contexto…</div>
    </div>

    <div class="card" style="display:flex;flex-direction:column;height:calc(100vh - 280px);min-height:400px">
      <div id="chat-messages" style="flex:1;overflow-y:auto;padding:8px;background:#fafafa;border-radius:6px;margin-bottom:10px"></div>

      <div id="chat-suggestions"></div>

      <div style="display:flex;gap:8px;align-items:flex-end">
        <textarea id="chat-input" rows="2" placeholder="Pregunta sobre el curso… (Enter para enviar, Shift+Enter nueva línea)"
          style="flex:1;resize:none;border:1px solid var(--ean-border);border-radius:6px;padding:8px;font-family:inherit;font-size:13px"></textarea>
        <button class="btn btn-cyan btn-lg" id="chat-send">➤</button>
      </div>
      <div style="font-size:10px;color:var(--ean-gray);margin-top:6px">
        💡 Cada mensaje consume 1 llamada IA de tu plan. La IA conoce: estudiantes, grupos, actividades, notas, asistencia y sustentaciones de este curso.
      </div>
    </div>
  `;

  document.getElementById('chat-refresh').onclick = async () => {
    document.getElementById('chat-context-info').textContent = 'Refrescando…';
    await loadContext();
    renderContextInfo();
    toast('Contexto actualizado','success');
  };
  document.getElementById('chat-clear').onclick = () => {
    if (!messages.length || confirm('¿Borrar la conversación?')){ messages = []; renderMessages(); renderSuggestions(); }
  };
  document.getElementById('chat-send').onclick = sendMessage;
  document.getElementById('chat-input').onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendMessage(); }
  };

  await loadContext();
  renderContextInfo();
  renderMessages();
  renderSuggestions();
}

async function loadContext(){
  const [courseR, stuR, grpR, memR, actR] = await Promise.all([
    supabase.from('v5_courses').select('*').eq('id', courseId).single(),
    supabase.from('v5_students').select('id, cedula, name, email, metadata').eq('course_id', courseId).order('name'),
    supabase.from('v5_groups').select('id, name, leader_student_id, notes').eq('course_id', courseId),
    supabase.from('v5_group_members').select('group_id, student_id'),
    supabase.from('v5_activities').select('*').eq('course_id', courseId).order('date',{ascending:true,nullsFirst:false}),
  ]);

  const course = courseR.data;
  const students = stuR.data || [];
  const groups = grpR.data || [];
  const memberships = memR.data || [];
  const activities = actR.data || [];

  let grades = [];
  if (activities.length){
    const ids = activities.map(a => a.id);
    const { data } = await supabase.from('v5_grades').select('*').in('activity_id', ids);
    grades = data || [];
  }

  courseData = { course, students, groups, memberships, activities, grades };
  courseContext = buildSystemPrompt(courseData);
}

function buildSystemPrompt({ course, students, groups, memberships, activities, grades }){
  const stuLines = students.map((s,i) => `  ${i+1}. ${s.cedula}|${s.name}${s.email?'|'+s.email:''}`).join('\n');

  const grpLines = groups.map(g => {
    const leader = students.find(st => st.id === g.leader_student_id);
    const mems = memberships.filter(m => m.group_id === g.id).map(m => students.find(st => st.id === m.student_id)?.name).filter(Boolean);
    return `  • ${g.name}${leader?` (líder: ${leader.name})`:''}: ${mems.join(', ') || 'sin integrantes'}`;
  }).join('\n');

  // Resumen de actividades + estado de calificación
  const actLines = activities.map(a => {
    const gs = grades.filter(g => g.activity_id === a.id);
    const promedio = gs.length ? (gs.reduce((sum,g) => sum + (g.value||0), 0) / gs.length).toFixed(1) : '—';
    return `  • [${a.type}] "${a.name}"${a.date?' ('+a.date+')':''} · escala 0-${a.max_points}${a.weight?' · peso '+a.weight+'%':''} · ${gs.length}/${students.length} calificados · prom: ${promedio}`;
  }).join('\n');

  // Notas detalladas por estudiante (compacto)
  const notesByStudent = {};
  students.forEach(s => { notesByStudent[s.id] = []; });
  grades.forEach(g => {
    const a = activities.find(x => x.id === g.activity_id);
    if (!a) return;
    const list = notesByStudent[g.student_id];
    if (list){
      if (a.type === 'attendance') list.push(`asist ${a.date}=${g.status}`);
      else list.push(`${a.name}=${g.value}/${a.max_points}`);
    }
  });
  const detailLines = students.map(s => `  ${s.name}: ${notesByStudent[s.id].join(' · ') || 'sin notas'}`).join('\n');

  return `Eres un asistente para el docente Jorge Hugo Pérez en el curso universitario "${course.name}"${course.code?' ('+course.code+')':''}${course.start_date?' · semestre ' + course.start_date + ' a ' + course.end_date:''}.

Sé breve, claro y útil. Cuando el docente pregunte por estudiantes específicos o estadísticas, responde con datos concretos del contexto. Si necesitas listas, usa formato markdown simple. Si te piden cosas que no estén en los datos (ej: detalles de tareas no registradas), dilo claramente.

═══════════════════════════════════════════════
DATOS DEL CURSO (al ${new Date().toLocaleDateString('es-CO')})
═══════════════════════════════════════════════

Estudiantes (${students.length} en total) — formato: cédula|nombre|email:
${stuLines || '  (ninguno)'}

Grupos del curso:
${grpLines || '  (ninguno)'}

Actividades creadas:
${actLines || '  (ninguna)'}

Notas por estudiante:
${detailLines || '  (sin notas)'}
═══════════════════════════════════════════════`;
}

function renderContextInfo(){
  if (!courseData) return;
  const { students, groups, activities, grades } = courseData;
  const sustenta = activities.filter(a => a.type === 'sustentacion').length;
  const asist = activities.filter(a => a.type === 'attendance').length;
  document.getElementById('chat-context-info').textContent =
    `📊 La IA conoce: ${students.length} estudiantes · ${groups.length} grupos · ${activities.length} actividades (${sustenta} sustentación + ${asist} asistencia + ${activities.length - sustenta - asist} otras) · ${grades.length} notas registradas`;
}

function renderMessages(){
  const div = document.getElementById('chat-messages');
  if (!messages.length){
    div.innerHTML = `
      <div style="text-align:center;padding:30px 20px;color:var(--ean-gray)">
        <div style="font-size:36px;margin-bottom:8px">🤖</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:4px">Hola docente, soy tu asistente IA</div>
        <div style="font-size:12px">Conozco a tus ${courseData?.students?.length||'?'} estudiantes y todas sus notas. Pregúntame lo que necesites.</div>
      </div>
    `;
    return;
  }

  div.innerHTML = messages.map(m => {
    const isUser = m.role === 'user';
    const text = (m.content || []).map(c => c.text || '').join('');
    const html = renderMd(text);
    return `
    <div style="display:flex;${isUser?'justify-content:flex-end':''};margin-bottom:10px">
      <div style="max-width:75%;padding:10px 14px;border-radius:10px;
        background:${isUser?'var(--ean-blue)':'#fff'};color:${isUser?'#fff':'var(--ean-dark)'};
        border:1px solid ${isUser?'var(--ean-blue)':'var(--ean-border)'};
        font-size:13px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word">${html}</div>
    </div>`;
  }).join('');

  // Auto-scroll abajo
  div.scrollTop = div.scrollHeight;
}

// Renderizado simple de markdown (bold, italic, code, listas)
function renderMd(text){
  let s = escape(text);
  s = s.replace(/```([\s\S]*?)```/g, '<pre style="background:#f0f0f0;padding:8px;border-radius:4px;overflow-x:auto;font-size:12px">$1</pre>');
  s = s.replace(/`([^`]+)`/g, '<code style="background:#f0f0f0;padding:2px 5px;border-radius:3px;font-size:12px">$1</code>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<i>$1</i>');
  // Listas con - o * al inicio de línea
  s = s.replace(/(^|\n)([-*]) (.+)/g, '$1• $3');
  return s;
}

function renderSuggestions(){
  const div = document.getElementById('chat-suggestions');
  if (!div) return;
  if (messages.length > 0){ div.innerHTML = ''; return; }
  div.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
      ${SUGGESTIONS.map(s => `<button class="btn btn-out btn-xs" data-sug="${escapeAttr(s)}" style="font-size:11px">${escape(s)}</button>`).join('')}
    </div>
  `;
  div.querySelectorAll('[data-sug]').forEach(b => b.onclick = () => {
    document.getElementById('chat-input').value = b.dataset.sug;
    sendMessage();
  });
}

async function sendMessage(){
  if (sending) return;
  const inp = document.getElementById('chat-input');
  const text = inp.value.trim();
  if (!text) return;

  sending = true;
  document.getElementById('chat-send').disabled = true;
  inp.value = '';

  messages.push({ role:'user', content:[{ type:'text', text }] });
  // Mensaje placeholder mientras Claude piensa
  messages.push({ role:'assistant', content:[{ type:'text', text:'⏳ Pensando…' }] });
  renderMessages();
  renderSuggestions();

  try {
    const session = await currentSession();
    if (!session?.access_token) throw new Error('Sesión expirada');

    // Recortar historial: enviar solo los últimos 10 turnos para no inflar contexto
    const sendMessages = messages.slice(0, -1).slice(-20); // sin el placeholder
    const r = await fetch(WORKER_URL + '/', {
      method:'POST',
      headers:{ 'Authorization':'Bearer '+session.access_token, 'Content-Type':'application/json' },
      body: JSON.stringify({ messages: sendMessages, system: courseContext, max_tokens: 2048 })
    });

    const txt = await r.text();
    if (!r.ok) throw new Error(`Worker ${r.status}: ${txt.substring(0,200)}`);
    const data = JSON.parse(txt);
    const aiText = data.result?.content?.[0]?.text || data.result?.text || (typeof data.result === 'string' ? data.result : '(sin respuesta)');

    // Reemplazar el placeholder con la respuesta real
    messages[messages.length - 1] = { role:'assistant', content:[{ type:'text', text: aiText }] };
    renderMessages();
  } catch(e){
    messages[messages.length - 1] = { role:'assistant', content:[{ type:'text', text:'❌ Error: '+e.message }] };
    renderMessages();
  } finally {
    sending = false;
    document.getElementById('chat-send').disabled = false;
    inp.focus();
  }
}

const escape = s => String(s||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const escapeAttr = s => escape(s).replace(/"/g,'&quot;');
