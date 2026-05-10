// 📅 SYLLABUS AI — sube syllabus PDF, genera plan de sesiones del semestre
import { supabase, currentSession } from './supabase-client.js';
import { WORKER_URL } from './config.js';
import { toast } from './toast.js';

let course = null;
let courseId = null;
let sessions = [];
let sources = [];                 // fuentes adicionales del curso
let pendingPlan = null;          // sesiones generadas por IA antes de guardar
let store = null;

const SOURCE_TYPE_ICONS = { pdf:'📄', image:'🖼', url:'🔗', text:'✏️' };
const SOURCE_TYPE_LABELS = { pdf:'PDF/Documento', image:'Imagen', url:'Enlace web', text:'Texto libre' };

// ───── FESTIVOS COLOMBIA (fijos + lunes de traslado + Pascua) ─────
function getColombianHolidays(year){
  const out = new Set();
  const fixed = [
    `${year}-01-01`, // Año Nuevo
    `${year}-05-01`, // Día del Trabajo
    `${year}-07-20`, // Independencia
    `${year}-08-07`, // Batalla de Boyacá
    `${year}-12-08`, // Inmaculada
    `${year}-12-25`, // Navidad
  ];
  fixed.forEach(d => out.add(d));

  // Lunes de traslado: si es domingo, se traslada al lunes siguiente
  const trasladables = [
    `${year}-01-06`, // Reyes
    `${year}-03-19`, // San José
    `${year}-06-29`, // San Pedro y San Pablo
    `${year}-08-15`, // Asunción
    `${year}-10-12`, // Día de la Raza
    `${year}-11-01`, // Todos los Santos
    `${year}-11-11`, // Independencia Cartagena
  ];
  trasladables.forEach(d => out.add(moveToMonday(d)));

  // Pascua y derivados (Domingo de Pascua + 39, 60, 68 días)
  const easter = computeEaster(year);
  const ascension = addDays(easter, 39);             // Ascensión (lunes traslado)
  const corpus = addDays(easter, 60);                // Corpus Christi (lunes traslado)
  const sagradoCorazon = addDays(easter, 68);        // Sagrado Corazón (lunes traslado)
  const juevesSanto = addDays(easter, -3);
  const viernesSanto = addDays(easter, -2);
  out.add(toIso(juevesSanto));
  out.add(toIso(viernesSanto));
  out.add(moveToMonday(toIso(ascension)));
  out.add(moveToMonday(toIso(corpus)));
  out.add(moveToMonday(toIso(sagradoCorazon)));
  return out;
}
function moveToMonday(iso){
  const d = new Date(iso + 'T12:00:00');
  const day = d.getDay();
  if (day !== 1) d.setDate(d.getDate() + ((8 - day) % 7));
  return toIso(d);
}
function addDays(d, n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function toIso(d){ return d.toISOString().slice(0,10); }
function computeEaster(year){
  const a=year%19, b=Math.floor(year/100), c=year%100, d=Math.floor(b/4), e=b%4;
  const f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30, i=Math.floor(c/4), k=c%4;
  const l=(32+2*e+2*i-h-k)%7, m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31), day=((h+l-7*m+114)%31)+1;
  return new Date(year, month-1, day);
}

const SESSION_TYPES = {
  magistral: 'Clase magistral',
  taller: 'Taller / Workshop',
  abp: 'Aprendizaje basado en proyectos',
  caso: 'Estudio de caso',
  sustentacion: 'Sustentación',
  parcial: 'Parcial / Examen',
  asesoria: 'Asesoría',
  feriado: 'Feriado / No hay clase',
};

export async function mountSyllabus(root, _store){
  store = _store;
  courseId = store.activeCourse.id;
  await loadAll();

  root.innerHTML = `
    <div class="card">
      <div class="card-row" style="justify-content:space-between">
        <h2>📅 Plan del semestre — ${escape(course.name)}</h2>
        <div style="display:flex;gap:8px">
          <button class="btn btn-out btn-xs" id="syl-refresh">🔄 Refrescar</button>
        </div>
      </div>
      <div id="syl-status" style="margin-top:8px;font-size:12px;color:var(--ean-gray)"></div>
    </div>

    <!-- STEP 1: Datos del semestre -->
    <details class="card acc acc-section" style="background:#F0F4F8;border-left:4px solid var(--ean-blue)">
      <summary><h3>1️⃣ Datos del semestre</h3></summary>
      <div class="grid-3">
        <div class="field"><label>Fecha inicio *</label><input id="c-start" type="date" value="${course.start_date||''}"></div>
        <div class="field"><label>Fecha fin *</label><input id="c-end" type="date" value="${course.end_date||''}"></div>
        <div class="field"><label>Sesiones / semana *</label><input id="c-spw" type="number" value="${course.sessions_per_week??2}" min="1" max="7"></div>
        <div class="field"><label>Horas por sesión</label><input id="c-hps" type="number" step="0.5" value="${course.hours_per_session??2}" min="0.5"></div>
        <div class="field" style="grid-column:span 2">
          <label>Días de la semana (separados por coma: lun,mar,mie,jue,vie,sab)</label>
          <input id="c-days" placeholder="Ej: mar,jue" value="">
        </div>
      </div>
      <button class="btn btn-out btn-xs" id="c-save">💾 Guardar datos del semestre</button>
    </details>

    <!-- STEP 2: Syllabus -->
    <details class="card acc acc-section" style="background:#F0FCFD;border-left:4px solid var(--ean-cyan)">
      <summary><h3>2️⃣ Syllabus del curso</h3></summary>
      <div id="syl-pdf-area"></div>
    </details>

    <!-- STEP 2.5: Fuentes adicionales -->
    <details class="card acc acc-section" style="background:#F3E5F5;border-left:4px solid var(--purple)">
      <summary><h3>📚 Fuentes adicionales (opcional)</h3></summary>
      <div class="card-row" style="justify-content:flex-end;gap:6px">
        <button class="btn btn-out btn-xs" id="src-add-pdf">📄 PDF/Imagen</button>
        <button class="btn btn-out btn-xs" id="src-add-url">🔗 Enlace</button>
        <button class="btn btn-out btn-xs" id="src-add-text">✏️ Texto</button>
      </div>
      <p style="font-size:12px;color:var(--ean-gray);margin-top:6px">
        Agrega bibliografía, apuntes, artículos, blogs, etc. La IA los combinará con el syllabus al generar el plan.
        Marca/desmarca cuáles usar con el ☑.
      </p>
      <div id="syl-sources-list" style="margin-top:10px"></div>
    </details>

    <!-- STEP 3: Generar plan -->
    <details class="card acc acc-section" style="background:#FFF8E1;border-left:4px solid #F57C00">
      <summary><h3>3️⃣ Generar plan con IA</h3></summary>
      <p style="font-size:12px;color:var(--ean-gray)" id="syl-gen-info">
        La IA usará el syllabus + fuentes activas, calculará las fechas saltando festivos colombianos y propondrá un tema para cada clase.
      </p>
      <button class="btn btn-cyan btn-lg" id="syl-generate" style="margin-top:8px">🚀 Generar plan del semestre</button>
      <div id="syl-gen-status" style="margin-top:8px"></div>
    </details>

    <!-- STEP 4: Plan editable -->
    <details class="card acc acc-section" id="syl-plan-card" style="background:#E8F5E9;border-left:4px solid var(--green);display:none">
      <summary><h3>4️⃣ Plan generado — revisa y guarda</h3></summary>
      <div id="syl-plan-table"></div>
    </details>

    <!-- Plan actual guardado — siempre visible, header sticky -->
    <div class="card" id="syl-saved-card">
      <h3>📋 Plan actual del semestre</h3>
      <div id="syl-saved-table" style="margin-top:10px"></div>
    </div>
  `;

  // Wire up
  document.getElementById('c-save').onclick = saveCourseDates;
  document.getElementById('syl-refresh').onclick = async () => { await loadAll(); refreshUI(); toast('Refrescado'); };
  document.getElementById('syl-generate').onclick = generatePlan;
  document.getElementById('src-add-pdf').onclick = () => openSourceModal('pdf');
  document.getElementById('src-add-url').onclick = () => openSourceModal('url');
  document.getElementById('src-add-text').onclick = () => openSourceModal('text');
  renderPdfArea();
  renderSources();
  renderSaved();
  updateStatus();
}

// Modal host helper
function ensureModalHost(){
  let h = document.getElementById('syl-modal-host');
  if (!h){ h = document.createElement('div'); h.id='syl-modal-host'; document.body.appendChild(h); }
  return h;
}

function renderSources(){
  const div = document.getElementById('syl-sources-list');
  if (!div) return;
  if (!sources.length){
    div.innerHTML = `<p class="empty-state" style="padding:14px;font-size:12px">Sin fuentes adicionales. Agrega bibliografía, blogs, apuntes con los botones de arriba.</p>`;
    updateGenInfo();
    return;
  }
  div.innerHTML = sources.map(s => `
    <div class="card-row" style="padding:8px 12px;border:1px solid var(--ean-border);border-radius:6px;margin-bottom:6px;background:#fff;justify-content:space-between;gap:10px">
      <label style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer">
        <input type="checkbox" data-toggle="${s.id}" ${s.enabled?'checked':''} style="width:16px;height:16px">
        <div style="flex:1">
          <div style="font-size:13px"><b>${SOURCE_TYPE_ICONS[s.type]||''} ${escape(s.name)}</b></div>
          <div style="font-size:10px;color:var(--ean-gray)">
            ${SOURCE_TYPE_LABELS[s.type]||s.type} ·
            ${s.url?'<a href="'+escapeAttr(s.url)+'" target="_blank">'+escape(s.url.substring(0,60))+'</a> · ':''}
            ${(s.content||'').length} chars
          </div>
        </div>
      </label>
      <div style="display:flex;gap:4px">
        <button class="btn btn-xs btn-out" data-view="${s.id}">👁</button>
        <button class="btn btn-xs btn-danger" data-del="${s.id}">🗑</button>
      </div>
    </div>
  `).join('');

  div.querySelectorAll('[data-toggle]').forEach(cb => cb.onchange = async () => {
    const sid = cb.dataset.toggle;
    const { error } = await supabase.from('v5_course_sources').update({ enabled: cb.checked }).eq('id', sid);
    if (error){ toast('Error: '+error.message,'error'); cb.checked = !cb.checked; return; }
    const s = sources.find(x => x.id === sid);
    if (s) s.enabled = cb.checked;
    updateGenInfo();
  });
  div.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    const s = sources.find(x => x.id === b.dataset.view);
    openViewModal(s);
  });
  div.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const s = sources.find(x => x.id === b.dataset.del);
    if (!confirm(`¿Eliminar la fuente "${s.name}"?`)) return;
    const { error } = await supabase.from('v5_course_sources').delete().eq('id', s.id);
    if (error){ toast('Error: '+error.message,'error'); return; }
    sources = sources.filter(x => x.id !== s.id);
    renderSources();
    toast('Eliminada');
  });

  updateGenInfo();
}

function updateGenInfo(){
  const info = document.getElementById('syl-gen-info');
  if (!info) return;
  const enabled = sources.filter(s => s.enabled);
  const totalChars = enabled.reduce((a,s) => a+(s.content||'').length, 0);
  info.innerHTML = `
    La IA usará el <b>syllabus</b> + <b>${enabled.length}</b> fuente${enabled.length===1?'':'s'} activa${enabled.length===1?'':'s'}
    (${(totalChars/1000).toFixed(1)}KB de contexto adicional), calculará las fechas saltando festivos colombianos y propondrá un tema para cada clase.
  `;
}

function openViewModal(s){
  const host = ensureModalHost();
  host.innerHTML = `
    <div class="modal-bg">
      <div class="modal" style="max-width:720px">
        <h2>${SOURCE_TYPE_ICONS[s.type]||''} ${escape(s.name)}</h2>
        <div style="font-size:11px;color:var(--ean-gray);margin-bottom:8px">
          ${SOURCE_TYPE_LABELS[s.type]||s.type}${s.url?' · '+escape(s.url):''}
        </div>
        <pre style="font-size:11px;background:#f5f5f5;padding:10px;border-radius:6px;max-height:400px;overflow:auto;white-space:pre-wrap">${escape((s.content||'(sin contenido)').substring(0,8000))}${(s.content||'').length>8000?'\n\n[… truncado]':''}</pre>
        <div class="modal-actions">
          <button class="btn btn-out" id="vm-close">Cerrar</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('vm-close').onclick = () => host.innerHTML='';
}

function openSourceModal(type){
  const host = ensureModalHost();
  let bodyHtml = '';
  if (type === 'pdf'){
    bodyHtml = `
      <div class="dropzone" id="src-dz">
        <div class="icon">📄</div>
        <div><b>Arrastra PDF/imagen aquí</b> o haz click</div>
        <div class="hint">.pdf, .jpg, .png · La IA extrae el contenido</div>
        <input type="file" id="src-file" accept=".pdf,.jpg,.jpeg,.png,.webp" style="display:none">
      </div>
      <div class="field" style="margin-top:10px"><label>Nombre (opcional)</label><input id="src-name" placeholder="Ej: Capítulo 3 Chaffey"></div>
    `;
  } else if (type === 'url'){
    bodyHtml = `
      <div class="field"><label>URL del enlace *</label><input id="src-url" type="url" placeholder="https://..."></div>
      <div class="field"><label>Nombre (opcional, default = la URL)</label><input id="src-name" placeholder="Ej: Blog HubSpot Marketing Digital"></div>
    `;
  } else {
    bodyHtml = `
      <div class="field"><label>Nombre *</label><input id="src-name" placeholder="Ej: Apuntes de mi clase 2024"></div>
      <div class="field"><label>Contenido (texto libre) *</label><textarea id="src-text" rows="10" style="width:100%;font-family:inherit;font-size:13px;border:1px solid var(--ean-border);border-radius:6px;padding:8px;resize:vertical" placeholder="Pega aquí cualquier texto: apuntes, articulos, resumen de un libro, etc."></textarea></div>
    `;
  }

  host.innerHTML = `
    <div class="modal-bg">
      <div class="modal">
        <h2>${SOURCE_TYPE_ICONS[type]} Agregar fuente — ${SOURCE_TYPE_LABELS[type]}</h2>
        ${bodyHtml}
        <div id="src-status"></div>
        <div class="modal-actions">
          <button class="btn btn-out" id="src-cancel">Cancelar</button>
          <button class="btn btn-cyan" id="src-save">Guardar</button>
        </div>
      </div>
    </div>
  `;

  let pendingFile = null;
  if (type === 'pdf'){
    const dz = document.getElementById('src-dz');
    const inp = document.getElementById('src-file');
    dz.onclick = () => inp.click();
    dz.ondragover = e => { e.preventDefault(); dz.classList.add('dragover'); };
    dz.ondragleave = () => dz.classList.remove('dragover');
    dz.ondrop = e => { e.preventDefault(); dz.classList.remove('dragover'); if (e.dataTransfer.files[0]){ pendingFile = e.dataTransfer.files[0]; if (!document.getElementById('src-name').value) document.getElementById('src-name').value = pendingFile.name; document.getElementById('src-status').innerHTML = '<div style="font-size:12px;color:var(--ean-blue);margin-top:6px">📎 ' + escape(pendingFile.name) + '</div>'; } };
    inp.onchange = () => { if (inp.files[0]){ pendingFile = inp.files[0]; if (!document.getElementById('src-name').value) document.getElementById('src-name').value = pendingFile.name; document.getElementById('src-status').innerHTML = '<div style="font-size:12px;color:var(--ean-blue);margin-top:6px">📎 ' + escape(pendingFile.name) + '</div>'; } };
  }

  document.getElementById('src-cancel').onclick = () => host.innerHTML='';
  document.getElementById('src-save').onclick = async () => {
    const status = document.getElementById('src-status');
    const btn = document.getElementById('src-save');
    btn.disabled = true; btn.textContent = 'Procesando…';
    status.innerHTML = '<div style="display:flex;align-items:center;gap:6px;margin-top:6px"><span class="loader"></span> <span style="font-size:12px">Procesando…</span></div>';

    try {
      let content = '', url = null, file_url = null, srcType = type;
      const name = (document.getElementById('src-name')?.value || '').trim();

      if (type === 'pdf'){
        if (!pendingFile){ throw new Error('Sube un archivo'); }
        const isPdf = pendingFile.name.toLowerCase().endsWith('.pdf');
        srcType = isPdf ? 'pdf' : 'image';
        content = await extractWithVision(pendingFile, isPdf);
        file_url = pendingFile.name;
      } else if (type === 'url'){
        url = document.getElementById('src-url').value.trim();
        if (!/^https?:\/\//i.test(url)) throw new Error('URL inválida');
        content = await fetchUrlContent(url);
      } else {
        content = (document.getElementById('src-text').value || '').trim();
        if (!content) throw new Error('El contenido no puede estar vacío');
      }

      const finalName = name || (url ? url.substring(0,60) : 'Fuente sin nombre');
      const { data, error } = await supabase.from('v5_course_sources').insert({
        course_id: courseId, type: srcType, name: finalName, content, url, file_url, enabled: true
      }).select().single();
      if (error) throw error;

      sources.push(data);
      host.innerHTML = '';
      renderSources();
      toast(`✅ Fuente "${finalName}" agregada (${content.length} chars)`,'success');
    } catch (e){
      status.innerHTML = '<div style="background:#FFEBEE;color:var(--red);padding:8px;border-radius:4px;margin-top:6px;font-size:12px">❌ ' + escape(e.message) + '</div>';
      btn.disabled = false; btn.textContent = 'Guardar';
    }
  };
}

async function extractWithVision(file, isPdf){
  const session = await currentSession();
  const b64 = await fileToBase64(file);
  const block = isPdf
    ? { type:'document', source:{ type:'base64', media_type:'application/pdf', data:b64 } }
    : { type:'image', source:{ type:'base64', media_type: file.type || 'image/jpeg', data:b64 } };
  const messages = [{ role:'user', content:[block, { type:'text', text:'Extrae todo el texto significativo del documento. Devuélvelo en texto plano organizado por secciones.' }] }];
  const r = await fetch(WORKER_URL + '/', {
    method:'POST',
    headers:{ 'Authorization':'Bearer '+session.access_token, 'Content-Type':'application/json' },
    body: JSON.stringify({ messages, system:'Eres un OCR. Devuelve solo texto plano limpio.', max_tokens: 4096 })
  });
  const data = await r.json();
  if (!r.ok) throw new Error('Worker '+r.status);
  return data.result?.content?.[0]?.text || '';
}

async function fetchUrlContent(url){
  const session = await currentSession();
  const r = await fetch(WORKER_URL + '/fetch-url', {
    method:'POST',
    headers:{ 'Authorization':'Bearer '+session.access_token, 'Content-Type':'application/json' },
    body: JSON.stringify({ url })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Error '+r.status);
  return data.text || '';
}

async function loadAll(){
  const [cR, sesR, srcR] = await Promise.all([
    supabase.from('v5_courses').select('*').eq('id', courseId).single(),
    supabase.from('v5_sessions').select('*').eq('course_id', courseId).order('date', { ascending:true }),
    supabase.from('v5_course_sources').select('*').eq('course_id', courseId).order('created_at', { ascending:true }),
  ]);
  course = cR.data;
  sessions = sesR.data || [];
  sources = srcR.data || [];
}

function refreshUI(){
  document.getElementById('c-start').value = course.start_date||'';
  document.getElementById('c-end').value = course.end_date||'';
  document.getElementById('c-spw').value = course.sessions_per_week??2;
  document.getElementById('c-hps').value = course.hours_per_session??2;
  renderPdfArea();
  renderSources();
  renderSaved();
  updateStatus();
}

function updateStatus(){
  const hasDates = course.start_date && course.end_date;
  const hasSyllabus = !!course.syllabus_text;
  const hasSessions = sessions.length > 0;
  const checks = [
    hasDates ? '✅ Fechas configuradas' : '⚠️ Faltan fechas del semestre',
    hasSyllabus ? '✅ Syllabus cargado' : '⚠️ Sin syllabus aún',
    hasSessions ? `✅ ${sessions.length} sesiones planificadas` : '⏳ Sin plan generado',
  ];
  document.getElementById('syl-status').innerHTML = checks.join(' · ');
}

async function saveCourseDates(){
  const days = document.getElementById('c-days').value.trim();
  const payload = {
    start_date: document.getElementById('c-start').value || null,
    end_date: document.getElementById('c-end').value || null,
    sessions_per_week: parseInt(document.getElementById('c-spw').value) || null,
    hours_per_session: parseFloat(document.getElementById('c-hps').value) || null,
  };
  const { error } = await supabase.from('v5_courses').update(payload).eq('id', courseId);
  if (error){ toast('Error: '+error.message,'error'); return; }
  Object.assign(course, payload);
  // Guardar dias de la semana en metadata? Por ahora solo localStorage del curso
  if (days) localStorage.setItem('v5_days_'+courseId, days);
  toast('Datos guardados','success');
  updateStatus();
}

function renderPdfArea(){
  const div = document.getElementById('syl-pdf-area');
  if (!div) return;
  const has = !!course.syllabus_text;

  div.innerHTML = `
    ${has ? `
      <div style="background:#fff;padding:10px;border-radius:6px;margin-bottom:10px">
        <b>✅ Syllabus cargado</b> · ${course.syllabus_text.length} caracteres extraídos
        <details style="margin-top:6px"><summary style="cursor:pointer;font-size:12px;color:var(--ean-blue)">Ver texto extraído</summary>
        <pre style="font-size:11px;background:#f5f5f5;padding:8px;border-radius:4px;max-height:200px;overflow:auto;white-space:pre-wrap;margin-top:6px">${escape(course.syllabus_text.substring(0, 3000))}${course.syllabus_text.length>3000?'…':''}</pre>
        </details>
      </div>
    ` : ''}
    <div class="dropzone" id="syl-dz" style="margin-top:8px">
      <div class="icon">📄</div>
      <div><b>${has?'Reemplazar syllabus':'Subir syllabus PDF/imagen'}</b> o haz click para seleccionar</div>
      <div class="hint">.pdf, .jpg, .png · La IA extraerá el contenido</div>
      <input type="file" id="syl-file" accept=".pdf,.jpg,.jpeg,.png,.webp" style="display:none">
    </div>
    <div id="syl-upload-status" style="margin-top:8px"></div>
  `;

  const dz = document.getElementById('syl-dz');
  const inp = document.getElementById('syl-file');
  dz.onclick = () => inp.click();
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('dragover'); };
  dz.ondragleave = () => dz.classList.remove('dragover');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleSyllabusFile(e.dataTransfer.files[0]); };
  inp.onchange = () => inp.files[0] && handleSyllabusFile(inp.files[0]);
}

async function handleSyllabusFile(f){
  const status = document.getElementById('syl-upload-status');
  status.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span class="loader"></span> Procesando con IA…</div>`;

  try{
    const session = await currentSession();
    const ext = f.name.split('.').pop().toLowerCase();
    const isPdf = ext === 'pdf';
    const b64 = await fileToBase64(f);
    const mediaType = isPdf ? 'application/pdf' : (f.type || 'image/jpeg');

    const block = isPdf
      ? { type:'document', source:{ type:'base64', media_type:'application/pdf', data:b64 } }
      : { type:'image', source:{ type:'base64', media_type:mediaType, data:b64 } };

    const messages = [{ role:'user', content:[block, { type:'text', text:'Extrae todo el texto significativo del syllabus: información general, propósito, contenidos, esquema de calificación, bibliografía. Devuelve solo el texto plano organizado por secciones.' }] }];

    const r = await fetch(WORKER_URL + '/', {
      method:'POST',
      headers:{ 'Authorization':'Bearer '+session.access_token, 'Content-Type':'application/json' },
      body: JSON.stringify({ messages, system:'Eres un OCR para syllabus universitarios. Devuelve texto plano limpio.', max_tokens: 4096 })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`Worker ${r.status}: ${JSON.stringify(data).substring(0,200)}`);
    const text = data.result?.content?.[0]?.text || '';
    if (!text) throw new Error('La IA no extrajo texto');

    // Guardar en el curso
    const { error } = await supabase.from('v5_courses').update({ syllabus_text: text, syllabus_url: f.name }).eq('id', courseId);
    if (error) throw error;
    course.syllabus_text = text;
    course.syllabus_url = f.name;
    status.innerHTML = `<div style="color:var(--green)">✅ Syllabus extraído (${text.length} chars)</div>`;
    renderPdfArea();
    updateStatus();
    toast('Syllabus guardado','success');
  } catch(e){
    status.innerHTML = `<div style="background:#FFEBEE;color:var(--red);padding:8px;border-radius:4px">❌ ${escape(e.message)}</div>`;
  }
}

async function generatePlan(){
  if (!course.start_date || !course.end_date){ toast('Configura fechas del semestre primero','error'); return; }
  if (!course.syllabus_text){ toast('Sube el syllabus primero','error'); return; }

  const status = document.getElementById('syl-gen-status');
  const btn = document.getElementById('syl-generate');
  btn.disabled = true;
  status.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span class="loader"></span> Generando plan… (15-30s)</div>`;

  try{
    // Calcular fechas posibles de clase saltando festivos
    const candidates = computeCandidateDates(course.start_date, course.end_date, course.sessions_per_week || 2);

    const session = await currentSession();
    const sysPrompt = `Eres un planificador académico. Te paso el syllabus de un curso universitario y un calendario de fechas posibles de clase. Tu tarea: asignar un tema/contenido a cada fecha, distribuyendo los contenidos del syllabus a lo largo del semestre. Considera que algunas sesiones pueden ser sustentaciones, parciales o talleres según lo que diga el syllabus. Responde SOLO con JSON sin markdown.`;

    // Construir contexto: syllabus + fuentes activas
    const enabledSources = sources.filter(s => s.enabled);
    let contextBlock = `═══ SYLLABUS (FUENTE PRINCIPAL) ═══\n${course.syllabus_text.substring(0, 6000)}`;
    if (enabledSources.length){
      contextBlock += `\n\n═══ FUENTES ADICIONALES (${enabledSources.length}) ═══`;
      // Distribuir presupuesto: ~2000 chars por fuente, máximo
      enabledSources.forEach(s => {
        const snippet = (s.content||'').substring(0, 2000);
        contextBlock += `\n\n--- [${SOURCE_TYPE_ICONS[s.type]} ${s.name}] ---\n${snippet}`;
      });
    }

    const userPrompt = `${contextBlock}

═══ FECHAS DE CLASE (ya excluyen festivos colombianos) ═══
${candidates.map((d,i) => `${i+1}. ${d}`).join('\n')}

═══ INSTRUCCIONES ═══
Genera un plan distribuyendo los contenidos en estas ${candidates.length} sesiones.
Usa el syllabus como guía principal. Las fuentes adicionales sirven para enriquecer los temas (referencias, ejemplos, profundidad).
Para cada sesión devuelve: número, fecha, tema (corto, máximo 80 chars), tipo (magistral|taller|abp|caso|sustentacion|parcial|asesoria), y notas opcionales.
Si el syllabus menciona evaluaciones, asigna sustentaciones/parciales en fechas estratégicas (mitad y final del semestre).

Responde EXACTAMENTE así, sin markdown:
{"sessions":[{"number":1,"date":"YYYY-MM-DD","topic":"...","type":"magistral","notes":""}, ...]}`;

    const messages = [{ role:'user', content:[{ type:'text', text: userPrompt }] }];

    const r = await fetch(WORKER_URL + '/', {
      method:'POST',
      headers:{ 'Authorization':'Bearer '+session.access_token, 'Content-Type':'application/json' },
      body: JSON.stringify({ messages, system: sysPrompt, max_tokens: 8192 })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`Worker ${r.status}`);
    const text = data.result?.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('IA no devolvió JSON');
    const parsed = JSON.parse(jsonMatch[0]);
    pendingPlan = parsed.sessions || [];

    status.innerHTML = `<div style="color:var(--green)">✅ ${pendingPlan.length} sesiones generadas. Revisa abajo y guarda.</div>`;
    renderPlan();
  } catch(e){
    status.innerHTML = `<div style="background:#FFEBEE;color:var(--red);padding:8px;border-radius:4px">❌ ${escape(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

function computeCandidateDates(startISO, endISO, perWeek){
  const start = new Date(startISO + 'T12:00:00');
  const end = new Date(endISO + 'T12:00:00');
  // Intentar leer dias preferidos del localStorage
  const daysPref = (localStorage.getItem('v5_days_'+courseId)||'').toLowerCase();
  const dayMap = { dom:0, lun:1, mar:2, mie:3, jue:4, vie:5, sab:6 };
  let allowedDays;
  if (daysPref){
    allowedDays = daysPref.split(/[,;\s]+/).filter(Boolean).map(d => dayMap[d.substring(0,3)]).filter(n => n!==undefined);
  } else {
    // Por defecto: distribuir uniformemente entre L-V
    const candidates = [1,2,3,4,5];
    if (perWeek <= candidates.length) allowedDays = candidates.slice(0, perWeek);
    else allowedDays = candidates;
  }

  const years = new Set();
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) years.add(y);
  const holidays = new Set();
  years.forEach(y => getColombianHolidays(y).forEach(h => holidays.add(h)));

  const dates = [];
  const cur = new Date(start);
  while (cur <= end){
    const day = cur.getDay();
    const iso = toIso(cur);
    if (allowedDays.includes(day) && !holidays.has(iso)) dates.push(iso);
    cur.setDate(cur.getDate()+1);
  }
  return dates;
}

function renderPlan(){
  const card = document.getElementById('syl-plan-card');
  const div = document.getElementById('syl-plan-table');
  if (!pendingPlan || !pendingPlan.length){ card.style.display='none'; card.open=false; return; }
  card.style.display='block';
  card.open = true;  // abrir el acordeón automáticamente al generar plan

  div.innerHTML = `
    <div style="font-size:12px;color:var(--ean-gray);margin-bottom:8px">
      Edita lo que quieras antes de guardar. Click en cualquier celda.
    </div>
    <div class="tbl-wrap" style="max-height:400px">
      <table>
        <thead><tr><th>#</th><th>Fecha</th><th>Tema</th><th>Tipo</th><th>Notas</th><th></th></tr></thead>
        <tbody id="plan-tbody"></tbody>
      </table>
    </div>
    <div style="text-align:right;margin-top:10px;display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-out" id="plan-discard">🗑 Descartar</button>
      <button class="btn btn-cyan btn-lg" id="plan-save">💾 Guardar plan en el sistema</button>
    </div>
  `;

  const tbody = document.getElementById('plan-tbody');
  tbody.innerHTML = pendingPlan.map((s,i) => `
    <tr data-i="${i}">
      <td class="num">${s.number||i+1}</td>
      <td><input type="date" value="${s.date||''}" data-f="date" style="font-size:12px"></td>
      <td><input type="text" value="${escapeAttr(s.topic||'')}" data-f="topic" style="width:100%;font-size:12px"></td>
      <td>
        <select data-f="type" style="font-size:12px">
          ${Object.entries(SESSION_TYPES).map(([k,v]) => `<option value="${k}" ${s.type===k?'selected':''}>${v}</option>`).join('')}
        </select>
      </td>
      <td><input type="text" value="${escapeAttr(s.notes||'')}" data-f="notes" style="width:100%;font-size:12px"></td>
      <td><button class="btn btn-xs btn-danger" data-rm="${i}">✕</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('input[data-f], select[data-f]').forEach(el => el.onchange = () => {
    const i = +el.closest('tr').dataset.i;
    pendingPlan[i][el.dataset.f] = el.value;
  });
  tbody.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
    pendingPlan.splice(+b.dataset.rm, 1);
    renderPlan();
  });
  document.getElementById('plan-discard').onclick = () => {
    pendingPlan = null;
    const c = document.getElementById('syl-plan-card');
    c.style.display = 'none';
    c.open = false;
  };
  document.getElementById('plan-save').onclick = saveSessions;
}

async function saveSessions(){
  if (!pendingPlan?.length) return;

  // Borrar las viejas y crear las nuevas
  await supabase.from('v5_sessions').delete().eq('course_id', courseId);
  const rows = pendingPlan.map((s,i) => ({
    course_id: courseId,
    number: s.number || i+1,
    date: s.date || null,
    topic: s.topic || null,
    type: s.type || 'magistral',
    notes: s.notes || null,
    duration_hours: course.hours_per_session || null,
  }));
  const { error } = await supabase.from('v5_sessions').insert(rows);
  if (error){ toast('Error: '+error.message,'error'); return; }

  toast(`✅ ${rows.length} sesiones guardadas en el plan del semestre`,'success');
  pendingPlan = null;
  await loadAll();
  refreshUI();
}

function renderSaved(){
  const div = document.getElementById('syl-saved-table');
  if (!div) return;
  if (!sessions.length){
    div.innerHTML = `<p class="empty-state">No hay plan guardado aún. Genera uno arriba.</p>`;
    return;
  }
  div.innerHTML = `
    <div class="tbl-wrap" style="max-height:50vh">
      <table>
        <thead><tr>
          <th style="position:sticky;top:0;background:var(--ean-light);z-index:2">#</th>
          <th style="position:sticky;top:0;background:var(--ean-light);z-index:2">Fecha</th>
          <th style="position:sticky;top:0;background:var(--ean-light);z-index:2">Tema</th>
          <th style="position:sticky;top:0;background:var(--ean-light);z-index:2">Tipo</th>
          <th style="position:sticky;top:0;background:var(--ean-light);z-index:2">Notas</th>
        </tr></thead>
        <tbody>
          ${sessions.map(s => `
            <tr>
              <td class="num">${s.number||''}</td>
              <td><b>${s.date||''}</b></td>
              <td>${escape(s.topic||'')}</td>
              <td><span class="chip" style="font-size:10px">${SESSION_TYPES[s.type]||s.type}</span></td>
              <td style="font-size:11px;color:var(--ean-gray)">${escape(s.notes||'')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function fileToBase64(file){
  return new Promise((res,rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

const escape = s => String(s||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const escapeAttr = s => escape(s).replace(/"/g,'&quot;');
