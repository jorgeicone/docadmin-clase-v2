// Roster de estudiantes con import desde Excel
import { supabase } from './supabase-client.js';
import { toast } from './toast.js';
import { loadXLSX } from './xlsx-loader.js';

// Campos extra del curso (definidos por el profe o detectados al importar Excel).
// Se guardan en localStorage por curso para que estén disponibles al editar
// estudiantes aunque ninguno aún tenga datos en esa columna.
function getCourseExtraKeys(courseId){
  const saved = localStorage.getItem('course_meta_keys_' + courseId);
  if (saved){ try { return JSON.parse(saved); } catch(e){} }
  return [];
}
function setCourseExtraKeys(courseId, keys){
  // Unique + non-empty
  const uniq = [...new Set(keys.filter(k => k && k.trim()))];
  localStorage.setItem('course_meta_keys_' + courseId, JSON.stringify(uniq));
}
function addCourseExtraKeys(courseId, newKeys){
  const cur = getCourseExtraKeys(courseId);
  setCourseExtraKeys(courseId, [...cur, ...newKeys]);
}

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

  document.getElementById('btn-add').onclick = async () => {
    const { data } = await supabase.from('v5_students').select('metadata').eq('course_id', courseId);
    const rosterMeta = (data || []).map(d => d.metadata).filter(m => m && typeof m === 'object');
    openStudentModal(courseId, null, ()=>renderList(courseId), rosterMeta);
  };
  document.getElementById('btn-import').onclick = () => openImportModal(courseId, ()=>renderList(courseId));

  // Botón nuevo: configurar campos extras del curso (sin importar Excel)
  if (!document.getElementById('btn-configure-fields')){
    const btnRow = document.getElementById('btn-add').parentElement;
    const btnCfg = document.createElement('button');
    btnCfg.id = 'btn-configure-fields';
    btnCfg.className = 'btn btn-out';
    btnCfg.title = 'Define los campos extras del curso (programa, plan, campus, etc.)';
    btnCfg.innerHTML = '⚙️ Campos del curso';
    btnCfg.onclick = () => openCourseFieldsModal(courseId, () => renderList(courseId));
    btnRow.insertBefore(btnCfg, document.getElementById('btn-import'));
  }
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

  // Lista de metadata de TODO el curso, para que el modal sepa qué campos existen
  const rosterMeta = data.map(d => d.metadata).filter(m => m && typeof m === 'object');
  list.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{
    const s = data.find(x=>x.id===b.dataset.edit);
    openStudentModal(courseId, s, ()=>renderList(courseId), rosterMeta);
  });
  list.querySelectorAll('[data-del]').forEach(b=>b.onclick=async ()=>{
    const s = data.find(x=>x.id===b.dataset.del);
    if (!confirm(`¿Eliminar a ${s.name}? Sus notas también se eliminarán.`)) return;
    const { error } = await supabase.from('v5_students').delete().eq('id', s.id);
    if (error) toast('Error: '+error.message,'error');
    else { toast('Eliminado'); renderList(courseId); }
  });
}

function openStudentModal(courseId, student, onDone, rosterMeta = []){
  const isEdit = !!student;
  const host = document.getElementById('stu-modal-host');
  const existingMeta = (student?.metadata && typeof student.metadata === 'object') ? student.metadata : {};

  // Claves del curso: definidas explicitamente + las que se ven en el roster + las del estudiante actual
  const knownKeys = new Set();
  getCourseExtraKeys(courseId).forEach(k => knownKeys.add(k));
  rosterMeta.forEach(m => Object.keys(m || {}).forEach(k => knownKeys.add(k)));
  Object.keys(existingMeta).forEach(k => knownKeys.add(k));
  const sortedKeys = [...knownKeys].sort();

  // Sugerencias de valores únicos por clave (para que el profe sepa qué valores hay)
  const valuesByKey = {};
  sortedKeys.forEach(k => {
    const set = new Set();
    rosterMeta.forEach(m => { const v = m?.[k]; if (v !== undefined && v !== null && v !== '') set.add(String(v)); });
    valuesByKey[k] = [...set].sort();
  });

  host.innerHTML = `
    <div class="modal-bg">
      <div class="modal" style="max-width:600px">
        <h2>${isEdit?'Editar':'Agregar'} estudiante</h2>
        <div class="field"><label>Cédula *</label><input id="f-ced" value="${escapeAttr(student?.cedula||'')}"></div>
        <div class="field"><label>Nombre completo *</label><input id="f-nom" value="${escapeAttr(student?.name||'')}"></div>
        <div class="field"><label>Email</label><input id="f-email" type="email" value="${escapeAttr(student?.email||'')}"></div>

        <details class="acc" open>
          <summary>📦 Datos extra ${sortedKeys.length > 0 ? `(${sortedKeys.length} campos del curso)` : '(programa, plan, campus, etc.)'}</summary>
          <div id="meta-fields" style="margin-top:10px;display:flex;flex-direction:column;gap:8px"></div>
          <button type="button" class="btn btn-out btn-xs" id="meta-add" style="margin-top:8px">＋ Agregar campo nuevo</button>
          <div style="margin-top:6px;font-size:11px;color:var(--ean-gray);font-style:italic">
            ${sortedKeys.length > 0
              ? '💡 Los campos del curso vienen del Excel importado. Deja en blanco para no asignar.'
              : '💡 Aún no hay campos del Excel. Agrega cualquier campo manualmente con el botón de arriba.'}
          </div>
        </details>

        <div class="modal-actions">
          <button class="btn btn-out" id="m-cancel">Cancelar</button>
          <button class="btn" id="m-save">Guardar</button>
        </div>
      </div>
    </div>
  `;

  const fieldsDiv = document.getElementById('meta-fields');

  // Render: filas con label fija (campos del roster) o filas libres (agregados manualmente)
  function renderFixedField(key){
    const value = existingMeta[key] != null ? String(existingMeta[key]) : '';
    const datalistId = 'dl-' + key.replace(/[^a-z0-9]/gi,'_');
    const suggestions = (valuesByKey[key] || []).slice(0, 50);
    const row = document.createElement('div');
    row.className = 'meta-field meta-field-fixed';
    row.dataset.key = key;
    row.innerHTML = `
      <label style="font-size:11px;color:var(--ean-gray);text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:4px;display:block">${escape(key)}</label>
      <input class="meta-v" type="text" placeholder="(vacío)" value="${escapeAttr(value)}" list="${datalistId}">
      ${suggestions.length ? `<datalist id="${datalistId}">${suggestions.map(s => `<option value="${escapeAttr(s)}">`).join('')}</datalist>` : ''}
    `;
    fieldsDiv.appendChild(row);
  }

  function renderFreeField(key='', value=''){
    const row = document.createElement('div');
    row.className = 'meta-field meta-field-free';
    row.style.cssText = 'display:grid;grid-template-columns:1fr 1.4fr auto;gap:6px;align-items:end';
    row.innerHTML = `
      <div>
        <label style="font-size:10px;color:var(--ean-gray);text-transform:uppercase;letter-spacing:.5px;font-weight:600;display:block;margin-bottom:3px">Nombre del campo</label>
        <input class="meta-k" type="text" placeholder="Ej: Programa" value="${escapeAttr(key)}">
      </div>
      <div>
        <label style="font-size:10px;color:var(--ean-gray);text-transform:uppercase;letter-spacing:.5px;font-weight:600;display:block;margin-bottom:3px">Valor</label>
        <input class="meta-v" type="text" placeholder="Ej: Comunicación Digital" value="${escapeAttr(value)}">
      </div>
      <button type="button" class="btn btn-xs btn-danger meta-del" title="Quitar este campo">🗑</button>
    `;
    row.querySelector('.meta-del').onclick = () => row.remove();
    fieldsDiv.appendChild(row);
  }

  // Pintar campos fijos del roster
  sortedKeys.forEach(renderFixedField);

  // Pintar campos del estudiante que NO están en sortedKeys (legacy, raros)
  Object.entries(existingMeta).forEach(([k,v]) => {
    if (!sortedKeys.includes(k)) renderFreeField(k, String(v ?? ''));
  });

  document.getElementById('meta-add').onclick = () => renderFreeField();

  document.getElementById('m-cancel').onclick = () => host.innerHTML='';
  document.getElementById('m-save').onclick = async () => {
    const payload = {
      cedula: document.getElementById('f-ced').value.trim(),
      name: document.getElementById('f-nom').value.trim(),
      email: document.getElementById('f-email').value.trim() || null,
    };
    if (!payload.cedula || !payload.name){ toast('Cédula y nombre requeridos','error'); return; }

    // Reconstruir metadata: combinar campos fijos (dataset.key) + campos libres (input meta-k + meta-v)
    const meta = {};
    const changesExtra = {};
    document.querySelectorAll('.meta-field-fixed').forEach(row => {
      const k = row.dataset.key;
      const newVal = row.querySelector('.meta-v').value.trim();
      const oldVal = String(existingMeta[k] || '');
      if (newVal) meta[k] = newVal;
      if (newVal !== oldVal){
        changesExtra[k] = { from: oldVal || '(vacío)', to: newVal || '(vacío)' };
      }
    });
    document.querySelectorAll('.meta-field-free').forEach(row => {
      const k = row.querySelector('.meta-k').value.trim();
      const v = row.querySelector('.meta-v').value.trim();
      if (!k) return;
      if (v) meta[k] = v;
      const oldVal = String(existingMeta[k] || '');
      if (v !== oldVal){
        changesExtra[k] = { from: oldVal || '(vacío)', to: v || '(vacío)' };
      }
    });
    payload.metadata = meta;

    // Decidir si aplicar a TODOS (solo si hay cambios en datos extra y es edición)
    let applyToAll = false;
    if (isEdit && Object.keys(changesExtra).length > 0){
      const detail = Object.entries(changesExtra)
        .map(([k,v]) => `  • ${k}: "${v.from}" → "${v.to}"`).join('\n');
      applyToAll = confirm(
        `Cambios en datos extra:\n\n${detail}\n\n` +
        `¿Aplicar estos cambios a TODOS los estudiantes del curso?\n\n` +
        `OK = Aplicar a TODOS (los valores cambiados sobreescriben a los demás)\n` +
        `Cancelar = Solo a ${payload.name}`
      );
    }

    let r;
    if (isEdit){
      r = await supabase.from('v5_students').update(payload).eq('id', student.id);
    } else {
      payload.course_id = courseId;
      r = await supabase.from('v5_students').insert(payload);
    }
    if (r.error){ toast('Error: '+r.error.message,'error'); return; }

    // Si el profe pidió aplicar a todos, hacer merge de los campos cambiados sobre cada estudiante
    if (applyToAll){
      const { data: allStudents } = await supabase
        .from('v5_students').select('id, metadata').eq('course_id', courseId).neq('id', student.id);
      const changedKv = {};
      Object.entries(changesExtra).forEach(([k,v]) => { changedKv[k] = v.to === '(vacío)' ? null : v.to; });
      const updates = (allStudents || []).map(s => {
        const cur = (s.metadata && typeof s.metadata === 'object') ? s.metadata : {};
        const merged = { ...cur };
        Object.entries(changedKv).forEach(([k,v]) => {
          if (v === null || v === '') delete merged[k];
          else merged[k] = v;
        });
        return supabase.from('v5_students').update({ metadata: merged }).eq('id', s.id);
      });
      await Promise.all(updates);
      toast(`✅ Actualizado + ${allStudents.length} estudiantes con los cambios aplicados a todos`,'success');
    } else {
      toast(isEdit?'Actualizado':'Agregado','success');
    }
    host.innerHTML='';
    onDone?.();
  };
}

// Modal de configuración de campos extras del curso
function openCourseFieldsModal(courseId, onDone){
  const host = document.getElementById('stu-modal-host');
  const existingKeys = getCourseExtraKeys(courseId);

  host.innerHTML = `
    <div class="modal-bg">
      <div class="modal" style="max-width:560px">
        <h2>⚙️ Campos del curso</h2>
        <p style="font-size:12px;color:var(--ean-gray);margin-bottom:14px">
          Define los campos extras (programa, plan, campus, etc.) que tendrán todos los estudiantes de este curso.
          Aparecerán automáticamente en el modal de editar/agregar estudiante.
        </p>

        <div id="cfk-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px"></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <button type="button" class="btn btn-out btn-xs" id="cfk-add">＋ Agregar campo manualmente</button>
          <button type="button" class="btn btn-cyan btn-xs" id="cfk-detect">📥 Detectar columnas desde Excel</button>
        </div>
        <input type="file" id="cfk-file" accept=".xlsx,.xls,.csv" style="display:none">
        <div id="cfk-detect-status" style="margin-top:8px;font-size:11px"></div>

        <div style="margin-top:14px;padding:10px;background:#FFF8E1;border-radius:6px;font-size:11px;color:var(--ean-gray)">
          💡 Estos son solo los <b>nombres</b> de los campos. Después, en cada estudiante, podrás
          escribir el valor (ej: campo "Programa" → valor "Comunicación Digital").
        </div>

        <div class="modal-actions">
          <button class="btn btn-out" id="m-cancel">Cancelar</button>
          <button class="btn" id="m-save">Guardar</button>
        </div>
      </div>
    </div>
  `;

  const listDiv = document.getElementById('cfk-list');
  function addRow(key=''){
    const row = document.createElement('div');
    row.className = 'cfk-row';
    row.style.cssText = 'display:flex;gap:6px;align-items:center';
    row.innerHTML = `
      <input class="cfk-name" type="text" placeholder="Ej: Programa, Plan, Campus, Horario" value="${escapeAttr(key)}" style="flex:1">
      <button type="button" class="btn btn-xs btn-danger cfk-del" title="Quitar">🗑</button>
    `;
    row.querySelector('.cfk-del').onclick = () => row.remove();
    listDiv.appendChild(row);
  }
  existingKeys.forEach(addRow);
  if (!existingKeys.length){ addRow(); addRow(); addRow(); }
  document.getElementById('cfk-add').onclick = () => addRow();

  // Detectar columnas desde Excel (sin importar estudiantes)
  const fileInput = document.getElementById('cfk-file');
  document.getElementById('cfk-detect').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    if (!f) return;
    const status = document.getElementById('cfk-detect-status');
    status.innerHTML = '<div style="display:flex;align-items:center;gap:6px"><span class="loader"></span>Leyendo Excel…</div>';
    try {
      const XLSX = await loadXLSX();
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length){ status.innerHTML = '<span style="color:var(--red)">Excel vacío</span>'; return; }
      const allKeys = Object.keys(rows[0]);
      // Filtrar las "típicas" de cédula/nombre/email para no agregarlas como campos extras
      const tipicas = /^(n.?\s*matr|matricul|cedula|documento|numero\s*id|id\s*estudiante|^id$|identificaci|estudiante|alumno|nombre|email|correo|e-?mail)/i;
      const extraKeys = allKeys.filter(k => !tipicas.test(k));
      // Agregar al listado existente sin duplicar
      const currentNames = [...document.querySelectorAll('.cfk-name')].map(i => i.value.trim()).filter(Boolean);
      const newOnes = extraKeys.filter(k => !currentNames.includes(k));
      newOnes.forEach(k => addRow(k));
      status.innerHTML = `<span style="color:var(--green)">✅ ${newOnes.length} columnas agregadas (de ${extraKeys.length} extras detectadas en el Excel). Da click en Guardar para confirmar.</span>`;
    } catch(e){
      status.innerHTML = `<span style="color:var(--red)">Error: ${e.message}</span>`;
    }
    fileInput.value = '';
  };

  document.getElementById('m-cancel').onclick = () => host.innerHTML='';
  document.getElementById('m-save').onclick = () => {
    const newKeys = [...listDiv.querySelectorAll('.cfk-name')]
      .map(inp => inp.value.trim())
      .filter(Boolean);
    setCourseExtraKeys(courseId, newKeys);
    toast(`✅ ${newKeys.length} campo${newKeys.length===1?'':'s'} guardado${newKeys.length===1?'':'s'}`,'success');
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

      <details open style="background:#F0F4F8;padding:10px 12px;border-radius:8px;margin-bottom:12px">
        <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--ean-blue)">
          📦 Columnas extra del Excel — <span style="color:var(--ean-cyan)">${extras.length} disponibles</span> (todas marcadas por defecto)
        </summary>
        <div style="margin-top:10px;font-size:12px;color:var(--ean-gray)">
          Estas columnas se guardan en cada estudiante <b>y quedan registradas como campos del curso</b>. Útil para programa, plan, campus, horario, etc. <b>Desmarca</b> las que NO quieras importar.
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px;margin-top:10px" id="extras-grid">
          ${extras.map(k => `
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;background:#fff;padding:6px 10px;border-radius:6px;border:1px solid var(--ean-border);cursor:pointer">
              <input type="checkbox" class="extra-cb" value="${escapeAttr(k)}" checked style="width:14px;height:14px"> ${escape(k)}
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

    // Guardar las claves usadas como definición de columnas del curso
    // (asi aparecen en el modal de editar aunque ningun estudiante tenga valor)
    const keysFromImport = new Set();
    parsed.forEach(s => Object.keys(s.metadata || {}).forEach(k => keysFromImport.add(k)));
    if (keysFromImport.size){
      addCourseExtraKeys(courseId, [...keysFromImport]);
    }

    toast(`✅ ${data?.length||parsed.length} estudiantes importados${keysFromImport.size ? ` con ${keysFromImport.size} campos extras` : ''}`,'success');
    host.innerHTML='';
    onDone?.();
  };
}

const escape = s => String(s||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const escapeAttr = s => escape(s).replace(/"/g,'&quot;');
