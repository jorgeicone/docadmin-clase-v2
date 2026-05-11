// 🏆 SUSTENTACIÓN — rúbrica POR sustentación + calificación grupal
import { supabase } from './supabase-client.js';
import { toast } from './toast.js';
import { sustLabel } from './config.js';

let sustentaciones = [], groups = [], students = [], memberships = [], grades = [];
let courseId = null;
let viewMode = 'list';        // 'list' | 'grade'
let activeSust = null;        // actividad sustentación activa para calificar
let pendingPts = {};          // {criterionIndex: pts}
let activeGroupId = null;
let presence = {};            // {studentId: true/false} — true si estuvo presente en la sustentación

const ABSENT_PREFIX = 'AUSENTE en la sustentación';

// Paleta de colores personalizables para cards de sustentación (misma que cursos)
const SUST_COLORS = {
  cyan:    { name:'Cyan',    main:'#1AC8DB', soft:'rgba(26,200,219,.10)',  glow:'rgba(26,200,219,.35)' },
  purple:  { name:'Púrpura', main:'#7A3CFF', soft:'rgba(122,60,255,.10)',  glow:'rgba(122,60,255,.35)' },
  blue:    { name:'Azul',    main:'#3055A6', soft:'rgba(48,85,166,.10)',   glow:'rgba(48,85,166,.35)'  },
  green:   { name:'Verde',   main:'#1FAA59', soft:'rgba(31,170,89,.10)',   glow:'rgba(31,170,89,.35)'  },
  orange:  { name:'Naranja', main:'#FF8A3C', soft:'rgba(255,138,60,.10)',  glow:'rgba(255,138,60,.35)' },
  pink:    { name:'Rosa',    main:'#E91E63', soft:'rgba(233,30,99,.10)',   glow:'rgba(233,30,99,.35)'  },
  yellow:  { name:'Amarillo',main:'#F9C911', soft:'rgba(249,201,17,.12)',  glow:'rgba(249,201,17,.40)' },
  red:     { name:'Rojo',    main:'#D7263D', soft:'rgba(215,38,61,.10)',   glow:'rgba(215,38,61,.35)'  },
};
const SUST_COLOR_KEYS = Object.keys(SUST_COLORS);

function sustColorOf(sustId){
  const saved = localStorage.getItem('sust_color_' + sustId);
  if (saved && SUST_COLORS[saved]) return saved;
  let h = 0;
  for (let i = 0; i < sustId.length; i++) h = (h * 31 + sustId.charCodeAt(i)) >>> 0;
  return SUST_COLOR_KEYS[h % SUST_COLOR_KEYS.length];
}
function setSustColorOf(sustId, color){
  if (!SUST_COLORS[color]) return;
  localStorage.setItem('sust_color_' + sustId, color);
}

const PLANTILLAS = {
  diagnostico: {
    name: 'Diagnóstico inicial (5 criterios)',
    criteria: [
      { name:'Perfil del Negocio',     max:4, desc:'Nombre, Actividad, UVP, Producto y Diferenciación claramente definidos.' },
      { name:'Avatar / Buyer Persona', max:4, desc:'Va más allá de demografía: intereses, miedos, comportamiento digital y 3 pain points.' },
      { name:'Ecosistema Digital',     max:4, desc:'3 canales justificados (Canal + Hábito del Avatar + cómo amplifica la UVP).' },
      { name:'Customer Journey',       max:4, desc:'Canales mapeados en Descubrimiento, Consideración y Decisión/Conversión.' },
      { name:'Objetivo SMART',         max:4, desc:'1 objetivo Específico, Medible, Alcanzable, Relevante y Temporal.' },
    ],
  },
  vacia: { name: 'En blanco', criteria: [] },
};

export async function mountSustentacion(root, store){
  courseId = store.activeCourse.id;
  await loadAll();
  renderList(root, store);
}

async function loadAll(){
  const [sustR, grpR, stuR, memR] = await Promise.all([
    supabase.from('v5_activities').select('*').eq('course_id', courseId).eq('type','sustentacion').order('date',{ascending:false,nullsFirst:false}),
    supabase.from('v5_groups').select('id, name, leader_student_id').eq('course_id', courseId).order('name'),
    supabase.from('v5_students').select('id, cedula, name').eq('course_id', courseId).order('name'),
    supabase.from('v5_group_members').select('group_id, student_id'),
  ]);
  sustentaciones = sustR.data || [];
  groups = grpR.data || [];
  students = stuR.data || [];
  memberships = memR.data || [];

  if (sustentaciones.length){
    const ids = sustentaciones.map(s=>s.id);
    const { data } = await supabase.from('v5_grades').select('*').in('activity_id', ids);
    grades = data || [];
  } else { grades = []; }
}

function membersOf(groupId){
  return memberships.filter(m => m.group_id === groupId).map(m => students.find(s => s.id === m.student_id)).filter(Boolean);
}

function gradedGroupsOf(sustId){
  // Devuelve un Map<group_id, [grade]>
  const byGroup = new Map();
  grades.filter(g => g.activity_id === sustId && g.group_id).forEach(g => {
    if (!byGroup.has(g.group_id)) byGroup.set(g.group_id, []);
    byGroup.get(g.group_id).push(g);
  });
  return byGroup;
}

// ───── VISTA: LISTA DE SUSTENTACIONES ─────
function renderList(root, store){
  root.innerHTML = `
    <div class="card">
      <div class="card-row" style="justify-content:space-between">
        <h2>🏆 Sustentaciones — ${escape(store.activeCourse.name)}</h2>
        <button class="btn btn-cyan" id="s-new">＋ Nueva sustentación</button>
      </div>
      <div id="s-info" style="margin-top:8px;font-size:12px;color:var(--ean-gray)"></div>
    </div>

    <div id="s-list"></div>

    <div id="s-modal-host"></div>
  `;

  document.getElementById('s-new').onclick = () => openCreateModal(root, store);

  const list = document.getElementById('s-list');
  document.getElementById('s-info').textContent =
    `${sustentaciones.length} sustentacion${sustentaciones.length===1?'':'es'} · ${groups.length} grupos disponibles · ${grades.filter(g=>sustentaciones.find(s=>s.id===g.activity_id)).length} calificaciones registradas`;

  if (!sustentaciones.length){
    list.innerHTML = `<div class="card"><p class="empty-state">No hay sustentaciones aún. Crea la primera con el botón de arriba.</p></div>`;
    return;
  }

  list.innerHTML = `<div class="grid-3" style="margin-top:14px">
    ${sustentaciones.map(s => {
      const rubric = s.rubric?.criterios || [];
      const totalMax = rubric.reduce((a,c)=>a+(c.max||0), 0);
      const byGroup = gradedGroupsOf(s.id);
      const totalGrupos = groups.length;
      const calificados = byGroup.size;
      const pct = totalGrupos > 0 ? Math.round(calificados/totalGrupos*100) : 0;
      // Color asignado por el usuario (o hash del id por defecto)
      const colorKey = sustColorOf(s.id);
      const color = SUST_COLORS[colorKey];
      const btnLabel = pct === 100 ? '📊 Ver / Editar notas'
                     : pct > 0     ? '📝 Continuar calificación'
                     :               '📝 Comenzar a calificar';
      return `
      <div class="course-card sust-card" data-id="${s.id}"
        style="--c-main:${color.main};--c-soft:${color.soft};--c-glow:${color.glow}">
        <div class="course-card-top">
          <div style="flex:1;min-width:0">
            <h3 class="course-name">🏆 ${escape(s.name)}</h3>
            <div class="course-meta">
              ${s.date ? '<span class="course-meta-pill">📅 '+s.date+'</span>' : ''}
              ${s.weight ? '<span class="course-meta-pill">'+s.weight+'% del curso</span>' : ''}
              <span class="course-meta-pill">${rubric.length} criterios · /${s.max_points}</span>
            </div>
            ${s.topic ? '<div style="font-size:12px;margin-top:6px;color:var(--ean-dark)"><b>Tema:</b> '+escape(s.topic)+'</div>' : ''}
          </div>
          <div class="course-actions">
            <button class="course-action-btn" data-color="${s.id}" title="Cambiar color">🎨</button>
            <button class="course-action-btn" data-edit="${s.id}" title="Editar rúbrica">✏️</button>
            <button class="course-action-btn course-action-danger" data-del="${s.id}" title="Eliminar">🗑</button>
          </div>
        </div>
        <div style="margin-top:14px;position:relative;z-index:1">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:5px">
            <span style="color:var(--ean-gray)"><b>${calificados}</b>/${totalGrupos} grupos</span>
            <span style="color:var(--c-main);font-weight:700">${pct}%</span>
          </div>
          <div style="height:6px;background:rgba(7,30,43,.08);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:var(--c-main);transition:width .4s"></div>
          </div>
        </div>
        <button class="btn course-open-btn" data-grade="${s.id}">
          <span>${btnLabel}</span>
          <span style="font-size:18px;line-height:1">→</span>
        </button>
      </div>
      `;
    }).join('')}
  </div>

  <!-- Popover de color (oculto por defecto) -->
  <div id="sust-color-popover" class="color-popover" style="display:none">
    <div class="color-popover-title">Color de la sustentación</div>
    <div class="color-popover-grid">
      ${SUST_COLOR_KEYS.map(k => `
        <button class="color-swatch" data-pick="${k}" title="${SUST_COLORS[k].name}"
          style="background:${SUST_COLORS[k].main}"></button>
      `).join('')}
    </div>
  </div>`;

  list.querySelectorAll('[data-grade]').forEach(b=>b.onclick=()=>openGradeView(root, store, b.dataset.grade));
  list.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{
    const s = sustentaciones.find(x=>x.id===b.dataset.edit);
    openCreateModal(root, store, s);
  });
  // Popover de color
  const popover = document.getElementById('sust-color-popover');
  let popoverSustId = null;
  list.querySelectorAll('[data-color]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    popoverSustId = b.dataset.color;
    const rect = b.getBoundingClientRect();
    popover.style.display = 'block';
    popover.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    popover.style.left = (rect.left + window.scrollX - 80) + 'px';
  });
  popover.querySelectorAll('[data-pick]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    if (popoverSustId) setSustColorOf(popoverSustId, b.dataset.pick);
    popover.style.display = 'none';
    renderList(root, store);
  });
  document.addEventListener('click', () => { popover.style.display = 'none'; }, { once:true });
  list.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
    const s = sustentaciones.find(x=>x.id===b.dataset.del);
    if (!confirm(`¿Eliminar "${s.name}"?\nLas notas asociadas también se eliminarán.`)) return;
    const { error } = await supabase.from('v5_activities').delete().eq('id', s.id);
    if (error) toast('Error: '+error.message,'error');
    else { toast('Eliminada'); await loadAll(); renderList(root, store); }
  });
}

// ───── MODAL: CREAR / EDITAR SUSTENTACIÓN ─────
function openCreateModal(root, store, existing){
  const isEdit = !!existing;
  const host = document.getElementById('s-modal-host');
  const initialCriteria = isEdit ? (existing.rubric?.criterios || []) : [];

  host.innerHTML = `
    <div class="modal-bg">
      <div class="modal" style="max-width:760px">
        <h2>${isEdit?'✏️ Editar':'＋ Nueva'} sustentación</h2>

        <div class="grid-2">
          <div class="field"><label>Nombre *</label><input id="s-name" value="${escapeAttr(existing?.name||'')}" placeholder="Ej: Sustentación 1, Final, etc."></div>
          <div class="field"><label>Fecha</label><input id="s-date" type="date" value="${existing?.date||''}"></div>
          <div class="field"><label>Tema (opcional)</label><input id="s-topic" value="${escapeAttr(existing?.topic||'')}"></div>
          <div class="field"><label>Peso del curso (%)</label><input id="s-weight" type="number" step="1" min="0" max="100" value="${existing?.weight??''}" placeholder="Opcional"></div>
        </div>

        ${!isEdit ? `
        <div class="field">
          <label>📋 Cargar plantilla (opcional)</label>
          <select id="s-template">
            <option value="">— Empezar en blanco —</option>
            <option value="diagnostico">Diagnóstico inicial (5 criterios estándar)</option>
            ${sustentaciones.length ? '<option value="" disabled>──── De otras sustentaciones ────</option>' : ''}
            ${sustentaciones.map(s => `<option value="prev:${s.id}">📋 Copiar de "${escape(s.name)}" (${(s.rubric?.criterios||[]).length} criterios)</option>`).join('')}
          </select>
        </div>` : ''}

        <h3 style="margin-top:14px">Criterios de esta sustentación</h3>
        <p style="font-size:11px;color:var(--ean-gray);margin-bottom:8px">
          Cada criterio tiene un nombre y un máximo de puntos. La suma de los max define el total. Se escala automáticamente a 0-20.
        </p>
        <div id="s-criteria-list" style="margin-bottom:8px"></div>
        <button class="btn btn-out btn-xs" id="s-add-crit">＋ Agregar criterio</button>

        <div id="s-rubric-summary" style="margin-top:10px;padding:8px;background:#F0F4F8;border-radius:6px;font-size:12px"></div>

        <div class="modal-actions">
          <button class="btn btn-out" id="m-cancel">Cancelar</button>
          <button class="btn" id="m-save">${isEdit?'Guardar cambios':'Crear sustentación'}</button>
        </div>
      </div>
    </div>
  `;

  let criteria = JSON.parse(JSON.stringify(initialCriteria));

  function renderCriteria(){
    const div = document.getElementById('s-criteria-list');
    div.innerHTML = criteria.length === 0
      ? `<p class="empty-state" style="padding:14px">Sin criterios. Agrega al menos uno.</p>`
      : criteria.map((c,i) => `
        <div style="display:flex;gap:6px;align-items:start;padding:8px;background:#fff;border:1px solid var(--ean-border);border-radius:6px;margin-bottom:6px">
          <div style="flex:2"><label style="font-size:10px">Nombre</label><input value="${escapeAttr(c.name||'')}" data-idx="${i}" data-f="name" placeholder="Ej: Perfil del Negocio"></div>
          <div style="width:80px"><label style="font-size:10px">Max pts</label><input type="number" step="1" min="1" value="${c.max||4}" data-idx="${i}" data-f="max"></div>
          <div style="flex:3"><label style="font-size:10px">Descripción (opcional)</label><input value="${escapeAttr(c.desc||'')}" data-idx="${i}" data-f="desc" placeholder="Qué evalúa este criterio…"></div>
          <button class="btn btn-xs btn-danger" style="margin-top:18px" data-del="${i}">✕</button>
        </div>
      `).join('');

    div.querySelectorAll('input[data-idx]').forEach(inp => inp.oninput = () => {
      const i = +inp.dataset.idx;
      const f = inp.dataset.f;
      criteria[i][f] = f==='max' ? (parseInt(inp.value)||1) : inp.value;
      updateSummary();
    });
    div.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      criteria.splice(+b.dataset.del, 1);
      renderCriteria();
      updateSummary();
    });
  }

  function updateSummary(){
    const totalMax = criteria.reduce((a,c)=>a+(parseInt(c.max)||0), 0);
    document.getElementById('s-rubric-summary').innerHTML =
      `<b>${criteria.length}</b> criterios · suma máxima: <b>${totalMax}</b> pts → la nota final será <b>0–${totalMax}</b> (directa, sin escalar).`;
  }

  document.getElementById('s-add-crit').onclick = () => {
    criteria.push({ name:'', max:4, desc:'' });
    renderCriteria();
    updateSummary();
  };

  if (!isEdit){
    document.getElementById('s-template').onchange = (e) => {
      const v = e.target.value;
      if (!v){ criteria = []; }
      else if (v.startsWith('prev:')){
        const sid = v.split(':')[1];
        const s = sustentaciones.find(x=>x.id===sid);
        criteria = JSON.parse(JSON.stringify(s?.rubric?.criterios || []));
      } else if (PLANTILLAS[v]){
        criteria = JSON.parse(JSON.stringify(PLANTILLAS[v].criteria));
      }
      renderCriteria();
      updateSummary();
    };
  }

  renderCriteria();
  updateSummary();

  document.getElementById('m-cancel').onclick = () => host.innerHTML='';
  document.getElementById('m-save').onclick = async () => {
    const name = document.getElementById('s-name').value.trim();
    if (!name){ toast('Nombre requerido','error'); return; }
    if (!criteria.length){ toast('Agrega al menos un criterio','error'); return; }
    if (criteria.some(c => !c.name?.trim())){ toast('Todos los criterios deben tener nombre','error'); return; }

    const totalMaxRubric = criteria.reduce((a,c) => a + (parseInt(c.max)||0), 0);
    const payload = {
      course_id: courseId,
      type: 'sustentacion',
      name,
      date: document.getElementById('s-date').value || null,
      topic: document.getElementById('s-topic').value.trim() || null,
      weight: parseFloat(document.getElementById('s-weight').value) || null,
      // max_points = suma de criterios. Antes se hardcodeaba a 20 (escalando),
      // ahora es directo: si dijiste max 10, la nota es /10.
      max_points: totalMaxRubric || 1,
      rubric: { criterios: criteria.map(c => ({ name:c.name.trim(), max:parseInt(c.max)||1, desc:c.desc?.trim()||'' })) },
    };

    let r;
    if (isEdit) r = await supabase.from('v5_activities').update(payload).eq('id', existing.id);
    else r = await supabase.from('v5_activities').insert(payload);
    if (r.error){ toast('Error: '+r.error.message,'error'); return; }

    toast(isEdit?'Actualizada':'Creada','success');
    host.innerHTML='';
    await loadAll();
    renderList(root, store);
  };
}

// ───── VISTA: CALIFICAR SUSTENTACIÓN ─────
async function openGradeView(root, store, sustId){
  activeSust = sustentaciones.find(s => s.id === sustId);
  if (!activeSust){ toast('No encontrada','error'); return; }
  pendingPts = {};
  activeGroupId = null;
  await loadAll(); // refrescar grades
  renderGradeView(root, store);
}

function renderGradeView(root, store){
  const rubric = activeSust.rubric?.criterios || [];
  const totalMaxRubric = rubric.reduce((a,c)=>a+(c.max||0), 0);
  const byGroup = gradedGroupsOf(activeSust.id);

  root.innerHTML = `
    <div class="card">
      <div class="card-row" style="justify-content:space-between">
        <button class="btn btn-out btn-xs" id="g-back">← Volver a la lista</button>
        <span style="font-size:11px;color:var(--ean-gray)">${rubric.length} criterios · nota /${activeSust.max_points}</span>
      </div>
      <h2 style="margin-top:8px">🏆 ${escape(activeSust.name)}${activeSust.date?` · ${activeSust.date}`:''}</h2>
      ${activeSust.topic?`<div style="font-size:12px;color:var(--ean-gray);margin-top:2px">${escape(activeSust.topic)}</div>`:''}
    </div>

    <div style="display:grid;grid-template-columns:1fr 320px;gap:14px;align-items:start">
      <!-- Calificador -->
      <div class="card">
        <div class="field">
          <label>Selecciona grupo a calificar</label>
          <select id="g-group">
            <option value="">— Selecciona —</option>
            ${groups.map(g => {
              const done = byGroup.has(g.id);
              const mems = membersOf(g.id);
              return `<option value="${g.id}">${done?'✅ ':'⏳ '}${escape(g.name)} (${mems.length} integrantes)${done?' — ya calificado':''}</option>`;
            }).join('')}
          </select>
        </div>

        <div id="g-members-info" style="margin-bottom:10px"></div>
        <div id="g-criteria"></div>
        <div id="g-total-bar" style="margin-top:12px"></div>

        <div class="field" style="margin-top:14px">
          <label>📝 Observaciones (líder, justificaciones, comentarios)</label>
          <textarea id="g-obs" rows="2" placeholder="Ej: LIDER: Juan Camacho · grupo destacado en presentación…" style="width:100%;font-family:inherit;font-size:13px;border:1px solid var(--ean-border);border-radius:6px;padding:8px;resize:vertical"></textarea>
        </div>

        <div style="text-align:right;margin-top:8px">
          <button class="btn btn-cyan btn-lg" id="g-save" disabled>💾 Guardar calificación</button>
        </div>
      </div>

      <!-- Historial al lado -->
      <div class="card" style="position:sticky;top:0">
        <h3>📋 Historial</h3>
        <div id="g-history" style="margin-top:8px"></div>
      </div>
    </div>
  `;

  document.getElementById('g-back').onclick = () => { activeSust = null; renderList(root, store); };
  document.getElementById('g-group').onchange = e => { loadGroupForGrading(e.target.value); };
  document.getElementById('g-save').onclick = () => saveGroupGrade(root, store);

  renderHistory();
}

function loadGroupForGrading(groupId){
  activeGroupId = groupId;
  pendingPts = {};
  presence = {};
  document.getElementById('g-obs').value = '';

  if (!groupId){
    document.getElementById('g-members-info').innerHTML = '';
    document.getElementById('g-criteria').innerHTML = '';
    document.getElementById('g-total-bar').innerHTML = '';
    document.getElementById('g-save').disabled = true;
    return;
  }

  const group = groups.find(g => g.id === groupId);
  const mems = membersOf(groupId);
  const leader = students.find(s => s.id === group.leader_student_id);

  // Cargar pts y obs si ya existen (cualquier grade del grupo en esta sustentación)
  const groupGrades = grades.filter(g => g.activity_id === activeSust.id && g.group_id === groupId);
  // raw_pts y observation grupal vienen del primer grade NO marcado como ausente
  const sample = groupGrades.find(g => !(g.observation||'').startsWith(ABSENT_PREFIX)) || groupGrades[0];
  if (sample?.raw_pts){
    // Filtrar campos no numéricos (pueden ser strings o objetos viejos)
    Object.entries(sample.raw_pts).forEach(([k,v]) => {
      if (!isNaN(parseInt(k))) pendingPts[parseInt(k)] = v;
    });
    const obs = sample.observation || '';
    document.getElementById('g-obs').value = obs.startsWith(ABSENT_PREFIX) ? '' : obs;
  }

  // Calcular presence: por defecto todos presentes; el que tiene grade con obs "AUSENTE..." → ausente
  mems.forEach(m => {
    const myGrade = groupGrades.find(g => g.student_id === m.id);
    if (myGrade && (myGrade.observation||'').startsWith(ABSENT_PREFIX)){
      presence[m.id] = false;
    } else {
      presence[m.id] = true;
    }
  });

  renderMembers(group, mems, leader);
  renderCriteriaGrading();
  updateTotal();
  document.getElementById('g-save').disabled = false;
}

function renderMembers(group, mems, leader){
  const presentCount = mems.filter(m => presence[m.id]).length;
  const absentCount = mems.length - presentCount;
  const div = document.getElementById('g-members-info');
  div.innerHTML = `
    <div style="background:#F0F4F8;padding:12px;border-radius:8px;font-size:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div>
          <b>${escape(group.name)}</b> · <b>${mems.length}</b> integrantes${leader?` · 👑 Líder: <b>${escape(leader.name)}</b>`:''}
        </div>
        <div style="display:flex;gap:6px">
          <span class="chip chip-green" style="font-size:10px;padding:2px 8px">✅ ${presentCount} presentes</span>
          ${absentCount > 0 ? `<span class="chip chip-red" style="font-size:10px;padding:2px 8px">❌ ${absentCount} ausentes</span>` : ''}
        </div>
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--ean-gray);font-style:italic">
        💡 Click ✏️ para marcar quién presentó. Los ausentes reciben nota 0.
      </div>
      <button type="button" class="btn btn-out btn-xs" id="g-edit-presence" style="margin-top:6px">
        ✏️ Editar presencia de integrantes
      </button>
      <div id="g-presence-list" style="display:none;margin-top:10px;display:none"></div>
    </div>
  `;

  document.getElementById('g-edit-presence').onclick = () => {
    const list = document.getElementById('g-presence-list');
    const isOpen = list.style.display === 'block';
    list.style.display = isOpen ? 'none' : 'block';
    document.getElementById('g-edit-presence').textContent = isOpen
      ? '✏️ Editar presencia de integrantes'
      : '▲ Cerrar edición de presencia';
    if (!isOpen){
      list.innerHTML = mems.map(m => {
        const isLeader = m.id === leader?.id;
        const isPresent = presence[m.id];
        return `
          <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#fff;border-radius:6px;border:1px solid var(--ean-border);margin-bottom:4px;cursor:pointer">
            <input type="checkbox" data-pid="${m.id}" ${isPresent?'checked':''} style="width:16px;height:16px">
            <span style="flex:1;font-size:12px">${escape(m.name)}${isLeader?' 👑':''}</span>
            <span class="chip ${isPresent?'chip-green':'chip-red'}" style="font-size:9px;padding:1px 6px">${isPresent?'Presente':'Ausente'}</span>
          </label>
        `;
      }).join('');

      list.querySelectorAll('input[data-pid]').forEach(cb => {
        cb.onchange = () => {
          presence[cb.dataset.pid] = cb.checked;
          // Re-render para actualizar contadores y chips
          renderMembers(group, mems, leader);
          // Reabrir la edición
          document.getElementById('g-edit-presence').click();
        };
      });
    }
  };
}

function renderCriteriaGrading(){
  const rubric = activeSust.rubric?.criterios || [];
  const div = document.getElementById('g-criteria');
  div.innerHTML = rubric.map((c,i) => {
    const sel = pendingPts[i] ?? null;
    const buttons = Array.from({length: c.max+1}, (_,v) => {
      const isSel = sel === v;
      return `<button class="pts-btn" data-i="${i}" data-v="${v}" style="
        width:32px;padding:6px 0;border:1px solid ${isSel?'var(--ean-cyan)':'var(--ean-border)'};
        background:${isSel?'var(--ean-cyan)':'#fff'};color:${isSel?'#fff':'var(--ean-dark)'};
        font-weight:${isSel?'700':'400'};border-radius:4px;cursor:pointer;font-size:13px;margin-right:3px">${v}</button>`;
    }).join('');
    return `
    <div style="padding:10px;border:1px solid var(--ean-border);border-radius:6px;margin-bottom:6px;background:#fafafa">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:start">
        <div style="flex:1">
          <div style="font-weight:700;font-size:13px">${escape(c.name)}</div>
          ${c.desc?`<div style="font-size:11px;color:var(--ean-gray);margin-top:2px">${escape(c.desc)}</div>`:''}
        </div>
        <div style="display:flex;gap:2px;flex-wrap:wrap;justify-content:flex-end;max-width:50%">${buttons}</div>
      </div>
    </div>
    `;
  }).join('');

  div.querySelectorAll('.pts-btn').forEach(b => b.onclick = () => {
    const i = +b.dataset.i, v = +b.dataset.v;
    pendingPts[i] = v;
    renderCriteriaGrading();
    updateTotal();
  });
}

function updateTotal(){
  const rubric = activeSust.rubric?.criterios || [];
  const totalMax = rubric.reduce((a,c)=>a+(c.max||0), 0);
  const totalActual = Object.values(pendingPts).reduce((a,v)=>a+(v||0), 0);
  // Si max_points == totalMax (caso normal después del fix), scaled = totalActual.
  // Si vienen distintos (sustentación vieja con max_points=20 hardcoded), se respeta el escalado.
  const scaled = totalMax > 0 ? Math.round((totalActual/totalMax)*activeSust.max_points) : 0;
  const lbl = sustLabel(scaled, activeSust.max_points);

  document.getElementById('g-total-bar').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;background:linear-gradient(135deg, var(--ean-dark), var(--ean-blue));color:#fff;border-radius:8px">
      <div>
        <div style="font-size:11px;opacity:.8">TOTAL</div>
        <div style="font-size:32px;font-weight:900">${scaled}<span style="font-size:18px;opacity:.8">/${activeSust.max_points}</span></div>
        ${scaled !== totalActual ? `<div style="font-size:10px;opacity:.7">(${totalActual} pts brutos escalados desde rúbrica)</div>` : ''}
      </div>
      <div style="text-align:right">
        <span class="chip ${lbl.cls}" style="font-size:14px;padding:6px 14px;font-weight:700">${lbl.label}</span>
      </div>
    </div>
  `;
}

async function saveGroupGrade(root, store){
  if (!activeGroupId) return;
  const rubric = activeSust.rubric?.criterios || [];
  const totalMax = rubric.reduce((a,c)=>a+(c.max||0), 0);
  const totalActual = Object.values(pendingPts).reduce((a,v)=>a+(v||0), 0);
  const scaled = totalMax > 0 ? Math.round((totalActual/totalMax)*activeSust.max_points) : 0;
  const desglose = rubric.map((c,i) => `${c.name}:${pendingPts[i]??0}`).join(' + ');
  const obsRaw = document.getElementById('g-obs').value.trim() || null;

  const mems = membersOf(activeGroupId);
  if (!mems.length){ toast('El grupo no tiene integrantes','error'); return; }

  // 1. Borrar grades viejas de este grupo en esta actividad (por si era edición)
  await supabase.from('v5_grades').delete().eq('activity_id', activeSust.id).eq('group_id', activeGroupId);

  // 2. Insertar una grade por cada integrante. Los ausentes reciben value=0
  //    con observation marcada con ABSENT_PREFIX para distinguirlos.
  const presentes = mems.filter(m => presence[m.id] !== false);
  const ausentes  = mems.filter(m => presence[m.id] === false);

  const rows = mems.map(m => {
    const isAbsent = presence[m.id] === false;
    return {
      activity_id: activeSust.id,
      student_id: m.id,
      group_id: activeGroupId,
      value: isAbsent ? 0 : scaled,
      raw_pts: isAbsent ? {} : pendingPts,
      desglose: isAbsent ? 'AUSENTE' : desglose,
      observation: isAbsent
        ? `${ABSENT_PREFIX} de ${activeSust.name}`
        : obsRaw,
      source: 'manual',
    };
  });

  const { error } = await supabase.from('v5_grades').upsert(rows, { onConflict: 'activity_id,student_id' });
  if (error){ toast('Error: '+error.message,'error'); return; }

  const ausenteMsg = ausentes.length ? ` (${ausentes.length} ausente${ausentes.length===1?'':'s'} con 0)` : '';
  toast(`✅ ${presentes.length} calificado${presentes.length===1?'':'s'} con ${scaled}/${activeSust.max_points}${ausenteMsg}`,'success');
  await loadAll();
  loadGroupForGrading(activeGroupId);  // recargar para que aparezca el ✅
  renderHistory();
  // refrescar dropdown para mostrar el ✅
  renderGradeView(root, store);
}

function renderHistory(){
  const div = document.getElementById('g-history');
  if (!div) return;
  const byGroup = gradedGroupsOf(activeSust.id);

  if (byGroup.size === 0){
    div.innerHTML = `<p class="empty-state" style="padding:10px;font-size:12px">Aún ningún grupo calificado.<br>Selecciona uno arriba para empezar.</p>`;
    return;
  }

  const items = [];
  groups.forEach(g => {
    const recs = byGroup.get(g.id);
    if (!recs?.length) return;
    const sample = recs[0];
    const lbl = sustLabel(sample.value || 0, activeSust.max_points);
    items.push({ group: g, value: sample.value, label: lbl, count: recs.length, obs: sample.observation });
  });

  div.innerHTML = `
    <div style="font-size:10px;color:var(--ean-gray);margin-bottom:6px;font-style:italic">
      💡 Click en un grupo para editar su nota
    </div>
    ${items.map(it => `
    <div class="hist-row" data-load="${it.group.id}" style="
      padding:8px;border:1px solid var(--ean-border);border-radius:6px;margin-bottom:6px;
      background:#fafafa;cursor:pointer;transition:.15s;display:flex;justify-content:space-between;gap:6px">
      <div style="flex:1;min-width:0">
        <b style="font-size:12px">${escape(it.group.name)}</b>
        <div style="font-size:10px;color:var(--ean-gray)">${it.count} integrantes</div>
        ${it.obs?`<div style="font-size:10px;color:var(--ean-gray);font-style:italic;margin-top:2px">${escape(it.obs.substring(0,80))}${it.obs.length>80?'…':''}</div>`:''}
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:18px;font-weight:900">${it.value}</div>
        <span class="chip ${it.label.cls}" style="font-size:9px;padding:1px 6px">${it.label.label}</span>
      </div>
    </div>
  `).join('')}`;

  // Hacer cada fila del historial clickable para cargar ese grupo en edición
  div.querySelectorAll('.hist-row').forEach(row => {
    row.onclick = () => {
      const gid = row.dataset.load;
      const sel = document.getElementById('g-group');
      if (sel) sel.value = gid;
      loadGroupForGrading(gid);
      // Scroll al área de calificación
      document.getElementById('g-criteria')?.scrollIntoView({ behavior:'smooth', block:'start' });
    };
    row.onmouseover = () => { row.style.background = 'var(--ean-cyan-soft)'; row.style.borderColor = 'var(--ean-cyan)'; };
    row.onmouseout = () => { row.style.background = '#fafafa'; row.style.borderColor = 'var(--ean-border)'; };
  });
}

const escape = s => String(s||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const escapeAttr = s => escape(s).replace(/"/g,'&quot;');
