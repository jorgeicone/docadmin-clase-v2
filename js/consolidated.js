// 📊 CONSOLIDADO — matriz de estudiantes × actividades + promedio ponderado + export
import { supabase } from './supabase-client.js';
import { toast } from './toast.js';

let students = [], activities = [], grades = [];
let courseId = null;

export async function mountConsolidated(root, store){
  courseId = store.activeCourse.id;
  root.innerHTML = `
    <div class="card">
      <div class="card-row" style="justify-content:space-between">
        <h2>📊 Consolidado de notas — ${escape(store.activeCourse.name)}</h2>
        <div style="display:flex;gap:8px">
          <button class="btn btn-out" id="c-refresh">🔄 Refrescar</button>
          <button class="btn btn-cyan" id="c-export">📥 Exportar Excel</button>
        </div>
      </div>
      <div id="c-summary" style="margin-top:8px;font-size:12px;color:var(--ean-gray)"></div>
    </div>

    <div class="card">
      <div id="c-table"><p class="empty-state">Cargando…</p></div>
    </div>
  `;

  document.getElementById('c-refresh').onclick = () => loadAndRender();
  document.getElementById('c-export').onclick = () => exportExcel(store.activeCourse.name);
  await loadAndRender();
}

async function loadAndRender(){
  const [stuR, actR] = await Promise.all([
    supabase.from('v5_students').select('id, cedula, name').eq('course_id', courseId).order('name'),
    supabase.from('v5_activities').select('*').eq('course_id', courseId).order('date',{ascending:true,nullsFirst:false}).order('created_at',{ascending:true}),
  ]);
  students = stuR.data || [];
  activities = actR.data || [];

  if (activities.length){
    const ids = activities.map(a=>a.id);
    const { data } = await supabase.from('v5_grades').select('*').in('activity_id', ids);
    grades = data || [];
  } else { grades = []; }

  const totalWeight = activities.reduce((s,a) => s + (a.weight||0), 0);
  document.getElementById('c-summary').innerHTML =
    `${students.length} estudiantes · ${activities.length} actividades · ${grades.length} notas registradas · Peso total: <b>${totalWeight}%</b>${totalWeight!==100 && totalWeight>0?' ⚠️ no suma 100%':''}`;

  render();
}

function gradeFor(activityId, studentId){
  return grades.find(g => g.activity_id===activityId && g.student_id===studentId);
}

function calcWeightedAvg(studentId){
  // Promedio ponderado escalado a la escala de cada actividad → 0-5 unificado
  let wpSum = 0, wSum = 0;
  activities.forEach(a => {
    if (!a.weight) return;
    const g = gradeFor(a.id, studentId);
    if (!g || g.value === null || g.value === undefined) return;
    const normalized = (g.value / a.max_points) * 5; // todo a escala 0-5
    wpSum += normalized * a.weight;
    wSum += a.weight;
  });
  return wSum > 0 ? wpSum/wSum : null;
}

function gradeColor(val, max){
  const pct = val / max;
  if (pct >= .85) return 'chip-green';
  if (pct >= .60) return 'chip-cyan';
  if (pct >= .40) return 'chip-yellow';
  return 'chip-red';
}

function render(){
  const div = document.getElementById('c-table');

  if (!students.length){
    div.innerHTML = `<p class="empty-state">Sin estudiantes en este curso.</p>`;
    return;
  }
  if (!activities.length){
    div.innerHTML = `<p class="empty-state">No hay actividades. Crea una desde 📝 Actividades y notas.</p>`;
    return;
  }

  div.innerHTML = `
    <div class="tbl-wrap" style="max-height:70vh">
      <table>
        <thead>
          <tr>
            <th style="position:sticky;left:0;background:var(--ean-light);z-index:2">#</th>
            <th style="position:sticky;left:32px;background:var(--ean-light);z-index:2;min-width:200px">Estudiante</th>
            ${activities.map(a => `
              <th class="num" style="min-width:90px" title="${escapeAttr(a.topic||'')}">
                ${escape(a.name)}
                <div style="font-size:9px;color:var(--ean-gray);font-weight:400">
                  /${a.max_points}${a.weight?` · ${a.weight}%`:''}
                </div>
              </th>
            `).join('')}
            <th class="num" style="min-width:90px;background:#FFF8E1">Promedio<br><small>(ponderado /5)</small></th>
          </tr>
        </thead>
        <tbody>
          ${students.map((s,i) => {
            const avg = calcWeightedAvg(s.id);
            const avgCls = avg!==null ? gradeColor(avg, 5) : '';
            return `
            <tr>
              <td class="num" style="position:sticky;left:0;background:#fff;z-index:1">${i+1}</td>
              <td style="position:sticky;left:32px;background:#fff;z-index:1">
                <b style="font-size:12px">${escape(s.name)}</b>
                <div style="font-size:10px;color:var(--ean-gray)"><code>${escape(s.cedula)}</code></div>
              </td>
              ${activities.map(a => {
                const g = gradeFor(a.id, s.id);
                if (!g || g.value === null || g.value === undefined){
                  return `<td class="num" style="color:var(--ean-gray)">—</td>`;
                }
                const cls = gradeColor(g.value, a.max_points);
                const tip = g.desglose ? `title="${escapeAttr(g.desglose)}"` : '';
                return `<td class="num"><span class="chip ${cls}" ${tip} style="font-size:11px;font-weight:700">${g.value}</span></td>`;
              }).join('')}
              <td class="num" style="background:#FFFDE7">
                ${avg!==null ? `<span class="chip ${avgCls}" style="font-weight:800">${avg.toFixed(2)}</span>` : '—'}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div style="font-size:11px;color:var(--ean-gray);margin-top:8px">
      💡 El promedio pondera cada actividad por su <b>%</b> y normaliza todas las escalas a 0-5. Las actividades sin peso no entran en el cálculo.
      Pasa el mouse sobre cada nota para ver el desglose.
    </div>
  `;
}

function exportExcel(courseName){
  if (!students.length || !activities.length){ toast('Nada para exportar','error'); return; }

  const headers = ['#', 'Cédula', 'Estudiante', ...activities.map(a => `${a.name} (/${a.max_points}${a.weight?', '+a.weight+'%':''})`), 'Promedio /5'];
  const rows = students.map((s,i) => {
    const row = [i+1, s.cedula, s.name];
    activities.forEach(a => {
      const g = gradeFor(a.id, s.id);
      row.push(g?.value ?? '');
    });
    const avg = calcWeightedAvg(s.id);
    row.push(avg!==null ? avg.toFixed(2) : '');
    return row;
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  // Auto-width
  ws['!cols'] = headers.map((h,i) => ({ wch: i===2 ? 32 : Math.max(h.length, 10) }));

  const wb = XLSX.utils.book_new();
  const safeName = courseName.replace(/[^a-z0-9 ]/gi,'').substring(0, 25);
  XLSX.utils.book_append_sheet(wb, ws, 'Consolidado');

  const today = new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, `consolidado_${safeName}_${today}.xlsx`);
  toast('Excel descargado','success');
}

const escape = s => String(s||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const escapeAttr = s => escape(s).replace(/"/g,'&quot;');
