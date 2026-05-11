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

  // Separar actividades: extras (sin peso) van PRIMERO, luego notas con peso
  const extrasActs   = activities.filter(a => !a.weight);
  const weightedActs = activities.filter(a => !!a.weight);
  const totalWeightCourse = weightedActs.reduce((a,b) => a + (b.weight || 0), 0);

  // Calcula los 4 sub-totales por estudiante
  function detailFor(studentId){
    let subExtras = 0, subNotas = 0;
    extrasActs.forEach(a => {
      const g = gradeFor(a.id, studentId);
      if (g?.value != null) subExtras += g.value;
    });
    weightedActs.forEach(a => {
      const g = gradeFor(a.id, studentId);
      if (g?.value != null && a.max_points > 0) subNotas += (g.value / a.max_points) * a.weight;
    });
    const total = subExtras + subNotas;
    const falta = Math.max(0, totalWeightCourse - subNotas);
    return { subExtras, subNotas, total, falta };
  }

  // Estilos de columnas (separación visual por bloque)
  const EXTRAS_BG = '#FFF3CD';            // oro suave
  const EXTRAS_BG_HEAD = '#FFE082';       // oro head
  const PESO_BG   = '#E0F7FA';            // cyan suave
  const PESO_BG_HEAD = '#80DEEA';         // cyan head
  const TOTAL_BG  = '#E8F5E9';            // verde
  const FALTA_BG  = '#FFEBEE';            // rojo

  div.innerHTML = `
    <div class="tbl-wrap" style="max-height:70vh">
      <table>
        <thead>
          <tr>
            <th style="position:sticky;left:0;top:0;background:var(--ean-light);z-index:3;width:32px">#</th>
            <th style="position:sticky;left:32px;top:0;background:var(--ean-light);z-index:3;min-width:220px;max-width:220px">Estudiante</th>

            ${extrasActs.map(a => `
              <th class="num" style="position:sticky;top:0;background:${EXTRAS_BG_HEAD};color:#6B4F00;z-index:2;min-width:90px" title="${escapeAttr(a.topic||'')}">
                ⭐ ${escape(a.name)}
                <div style="font-size:9px;color:#8B6914;font-weight:400">/${a.max_points} · EXTRA</div>
              </th>
            `).join('')}

            ${extrasActs.length > 0 ? `
              <th class="num" style="position:sticky;top:0;background:#FFD54F;color:#5D4500;z-index:2;min-width:90px;font-weight:800;border-left:2px solid #D4A017;border-right:2px solid #D4A017">
                Σ EXTRAS
                <div style="font-size:9px;font-weight:500">subtotal</div>
              </th>
            ` : ''}

            ${weightedActs.map(a => `
              <th class="num" style="position:sticky;top:0;background:${PESO_BG_HEAD};color:#006064;z-index:2;min-width:90px" title="${escapeAttr(a.topic||'')}">
                ${escape(a.name)}
                <div style="font-size:9px;color:#00838F;font-weight:400">/${a.max_points} · ${a.weight}%</div>
              </th>
            `).join('')}

            ${weightedActs.length > 0 ? `
              <th class="num" style="position:sticky;top:0;background:#4DD0E1;color:#004D40;z-index:2;min-width:90px;font-weight:800;border-left:2px solid #00838F;border-right:2px solid #00838F">
                Σ NOTAS
                <div style="font-size:9px;font-weight:500">/${totalWeightCourse}</div>
              </th>
            ` : ''}

            <th class="num" style="position:sticky;top:0;background:${TOTAL_BG};color:#1B5E20;z-index:2;min-width:100px;font-weight:800;border-left:2px solid var(--green)">
              🏆 TOTAL
              <div style="font-size:9px;font-weight:500">extras + notas</div>
            </th>
            <th class="num" style="position:sticky;top:0;background:${FALTA_BG};color:#B71C1C;z-index:2;min-width:90px;font-weight:800">
              ⚠️ FALTA
              <div style="font-size:9px;font-weight:500">para 100% notas</div>
            </th>
          </tr>
        </thead>
        <tbody>
          ${students.map((s,i) => {
            const d = detailFor(s.id);
            const subExtrasCell = Math.round(d.subExtras);
            const subNotasCls = totalWeightCourse > 0 ? gradeColor(d.subNotas, totalWeightCourse) : '';
            const totalCls = totalWeightCourse > 0 ? gradeColor(d.total, totalWeightCourse) : '';
            return `
            <tr>
              <td class="num" style="position:sticky;left:0;background:#fff;z-index:1;width:32px">${i+1}</td>
              <td style="position:sticky;left:32px;background:#fff;z-index:1;min-width:220px;max-width:220px;overflow:hidden">
                <b style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block" title="${escapeAttr(s.name)}">${escape(s.name)}</b>
                <div style="font-size:10px;color:var(--ean-gray)"><code>${escape(s.cedula)}</code></div>
              </td>

              ${extrasActs.map(a => {
                const g = gradeFor(a.id, s.id);
                if (!g || g.value === null || g.value === undefined){
                  return `<td class="num" style="color:var(--ean-gray);background:${EXTRAS_BG}">—</td>`;
                }
                const tip = g.desglose ? `title="${escapeAttr(g.desglose)}"` : '';
                return `<td class="num" style="background:${EXTRAS_BG}"><span class="chip chip-gold" ${tip} style="font-size:11px;font-weight:700">${g.value}</span></td>`;
              }).join('')}

              ${extrasActs.length > 0 ? `
                <td class="num" style="background:#FFD54F;border-left:2px solid #D4A017;border-right:2px solid #D4A017">
                  <span style="font-weight:800;color:#5D4500">${subExtrasCell}</span>
                </td>
              ` : ''}

              ${weightedActs.map(a => {
                const g = gradeFor(a.id, s.id);
                if (!g || g.value === null || g.value === undefined){
                  return `<td class="num" style="color:var(--ean-gray);background:${PESO_BG}">—</td>`;
                }
                const cls = gradeColor(g.value, a.max_points);
                const tip = g.desglose ? `title="${escapeAttr(g.desglose)}"` : '';
                return `<td class="num" style="background:${PESO_BG}"><span class="chip ${cls}" ${tip} style="font-size:11px;font-weight:700">${g.value}</span></td>`;
              }).join('')}

              ${weightedActs.length > 0 ? `
                <td class="num" style="background:#4DD0E1;border-left:2px solid #00838F;border-right:2px solid #00838F">
                  <span class="chip ${subNotasCls}" style="font-weight:800">${Math.round(d.subNotas)} / ${totalWeightCourse}</span>
                </td>
              ` : ''}

              <td class="num" style="background:${TOTAL_BG};border-left:2px solid var(--green)">
                <span class="chip ${totalCls}" style="font-weight:800;font-size:13px">${Math.round(d.total)}</span>
              </td>
              <td class="num" style="background:${FALTA_BG}">
                <span style="color:${d.falta > 0 ? '#B71C1C' : '#1B5E20'};font-weight:800">${Math.round(d.falta)}</span>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div style="font-size:11px;color:var(--ean-gray);margin-top:8px">
      💡 <b>Bloques</b>:
      <span style="background:${EXTRAS_BG};padding:1px 6px;border-radius:4px">⭐ EXTRAS</span> (puntos adicionales, suman tal cual) ·
      <span style="background:${PESO_BG};padding:1px 6px;border-radius:4px">NOTAS</span> (ponderadas al ${totalWeightCourse}% total) ·
      <span style="background:${TOTAL_BG};padding:1px 6px;border-radius:4px">🏆 TOTAL</span> = extras + notas ·
      <span style="background:${FALTA_BG};padding:1px 6px;border-radius:4px">⚠️ FALTA</span> = ${totalWeightCourse}% − Σ notas (cuánto le falta al estudiante para llegar al techo del curso).
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
