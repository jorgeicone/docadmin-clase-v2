// CRUD de cursos: lista, crear, editar, eliminar, activar
import { supabase, currentSession } from './supabase-client.js';
import { toast } from './toast.js';

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
      ${data.map(c => `
        <div class="card" style="margin:0;cursor:pointer;border-left:4px solid var(--ean-cyan)" data-id="${c.id}">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
            <div style="flex:1">
              <h3 style="margin-bottom:4px">${escape(c.name)}</h3>
              <div style="font-size:11px;color:var(--ean-gray)">
                ${c.code ? '<b>'+escape(c.code)+'</b> · ' : ''}
                ${c.credits ? c.credits+' créd · ':''}
                ${c.start_date ? c.start_date+' → '+(c.end_date||'?'):''}
              </div>
            </div>
            <div style="display:flex;gap:4px;flex-direction:column">
              <button class="btn btn-xs btn-out" data-edit="${c.id}">✏️</button>
              <button class="btn btn-xs btn-danger" data-del="${c.id}">🗑</button>
            </div>
          </div>
          <button class="btn btn-cyan" style="width:100%;margin-top:10px" data-open="${c.id}">Abrir →</button>
        </div>
      `).join('')}
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
