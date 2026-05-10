// 📋 CONSOLIDADO DE ASISTENCIA — matriz estudiantes × sesiones + KPIs
import { supabase } from './supabase-client.js';
import { toast } from './toast.js';
import { loadXLSX } from './xlsx-loader.js';

let students = [], sessions = [], grades = [], groups = [], memberships = [];
let courseId = null;

const STATUS_COLORS = {
  P: 'chip-green',
  T: 'chip-yellow',
  A: 'chip-red',
};

export async function mountConsolidadoAsistencia(root, store){
  courseId = store.activeCourse.id;
  root.innerHTML = `
    <div class="card">
      <div class="card-row" style="justify-content:space-between">
        <h2>📋 Consolidado de Asistencia — ${escape(store.activeCourse.name)}</h2>
        <button class="btn btn-cyan" id="ca-export">📥 Exportar Excel</button>
      </div>
    </div>

    <details class="acc acc-block" id="ca-kpis-acc" open>
      <summary>
        <span class="acc-label">📊 <span id="ca-kpis-summary-text">Resumen</span></span>
      </summary>
      <div id="ca-kpis" style="margin-top:10px"></div>
    </details>

    <div class="card">
      <div class="card-row" style="margin-bottom:10px">
        <input type="text" id="ca-search" placeholder="🔍 Buscar estudiante…" style="max-width:280px">
        <select id="ca-filter" style="max-width:200px">
          <option value="all">Todos</option>
          <option value="risk">En riesgo (3+ fallas)</option>
          <option value="attention">En atención (1-2 fallas)</option>
          <option value="clean">Sin fallas</option>
        </select>
        <span id="ca-count" style="margin-left:auto;font-size:12px;color:var(--ean-gray)"></span>
      </div>
      <div id="ca-table"><p class="empty-state">Cargando…</p></div>
    </div>
  `;

  document.getElementById('ca-search').oninput = e => render(e.target.value, document.getElementById('ca-filter').value);
  document.getElementById('ca-filter').onchange = e => render(document.getElementById('ca-search').value, e.target.value);
  document.getElementById('ca-export').onclick = () => exportExcel(store.activeCourse.name);

  await loadAll();
  render('', 'all');
}

async function loadAll(){
  const [stuR, sesR, grpR, memR] = await Promise.all([
    supabase.from('v5_students').select('id, cedula, name').eq('course_id', courseId).order('name'),
    supabase.from('v5_activities').select('*').eq('course_id', courseId).eq('type','attendance').order('date',{ascending:true,nullsFirst:false}),
    supabase.from('v5_groups').select('id, name').eq('course_id', courseId),
    supabase.from('v5_group_members').select('group_id, student_id'),
  ]);
  students = stuR.data || [];
  sessions = sesR.data || [];
  groups = grpR.data || [];
  memberships = memR.data || [];

  if (sessions.length){
    const ids = sessions.map(s=>s.id);
    const { data } = await supabase.from('v5_grades').select('*').in('activity_id', ids);
    grades = data || [];
  } else { grades = []; }
}

function statusOf(sessionId, studentId){
  return grades.find(g => g.activity_id === sessionId && g.student_id === studentId)?.status || null;
}

function studentStats(studentId){
  let p=0, t=0, a=0, sin=0;
  sessions.forEach(s => {
    const st = statusOf(s.id, studentId);
    if (st==='P') p++; else if (st==='T') t++; else if (st==='A') a++; else sin++;
  });
  const totalScored = p + t + a;
  // % asistencia = (presentes + tardes) / total marcadas. Tarde cuenta como asistencia.
  const pct = totalScored > 0 ? Math.round((p + t) / totalScored * 100) : 0;
  const pPct = totalScored > 0 ? Math.round(p / totalScored * 100) : 0;
  const tPct = totalScored > 0 ? Math.round(t / totalScored * 100) : 0;
  const aPct = totalScored > 0 ? Math.round(a / totalScored * 100) : 0;
  return { p, t, a, sin, pct, pPct, tPct, aPct };
}

function groupOf(studentId){
  const m = memberships.find(mm => mm.student_id === studentId);
  if (!m) return null;
  return groups.find(g => g.id === m.group_id);
}

function calcKpis(){
  const totalSessions = sessions.length;
  let sumPct = 0, totalFallas = 0, atencion = 0, riesgo = 0, sinFallas = 0;
  students.forEach(s => {
    const st = studentStats(s.id);
    sumPct += st.pct;
    totalFallas += st.a;
    if (st.a === 0) sinFallas++;
    else if (st.a >= 3) riesgo++;
    else if (st.a >= 1) atencion++;
  });
  const avgPct = students.length > 0 ? Math.round(sumPct / students.length) : 0;
  return { totalSessions, avgPct, totalFallas, atencion, riesgo, sinFallas };
}

function render(searchTerm, filter){
  const k = calcKpis();
  // Resumen corto en summary del acordeón
  const sumText = document.getElementById('ca-kpis-summary-text');
  if (sumText){
    sumText.innerHTML = `Resumen — ${k.totalSessions} sesiones · ${k.avgPct}% promedio · ${k.totalFallas} fallas · <span style="color:var(--red)">${k.riesgo} en riesgo</span>`;
  }
  document.getElementById('ca-kpis').innerHTML = `
    <div class="card" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:0">
      ${kpiCard('SESIONES REGISTRADAS', k.totalSessions, 'var(--ean-blue)')}
      ${kpiCard('% ASISTENCIA PROMEDIO', k.avgPct + '%', k.avgPct >= 80 ? 'var(--green)' : k.avgPct >= 60 ? 'var(--yellow)' : 'var(--red)')}
      ${kpiCard('TOTAL FALLAS ACUM.', k.totalFallas, 'var(--ean-dark)')}
      ${kpiCard('⚠️ EN ATENCIÓN (1-2)', k.atencion, 'var(--yellow)')}
      ${kpiCard('🔴 EN RIESGO (3+)', k.riesgo, 'var(--red)')}
      ${kpiCard('✅ SIN FALLAS', k.sinFallas, 'var(--green)')}
    </div>
  `;

  if (!students.length){
    document.getElementById('ca-table').innerHTML = `<p class="empty-state">Sin estudiantes en este curso.</p>`;
    return;
  }
  if (!sessions.length){
    document.getElementById('ca-table').innerHTML = `<p class="empty-state">Sin sesiones de asistencia. Registra una en 📅 Asistencia.</p>`;
    return;
  }

  // Filtrar
  const term = searchTerm.toLowerCase();
  const filtered = students.filter(s => {
    if (term && !s.name.toLowerCase().includes(term) && !s.cedula.includes(term)) return false;
    const st = studentStats(s.id);
    if (filter === 'risk' && st.a < 3) return false;
    if (filter === 'attention' && (st.a < 1 || st.a > 2)) return false;
    if (filter === 'clean' && st.a > 0) return false;
    return true;
  });

  document.getElementById('ca-count').textContent = `Mostrando ${filtered.length} de ${students.length} estudiantes`;

  document.getElementById('ca-table').innerHTML = `
    <details class="acc acc-block" open>
      <summary>
        <span class="acc-label">👥 Estudiantes (${filtered.length}${filtered.length!==students.length?' de '+students.length:''})</span>
      </summary>
      <div class="tbl-wrap" style="max-height:70vh;margin-top:10px">
      <table>
        <thead>
          <tr>
            <th style="position:sticky;left:0;top:0;background:var(--ean-light);z-index:3;width:32px">#</th>
            <th style="position:sticky;left:32px;top:0;background:var(--ean-light);z-index:3;min-width:200px;max-width:200px">Estudiante</th>
            <th style="position:sticky;left:232px;top:0;background:var(--ean-light);z-index:3;min-width:110px;max-width:110px">Grupo</th>
            ${sessions.map(s => `<th class="num" style="position:sticky;top:0;background:var(--ean-light);z-index:2;min-width:60px;font-size:10px" title="${escapeAttr(s.topic||'')}">${escape(s.date||'')}</th>`).join('')}
            <th class="num" style="position:sticky;top:0;background:#E8F5E9;color:var(--green);z-index:2;min-width:75px">✅<br>P %</th>
            <th class="num" style="position:sticky;top:0;background:#FFFDE7;color:#E65100;z-index:2;min-width:75px">⏰<br>T %</th>
            <th class="num" style="position:sticky;top:0;background:#FFEBEE;color:var(--red);z-index:2;min-width:75px">❌<br>A %</th>
            <th class="num" style="position:sticky;top:0;background:#E3F2FD;color:var(--ean-blue);z-index:2;min-width:90px">% asistencia</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((s,i) => {
            const st = studentStats(s.id);
            const grp = groupOf(s.id);
            const pctCls = st.pct >= 80 ? 'chip-green' : st.pct >= 60 ? 'chip-yellow' : 'chip-red';
            return `
            <tr>
              <td class="num" style="position:sticky;left:0;background:#fff;z-index:1;width:32px">${i+1}</td>
              <td style="position:sticky;left:32px;background:#fff;z-index:1;min-width:200px;max-width:200px;overflow:hidden">
                <b style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block" title="${escapeAttr(s.name)}">${escape(s.name)}</b>
                <div style="font-size:10px;color:var(--ean-gray)"><code>${escape(s.cedula)}</code></div>
              </td>
              <td style="position:sticky;left:232px;background:#fff;z-index:1;min-width:110px;max-width:110px">${grp ? `<span class="chip" style="font-size:10px">${escape(grp.name)}</span>` : '—'}</td>
              ${sessions.map(sess => {
                const status = statusOf(sess.id, s.id);
                if (!status) return `<td class="num" style="color:var(--ean-gray)">—</td>`;
                return `<td class="num"><span class="chip ${STATUS_COLORS[status]}" style="font-size:10px;padding:2px 6px;font-weight:700">${status}</span></td>`;
              }).join('')}
              <td class="num" style="background:#E8F5E9;font-weight:700;color:var(--green)">${st.p}<br><small style="font-weight:400;font-size:10px">${st.pPct}%</small></td>
              <td class="num" style="background:#FFFDE7;font-weight:700;color:#E65100">${st.t}<br><small style="font-weight:400;font-size:10px">${st.tPct}%</small></td>
              <td class="num" style="background:#FFEBEE;font-weight:700;color:var(--red)">${st.a}<br><small style="font-weight:400;font-size:10px">${st.aPct}%</small></td>
              <td class="num" style="background:#E3F2FD"><span class="chip ${pctCls}" style="font-weight:700">${st.pct}%</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>
    </details>
    <div style="font-size:11px;color:var(--ean-gray);margin-top:8px">
      💡 <b>% asistencia</b> = (Presentes + Tardes) / sesiones marcadas. Las llegadas tarde cuentan como asistencia.
      Sesiones sin marca no entran al cálculo. Pasa el mouse sobre cada fecha para ver el tema de la sesión.
    </div>
  `;
}

function kpiCard(label, value, color){
  return `
    <div style="background:#fff;border:1px solid var(--ean-border);border-left:4px solid ${color};border-radius:8px;padding:10px 14px;text-align:center">
      <div style="font-size:10px;color:var(--ean-gray);text-transform:uppercase;letter-spacing:.5px;font-weight:700">${label}</div>
      <div style="font-size:24px;font-weight:900;color:${color};margin-top:2px">${value}</div>
    </div>
  `;
}

async function exportExcel(courseName){
  if (!students.length || !sessions.length){ toast('Nada para exportar','error'); return; }
  let XLSX;
  try { XLSX = await loadXLSX(); }
  catch(e){ toast(e.message,'error'); return; }

  const headers = ['#', 'Cédula', 'Estudiante', 'Grupo', ...sessions.map(s => s.date), 'P', 'T', 'A', '% Asistencia'];
  const rows = students.map((s,i) => {
    const grp = groupOf(s.id);
    const row = [i+1, s.cedula, s.name, grp?.name || ''];
    sessions.forEach(sess => row.push(statusOf(sess.id, s.id) || ''));
    const st = studentStats(s.id);
    row.push(st.p, st.t, st.a, st.pct);
    return row;
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((h,i) => ({ wch: i===2 ? 32 : i===3 ? 16 : Math.max(h.length, 8) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Asistencia');
  const safeName = courseName.replace(/[^a-z0-9 ]/gi,'').substring(0, 25);
  const today = new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, `consolidado_asistencia_${safeName}_${today}.xlsx`);
  toast('Excel descargado','success');
}

const escape = s => String(s||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const escapeAttr = s => escape(s).replace(/"/g,'&quot;');
