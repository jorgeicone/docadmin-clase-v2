// 📊 CONSOLIDADO — matriz de estudiantes × actividades + promedio ponderado + export
import { supabase } from './supabase-client.js';
import { toast } from './toast.js';
import { loadXLSX } from './xlsx-loader.js';

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
      <details class="acc acc-block" open style="margin-top:8px">
        <summary>
          <span class="acc-label">📊 <span id="c-summary"></span></span>
        </summary>
        <div id="c-summary-extra" style="margin-top:6px;font-size:11px;color:var(--ean-gray)">
          💡 (asistencia y sustentaciones se cuentan aparte; las sustentaciones sí entran si tienen peso)
        </div>
      </details>
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
  // Feedback visible al refrescar
  const refBtn = document.getElementById('c-refresh');
  if (refBtn){ refBtn.disabled = true; refBtn.textContent = '🔄 Refrescando…'; }

  const [stuR, actR] = await Promise.all([
    supabase.from('v5_students').select('id, cedula, name').eq('course_id', courseId).order('name'),
    // EXCLUIR asistencia: el consolidado de notas solo muestra notas, no asistencia
    supabase.from('v5_activities').select('*').eq('course_id', courseId).neq('type','attendance').order('date',{ascending:true,nullsFirst:false}).order('created_at',{ascending:true}),
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
    `${students.length} estudiantes · ${activities.length} actividades · ${grades.length} notas · Peso: <b>${totalWeight}%</b>${totalWeight!==100 && totalWeight>0?' ⚠️ no suma 100%':''}`;

  render();

  if (refBtn){ refBtn.disabled = false; refBtn.textContent = '🔄 Refrescar'; toast('Datos actualizados','success'); }
}

function gradeFor(activityId, studentId){
  return grades.find(g => g.activity_id===activityId && g.student_id===studentId);
}

function calcAccumulated(studentId){
  // Acumulativa = suma de:
  //   • Actividades CON peso: (nota/max) × peso%   (cuentan al divisor)
  //   • Actividades SIN peso: la nota tal cual     (suman como EXTRA, NO al divisor)
  // Resultado: el divisor solo refleja los pesos obligatorios calificados;
  // los extras pueden empujar la nota POR ENCIMA del máximo.
  let acumulado = 0, maxPosible = 0;
  activities.forEach(a => {
    const g = gradeFor(a.id, studentId);
    if (!g || g.value === null || g.value === undefined) return;
    if (a.weight){
      acumulado += (g.value / a.max_points) * a.weight;
      maxPosible += a.weight;
    } else {
      acumulado += g.value;          // suma como extra
      // maxPosible NO se incrementa — los extras no cuentan al divisor
    }
  });
  return { acumulado, maxPosible };
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
            <th style="position:sticky;left:0;top:0;background:var(--ean-light);z-index:3;width:32px">#</th>
            <th style="position:sticky;left:32px;top:0;background:var(--ean-light);z-index:3;min-width:220px;max-width:220px">Estudiante</th>
            ${activities.map(a => `
              <th class="num" style="position:sticky;top:0;background:var(--ean-light);z-index:2;min-width:90px" title="${escapeAttr(a.topic||'')}">
                ${escape(a.name)}
                <div style="font-size:9px;color:var(--ean-gray);font-weight:400">
                  /${a.max_points}${a.weight?` · ${a.weight}%`:''}
                </div>
              </th>
            `).join('')}
            <th class="num" style="position:sticky;top:0;z-index:2;min-width:110px;background:#FFF8E1">Acumulado<br><small>(pesos + extras)</small></th>
          </tr>
        </thead>
        <tbody>
          ${students.map((s,i) => {
            const { acumulado, maxPosible } = calcAccumulated(s.id);
            const acumCls = maxPosible > 0 ? gradeColor(acumulado, maxPosible) : '';
            return `
            <tr>
              <td class="num" style="position:sticky;left:0;background:#fff;z-index:1;width:32px">${i+1}</td>
              <td style="position:sticky;left:32px;background:#fff;z-index:1;min-width:220px;max-width:220px;overflow:hidden">
                <b style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block" title="${escapeAttr(s.name)}">${escape(s.name)}</b>
                <div style="font-size:10px;color:var(--ean-gray)"><code>${escape(s.cedula)}</code></div>
              </td>
              ${activities.map(a => {
                const g = gradeFor(a.id, s.id);
                if (!g || g.value === null || g.value === undefined){
                  return `<td class="num" style="color:var(--ean-gray)">—</td>`;
                }
                // Actividades sin peso = puntos extras → siempre color oro
                // (cualquier punto extra es positivo, no debe verse como mala nota)
                const cls = !a.weight ? 'chip-gold' : gradeColor(g.value, a.max_points);
                const tip = g.desglose ? `title="${escapeAttr(g.desglose)}"` : '';
                return `<td class="num"><span class="chip ${cls}" ${tip} style="font-size:11px;font-weight:700">${g.value}</span></td>`;
              }).join('')}
              <td class="num" style="background:#FFFDE7">
                ${maxPosible > 0
                  ? `<span class="chip ${acumCls}" style="font-weight:800">${acumulado.toFixed(2)} / ${maxPosible}</span>`
                  : '—'}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div style="font-size:11px;color:var(--ean-gray);margin-top:8px">
      💡 <b>Acumulado X / Y</b>: <b>Y</b> = suma de los pesos calificados (solo obligatorias) ·
      <b>X</b> = aportes ponderados <i>+ puntos extras</i> (los extras pueden empujar X por encima de Y).
      Ejemplo: nota 19/20 con peso 20% (=19) + 2 puntos extras = <b>21 / 20</b>.
    </div>
  `;
}

async function exportExcel(courseName){
  if (!students.length || !activities.length){ toast('Nada para exportar','error'); return; }
  let XLSX;
  try { XLSX = await loadXLSX(); }
  catch(e){ toast(e.message,'error'); return; }

  const headers = ['#', 'Cédula', 'Estudiante', ...activities.map(a => `${a.name} (/${a.max_points}${a.weight?', '+a.weight+'%':' EXTRA'})`), 'Acumulado', 'Máximo posible'];
  const rows = students.map((s,i) => {
    const row = [i+1, s.cedula, s.name];
    activities.forEach(a => {
      const g = gradeFor(a.id, s.id);
      row.push(g?.value ?? '');
    });
    const { acumulado, maxPosible } = calcAccumulated(s.id);
    row.push(maxPosible > 0 ? Number(acumulado.toFixed(2)) : '');
    row.push(maxPosible > 0 ? maxPosible : '');
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
