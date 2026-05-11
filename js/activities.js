// CRUD de actividades + visualización de notas asignadas
import { supabase } from './supabase-client.js';
import { toast } from './toast.js';
import { ACTIVITY_TYPES, sustLabel } from './config.js';

let activities = [], grades = [], students = [], groups = [], memberships = [];

export async function mountActivities(root, store){
  const courseId = store.activeCourse.id;
  root.innerHTML = `
    <div class="card">
      <div class="card-row" style="justify-content:space-between">
        <h2>📝 Actividades — ${escape(store.activeCourse.name)}</h2>
        <button class="btn btn-cyan" id="btn-new-act">＋ Nueva actividad</button>
      </div>
      <div id="act-info" style="margin-top:8px;font-size:12px;color:var(--ean-gray)"></div>
    </div>

    <div id="act-list"></div>

    <div id="act-modal-host"></div>
  `;
  document.getElementById('btn-new-act').onclick = () => openActivityModal(courseId, null);
  await loadAll(courseId);
  renderList(courseId);
}

async function loadAll(courseId){
  const [actR, stuR, grpR] = await Promise.all([
    supabase.from('v5_activities').select('*').eq('course_id', courseId).order('date',{ascending:false,nullsFirst:false}).order('created_at',{ascending:false}),
    supabase.from('v5_students').select('id, cedula, name').eq('course_id', courseId).order('name'),
    supabase.from('v5_groups').select('id, name, leader_student_id').eq('course_id', courseId).order('name'),
  ]);
  activities = actR.data || [];
  students = stuR.data || [];
  groups = grpR.data || [];

  if (groups.length){
    const grpIds = groups.map(g => g.id);
    const { data: memData } = await supabase.from('v5_group_members').select('group_id, student_id').in('group_id', grpIds);
    memberships = memData || [];
  } else { memberships = []; }

  if (activities.length){
    const ids = activities.map(a=>a.id);
    const { data } = await supabase.from('v5_grades').select('*').in('activity_id', ids);
    grades = data || [];
  } else {
    grades = [];
  }

  document.getElementById('act-info').textContent =
    `${activities.length} actividad${activities.length===1?'':'es'} · ${grades.length} nota${grades.length===1?'':'s'} registrada${grades.length===1?'':'s'}`;
}

function gradesOf(activityId){ return grades.filter(g => g.activity_id === activityId); }

function renderList(courseId){
  const list = document.getElementById('act-list');
  if (!activities.length){
    list.innerHTML = `<div class="card"><p class="empty-state">No hay actividades aún. Crea la primera o usa <b>🤖 Ingesta IA</b> para subir un archivo de notas.</p></div>`;
    return;
  }
  list.innerHTML = activities.map(a => {
    const gs = gradesOf(a.id);
    const typeLabel = ACTIVITY_TYPES[a.type] || a.type;
    return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:12px">
        <div style="flex:1">
          <h3>${escape(a.name)} <span class="chip" style="font-size:10px">${escape(typeLabel)}</span> ${a.weight?`<span class="chip chip-cyan" style="font-size:10px">${a.weight}%</span>`:''}</h3>
          <div style="font-size:11px;color:var(--ean-gray);margin-top:2px">
            ${a.date?'📅 '+a.date+' · ':''}
            Escala: 0-${a.max_points} ·
            ${gs.length} nota${gs.length===1?'':'s'} registrada${gs.length===1?'':'s'}
          </div>
          ${a.topic?`<div style="font-size:12px;margin-top:4px"><b>Tema:</b> ${escape(a.topic)}</div>`:''}
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-xs btn-out" data-toggle="${a.id}">${gs.length?'👁 Ver notas':'＋ Agregar manual'}</button>
          <button class="btn btn-xs btn-out" data-edit="${a.id}">✏️</button>
          <button class="btn btn-xs btn-danger" data-del="${a.id}">🗑</button>
        </div>
      </div>
      <div id="grades-${a.id}" style="display:none;margin-top:14px"></div>
    </div>
    `;
  }).join('');

  list.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>{
    const id = b.dataset.toggle;
    const div = document.getElementById('grades-'+id);
    if (div.style.display === 'none'){
      div.style.display = 'block';
      renderGradesEditor(id, courseId);
      b.textContent = '✕ Cerrar';
    } else {
      div.style.display = 'none';
      const gs = gradesOf(id);
      b.textContent = gs.length?'👁 Ver notas':'＋ Agregar manual';
    }
  });
  list.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{
    const a = activities.find(x=>x.id===b.dataset.edit);
    openActivityModal(courseId, a);
  });
  list.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
    const a = activities.find(x=>x.id===b.dataset.del);
    if (!confirm(`¿Eliminar "${a.name}"? Se eliminarán también sus ${gradesOf(a.id).length} notas.`)) return;
    const { error } = await supabase.from('v5_activities').delete().eq('id', a.id);
    if (error) toast('Error: '+error.message,'error');
    else { toast('Eliminada'); await loadAll(courseId); renderList(courseId); }
  });
}

function renderGradesEditor(activityId, courseId){
  const a = activities.find(x=>x.id===activityId);
  const div = document.getElementById('grades-'+activityId);
  const gs = gradesOf(activityId);
  const gradeByStudent = Object.fromEntries(gs.map(g => [g.student_id, g]));

  // Si es nota GRUPAL y hay grupos creados → editor POR GRUPO
  if (a.type === 'group' && groups.length > 0){
    renderGradesEditorByGroup(activityId, courseId);
    return;
  }

  div.innerHTML = `
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>#</th><th>Estudiante</th>
          <th class="num" style="width:90px">Nota (0-${a.max_points})</th>
          <th>Desglose / Observación</th>
          <th class="num" style="width:80px">Origen</th>
        </tr></thead>
        <tbody>
          ${students.map((s,i) => {
            const g = gradeByStudent[s.id];
            return `
            <tr>
              <td class="num">${i+1}</td>
              <td><b>${escape(s.name)}</b><div style="font-size:10px;color:var(--ean-gray)"><code>${escape(s.cedula)}</code></div></td>
              <td class="num">
                <input type="number" class="input-grade" min="0" max="${a.max_points}" step="0.1"
                  value="${g?.value??''}" data-sid="${s.id}" placeholder="—">
              </td>
              <td>
                <input type="text" class="obs-input" data-obs="${s.id}" value="${escapeAttr(g?.desglose || g?.observation || '')}" placeholder="Opcional…" style="width:100%;font-size:12px">
              </td>
              <td class="num"><span class="chip" style="font-size:10px">${g?.source||'—'}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:10px;text-align:right">
      <button class="btn btn-cyan" id="save-grades-${activityId}">💾 Guardar cambios</button>
    </div>
  `;

  document.getElementById('save-grades-'+activityId).onclick = async () => {
    const updates = [];
    div.querySelectorAll('input[data-sid]').forEach(inp => {
      const sid = inp.dataset.sid;
      const valStr = inp.value.trim();
      const val = valStr === '' ? null : parseFloat(valStr);
      const obs = div.querySelector(`input[data-obs="${sid}"]`).value.trim() || null;
      const existing = gradeByStudent[sid];
      if (val === null && !obs && !existing) return; // nada
      if (val === null && !obs && existing){
        updates.push({ delete: existing.id });
        return;
      }
      const payload = {
        activity_id: activityId,
        student_id: sid,
        value: val,
        desglose: obs,
        source: existing?.source || 'manual',
      };
      updates.push(payload);
    });

    const dels = updates.filter(u => u.delete).map(u => u.delete);
    const upserts = updates.filter(u => !u.delete);

    if (dels.length){
      await supabase.from('v5_grades').delete().in('id', dels);
    }
    if (upserts.length){
      const { error } = await supabase.from('v5_grades').upsert(upserts, { onConflict: 'activity_id,student_id' });
      if (error){ toast('Error: '+error.message,'error'); return; }
    }
    toast(`✅ ${upserts.length} nota${upserts.length===1?'':'s'} guardada${upserts.length===1?'':'s'}`,'success');
    await loadAll(courseId);
    renderList(courseId);
  };
}

// Editor de notas para actividades de tipo 'group' (nota grupal):
// muestra UNA fila por grupo; al guardar, propaga la nota a todos los miembros.
function renderGradesEditorByGroup(activityId, courseId){
  const a = activities.find(x=>x.id===activityId);
  const div = document.getElementById('grades-'+activityId);
  const gs = gradesOf(activityId);

  // Helper: miembros de un grupo
  const memsOf = (gid) => memberships
    .filter(m => m.group_id === gid)
    .map(m => students.find(s => s.id === m.student_id))
    .filter(Boolean);

  // Nota actual del grupo: tomar el primer grade con ese group_id (todos tienen el mismo valor)
  const gradeByGroup = {};
  groups.forEach(g => {
    const sample = gs.find(x => x.group_id === g.id);
    if (sample) gradeByGroup[g.id] = sample;
  });

  div.innerHTML = `
    <div style="background:#E0F7FA;padding:10px 14px;border-radius:8px;font-size:12px;margin-bottom:10px;border-left:3px solid var(--ean-cyan)">
      🧑‍🤝‍🧑 <b>Nota grupal</b>: cada grupo recibe UNA nota que se aplica a todos sus integrantes.
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>#</th>
          <th>Grupo</th>
          <th class="num" style="width:110px">Nota (0-${a.max_points})</th>
          <th>Integrantes / Observación</th>
        </tr></thead>
        <tbody>
          ${groups.map((g,i) => {
            const grade = gradeByGroup[g.id];
            const mems = memsOf(g.id);
            const leader = students.find(s => s.id === g.leader_student_id);
            return `
            <tr>
              <td class="num">${i+1}</td>
              <td>
                <b>${escape(g.name)}</b>
                <div style="font-size:10px;color:var(--ean-gray);margin-top:2px">${mems.length} integrante${mems.length===1?'':'s'}${leader?' · 👑 '+escape(leader.name):''}</div>
              </td>
              <td class="num">
                <input type="number" class="input-grade" min="0" max="${a.max_points}" step="0.1"
                  value="${grade?.value??''}" data-gid="${g.id}" placeholder="—" style="font-weight:700">
              </td>
              <td>
                <input type="text" class="obs-input" data-obs-gid="${g.id}" value="${escapeAttr(grade?.desglose || grade?.observation || '')}" placeholder="Observación grupal…" style="width:100%;font-size:12px">
                <details style="margin-top:4px">
                  <summary style="cursor:pointer;font-size:10px;color:var(--ean-cyan)">Ver ${mems.length} integrante${mems.length===1?'':'s'}</summary>
                  <div style="margin-top:4px;font-size:10px;color:var(--ean-gray)">${mems.map(m => escape(m.name)).join(' · ') || 'Sin integrantes'}</div>
                </details>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:10px;text-align:right">
      <button class="btn btn-cyan" id="save-grades-${activityId}">💾 Guardar notas grupales</button>
    </div>
  `;

  document.getElementById('save-grades-'+activityId).onclick = async () => {
    const rowsToUpsert = [];
    const groupsToClear = [];

    div.querySelectorAll('input[data-gid]').forEach(inp => {
      const gid = inp.dataset.gid;
      const valStr = inp.value.trim();
      const val = valStr === '' ? null : parseFloat(valStr);
      const obs = div.querySelector(`input[data-obs-gid="${gid}"]`).value.trim() || null;
      const mems = memsOf(gid);
      if (val === null && !obs){
        // Si había nota previa de este grupo, borrar
        if (gradeByGroup[gid]) groupsToClear.push(gid);
        return;
      }
      // Una grade por cada miembro con el mismo valor
      mems.forEach(m => {
        rowsToUpsert.push({
          activity_id: activityId,
          student_id: m.id,
          group_id: gid,
          value: val,
          desglose: obs,
          source: 'manual',
        });
      });
    });

    // Borrar notas de grupos que quedaron vacíos
    for (const gid of groupsToClear){
      await supabase.from('v5_grades').delete().eq('activity_id', activityId).eq('group_id', gid);
    }

    if (rowsToUpsert.length){
      // Primero borrar grades previas de los grupos que vamos a actualizar (por si el grupo cambió de integrantes)
      const affectedGids = [...new Set(rowsToUpsert.map(r => r.group_id))];
      for (const gid of affectedGids){
        await supabase.from('v5_grades').delete().eq('activity_id', activityId).eq('group_id', gid);
      }
      const { error } = await supabase.from('v5_grades').upsert(rowsToUpsert, { onConflict: 'activity_id,student_id' });
      if (error){ toast('Error: '+error.message,'error'); return; }
    }

    const gruposCount = new Set(rowsToUpsert.map(r => r.group_id)).size;
    toast(`✅ ${gruposCount} grupo${gruposCount===1?'':'s'} calificado${gruposCount===1?'':'s'} (${rowsToUpsert.length} notas registradas en total)`,'success');
    await loadAll(courseId);
    renderList(courseId);
  };
}

function openActivityModal(courseId, activity){
  const isEdit = !!activity;
  const host = document.getElementById('act-modal-host');
  host.innerHTML = `
    <div class="modal-bg">
      <div class="modal" style="max-width:560px">
        <h2>${isEdit?'✏️ Editar':'＋ Nueva'} actividad</h2>
        <div class="field">
          <label>Nombre *</label>
          <input id="a-name" value="${escapeAttr(activity?.name||'')}" placeholder="Ej: Sustentación 1, Taller 2, Parcial">
        </div>
        <div class="grid-2">
          <div class="field">
            <label>Tipo *</label>
            <select id="a-type">
              ${Object.entries(ACTIVITY_TYPES).map(([k,v]) =>
                `<option value="${k}" ${activity?.type===k?'selected':''}>${v}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Escala máxima</label>
            <input id="a-max" type="number" step="0.1" value="${activity?.max_points??5}" min="1">
          </div>
          <div class="field">
            <label>Peso (% del curso)</label>
            <input id="a-weight" type="number" step="1" value="${activity?.weight??''}" min="0" max="100" placeholder="Opcional">
          </div>
          <div class="field">
            <label>Fecha</label>
            <input id="a-date" type="date" value="${activity?.date||''}">
          </div>
        </div>
        <div class="field">
          <label>Tema (opcional)</label>
          <input id="a-topic" value="${escapeAttr(activity?.topic||'')}">
        </div>
        <div class="modal-actions">
          <button class="btn btn-out" id="m-cancel">Cancelar</button>
          <button class="btn" id="m-save">Guardar</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('m-cancel').onclick = () => host.innerHTML='';
  document.getElementById('m-save').onclick = async () => {
    const payload = {
      name: document.getElementById('a-name').value.trim(),
      type: document.getElementById('a-type').value,
      max_points: parseFloat(document.getElementById('a-max').value) || 5,
      weight: parseFloat(document.getElementById('a-weight').value) || null,
      date: document.getElementById('a-date').value || null,
      topic: document.getElementById('a-topic').value.trim() || null,
    };
    if (!payload.name){ toast('Nombre requerido','error'); return; }

    let r;
    if (isEdit) r = await supabase.from('v5_activities').update(payload).eq('id', activity.id);
    else { payload.course_id = courseId; r = await supabase.from('v5_activities').insert(payload); }
    if (r.error){ toast('Error: '+r.error.message,'error'); return; }
    toast(isEdit?'Actualizada':'Creada','success');
    host.innerHTML='';
    await loadAll(courseId);
    renderList(courseId);
  };
}

const escape = s => String(s||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const escapeAttr = s => escape(s).replace(/"/g,'&quot;');
