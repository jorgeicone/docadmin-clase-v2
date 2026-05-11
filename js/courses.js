// CRUD de cursos: lista, crear, editar, eliminar, activar
import { supabase, currentSession } from './supabase-client.js';
import { toast } from './toast.js';

// Paleta de 8 colores para cards de cursos
const COURSE_COLORS = {
  cyan:    { name:'Cyan',    main:'#1AC8DB', soft:'rgba(26,200,219,.10)',  glow:'rgba(26,200,219,.35)' },
  purple:  { name:'Púrpura', main:'#7A3CFF', soft:'rgba(122,60,255,.10)',  glow:'rgba(122,60,255,.35)' },
  blue:    { name:'Azul',    main:'#3055A6', soft:'rgba(48,85,166,.10)',   glow:'rgba(48,85,166,.35)'  },
  green:   { name:'Verde',   main:'#1FAA59', soft:'rgba(31,170,89,.10)',   glow:'rgba(31,170,89,.35)'  },
  orange:  { name:'Naranja', main:'#FF8A3C', soft:'rgba(255,138,60,.10)',  glow:'rgba(255,138,60,.35)' },
  pink:    { name:'Rosa',    main:'#E91E63', soft:'rgba(233,30,99,.10)',   glow:'rgba(233,30,99,.35)'  },
  yellow:  { name:'Amarillo',main:'#F9C911', soft:'rgba(249,201,17,.12)',  glow:'rgba(249,201,17,.40)' },
  red:     { name:'Rojo',    main:'#D7263D', soft:'rgba(215,38,61,.10)',   glow:'rgba(215,38,61,.35)'  },
};
const COLOR_KEYS = Object.keys(COURSE_COLORS);

// Color asignado a un curso (con fallback hash determinístico)
function colorOf(courseId){
  const saved = localStorage.getItem('course_color_' + courseId);
  if (saved && COURSE_COLORS[saved]) return saved;
  // Hash simple del UUID para asignar color inicial
  let h = 0;
  for (let i = 0; i < courseId.length; i++) h = (h * 31 + courseId.charCodeAt(i)) >>> 0;
  return COLOR_KEYS[h % COLOR_KEYS.length];
}
function setColorOf(courseId, color){
  if (!COURSE_COLORS[color]) return;
  localStorage.setItem('course_color_' + courseId, color);
}

export async function mountCourses(root, store){
  root.innerHTML = `
    <div class="card">
      <div class="card-row" style="justify-content:space-between">
        <h2>📋 Mis cursos</h2>
        <button class="btn btn-cyan" id="btn-new-course">＋ Nuevo curso</button>
      </div>
      <div id="course-list" style="margin-top:14px"><p class="empty-state">Cargando…</p></div>
    </div>

    <div id="course-modal-host"></div>
  `;

  document.getElementById('btn-new-course').onclick = () => {
    const maxAllowed = store.maxCourses ? store.maxCourses() : 999;
    const currentCount = store.courses?.length || 0;
    if (currentCount >= maxAllowed){
      const nextPlan = store.plan === 'trial' ? 'Starter' : store.plan === 'starter' ? 'Pro' : 'Premium';
      toast(`Tu plan ${store.plan.toUpperCase()} permite ${maxAllowed} curso${maxAllowed===1?'':'s'}. Actualiza a ${nextPlan} para crear más.`, 'error');
      setTimeout(() => store.openPlan(), 1500);
      return;
    }
    openCourseModal(null, ()=>renderList(store));
  };
  await renderList(store);
}

async function renderList(store){
  const list = document.getElementById('course-list');
  // P0.5 mobile fix: usar store.user (poblado por onAuthStateChange/getSession)
  // en vez de currentUser() (=getUser, network call). En mobile lento esto colgaba
  // la vista en "Cargando…" indefinidamente esperando /auth/v1/user.
  const u = store.user;
  if (!u){ list.innerHTML = '<p class="empty-state">Sesión expirada.</p>'; return; }

  const { data, error } = await supabase.from('v5_courses').select('*').order('created_at',{ascending:false});
  if (error){ list.innerHTML = `<p class="empty-state" style="color:var(--red)">Error: ${error.message}</p>`; return; }

  store.courses = data || [];

  if (!data?.length){
    list.innerHTML = `<p class="empty-state">No tienes cursos aún. Crea el primero arriba.</p>`;
    return;
  }

  list.innerHTML = `
    <div class="grid-3">
      ${data.map(c => {
        const colorKey = colorOf(c.id);
        const col = COURSE_COLORS[colorKey];
        return `
        <div class="course-card" data-id="${c.id}" style="
          --c-main:${col.main}; --c-soft:${col.soft}; --c-glow:${col.glow};">
          <div class="course-card-top">
            <div style="flex:1;min-width:0">
              <h3 class="course-name">${escape(c.name)}</h3>
              <div class="course-meta">
                ${c.code ? '<span class="course-meta-code">'+escape(c.code)+'</span>' : ''}
                ${c.credits ? '<span class="course-meta-pill">'+c.credits+' créd</span>':''}
                ${c.start_date ? '<span class="course-meta-pill">'+c.start_date+' → '+(c.end_date||'?')+'</span>':''}
              </div>
            </div>
            <div class="course-actions">
              <button class="course-action-btn" data-color="${c.id}" title="Cambiar color">🎨</button>
              <button class="course-action-btn" data-edit="${c.id}" title="Editar">✏️</button>
              <button class="course-action-btn course-action-danger" data-del="${c.id}" title="Eliminar">🗑</button>
            </div>
          </div>
          <button class="btn course-open-btn" data-open="${c.id}">
            <span>Abrir curso</span>
            <span style="font-size:18px;line-height:1">→</span>
          </button>
        </div>
      `}).join('')}
    </div>

    <!-- Popover de color (oculto por defecto) -->
    <div id="color-popover" class="color-popover" style="display:none">
      <div class="color-popover-title">Color del curso</div>
      <div class="color-popover-grid">
        ${COLOR_KEYS.map(k => `
          <button class="color-swatch" data-pick="${k}" title="${COURSE_COLORS[k].name}"
            style="background:${COURSE_COLORS[k].main}"></button>
        `).join('')}
      </div>
    </div>
  `;

  list.querySelectorAll('[data-open]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const c = data.find(x=>x.id===b.dataset.open);
    if (c) store.setActiveCourse(c);
  });
  list.querySelectorAll('[data-edit]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const c = data.find(x=>x.id===b.dataset.edit);
    openCourseModal(c, ()=>renderList(store));
  });
  list.querySelectorAll('[data-del]').forEach(b => b.onclick = async (e) => {
    e.stopPropagation();
    const c = data.find(x=>x.id===b.dataset.del);
    if (!confirm(`¿Eliminar curso "${c.name}"?\nSe perderán todos los estudiantes, grupos y notas asociados.`)) return;
    const { error } = await supabase.from('v5_courses').delete().eq('id', c.id);
    if (error) toast('Error: '+error.message,'error');
    else { toast('Curso eliminado'); renderList(store); }
  });

  // Popover de color: abrir al click en 🎨
  const popover = document.getElementById('color-popover');
  let popoverCourseId = null;
  list.querySelectorAll('[data-color]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    popoverCourseId = b.dataset.color;
    const rect = b.getBoundingClientRect();
    popover.style.display = 'block';
    popover.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    popover.style.left = (rect.left + window.scrollX - 80) + 'px';
  });
  popover.querySelectorAll('[data-pick]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    if (popoverCourseId) setColorOf(popoverCourseId, b.dataset.pick);
    popover.style.display = 'none';
    renderList(store);
  });
  // Cerrar popover al click fuera
  document.addEventListener('click', () => { popover.style.display = 'none'; }, { once:true });
}

function openCourseModal(course, onDone){
  const isEdit = !!course;
  const host = document.getElementById('course-modal-host');
  host.innerHTML = `
    <div class="modal-bg">
      <div class="modal">
        <h2>${isEdit?'✏️ Editar':'＋ Nuevo'} curso</h2>
        <div class="grid-2">
          <div class="field"><label>Nombre *</label><input id="f-name" value="${escapeAttr(course?.name||'')}" required></div>
          <div class="field"><label>Código</label><input id="f-code" value="${escapeAttr(course?.code||'')}" placeholder="Ej: AFPN0093"></div>
          <div class="field"><label>Créditos</label><input id="f-credits" type="number" value="${course?.credits??''}" min="0"></div>
          <div class="field"><label>Sesiones / semana</label><input id="f-spw" type="number" value="${course?.sessions_per_week??''}" min="0"></div>
          <div class="field"><label>Horas / sesión</label><input id="f-hps" type="number" step="0.5" value="${course?.hours_per_session??''}" min="0"></div>
          <div class="field"><label>Fecha inicio</label><input id="f-start" type="date" value="${course?.start_date||''}"></div>
          <div class="field"><label>Fecha fin</label><input id="f-end" type="date" value="${course?.end_date||''}"></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-out" id="m-cancel">Cancelar</button>
          <button class="btn" id="m-save">${isEdit?'Guardar cambios':'Crear curso'}</button>
        </div>
      </div>
    </div>
  `;

  const close = () => host.innerHTML = '';
  document.getElementById('m-cancel').onclick = close;

  document.getElementById('m-save').onclick = async () => {
    const btn = document.getElementById('m-save');
    btn.disabled = true; btn.textContent = 'Guardando…';

    const payload = {
      name: document.getElementById('f-name').value.trim(),
      code: document.getElementById('f-code').value.trim() || null,
      credits: parseInt(document.getElementById('f-credits').value) || null,
      sessions_per_week: parseInt(document.getElementById('f-spw').value) || null,
      hours_per_session: parseFloat(document.getElementById('f-hps').value) || null,
      start_date: document.getElementById('f-start').value || null,
      end_date: document.getElementById('f-end').value || null,
    };
    if (!payload.name){
      toast('El nombre es requerido','error');
      btn.disabled = false; btn.textContent = isEdit ? 'Guardar cambios' : 'Crear curso';
      return;
    }

    try {
      let result;
      if (isEdit){
        result = await supabase.from('v5_courses').update(payload).eq('id', course.id);
      } else {
        // Bug fix: currentUser() (network) podía colgarse con token expirado.
        // Usamos getSession() (localStorage) que es instantáneo y robusto.
        const session = await currentSession();
        const u = session?.user;
        if (!u){
          toast('Sesión expirada — recarga la página','error');
          btn.disabled = false; btn.textContent = 'Crear curso';
          return;
        }
        payload.user_id = u.id;
        result = await supabase.from('v5_courses').insert(payload);
      }
      if (result.error){
        toast('Error: '+result.error.message,'error');
        btn.disabled = false; btn.textContent = isEdit ? 'Guardar cambios' : 'Crear curso';
        return;
      }
      toast(isEdit?'Curso actualizado':'Curso creado','success');
      close();
      onDone?.();
    } catch(e){
      toast('Error inesperado: '+(e?.message||e),'error');
      btn.disabled = false; btn.textContent = isEdit ? 'Guardar cambios' : 'Crear curso';
    }
  };
}

const escape = s => String(s||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const escapeAttr = s => escape(s).replace(/"/g,'&quot;');
