// Gestión de grupos del curso
import { supabase } from './supabase-client.js';
import { toast } from './toast.js';

let students = [];
let groups = [];
let memberships = []; // {group_id, student_id}

export async function mountGroups(root, store){
  const courseId = store.activeCourse.id;
  root.innerHTML = `
    <div class="card">
      <div class="card-row" style="justify-content:space-between">
        <h2>🧑‍🤝‍🧑 Grupos — ${escape(store.activeCourse.name)}</h2>
        <div style="display:flex;gap:8px">
          <button class="btn btn-out" id="btn-auto">🎲 Auto-crear grupos</button>
          <button class="btn btn-cyan" id="btn-new">＋ Nuevo grupo</button>
        </div>
      </div>
      <div id="grp-info" style="margin-top:8px;font-size:12px;color:var(--ean-gray)"></div>
    </div>

    <div class="card">
      <div id="grp-grid"><p class="empty-state">Cargando…</p></div>
    </div>

    <div id="grp-modal-host"></div>
  `;

  document.getElementById('btn-new').onclick = () => openGroupModal(courseId, null);
  document.getElementById('btn-auto').onclick = () => openAutoModal(courseId);

  await loadAll(courseId);
  renderGrid(courseId);
}

async function loadAll(courseId){
  const [stuRes, grpRes, memRes] = await Promise.all([
    supabase.from('v5_students').select('id, cedula, name').eq('course_id', courseId).order('name'),
    supabase.from('v5_groups').select('*').eq('course_id', courseId).order('name'),
    supabase.from('v5_group_members').select('group_id, student_id').in('group_id',
      (await supabase.from('v5_groups').select('id').eq('course_id', courseId)).data?.map(g=>g.id) || ['00000000-0000-0000-0000-000000000000']
    ),
  ]);
  students = stuRes.data || [];
  groups = grpRes.data || [];
  memberships = memRes.data || [];
  document.getElementById('grp-info').textContent =
    `${groups.length} grupo${groups.length===1?'':'s'} · ${memberships.length} asignaciones · ${students.length} estudiantes en el roster`;
}

function membersOf(gid){
  return memberships.filter(m => m.group_id === gid).map(m => students.find(s => s.id === m.student_id)).filter(Boolean);
}

function renderGrid(courseId){
  const grid = document.getElementById('grp-grid');
  if (!groups.length){
    grid.innerHTML = `<p class="empty-state">No hay grupos. Crea uno o usa 🎲 Auto-crear para repartir estudiantes.</p>`;
    return;
  }
  grid.innerHTML = `
    <div class="grid-3">
      ${groups.map(g => {
        const mems = membersOf(g.id);
        const leader = students.find(s => s.id === g.leader_student_id);
        return `
        <div class="card" style="margin:0;border-left:4px solid var(--ean-blue)">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
            <div style="flex:1">
              <h3 style="margin-bottom:2px">${escape(g.name)} <span class="chip" style="font-size:10px">${mems.length}</span></h3>
              ${leader ? `<div style="font-size:11px;color:var(--ean-gray)">👑 ${escape(leader.name)}</div>` : ''}
              ${g.notes ? `<div style="font-size:11px;color:var(--ean-gray);font-style:italic;margin-top:2px">${escape(g.notes)}</div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:4px">
              <button class="btn btn-xs btn-out" data-edit="${g.id}">✏️</button>
              <button class="btn btn-xs btn-danger" data-del="${g.id}">🗑</button>
            </div>
          </div>
          <div style="margin-top:10px">
            ${mems.length === 0 ? '<span class="empty-state" style="padding:6px">Sin integrantes</span>' :
              `<details class="acc">
                <summary>👥 Ver ${mems.length} integrante${mems.length===1?'':'s'}</summary>
                <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">
                  ${mems.map(s => `<span class="chip" style="font-size:11px" title="${escapeAttr(s.cedula)}">${escape(s.name.split(' ').slice(0,2).join(' '))}${s.id===g.leader_student_id?' 👑':''}</span>`).join('')}
                </div>
              </details>`}
          </div>
        </div>
      `}).join('')}
    </div>
  `;
  grid.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{
    const g = groups.find(x=>x.id===b.dataset.edit);
    openGroupModal(courseId, g);
  });
  grid.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
    const g = groups.find(x=>x.id===b.dataset.del);
    if (!confirm(`¿Eliminar grupo "${g.name}"? Las notas asociadas se conservan, solo se rompe la asignación.`)) return;
    const { error } = await supabase.from('v5_groups').delete().eq('id', g.id);
    if (error) toast('Error: '+error.message,'error');
    else { toast('Grupo eliminado'); await loadAll(courseId); renderGrid(courseId); }
  });
}

function openGroupModal(courseId, group){
  const isEdit = !!group;
  const currentMembers = isEdit ? membersOf(group.id).map(s=>s.id) : [];
  const host = document.getElementById('grp-modal-host');

  host.innerHTML = `
    <div class="modal-bg">
      <div class="modal" style="max-width:680px">
        <h2>${isEdit?'✏️ Editar':'＋ Nuevo'} grupo</h2>
        <div class="grid-2">
          <div class="field"><label>Nombre del grupo *</label><input id="g-name" value="${escapeAttr(group?.name||'')}" placeholder="Ej: Yoga Serena, Equipo 1, etc."></div>
          <div class="field"><label>Notas (opcional)</label><input id="g-notes" value="${escapeAttr(group?.notes||'')}" placeholder="Ej: empresa, tema, etc."></div>
        </div>

        <label>Integrantes</label>
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <input id="g-search" placeholder="🔍 Buscar por nombre o cédula…" style="flex:1">
          <button type="button" class="btn btn-out btn-xs" id="g-add-stu" title="Crear estudiante nuevo si no aparece en el listado">＋ Crear estudiante</button>
        </div>
        <div id="g-new-stu-form" style="display:none;background:#FFF8E1;padding:10px;border-radius:8px;margin-bottom:8px;border:1px solid #F9C911">
          <div style="font-size:11px;color:#8B6914;margin-bottom:6px"><b>Crear estudiante nuevo en este curso</b> (se agregará al grupo automáticamente)</div>
          <div style="display:grid;grid-template-columns:1fr 2fr 1fr auto;gap:6px;align-items:center">
            <input id="g-ns-cedula" placeholder="Cédula *" style="font-size:12px">
            <input id="g-ns-name"   placeholder="Nombre completo *" style="font-size:12px">
            <input id="g-ns-email"  placeholder="Email (opcional)" type="email" style="font-size:12px">
            <button type="button" class="btn btn-cyan btn-xs" id="g-ns-save">Crear</button>
          </div>
          <div id="g-ns-status" style="margin-top:6px;font-size:11px"></div>
        </div>
        <div style="max-height:280px;overflow-y:auto;border:1px solid var(--ean-border);border-radius:8px" id="g-stu-list"></div>

        <div class="field" style="margin-top:12px">
          <label>👑 Líder (opcional, debe ser un integrante)</label>
          <select id="g-leader"><option value="">— Sin líder —</option></select>
        </div>

        <div class="modal-actions">
          <button class="btn btn-out" id="m-cancel">Cancelar</button>
          <button class="btn" id="m-save">${isEdit?'Guardar cambios':'Crear grupo'}</button>
        </div>
      </div>
    </div>
  `;

  const selected = new Set(currentMembers);
  const renderStu = (filter='') => {
    const ft = filter.toLowerCase();
    const filtered = students.filter(s =>
      !ft || s.name.toLowerCase().includes(ft) || s.cedula.includes(ft)
    );
    document.getElementById('g-stu-list').innerHTML = filtered.length === 0
      ? `<p class="empty-state">Sin coincidencias.</p>`
      : filtered.map(s => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--ean-border);cursor:pointer">
          <input type="checkbox" data-sid="${s.id}" ${selected.has(s.id)?'checked':''} style="width:16px;height:16px">
          <span style="flex:1;font-size:13px"><b>${escape(s.name)}</b></span>
          <code style="font-size:11px;color:var(--ean-gray)">${escape(s.cedula)}</code>
        </label>
      `).join('');
    document.getElementById('g-stu-list').querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.onchange = () => {
        if (cb.checked) selected.add(cb.dataset.sid);
        else selected.delete(cb.dataset.sid);
        renderLeader();
      };
    });
  };
  const renderLeader = () => {
    const sel = document.getElementById('g-leader');
    const cur = sel.value || group?.leader_student_id || '';
    sel.innerHTML = '<option value="">— Sin líder —</option>' +
      [...selected].map(sid => students.find(s=>s.id===sid)).filter(Boolean)
        .map(s => `<option value="${s.id}" ${cur===s.id?'selected':''}>${escape(s.name)}</option>`).join('');
  };
  renderStu(); renderLeader();
  document.getElementById('g-search').oninput = e => renderStu(e.target.value);

  // ── Crear estudiante manualmente desde el modal de grupos ──
  const newForm = document.getElementById('g-new-stu-form');
  document.getElementById('g-add-stu').onclick = () => {
    const isOpen = newForm.style.display === 'block';
    newForm.style.display = isOpen ? 'none' : 'block';
    if (!isOpen){
      document.getElementById('g-ns-cedula').value = '';
      document.getElementById('g-ns-name').value = '';
      document.getElementById('g-ns-email').value = '';
      document.getElementById('g-ns-status').innerHTML = '';
      document.getElementById('g-ns-cedula').focus();
    }
  };

  document.getElementById('g-ns-save').onclick = async () => {
    const cedula = document.getElementById('g-ns-cedula').value.trim();
    const name   = document.getElementById('g-ns-name').value.trim();
    const email  = document.getElementById('g-ns-email').value.trim() || null;
    const status = document.getElementById('g-ns-status');
    if (!cedula || !name){
      status.innerHTML = '<span style="color:var(--red)">Cédula y nombre son obligatorios</span>';
      return;
    }
    // Si ya existe la cédula en este curso, no duplicar
    const existing = students.find(s => s.cedula === cedula);
    if (existing){
      selected.add(existing.id);
      renderStu(document.getElementById('g-search').value);
      renderLeader();
      status.innerHTML = `<span style="color:#E65100">⚠️ Ya existía en el curso (${escape(existing.name)}). Lo agregué al grupo.</span>`;
      return;
    }
    const btn = document.getElementById('g-ns-save');
    btn.disabled = true; btn.textContent = 'Creando…';
    const { data, error } = await supabase.from('v5_students')
      .insert({ course_id: courseId, cedula, name, email })
      .select().single();
    btn.disabled = false; btn.textContent = 'Crear';
    if (error){
      status.innerHTML = `<span style="color:var(--red)">Error: ${escape(error.message)}</span>`;
      return;
    }
    // Agregar a la lista local + marcar como seleccionado
    students.push(data);
    students.sort((a,b) => a.name.localeCompare(b.name));
    selected.add(data.id);
    renderStu(document.getElementById('g-search').value);
    renderLeader();
    status.innerHTML = `<span style="color:var(--green)">✅ ${escape(name)} creado y agregado al grupo</span>`;
    // Limpiar inputs para crear otro rápidamente
    document.getElementById('g-ns-cedula').value = '';
    document.getElementById('g-ns-name').value = '';
    document.getElementById('g-ns-email').value = '';
    document.getElementById('g-ns-cedula').focus();
  };

  document.getElementById('m-cancel').onclick = () => host.innerHTML = '';

  document.getElementById('m-save').onclick = async () => {
    const name = document.getElementById('g-name').value.trim();
    const notes = document.getElementById('g-notes').value.trim() || null;
    const leader = document.getElementById('g-leader').value || null;
    if (!name){ toast('Nombre requerido','error'); return; }

    let groupId;
    if (isEdit){
      const { error } = await supabase.from('v5_groups').update({ name, notes, leader_student_id: leader }).eq('id', group.id);
      if (error){ toast('Error: '+error.message,'error'); return; }
      groupId = group.id;
      // Reset memberships: borrar todas y reinsertar
      await supabase.from('v5_group_members').delete().eq('group_id', groupId);
    } else {
      const { data, error } = await supabase.from('v5_groups').insert({ course_id: courseId, name, notes, leader_student_id: leader }).select().single();
      if (error){ toast('Error: '+error.message,'error'); return; }
      groupId = data.id;
    }

    if (selected.size > 0){
      const rows = [...selected].map(sid => ({ group_id: groupId, student_id: sid }));
      const { error } = await supabase.from('v5_group_members').insert(rows);
      if (error){ toast('Error miembros: '+error.message,'error'); return; }
    }

    toast(isEdit?'Grupo actualizado':'Grupo creado','success');
    host.innerHTML = '';
    await loadAll(courseId);
    renderGrid(courseId);
  };
}

function openAutoModal(courseId){
  const host = document.getElementById('grp-modal-host');
  if (!students.length){ toast('Importa estudiantes primero','error'); return; }
  host.innerHTML = `
    <div class="modal-bg">
      <div class="modal">
        <h2>🎲 Auto-crear grupos</h2>
        <p style="font-size:12px;color:var(--ean-gray);margin-bottom:12px">
          Reparto aleatorio de los <b>${students.length}</b> estudiantes en grupos del tamaño que prefieras.
        </p>
        <div class="grid-2">
          <div class="field">
            <label>¿Cuántos grupos?</label>
            <input type="number" id="a-n" value="6" min="2" max="50">
          </div>
          <div class="field">
            <label>Prefijo del nombre</label>
            <input id="a-prefix" value="Grupo" placeholder="Ej: Equipo, Team, etc.">
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-out" id="m-cancel">Cancelar</button>
          <button class="btn btn-cyan" id="m-go">Crear grupos</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('m-cancel').onclick = () => host.innerHTML='';
  document.getElementById('m-go').onclick = async () => {
    const n = parseInt(document.getElementById('a-n').value)||6;
    const prefix = document.getElementById('a-prefix').value.trim() || 'Grupo';
    if (n < 2){ toast('Mínimo 2 grupos','error'); return; }
    const shuffled = [...students].sort(()=>Math.random()-.5);
    const size = Math.ceil(shuffled.length/n);

    const grpInserts = Array.from({length:n}, (_,i) => ({ course_id: courseId, name: `${prefix} ${i+1}` }));
    const { data: created, error } = await supabase.from('v5_groups').insert(grpInserts).select();
    if (error){ toast('Error: '+error.message,'error'); return; }

    const memInserts = [];
    created.forEach((g, i) => {
      shuffled.slice(i*size, (i+1)*size).forEach(s => memInserts.push({ group_id: g.id, student_id: s.id }));
    });
    if (memInserts.length){
      const { error: e2 } = await supabase.from('v5_group_members').insert(memInserts);
      if (e2){ toast('Error miembros: '+e2.message,'error'); return; }
    }
    toast(`${n} grupos creados con ${shuffled.length} estudiantes`,'success');
    host.innerHTML='';
    await loadAll(courseId);
    renderGrid(courseId);
  };
}

const escape = s => String(s||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const escapeAttr = s => escape(s).replace(/"/g,'&quot;');
