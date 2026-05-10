// Roster de estudiantes con import desde Excel
import { supabase } from './supabase-client.js';
import { toast } from './toast.js';
import { loadXLSX } from './xlsx-loader.js';

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
    <details class="acc acc-block" open>
      <summary>
        <span class="acc-label">👥 Todos los estudiantes (${data.length})</span>
      </summary>
      <div class="tbl-wrap" style="margin-top:10px">
      <table>
        <thead><tr><th>#</th><th>Cédula</th><th>Nombre y datos extra</th><th>Email</th><th class="num">Acciones</th></tr></thead>
        <tbody>
          ${data.map((s,i)=>{
            const meta = s.metadata && typeof s.metadata === 'object' ? s.metadata : {};
            const metaKeys = Object.keys(meta).filter(k => meta[k] !== '' && meta[k] !== null);
            return `
            <tr>
              <td class="num" style="vertical-align:top">${i+1}</td>
              <td style="vertical-align:top"><code>${escape(s.cedula)}</code></td>
              <td>
                <b>${escape(s.name)}</b>
                ${metaKeys.length ? `<details class="acc">
                  <summary>Ver ${metaKeys.length} dato${metaKeys.length===1?'':'s'} extra</summary>
                  <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">
                    ${metaKeys.map(k=>`<span class="chip" title="${escapeAttr(k)}" style="font-size:10px;padding:2px 6px"><b>${escape(k)}:</b> ${escape(String(meta[k]).substring(0,40))}</span>`).join('')}
                  </div>
                </details>`:''}
              </td>
              <td style="vertical-align:top">${escape(s.email||'—')}</td>
              <td class="num" style="vertical-align:top">
                <button class="btn btn-xs btn-out" data-edit="${s.id}">✏️</button>
                <button class="btn btn-xs btn-danger" data-del="${s.id}">🗑</button>
              </td>
            </tr>`}).join('')}
        </tbody>
      </table>
      </div>
    </details>
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

  let rawRows = null, rawKeys = null;

  async function handleFile(f){
    let XLSX;
    try { XLSX = await loadXLSX(); }
    catch(e){ toast(e.message,'error'); return; }
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rawRows.length){ toast('El archivo está vacío','error'); return; }
    rawKeys = Object.keys(rawRows[0]);

    // Auto-detect con regex amplio (cubre formatos universitarios)
    const guess = guessColumns(rawKeys);
    renderColumnPicker(guess);
    refreshPreview();
  }

  function guessColumns(keys){
    const norm = s => s.toLowerCase().replace(/[áéíóúñ]/g,c=>({á:'a',é:'e',í:'i',ó:'o',ú:'u',ñ:'n'}[c])).replace(/[°º.]/g,'').trim();
    const find = patterns => keys.find(k => patterns.some(p => p.test(norm(k))));
    return {
      cedula: find([/^n.?\s*matricul/, /^matricul/, /\bcedula\b/, /\bdocumento\b/, /^numero\s*id$/, /\bid\s*(estudiante|alumno)/, /^id$/, /identificaci/]),
      nombre: find([/^estudiante$/, /^alumno$/, /\bnombre.*estudiante/, /\bnombre.*completo/, /\bapellidos.*nombres/, /^nombre$/]),
      email:  find([/email.*estudiante/, /correo.*estudiante/, /^email$/, /^correo$/, /correo.*electr/, /e-?mail/]),
    };
  }

  function renderColumnPicker(guess){
    const opts = ['<option value="">— Selecciona —</option>', ...rawKeys.map(k => `<option value="${escapeAttr(k)}">${escape(k)}</option>`)];
    const optsOpt = ['<option value="">(ninguna)</option>', ...rawKeys.map(k => `<option value="${escapeAttr(k)}">${escape(k)}</option>`)];
    const usedKeys = [guess.cedula, guess.nombre, guess.email].filter(Boolean);
    const extras = rawKeys.filter(k => !usedKeys.includes(k));

    document.getElementById('preview-area').innerHTML = `
      <div class="card-row" style="background:#FFF8E1;padding:12px;border-radius:8px;margin-bottom:12px;flex-direction:column;align-items:stretch;gap:10px">
        <div style="font-size:12px;color:#E65100"><b>Mapea las columnas:</b> ${guess.cedula||guess.nombre?'detecté algunas, ajusta si hace falta.':'no detecté ninguna automáticamente — selecciónalas manualmente.'}</div>
        <div class="grid-3">
          <div class="field" style="margin:0">
            <label>Columna de cédula *</label>
            <select id="map-ced">${opts.map(o => o.includes(`value="${escapeAttr(guess.cedula||'')}"`) && guess.cedula ? o.replace('<option','<option selected') : o).join('')}</select>
          </div>
          <div class="field" style="margin:0">
            <label>Columna de nombre *</label>
            <select id="map-nom">${opts.map(o => o.includes(`value="${escapeAttr(guess.nombre||'')}"`) && guess.nombre ? o.replace('<option','<option selected') : o).join('')}</select>
          </div>
          <div class="field" style="margin:0">
            <label>Columna de email (opcional)</label>
            <select id="map-email">${optsOpt.map(o => o.includes(`value="${escapeAttr(guess.email||'')}"`) && guess.email ? o.replace('<option','<option selected') : o).join('')}</select>
          </div>
        </div>
      </div>

      <details style="background:#F0F4F8;padding:10px 12px;border-radius:8px;margin-bottom:12px">
        <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--ean-blue)">
          📦 Incluir más columnas como datos extra (opcional) — ${extras.length} disponibles
        </summary>
        <div style="margin-top:10px;font-size:12px;color:var(--ean-gray)">
          Estas columnas se guardan en cada estudiante. Útil para programa, plan, campus, horario, etc.
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px;margin-top:10px" id="extras-grid">
          ${extras.map(k => `
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;background:#fff;padding:6px 10px;border-radius:6px;border:1px solid var(--ean-border);cursor:pointer">
              <input type="checkbox" class="extra-cb" value="${escapeAttr(k)}" style="width:14px;height:14px"> ${escape(k)}
            </label>
          `).join('')}
        </div>
        <div style="margin-top:8px;display:flex;gap:6px">
          <button type="button" class="btn btn-xs btn-out" id="extras-all">Marcar todas</button>
          <button type="button" class="btn btn-xs btn-out" id="extras-none">Ninguna</button>
        </div>
      </details>

      <div id="preview-table"></div>
    `;
    document.getElementById('map-ced').onchange = refreshPreview;
    document.getElementById('map-nom').onchange = refreshPreview;
    document.getElementById('map-email').onchange = refreshPreview;
    document.querySelectorAll('.extra-cb').forEach(cb => cb.onchange = refreshPreview);
    document.getElementById('extras-all').onclick = () => {
      document.querySelectorAll('.extra-cb').forEach(cb => cb.checked = true);
      refreshPreview();
    };
    document.getElementById('extras-none').onclick = () => {
      document.querySelectorAll('.extra-cb').forEach(cb => cb.checked = false);
      refreshPreview();
    };
  }

  function refreshPreview(){
    const cedKey   = document.getElementById('map-ced').value;
    const nomKey   = document.getElementById('map-nom').value;
    const emailKey = document.getElementById('map-email').value;
    const tbl = document.getElementById('preview-table');
    const importBtn = document.getElementById('m-import');

    if (!cedKey || !nomKey){
      parsed = null;
      importBtn.disabled = true;
      tbl.innerHTML = `<p class="empty-state">Selecciona las columnas de cédula y nombre para continuar.</p>`;
      return;
    }

    const extraKeys = [...document.querySelectorAll('.extra-cb:checked')].map(cb => cb.value);

    const all = rawRows.map(r => {
      const meta = {};
      extraKeys.forEach(k => {
        const v = r[k];
        if (v !== '' && v !== null && v !== undefined) meta[k] = typeof v === 'string' ? v.trim() : v;
      });
      return {
        cedula: String(r[cedKey]||'').trim(),
        name:   String(r[nomKey]||'').trim(),
        email:  emailKey ? (String(r[emailKey]||'').trim() || null) : null,
        metadata: meta,
      };
    }).filter(s => s.cedula && s.name);

    // Deduplicar por cédula (Excel suele tener al estudiante en varias listas/secciones)
    const seen = new Set();
    parsed = all.filter(s => seen.has(s.cedula) ? false : (seen.add(s.cedula), true));
    const dupCount = all.length - parsed.length;

    if (!parsed.length){
      tbl.innerHTML = `<p class="empty-state" style="color:var(--red)">No quedaron filas válidas con esas columnas.</p>`;
      importBtn.disabled = true;
      return;
    }

    const extraColCount = extraKeys.length;
    tbl.innerHTML = `
      <div class="preview-header">
        <span><b>${parsed.length}</b> estudiantes únicos listos para importar
          ${extraColCount>0?`<span class="chip chip-cyan" style="margin-left:6px">+${extraColCount} columna${extraColCount===1?'':'s'} extra</span>`:''}
        </span>
        ${dupCount>0?`<span style="font-size:11px;color:var(--ean-gray)">🔁 <b>${dupCount}</b> duplicado${dupCount===1?'':'s'} eliminado${dupCount===1?'':'s'}</span>`:''}
      </div>
      <div class="tbl-wrap" style="max-height:300px">
        <table>
          <thead><tr><th>#</th><th>Cédula</th><th>Nombre</th><th>Email</th>${extraKeys.map(k=>`<th>${escape(k)}</th>`).join('')}</tr></thead>
          <tbody>
            ${parsed.slice(0,15).map((s,i)=>`
              <tr>
                <td class="num">${i+1}</td>
                <td><code>${escape(s.cedula)}</code></td>
                <td>${escape(s.name)}</td>
                <td>${escape(s.email||'—')}</td>
                ${extraKeys.map(k=>`<td>${escape(String(s.metadata?.[k]??'—'))}</td>`).join('')}
              </tr>`).join('')}
            ${parsed.length>15?`<tr><td colspan="${4+extraKeys.length}" style="text-align:center;font-style:italic;color:var(--ean-gray)">… ${parsed.length-15} más</td></tr>`:''}
          </tbody>
        </table>
      </div>
    `;
    importBtn.disabled = false;
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
