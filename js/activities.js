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

  // B1: reparar grades huérfanas (group_id NULL en actividades grupales) reasignándolas
  //     al grupo actual del estudiante. Esto cubre el caso "actividad creada individual,
  //     cambiada después a grupal" donde las grades quedaron sin grupo.
  await repairOrphanGroupGrades();

  document.getElementById('act-info').textContent =
    `${activities.length} actividad${activities.length===1?'':'es'} · ${grades.length} nota${grades.length===1?'':'s'} registrada${grades.length===1?'':'s'}`;
}

async function repairOrphanGroupGrades(){
  if (!grades.length || !memberships.length) return;
  const stuToGroup = {};
  memberships.forEach(m => { stuToGroup[m.student_id] = m.group_id; });
  const groupActIds = new Set(activities.filter(a => a.type === 'group').map(a => a.id));
  const orphans = grades.filter(g => !g.group_id && groupActIds.has(g.activity_id) && stuToGroup[g.student_id]);
  if (!orphans.length) return;
  const ops = orphans.map(o =>
    supabase.from('v5_grades').update({ group_id: stuToGroup[o.student_id] }).eq('id', o.id)
  );
  const results = await Promise.all(ops);
  const failed = results.filter(r => r.error).length;
  if (failed) console.warn(`[reparación] ${failed}/${orphans.length} grades no pudieron reasignarse`);
  orphans.forEach(o => { if (stuToGroup[o.student_id]) o.group_id = stuToGroup[o.student_id]; });
  console.info(`[reparación] ${orphans.length - failed} grade(s) huérfana(s) reasignada(s) a su grupo.`);
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
                <input type="number" class="input-grade" min="0" max="${a.max_points}" step="${a.max_points <= 1 ? '1' : '0.1'}"
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

    // B10: si vas a borrar notas, confirmar
    if (dels.length){
      const delNames = dels.map(id => {
        const g = grades.find(x => x.id === id);
        const s = students.find(x => x.id === g?.student_id);
        return s?.name || '?';
      });
      const ok = confirm(`⚠ Vas a BORRAR la nota de ${dels.length} estudiante${dels.length===1?'':'s'}:\n\n${delNames.slice(0,10).join('\n')}${delNames.length>10?`\n…y ${delNames.length-10} más`:''}\n\n¿Continuar?`);
      if (!ok){ toast('Borrado cancelado','info'); return; }
      await supabase.from('v5_grades').delete().in('id', dels);
    }
    if (upserts.length){
      const { error } = await supabase.from('v5_grades').upsert(upserts, { onConflict: 'activity_id,student_id' });
      if (error){ toast('Error: '+error.message,'error'); return; }
    }
    // B3: toast honesto
    if (!upserts.length && !dels.length){
      toast('Sin cambios','info');
    } else {
      const parts = [];
      if (upserts.length) parts.push(`${upserts.length} nota${upserts.length===1?'':'s'} guardada${upserts.length===1?'':'s'}`);
      if (dels.length)    parts.push(`${dels.length} borrada${dels.length===1?'':'s'}`);
      toast(`✅ ${parts.join(' · ')}`,'success');
    }
    await loadAll(courseId);
    renderList(courseId);
  };
}

// Editor de notas para actividades de tipo 'group' (nota grupal):
// muestra UNA fila por grupo + permite marcar quién del grupo asistió.
const ABSENT_GROUP_PREFIX = 'AUSENTE en';
const INDIV_GROUP_PREFIX = 'Nota grupal:'; // prefijo en observation para overrides individuales

function renderGradesEditorByGroup(activityId, courseId){
  const a = activities.find(x=>x.id===activityId);
  const div = document.getElementById('grades-'+activityId);
  const gs = gradesOf(activityId);

  // Helper: miembros de un grupo
  const memsOf = (gid) => memberships
    .filter(m => m.group_id === gid)
    .map(m => students.find(s => s.id === m.student_id))
    .filter(Boolean);

  // Nota actual del grupo (preferir sample no-ausente Y sin marca individual)
  const gradeByGroup = {};
  // baseValByGroup: la nota grupal "real" (lo que pintamos en el input grupal).
  // Si hay alguno con marca [Nota grupal: X], X es la base. Si no, sample.value.
  const baseValByGroup = {};
  groups.forEach(g => {
    const groupGs = gs.filter(x => x.group_id === g.id);
    const notAbsent = x => !(x.observation||'').startsWith(ABSENT_GROUP_PREFIX);
    const notIndiv  = x => !/\[?Nota grupal:/.test(x.observation||'');
    const clean = groupGs.find(x => notAbsent(x) && notIndiv(x));
    const sample = clean || groupGs.find(notAbsent) || groupGs[0];
    if (sample) gradeByGroup[g.id] = sample;
    // Base por marca
    const marker = groupGs.find(x => /Nota grupal:/.test(x.observation||''));
    if (marker){
      const m = marker.observation.match(/Nota grupal:\s*(\d+(?:\.\d+)?)/);
      if (m) baseValByGroup[g.id] = parseFloat(m[1]);
    }
    if (baseValByGroup[g.id] == null && clean) baseValByGroup[g.id] = clean.value;
    if (baseValByGroup[g.id] == null && sample && notAbsent(sample)) baseValByGroup[g.id] = sample.value;
  });

  // Presencia por grupo: { gid: { studentId: true/false } }
  const presenceByGroup = {};
  // Overrides individuales por grupo: { gid: { studentId: number } }
  const indivByGroup = {};
  groups.forEach(g => {
    const mems = memsOf(g.id);
    presenceByGroup[g.id] = {};
    indivByGroup[g.id] = {};
    mems.forEach(m => {
      const myGrade = gs.find(x => x.activity_id === activityId && x.student_id === m.id && x.group_id === g.id);
      // Si tiene grade con marca AUSENTE → ausente; si no, presente por default
      if (myGrade && (myGrade.observation||'').startsWith(ABSENT_GROUP_PREFIX)){
        presenceByGroup[g.id][m.id] = false;
      } else {
        presenceByGroup[g.id][m.id] = true;
      }
    });
    // Detectar overrides: presentes cuyo value difiere de la base real del grupo
    const baseVal = baseValByGroup[g.id];
    if (baseVal != null){
      mems.forEach(m => {
        if (presenceByGroup[g.id][m.id] === false) return;
        const myGrade = gs.find(x => x.student_id === m.id && x.group_id === g.id);
        if (myGrade && myGrade.value != null && myGrade.value !== baseVal){
          indivByGroup[g.id][m.id] = myGrade.value;
        }
      });
    }
  });

  div.innerHTML = `
    <div style="background:#E0F7FA;padding:10px 14px;border-radius:8px;font-size:12px;margin-bottom:10px;border-left:3px solid var(--ean-cyan)">
      🧑‍🤝‍🧑 <b>Nota grupal</b>: cada grupo recibe UNA nota que se aplica a sus integrantes presentes.
      Los marcados como ausentes reciben 0.
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>#</th>
          <th>Grupo</th>
          <th class="num" style="width:110px">Nota (0-${a.max_points})</th>
          <th>Integrantes / Presencia / Observación</th>
        </tr></thead>
        <tbody>
          ${groups.map((g,i) => {
            const grade = gradeByGroup[g.id];
            const mems = memsOf(g.id);
            const leader = students.find(s => s.id === g.leader_student_id);
            const presence = presenceByGroup[g.id] || {};
            const presentCount = mems.filter(m => presence[m.id]).length;
            const absentCount = mems.length - presentCount;
            return `
            <tr>
              <td class="num">${i+1}</td>
              <td>
                <b>${escape(g.name)}</b>
                <div style="font-size:10px;color:var(--ean-gray);margin-top:2px">${mems.length} int.${leader?' · 👑 '+escape(leader.name):''}</div>
                <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">
                  <span class="chip chip-green" style="font-size:9px;padding:1px 6px">✅ ${presentCount}</span>
                  ${absentCount > 0 ? `<span class="chip chip-red" style="font-size:9px;padding:1px 6px">❌ ${absentCount}</span>` : ''}
                </div>
              </td>
              <td class="num">
                <input type="number" class="input-grade" min="0" max="${a.max_points}" step="${a.max_points <= 1 ? '1' : '0.1'}"
                  value="${baseValByGroup[g.id] ?? grade?.value ?? ''}" data-gid="${g.id}" placeholder="—" style="font-weight:700">
                <button class="btn btn-xs btn-cyan save-one" data-save-gid="${g.id}" style="margin-top:6px;width:100%;font-size:10px" title="Guardar solo este grupo">💾 Guardar este grupo</button>
              </td>
              <td>
                <input type="text" class="obs-input" data-obs-gid="${g.id}" value="${escapeAttr(grade?.desglose || (grade?.observation||'').replace(/^Nota grupal:[^·]*·[^·]*$/,''))}" placeholder="Observación grupal…" style="width:100%;font-size:12px">
                <details class="acc" style="margin-top:6px" data-presence-gid="${g.id}">
                  <summary>✏️ Editar presencia de integrantes (${mems.length})</summary>
                  <div style="margin-top:6px;display:flex;flex-direction:column;gap:4px">
                    ${mems.map(m => `
                      <label style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:#fff;border-radius:6px;border:1px solid var(--ean-border);font-size:11px;cursor:pointer">
                        <input type="checkbox" class="presence-cb" data-gid="${g.id}" data-sid="${m.id}" ${presence[m.id]?'checked':''} style="width:14px;height:14px">
                        <span style="flex:1">${escape(m.name)}${m.id===leader?.id?' 👑':''}</span>
                      </label>
                    `).join('')}
                  </div>
                </details>
                ${presentCount > 0 ? (() => {
                  const overrides = indivByGroup[g.id] || {};
                  const indivCount = Object.keys(overrides).filter(sid => presenceByGroup[g.id][sid]).length;
                  const baseVal = baseValByGroup[g.id] ?? grade?.value;
                  const phStr = baseVal != null ? String(baseVal) : 'grupal';
                  return `
                <details class="acc" style="margin-top:6px" data-indiv-gid="${g.id}" ${indivCount>0?'open':''}>
                  <summary data-indiv-summary="${g.id}">🎯 Ajustar nota por integrante${indivCount>0?` (${indivCount} ajuste${indivCount===1?'':'s'})`:''}</summary>
                  <div style="margin-top:6px">
                    <div style="font-size:10px;color:var(--ean-gray);font-style:italic;margin-bottom:6px">
                      💡 Califica según contribución. Vacío = nota grupal.
                    </div>
                    <div style="display:flex;flex-direction:column;gap:4px">
                      ${mems.filter(m => presenceByGroup[g.id][m.id]).map(m => `
                        <label style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:#fff;border-radius:6px;border:1px solid var(--ean-border);font-size:11px">
                          <span style="flex:1">${escape(m.name)}${m.id===leader?.id?' 👑':''}</span>
                          <input type="number" class="indiv-input" data-gid="${g.id}" data-sid="${m.id}"
                            min="0" max="${a.max_points}" step="${a.max_points <= 1 ? '1' : '0.1'}"
                            value="${overrides[m.id] ?? ''}" placeholder="${phStr}"
                            style="width:60px;text-align:center;font-weight:700;padding:2px 4px;border:1px solid var(--ean-border);border-radius:4px;font-size:11px">
                          <span style="font-size:10px;color:var(--ean-gray)">/${a.max_points}</span>
                        </label>
                      `).join('')}
                    </div>
                  </div>
                </details>`;
                })() : ''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:10px;text-align:right">
      <button class="btn btn-cyan" id="save-grades-${activityId}">💾 Guardar TODOS los grupos</button>
    </div>
  `;

  // Wire-up: checkboxes de presencia actualizan presenceByGroup en vivo + chips visuales
  div.querySelectorAll('.presence-cb').forEach(cb => {
    cb.onchange = () => {
      const gid = cb.dataset.gid;
      const sid = cb.dataset.sid;
      presenceByGroup[gid][sid] = cb.checked;
      // Si pasó a ausente, descartamos su override individual (lógicamente irrelevante)
      if (!cb.checked && indivByGroup[gid]) delete indivByGroup[gid][sid];
      // Actualizar chips del grupo
      const mems = memsOf(gid);
      const present = mems.filter(m => presenceByGroup[gid][m.id]).length;
      const absent = mems.length - present;
      const row = cb.closest('tr');
      const chips = row.querySelector('td:nth-child(2) > div:last-child');
      chips.innerHTML = `
        <span class="chip chip-green" style="font-size:9px;padding:1px 6px">✅ ${present}</span>
        ${absent > 0 ? `<span class="chip chip-red" style="font-size:9px;padding:1px 6px">❌ ${absent}</span>` : ''}
      `;
      // Re-render la lista de ajustes individuales de ese grupo
      renderIndivList(gid);
    };
  });

  // Helper: re-renderiza la lista de inputs individuales de un grupo (presencia cambió)
  function renderIndivList(gid){
    const det = div.querySelector(`details[data-indiv-gid="${gid}"]`);
    if (!det) return;
    const groupObj = groups.find(x => x.id === gid);
    const mems = memsOf(gid);
    const leader = students.find(s => s.id === groupObj?.leader_student_id);
    const presentMems = mems.filter(m => presenceByGroup[gid][m.id]);
    const grpInp = div.querySelector(`input.input-grade[data-gid="${gid}"]`);
    const phStr = grpInp?.value.trim() || 'grupal';
    const overrides = indivByGroup[gid] || {};
    const listWrap = det.querySelector(':scope > div > div:last-child');
    if (!listWrap) return;
    listWrap.innerHTML = presentMems.map(m => `
      <label style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:#fff;border-radius:6px;border:1px solid var(--ean-border);font-size:11px">
        <span style="flex:1">${escape(m.name)}${m.id===leader?.id?' 👑':''}</span>
        <input type="number" class="indiv-input" data-gid="${gid}" data-sid="${m.id}"
          min="0" max="${a.max_points}" step="${a.max_points <= 1 ? '1' : '0.1'}"
          value="${overrides[m.id] ?? ''}" placeholder="${phStr}"
          style="width:60px;text-align:center;font-weight:700;padding:2px 4px;border:1px solid var(--ean-border);border-radius:4px;font-size:11px">
        <span style="font-size:10px;color:var(--ean-gray)">/${a.max_points}</span>
      </label>
    `).join('');
    wireIndivInputs(gid);
    updateIndivSummary(gid);
  }

  function wireIndivInputs(gid){
    div.querySelectorAll(`input.indiv-input[data-gid="${gid}"]`).forEach(inp => {
      inp.oninput = () => {
        const sid = inp.dataset.sid;
        const v = inp.value.trim();
        if (!indivByGroup[gid]) indivByGroup[gid] = {};
        if (v === ''){ delete indivByGroup[gid][sid]; }
        else {
          const n = parseFloat(v);
          if (!isNaN(n)) indivByGroup[gid][sid] = n;
        }
        updateIndivSummary(gid);
      };
    });
  }

  function updateIndivSummary(gid){
    const summary = div.querySelector(`summary[data-indiv-summary="${gid}"]`);
    if (!summary) return;
    const overrides = indivByGroup[gid] || {};
    const count = Object.keys(overrides).filter(sid => presenceByGroup[gid][sid]).length;
    summary.textContent = `🎯 Ajustar nota por integrante${count>0?` (${count} ajuste${count===1?'':'s'})`:''}`;
  }

  // Cablear inputs individuales iniciales
  [...new Set([...div.querySelectorAll('input.indiv-input[data-gid]')].map(i => i.dataset.gid))]
    .forEach(gid => wireIndivInputs(gid));

  // Cuando el profe cambia la nota grupal, refrescar placeholders de los inputs individuales del mismo grupo
  div.querySelectorAll('input.input-grade[data-gid]').forEach(inp => {
    inp.oninput = () => {
      const gid = inp.dataset.gid;
      const phStr = inp.value.trim() || 'grupal';
      div.querySelectorAll(`input.indiv-input[data-gid="${gid}"]`).forEach(ind => { ind.placeholder = phStr; });
    };
  });

  // Construye filas para UN grupo. Devuelve { rows, clear } donde:
  //   rows  = filas a upsert (presentes con nota + ausentes con 0); [] si no hay nada que guardar
  //   clear = true si el grupo tenía nota previa y ahora se dejó vacío → marcar para borrado
  function buildForGroup(gid){
    const inp = div.querySelector(`input.input-grade[data-gid="${gid}"]`);
    const obsInp = div.querySelector(`input[data-obs-gid="${gid}"]`);
    if (!inp || !obsInp) return { rows: [], clear: false };
    const valStr = inp.value.trim();
    const val = valStr === '' ? null : parseFloat(valStr);
    const obs = obsInp.value.trim() || null;
    const mems = memsOf(gid);
    if (val === null && !obs){
      return { rows: [], clear: !!gradeByGroup[gid] };
    }
    const rows = mems.map(m => {
      const isAbsent = presenceByGroup[gid][m.id] === false;
      const existing = gs.find(x => x.student_id === m.id && x.group_id === gid);
      if (isAbsent){
        return {
          activity_id: activityId,
          student_id: m.id,
          group_id: gid,
          value: 0,
          desglose: 'AUSENTE',
          observation: `${ABSENT_GROUP_PREFIX} ${a.name}`,
          source: existing?.source || 'manual',
        };
      }
      const override = indivByGroup[gid]?.[m.id];
      const hasOverride = override != null && !isNaN(override) && override !== val;
      return {
        activity_id: activityId,
        student_id: m.id,
        group_id: gid,
        value: hasOverride ? override : val,
        desglose: obs,
        observation: hasOverride ? `${INDIV_GROUP_PREFIX} ${val} · ajuste individual a ${override}` : null,
        source: existing?.source || 'manual', // B7: preservar source (ej. ingesta IA)
      };
    });
    return { rows, clear: false };
  }

  // Guarda uno o varios grupos. gids=null → todos los inputs de la tabla.
  async function saveGroups(gids){
    const targetGids = gids ?? [...new Set([...div.querySelectorAll('input.input-grade[data-gid]')].map(i=>i.dataset.gid))];
    const rowsToUpsert = [];
    const groupsToClear = [];
    targetGids.forEach(gid => {
      const { rows, clear } = buildForGroup(gid);
      if (rows.length) rowsToUpsert.push(...rows);
      if (clear) groupsToClear.push(gid);
    });

    // B3: si no hay nada que hacer, decirlo en azul, no en verde
    if (!rowsToUpsert.length && !groupsToClear.length){
      toast('Sin cambios','info');
      return;
    }

    // Deduplicar por student_id (alumno en >1 grupo): el último gana
    const bySid = new Map();
    const dupes = [];
    for (const r of rowsToUpsert){
      if (bySid.has(r.student_id)) dupes.push(r.student_id);
      bySid.set(r.student_id, r);
    }
    if (dupes.length){
      console.warn('[grupal] estudiantes en >1 grupo (se conservó el último):', [...new Set(dupes)]);
    }
    const dedupRows = [...bySid.values()];

    // B2: ATOMICIDAD. Antes hacíamos DELETE+UPSERT y si la red fallaba entre los dos, perdíamos notas.
    // Ahora: UPSERT primero (en caliente). Después, limpiar ex-miembros del grupo (estudiantes
    // que ya no están en él). Si el segundo paso falla, quedan filas viejas pero ninguna pérdida.
    if (dedupRows.length){
      const { error } = await supabase.from('v5_grades').upsert(dedupRows, { onConflict: 'activity_id,student_id' });
      if (error){ toast('Error: '+error.message,'error'); return; }
    }

    // Borrar grades de ex-miembros: por cada gid afectado, eliminar grades cuyo student_id ya no esté en la membresía actual
    const affectedGids = [...new Set([...dedupRows.map(r=>r.group_id), ...groupsToClear])];
    for (const gid of affectedGids){
      const currentSids = memsOf(gid).map(m => m.id);
      const toDelete = gs
        .filter(x => x.group_id === gid && !currentSids.includes(x.student_id))
        .map(x => x.id);
      if (toDelete.length){
        await supabase.from('v5_grades').delete().in('id', toDelete);
      }
    }

    // Limpiar grupos marcados para borrado total (se dejó vacío y tenía nota)
    for (const gid of groupsToClear){
      await supabase.from('v5_grades').delete().eq('activity_id', activityId).eq('group_id', gid);
    }

    const gruposCount = new Set(dedupRows.map(r => r.group_id)).size;
    const absentCount = dedupRows.filter(r => r.desglose === 'AUSENTE').length;
    const indivCount = dedupRows.filter(r => (r.observation||'').startsWith(INDIV_GROUP_PREFIX)).length;
    const clearedMsg = groupsToClear.length ? ` · ${groupsToClear.length} limpiado${groupsToClear.length===1?'':'s'}` : '';
    const absentMsg = absentCount ? ` · ${absentCount} ausente${absentCount===1?'':'s'} con 0` : '';
    const ajusteMsg = indivCount ? ` · 🎯 ${indivCount} ajuste${indivCount===1?'':'s'} individual${indivCount===1?'':'es'}` : '';
    toast(`✅ ${gruposCount} grupo${gruposCount===1?'':'s'} calificado${gruposCount===1?'':'s'}${absentMsg}${ajusteMsg}${clearedMsg}`,'success');
    await loadAll(courseId);
    renderList(courseId);
  }

  // B4: botón "Guardar este grupo" en cada fila
  div.querySelectorAll('.save-one').forEach(btn => {
    btn.onclick = () => saveGroups([btn.dataset.saveGid]);
  });
  // Botón global "Guardar TODOS los grupos"
  document.getElementById('save-grades-'+activityId).onclick = () => saveGroups(null);
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
    // B9: validar max_points > 0
    if (!(payload.max_points > 0)){ toast('La escala máxima debe ser mayor a 0','error'); return; }

    // B5: si cambia el tipo de actividad y ya hay notas, avisar
    if (isEdit && activity.type !== payload.type){
      const existing = gradesOf(activity.id);
      if (existing.length){
        const msg = `⚠ Esta actividad ya tiene ${existing.length} nota${existing.length===1?'':'s'} guardada${existing.length===1?'':'s'}.\n\n` +
          `Vas a cambiar el tipo de "${ACTIVITY_TYPES[activity.type]||activity.type}" a "${ACTIVITY_TYPES[payload.type]||payload.type}".\n\n` +
          `Si cambias a GRUPAL, las notas existentes se reasignarán automáticamente al grupo actual de cada estudiante (los que estén en algún grupo).\n` +
          `Si cambias a INDIVIDUAL, las notas mantienen su valor pero pierden la asociación con grupos.\n\n` +
          `¿Continuar?`;
        if (!confirm(msg)){ return; }
      }
    }

    // B6: si crea/edita actividad grupal y no hay grupos, advertir
    if (payload.type === 'group' && groups.length === 0){
      const ok = confirm(`⚠ Esta actividad es GRUPAL pero el curso aún no tiene grupos creados.\n\nSe creará igual, pero al editar las notas verás el editor individual hasta que crees grupos.\n\n¿Continuar?`);
      if (!ok) return;
    }

    let r;
    if (isEdit) r = await supabase.from('v5_activities').update(payload).eq('id', activity.id);
    else { payload.course_id = courseId; r = await supabase.from('v5_activities').insert(payload); }
    if (r.error){ toast('Error: '+r.error.message,'error'); return; }
    toast(isEdit?'Actualizada':'Creada','success');
    host.innerHTML='';
    await loadAll(courseId); // dispara repairOrphanGroupGrades si pasó a grupal
    renderList(courseId);
  };
}

const escape = s => String(s||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const escapeAttr = s => escape(s).replace(/"/g,'&quot;');
