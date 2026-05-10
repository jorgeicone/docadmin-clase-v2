// 📅 ASISTENCIA — sesiones por fecha con P/T/A + observaciones + historial
import { supabase } from './supabase-client.js';
import { toast } from './toast.js';

let students = [], sessions = [], grades = [];
let courseId = null;
let currentSessionId = null;        // id de la actividad attendance activa
let currentRecords = {};            // { studentId: { status, obs } }

const STATUS_COLORS = {
  P: { bg:'#C8E6C9', fg:'#1B5E20', name:'Presente' },
  T: { bg:'#FFF9C4', fg:'#E65100', name:'Tarde' },
  A: { bg:'#FFCDD2', fg:'#B71C1C', name:'Ausente' },
};

export async function mountAsistencia(root, store){
  courseId = store.activeCourse.id;

  root.innerHTML = `
    <div style="display:grid;grid-template-columns:280px 1fr;gap:16px;align-items:start">

      <!-- SIDEBAR DE SESIONES -->
      <div class="card" style="position:sticky;top:0">
        <div class="card-row" style="justify-content:space-between;margin-bottom:8px">
          <h3 style="margin:0">📅 Sesiones</h3>
          <div style="display:flex;gap:4px">
            <button class="btn btn-xs btn-out" id="a-import" title="Importar desde JSON (v4 dashboard)">📥</button>
            <button class="btn btn-xs btn-cyan" id="a-new">＋ Nueva</button>
          </div>
        </div>
        <details class="acc acc-block" id="a-sessions-acc" open>
          <summary>
            <span class="acc-label">📅 <span id="a-sessions-summary-text">Todas las sesiones</span></span>
          </summary>
          <div id="a-sessions-list" style="max-height:60vh;overflow-y:auto;margin-top:8px">
            <p class="empty-state">Cargando…</p>
          </div>
        </details>
      </div>

      <!-- AREA PRINCIPAL -->
      <div>
        <div class="card">
          <div class="grid-3">
            <div class="field"><label>Fecha de la sesión *</label><input id="a-date" type="date"></div>
            <div class="field"><label>Semana / clase</label><input id="a-week" placeholder="Ej: Semana 5, Clase 9"></div>
            <div class="field"><label>Tema</label><input id="a-topic" placeholder="Tema del día"></div>
          </div>
          <div class="card-row" style="margin-top:6px;gap:6px">
            <button class="btn btn-out btn-xs" id="a-all-p">Marcar todos P</button>
            <button class="btn btn-out btn-xs" id="a-all-t">Marcar todos T</button>
            <button class="btn btn-out btn-xs" id="a-all-a">Marcar todos A</button>
            <button class="btn btn-out btn-xs" id="a-clear">Limpiar</button>
            <span style="flex:1"></span>
            <button class="btn btn-cyan" id="a-save">💾 Guardar sesión</button>
          </div>
        </div>

        <div class="card">
          <details class="acc acc-block" open>
            <summary>
              <span class="acc-label">👥 Estudiantes — sesión actual</span>
              <span id="a-counters" style="display:inline-flex;gap:6px;flex-wrap:wrap;margin-left:auto"></span>
            </summary>
            <div id="a-table-wrap" style="margin-top:10px"><p class="empty-state">Cargando estudiantes…</p></div>
          </details>
        </div>
      </div>
    </div>
  `;

  // Set fecha por defecto = hoy
  document.getElementById('a-date').value = new Date().toISOString().slice(0,10);

  // Wire-up
  document.getElementById('a-new').onclick = newSession;
  document.getElementById('a-import').onclick = openImportModal;
  document.getElementById('a-save').onclick = saveSession;
  document.getElementById('a-all-p').onclick = () => markAll('P');
  document.getElementById('a-all-t').onclick = () => markAll('T');
  document.getElementById('a-all-a').onclick = () => markAll('A');
  document.getElementById('a-clear').onclick = () => { currentRecords = {}; renderTable(); };

  await loadAll();
  renderSessionsList();
  renderTable();
}

async function loadAll(){
  const [stuR, sesR] = await Promise.all([
    supabase.from('v5_students').select('id, cedula, name').eq('course_id', courseId).order('name'),
    supabase.from('v5_activities').select('*').eq('course_id', courseId).eq('type','attendance').order('date',{ascending:false,nullsFirst:false}),
  ]);
  students = stuR.data || [];
  sessions = sesR.data || [];

  if (sessions.length){
    const ids = sessions.map(s=>s.id);
    const { data } = await supabase.from('v5_grades').select('*').in('activity_id', ids);
    grades = data || [];
  } else { grades = []; }
}

function newSession(){
  currentSessionId = null;
  currentRecords = {};
  document.getElementById('a-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('a-week').value = '';
  document.getElementById('a-topic').value = '';
  renderSessionsList();
  renderTable();
  toast('Nueva sesión iniciada');
}

function loadSession(sid){
  const s = sessions.find(x => x.id === sid);
  if (!s) return;
  currentSessionId = sid;
  document.getElementById('a-date').value = s.date || '';
  document.getElementById('a-week').value = s.topic?.split('|')[0]?.trim() || '';
  document.getElementById('a-topic').value = s.topic?.split('|')[1]?.trim() || s.topic || '';

  currentRecords = {};
  grades.filter(g => g.activity_id === sid).forEach(g => {
    currentRecords[g.student_id] = { status: g.status, obs: g.observation || '' };
  });
  renderSessionsList();
  renderTable();
  toast(`📂 Sesión del ${s.date} cargada`);
}

function markAll(status){
  students.forEach(s => {
    if (!currentRecords[s.id]) currentRecords[s.id] = { status, obs:'' };
    else currentRecords[s.id].status = status;
  });
  renderTable();
}

async function saveSession(){
  const date = document.getElementById('a-date').value;
  const week = document.getElementById('a-week').value.trim();
  const topic = document.getElementById('a-topic').value.trim();
  if (!date){ toast('Selecciona una fecha','error'); return; }

  const records = Object.entries(currentRecords).filter(([,r]) => r.status);
  if (!records.length){ toast('Marca al menos un estudiante','error'); return; }

  // 1. Crear o actualizar la actividad de tipo attendance
  const activityPayload = {
    course_id: courseId,
    type: 'attendance',
    name: `Asistencia ${date}${week?' · '+week:''}`,
    date,
    topic: week && topic ? `${week} | ${topic}` : (topic || week || null),
    max_points: 1,
  };

  let actId = currentSessionId;
  if (actId){
    const { error } = await supabase.from('v5_activities').update(activityPayload).eq('id', actId);
    if (error){ toast('Error: '+error.message,'error'); return; }
    // Borrar grades viejos de esta sesión para reemplazar
    await supabase.from('v5_grades').delete().eq('activity_id', actId);
  } else {
    const { data, error } = await supabase.from('v5_activities').insert(activityPayload).select().single();
    if (error){ toast('Error: '+error.message,'error'); return; }
    actId = data.id;
    currentSessionId = actId;
  }

  // 2. Insertar grades para cada estudiante
  const rows = records.map(([sid, rec]) => ({
    activity_id: actId,
    student_id: sid,
    status: rec.status,
    observation: rec.obs || null,
    value: rec.status === 'P' ? 1 : (rec.status === 'T' ? 0.5 : 0),
    source: 'manual',
  }));

  const { error } = await supabase.from('v5_grades').upsert(rows, { onConflict: 'activity_id,student_id' });
  if (error){ toast('Error: '+error.message,'error'); return; }

  toast(`✅ ${records.length} estudiantes registrados`,'success');
  await loadAll();
  renderSessionsList();
}

function renderSessionsList(){
  const list = document.getElementById('a-sessions-list');
  // Actualizar contador del summary del acordeón
  const summaryText = document.getElementById('a-sessions-summary-text');
  if (summaryText){
    summaryText.textContent = sessions.length
      ? `Todas las sesiones (${sessions.length})`
      : 'Todas las sesiones';
  }
  if (!sessions.length){
    list.innerHTML = `<p class="empty-state" style="padding:14px">Sin sesiones aún. Crea una con la fecha y "Guardar sesión".</p>`;
    return;
  }

  list.innerHTML = sessions.map(s => {
    const recs = grades.filter(g => g.activity_id === s.id);
    const p = recs.filter(g => g.status==='P').length;
    const t = recs.filter(g => g.status==='T').length;
    const a = recs.filter(g => g.status==='A').length;
    const isActive = s.id === currentSessionId;
    return `
    <div class="session-row" data-sid="${s.id}" style="
      padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;
      background:${isActive?'var(--ean-cyan)':'transparent'};
      color:${isActive?'#fff':'inherit'};
      border:1px solid ${isActive?'var(--ean-cyan)':'var(--ean-border)'}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <b style="font-size:12px">${s.date || '(sin fecha)'}</b>
        <button class="btn btn-xs btn-danger" data-del="${s.id}" title="Eliminar" style="padding:1px 5px">✕</button>
      </div>
      ${s.topic?`<div style="font-size:10px;opacity:.85;margin-top:2px">${escape(s.topic)}</div>`:''}
      <div style="display:flex;gap:4px;margin-top:4px">
        <span class="chip chip-green" style="font-size:9px;padding:1px 5px">P:${p}</span>
        <span class="chip chip-yellow" style="font-size:9px;padding:1px 5px">T:${t}</span>
        <span class="chip chip-red" style="font-size:9px;padding:1px 5px">A:${a}</span>
      </div>
    </div>
    `;
  }).join('');

  list.querySelectorAll('.session-row').forEach(row => {
    row.onclick = e => {
      if (e.target.dataset.del) return;
      loadSession(row.dataset.sid);
    };
  });
  list.querySelectorAll('[data-del]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const s = sessions.find(x=>x.id===b.dataset.del);
    if (!confirm(`¿Eliminar la sesión del ${s.date}?`)) return;
    const { error } = await supabase.from('v5_activities').delete().eq('id', s.id);
    if (error){ toast('Error: '+error.message,'error'); return; }
    if (currentSessionId === s.id){ currentSessionId = null; currentRecords = {}; }
    await loadAll();
    renderSessionsList();
    renderTable();
    toast('Sesión eliminada');
  });
}

function renderTable(){
  const counters = document.getElementById('a-counters');
  const wrap = document.getElementById('a-table-wrap');

  if (!students.length){
    wrap.innerHTML = `<p class="empty-state">No hay estudiantes en este curso. Importa el roster primero.</p>`;
    counters.innerHTML = '';
    return;
  }

  let p=0,t=0,a=0,sin=0;
  students.forEach(s => {
    const st = currentRecords[s.id]?.status;
    if (st==='P') p++; else if (st==='T') t++; else if (st==='A') a++; else sin++;
  });
  counters.innerHTML = `
    <span class="chip chip-green">✅ Presentes: <b>${p}</b></span>
    <span class="chip chip-yellow">⏰ Tarde: <b>${t}</b></span>
    <span class="chip chip-red">❌ Ausentes: <b>${a}</b></span>
    <span class="chip">⏳ Sin marcar: <b>${sin}</b></span>
    <span class="chip" style="background:var(--ean-blue);color:#fff">Total: <b>${students.length}</b></span>
  `;

  wrap.innerHTML = `
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>#</th>
          <th>Estudiante</th>
          <th class="num" style="min-width:170px">Estado</th>
          <th>Observación</th>
        </tr></thead>
        <tbody>
          ${students.map((s,i) => {
            const r = currentRecords[s.id] || {};
            return `
            <tr>
              <td class="num">${i+1}</td>
              <td>
                <b style="font-size:12px">${escape(s.name)}</b>
                <div style="font-size:10px;color:var(--ean-gray)"><code>${escape(s.cedula)}</code></div>
              </td>
              <td class="num">
                <div style="display:flex;gap:3px;justify-content:center">
                  ${['P','T','A'].map(st => {
                    const sel = r.status === st;
                    const c = STATUS_COLORS[st];
                    return `<button class="status-btn" data-sid="${s.id}" data-st="${st}"
                      style="width:36px;padding:6px 0;border:1px solid ${sel?c.fg:'var(--ean-border)'};
                      background:${sel?c.bg:'#fff'};color:${sel?c.fg:'var(--ean-gray)'};
                      font-weight:${sel?'700':'400'};border-radius:5px;cursor:pointer;font-size:13px"
                      title="${c.name}">${st}</button>`;
                  }).join('')}
                </div>
              </td>
              <td><input type="text" class="obs-input" data-obs="${s.id}" value="${escapeAttr(r.obs||'')}" placeholder="Justificación / nota…" style="width:100%;font-size:12px"></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  wrap.querySelectorAll('.status-btn').forEach(b => b.onclick = () => {
    const sid = b.dataset.sid;
    const st = b.dataset.st;
    if (!currentRecords[sid]) currentRecords[sid] = { status:'', obs:'' };
    currentRecords[sid].status = st;
    renderTable();
  });
  wrap.querySelectorAll('input[data-obs]').forEach(inp => inp.oninput = () => {
    const sid = inp.dataset.obs;
    if (!currentRecords[sid]) currentRecords[sid] = { status:'', obs:'' };
    currentRecords[sid].obs = inp.value;
  });
}

// ───── IMPORTAR DESDE V4 (JSON dashboard) ─────
function openImportModal(){
  let host = document.getElementById('a-import-host');
  if (!host){ host = document.createElement('div'); host.id='a-import-host'; document.body.appendChild(host); }
  host.innerHTML = `
    <div class="modal-bg">
      <div class="modal" style="max-width:720px">
        <h2>📥 Importar sesiones de asistencia desde JSON</h2>
        <p style="font-size:12px;color:var(--ean-gray);margin-bottom:10px">
          Pega el JSON exportado de tu dashboard v4. Formato esperado: <code>{"sessions":{"2026-03-10":{"date":"...","week":"...","topic":"...","records":{"cedula":{"status":"P","obs":""}}}}}</code>
        </p>
        <textarea id="imp-json" rows="10" placeholder='Pega aquí el JSON…' style="width:100%;font-family:monospace;font-size:11px;border:1px solid var(--ean-border);border-radius:6px;padding:8px;resize:vertical"></textarea>
        <div id="imp-preview" style="margin-top:10px"></div>
        <div class="modal-actions">
          <button class="btn btn-out" id="imp-cancel">Cancelar</button>
          <button class="btn btn-out" id="imp-analyze">🔍 Analizar</button>
          <button class="btn btn-cyan" id="imp-go" disabled>📥 Importar</button>
        </div>
      </div>
    </div>
  `;

  let parsed = null;

  document.getElementById('imp-cancel').onclick = () => host.innerHTML='';

  document.getElementById('imp-analyze').onclick = () => {
    const txt = document.getElementById('imp-json').value.trim();
    if (!txt){ toast('Pega el JSON primero','error'); return; }

    try {
      const raw = JSON.parse(txt);
      // Aceptar tanto {sessions:{...}} como directamente {fecha:{...}}
      const sessionsMap = raw.sessions || raw;

      const list = Object.entries(sessionsMap).map(([date, s]) => ({
        date: s.date || date,
        week: s.week || '',
        topic: s.topic || '',
        records: s.records || {},
      }));

      // Mapear cédulas a students
      const cedToStu = new Map();
      students.forEach(s => cedToStu.set(s.cedula, s));

      let totalRecords = 0, matched = 0, unmatched = new Set();
      list.forEach(s => {
        Object.entries(s.records).forEach(([ced, rec]) => {
          if (!rec?.status) return;
          totalRecords++;
          if (cedToStu.has(ced)) matched++;
          else unmatched.add(ced);
        });
      });

      parsed = list;

      const preview = document.getElementById('imp-preview');
      preview.innerHTML = `
        <div class="preview-header" style="flex-direction:column;align-items:stretch;gap:8px">
          <div><b>${list.length}</b> sesiones detectadas · <b>${totalRecords}</b> marcas P/T/A · <b>${matched}</b> coinciden con tus estudiantes${unmatched.size?` · <b style="color:var(--red)">${unmatched.size}</b> cédulas no encontradas`:''}</div>
          ${unmatched.size ? `<div style="font-size:11px;color:var(--ean-gray)">Cédulas sin match (se ignoran): ${[...unmatched].slice(0,8).map(c=>`<code>${escape(c)}</code>`).join(' ')}${unmatched.size>8?` … +${unmatched.size-8}`:''}</div>` : ''}
        </div>
        <div class="tbl-wrap" style="max-height:240px">
          <table><thead><tr><th>Fecha</th><th>Semana</th><th>Tema</th><th class="num">P</th><th class="num">T</th><th class="num">A</th></tr></thead><tbody>
            ${list.map(s => {
              const recs = Object.values(s.records);
              const p = recs.filter(r=>r?.status==='P').length;
              const t = recs.filter(r=>r?.status==='T').length;
              const a = recs.filter(r=>r?.status==='A').length;
              return `<tr><td><b>${escape(s.date)}</b></td><td>${escape(s.week)}</td><td style="font-size:11px">${escape(s.topic.substring(0,50))}</td><td class="num"><span class="chip chip-green" style="font-size:10px">${p}</span></td><td class="num"><span class="chip chip-yellow" style="font-size:10px">${t}</span></td><td class="num"><span class="chip chip-red" style="font-size:10px">${a}</span></td></tr>`;
            }).join('')}
          </tbody></table>
        </div>
      `;
      document.getElementById('imp-go').disabled = !list.length || !matched;
    } catch(e){
      document.getElementById('imp-preview').innerHTML = `<div class="login-error">JSON inválido: ${escape(e.message)}</div>`;
      parsed = null;
      document.getElementById('imp-go').disabled = true;
    }
  };

  document.getElementById('imp-go').onclick = async () => {
    if (!parsed?.length) return;
    const btn = document.getElementById('imp-go');
    btn.disabled = true; btn.textContent = 'Importando…';

    const cedToStu = new Map();
    students.forEach(s => cedToStu.set(s.cedula, s));

    let createdSessions = 0, createdGrades = 0, errors = 0;

    for (const s of parsed){
      // Crear actividad
      const actPayload = {
        course_id: courseId,
        type: 'attendance',
        name: `Asistencia ${s.date}${s.week?' · '+s.week:''}`,
        date: s.date,
        topic: s.week && s.topic ? `${s.week} | ${s.topic}` : (s.topic || s.week || null),
        max_points: 1,
      };
      const { data: act, error: e1 } = await supabase.from('v5_activities').insert(actPayload).select().single();
      if (e1){ errors++; continue; }
      createdSessions++;

      // Crear grades
      const rows = [];
      Object.entries(s.records).forEach(([ced, rec]) => {
        if (!rec?.status) return;
        const stu = cedToStu.get(ced);
        if (!stu) return; // no match, skip
        rows.push({
          activity_id: act.id,
          student_id: stu.id,
          status: rec.status,
          observation: rec.obs || null,
          value: rec.status === 'P' ? 1 : (rec.status === 'T' ? 0.5 : 0),
          source: 'manual',
        });
      });
      if (rows.length){
        const { error: e2 } = await supabase.from('v5_grades').upsert(rows, { onConflict: 'activity_id,student_id' });
        if (e2) errors++;
        else createdGrades += rows.length;
      }
    }

    toast(`✅ ${createdSessions} sesiones · ${createdGrades} marcas importadas${errors?` · ${errors} errores`:''}`,'success');
    host.innerHTML = '';
    await loadAll();
    renderSessionsList();
    renderTable();
  };
}

const escape = s => String(s||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const escapeAttr = s => escape(s).replace(/"/g,'&quot;');
