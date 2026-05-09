// Roster de estudiantes con import desde Excel
import { supabase } from './supabase-client.js';
import { toast } from './toast.js';

export async function mountStudents(root, store){
  const courseId = store.activeCourse.id;
  root.innerHTML = `
    <div class="card">
      <div class="card-row" style="justify-content:space-between">
        <h2>👥 Estudiantes — ${escape(store.activeCourse.name)}</h2>
        <div style="display:flex;gap:8px">
          <button class="btn btn-out" id="btn-import">📥 Importar Excel</button>
          <button class="btn btn-cyan" id="btn-add">＋ Agregar manual</button>
        </div>
      </div>
      <div id="stu-info" style="margin-top:8px;font-size:12px;color:var(--ean-gray)"></div>
      <div id="stu-list" style="margin-top:14px"><p class="empty-state">Cargando…</p></div>
    </div>

    <div id="stu-modal-host"></div>
  `;

  document.getElementById('btn-add').onclick = () => openStudentModal(courseId, null, ()=>renderList(courseId));
  document.getElementById('btn-import').onclick = () => openImportModal(courseId, ()=>renderList(courseId));

  await renderList(courseId);
}

async function renderList(courseId){
  const list = document.getElementById('stu-list');
  const info = document.getElementById('stu-info');
  const { data, error } = await supabase.from('v5_students').select('*').eq('course_id', courseId).order('name');
  if (error){ list.innerHTML = `<p class="empty-state" style="color:var(--red)">Error: ${error.message}</p>`; return; }

  info.textContent = `${data.length} estudiante${data.length===1?'':'s'} en este curso`;

  if (!data.length){
    list.innerHTML = `<p class="empty-state">Aún no hay estudiantes. Importa un Excel o agrega manualmente.</p>`;
    return;
  }

  list.innerHTML = `
    <div class="tbl-wrap">
      <table>
        <thead><tr><th>#</th><th>Cédula</th><th>Nombre</th><th>Email</th><th class="num">Acciones</th></tr></thead>
        <tbody>
          ${data.map((s,i)=>`
            <tr>
              <td class="num">${i+1}</td>
              <td><code>${escape(s.cedula)}</code></td>
              <td><b>${escape(s.name)}</b></td>
              <td>${escape(s.email||'—')}</td>
              <td class="num">
                <button class="btn btn-xs btn-out" data-edit="${s.id}">✏️</button>
                <button class="btn btn-xs btn-danger" data-del="${s.id}">🗑</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  list.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{
    const s = data.find(x=>x.id===b.dataset.edit);
    openStudentModal(courseId, s, ()=>renderList(courseId));
  });
  list.querySelectorAll('[data-del]').forEach(b=>b.onclick=async ()=>{
    const s = data.find(x=>x.id===b.dataset.del);
    if (!confirm(`¿Eliminar a ${s.name}? Sus notas también se eliminarán.`)) return;
    const { error } = await supabase.from('v5_students').delete().eq('id', s.id);
    if (error) toast('Error: '+error.message,'error');
    else { toast('Eliminado'); renderList(courseId); }
  });
}

function openStudentModal(courseId, student, onDone){
  const isEdit = !!student;
  const host = document.getElementById('stu-modal-host');
  host.innerHTML = `
    <div class="modal-bg">
      <div class="modal">
        <h2>${isEdit?'Editar':'Agregar'} estudiante</h2>
        <div class="field"><label>Cédula *</label><input id="f-ced" value="${escapeAttr(student?.cedula||'')}"></div>
        <div class="field"><label>Nombre completo *</label><input id="f-nom" value="${escapeAttr(student?.name||'')}"></div>
        <div class="field"><label>Email</label><input id="f-email" type="email" value="${escapeAttr(student?.email||'')}"></div>
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
      cedula: document.getElementById('f-ced').value.trim(),
      name: document.getElementById('f-nom').value.trim(),
      email: document.getElementById('f-email').value.trim() || null,
    };
    if (!payload.cedula || !payload.name){ toast('Cédula y nombre requeridos','error'); return; }
    let r;
    if (isEdit) r = await supabase.from('v5_students').update(payload).eq('id', student.id);
    else { payload.course_id = courseId; r = await supabase.from('v5_students').insert(payload); }
    if (r.error){ toast('Error: '+r.error.message,'error'); return; }
    toast(isEdit?'Actualizado':'Agregado','success');
    host.innerHTML='';
    onDone?.();
  };
}

function openImportModal(courseId, onDone){
  const host = document.getElementById('stu-modal-host');
  host.innerHTML = `
    <div class="modal-bg">
      <div class="modal" style="max-width:720px">
        <h2>📥 Importar estudiantes desde Excel</h2>
        <p style="font-size:12px;color:var(--ean-gray);margin-bottom:12px">
          Sube un .xlsx o .csv. Debe tener al menos las columnas: <b>cédula</b> (o documento/id) y <b>nombre</b> (o estudiante).
          La app detecta automáticamente las columnas. Los duplicados se ignoran.
        </p>
        <div class="dropzone" id="dz">
          <div class="icon">📊</div>
          <div><b>Arrastra tu Excel aquí</b> o haz click para seleccionar</div>
          <div class="hint">.xlsx, .xls, .csv</div>
          <input type="file" id="f-file" accept=".xlsx,.xls,.csv" style="display:none">
        </div>
        <div id="preview-area" style="margin-top:14px"></div>
        <div class="modal-actions">
          <button class="btn btn-out" id="m-cancel">Cerrar</button>
          <button class="btn btn-cyan" id="m-import" disabled>Importar</button>
        </div>
      </div>
    </div>
  `;

  const dz = document.getElementById('dz');
  const fileInput = document.getElementById('f-file');
  let parsed = null;

  dz.onclick = () => fileInput.click();
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('dragover'); };
  dz.ondragleave = () => dz.classList.remove('dragover');
  dz.ondrop = e => {
    e.preventDefault(); dz.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };
  fileInput.onchange = () => fileInput.files[0] && handleFile(fileInput.files[0]);

  async function handleFile(f){
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rows.length){ toast('El archivo está vacío','error'); return; }

    // Detectar columnas: cédula y nombre con tolerancia
    const sample = rows[0];
    const keys = Object.keys(sample);
    const cedKey = keys.find(k => /c[ée]dula|documento|^id$|identificaci/i.test(k));
    const nomKey = keys.find(k => /nombre|estudiante|alumno|apellido/i.test(k));
    const emailKey = keys.find(k => /correo|email|e-mail/i.test(k));

    if (!cedKey || !nomKey){
      document.getElementById('preview-area').innerHTML = `
        <div class="login-error">No detecté las columnas. Encontré: ${keys.map(k=>'<code>'+escape(k)+'</code>').join(', ')}.<br>
        Asegúrate de tener al menos columnas de cédula y nombre.</div>`;
      return;
    }

    parsed = rows.map(r => ({
      cedula: String(r[cedKey]).trim(),
      name:   String(r[nomKey]).trim(),
      email:  emailKey ? String(r[emailKey]||'').trim() || null : null,
    })).filter(s => s.cedula && s.name);

    document.getElementById('preview-area').innerHTML = `
      <div class="preview-header">
        <span><b>${parsed.length}</b> estudiantes detectados</span>
        <span style="font-size:11px;color:var(--ean-gray)">Cédula: <b>${escape(cedKey)}</b> · Nombre: <b>${escape(nomKey)}</b>${emailKey?' · Email: <b>'+escape(emailKey)+'</b>':''}</span>
      </div>
      <div class="tbl-wrap" style="max-height:300px">
        <table>
          <thead><tr><th>#</th><th>Cédula</th><th>Nombre</th><th>Email</th></tr></thead>
          <tbody>
            ${parsed.slice(0,15).map((s,i)=>`<tr><td class="num">${i+1}</td><td><code>${escape(s.cedula)}</code></td><td>${escape(s.name)}</td><td>${escape(s.email||'—')}</td></tr>`).join('')}
            ${parsed.length>15?`<tr><td colspan="4" style="text-align:center;font-style:italic;color:var(--ean-gray)">… ${parsed.length-15} más</td></tr>`:''}
          </tbody>
        </table>
      </div>
    `;
    document.getElementById('m-import').disabled = false;
  }

  document.getElementById('m-cancel').onclick = () => host.innerHTML='';
  document.getElementById('m-import').onclick = async () => {
    if (!parsed?.length) return;
    const btn = document.getElementById('m-import');
    btn.disabled = true; btn.textContent = 'Importando…';
    const payload = parsed.map(s => ({ ...s, course_id: courseId }));
    const { data, error } = await supabase.from('v5_students').upsert(payload, { onConflict: 'course_id,cedula', ignoreDuplicates: false }).select();
    if (error){ toast('Error: '+error.message,'error'); btn.disabled=false; btn.textContent='Importar'; return; }
    toast(`✅ ${data?.length||parsed.length} estudiantes importados`,'success');
    host.innerHTML='';
    onDone?.();
  };
}

const escape = s => String(s||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const escapeAttr = s => escape(s).replace(/"/g,'&quot;');
