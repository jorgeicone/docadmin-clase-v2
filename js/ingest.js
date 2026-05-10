// 🤖 INGESTA IA — sube Excel/PDF/imagen → IA extrae notas → matchea estudiantes/grupos → guarda
import { supabase, currentSession } from './supabase-client.js';
import { toast } from './toast.js';
import { ACTIVITY_TYPES } from './config.js';
import { WORKER_URL } from './config.js';
import { loadXLSX } from './xlsx-loader.js';

let activities = [], students = [], groups = [], memberships = [];
let courseId = null;

// Estado del wizard
let state = {
  selectedActivity: null,
  newActivity: null,
  file: null,
  fileType: null,        // 'excel' | 'image' | 'pdf'
  rawData: null,         // para Excel: array de filas
  aiResponse: null,      // respuesta cruda de la IA
  matches: [],           // {studentId|groupId, name, value, desglose, confidence, status}
};

export async function mountIngest(root, store){
  courseId = store.activeCourse.id;
  await loadContext();

  root.innerHTML = `
    <div class="card">
      <h2>🤖 Ingesta IA — Subir notas desde cualquier archivo</h2>
      <p style="font-size:13px;color:var(--ean-gray);margin-bottom:14px">
        Sube un Excel, foto de cuaderno, o PDF con notas. La IA extrae los datos y los matchea con tus
        <b>${students.length}</b> estudiantes y <b>${groups.length}</b> grupos. Tú revisas y confirmas antes de guardar.
      </p>

      <!-- Step 1: Elegir actividad -->
      <div class="card" style="background:#F0F4F8;border-left:4px solid var(--ean-blue)">
        <h3>1️⃣ ¿A qué actividad pertenecen estas notas?</h3>
        <div class="grid-2" style="margin-top:8px">
          <div class="field">
            <label>Actividad existente</label>
            <select id="i-act-existing">
              <option value="">— Selecciona —</option>
              ${activities.map(a => `<option value="${a.id}">${escape(a.name)} (escala 0-${a.max_points})</option>`).join('')}
            </select>
          </div>
          <div class="field" style="display:flex;align-items:flex-end">
            <button class="btn btn-out" id="i-act-new" style="width:100%">＋ O crear nueva actividad</button>
          </div>
        </div>
        <div id="i-act-form" style="display:none"></div>
        <div id="i-act-summary" style="display:none;margin-top:8px;padding:10px;background:#fff;border-radius:6px;font-size:13px"></div>
      </div>

      <!-- Step 2: Subir archivo (oculto hasta tener actividad) -->
      <div class="card" id="step2" style="display:none;background:#F0FCFD;border-left:4px solid var(--ean-cyan)">
        <h3>2️⃣ Sube el archivo de notas</h3>
        <div class="dropzone" id="dz-ingest">
          <div class="icon">📄</div>
          <div><b>Arrastra el archivo aquí</b> o haz click para seleccionar</div>
          <div class="hint">Excel · CSV · PDF · JPG · PNG</div>
          <input type="file" id="f-ingest" accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.webp" style="display:none">
        </div>
        <div id="i-file-preview" style="margin-top:10px"></div>
      </div>

      <!-- Step 3: Procesar con IA -->
      <div class="card" id="step3" style="display:none;background:#FFF8E1;border-left:4px solid #F57C00">
        <h3>3️⃣ Procesar con IA</h3>
        <p style="font-size:12px;color:var(--ean-gray)">La IA leerá el archivo, extraerá las notas y las matchea con tus estudiantes/grupos.</p>
        <button class="btn btn-cyan btn-lg" id="i-process" style="margin-top:10px">🚀 Procesar con IA</button>
        <div id="i-process-status" style="margin-top:10px"></div>
      </div>

      <!-- Step 4: Revisar y guardar -->
      <div class="card" id="step4" style="display:none;background:#E8F5E9;border-left:4px solid var(--green)">
        <h3>4️⃣ Revisa los matches y confirma</h3>
        <div id="i-matches"></div>
      </div>
    </div>
  `;

  document.getElementById('i-act-existing').onchange = e => {
    const id = e.target.value;
    state.selectedActivity = activities.find(a => a.id === id) || null;
    state.newActivity = null;
    document.getElementById('i-act-form').style.display = 'none';
    showActivitySummary();
  };

  document.getElementById('i-act-new').onclick = () => {
    document.getElementById('i-act-existing').value = '';
    state.selectedActivity = null;
    renderNewActivityForm();
  };

  setupDropzone();
  document.getElementById('i-process').onclick = () => processWithAI(store);
}

async function loadContext(){
  const [actR, stuR, grpR, memR] = await Promise.all([
    supabase.from('v5_activities').select('*').eq('course_id', courseId).order('created_at',{ascending:false}),
    supabase.from('v5_students').select('id, cedula, name').eq('course_id', courseId).order('name'),
    supabase.from('v5_groups').select('id, name').eq('course_id', courseId).order('name'),
    supabase.from('v5_group_members').select('group_id, student_id'),
  ]);
  activities = actR.data || [];
  students = stuR.data || [];
  groups = grpR.data || [];
  memberships = memR.data || [];
}

function showActivitySummary(){
  const a = state.selectedActivity || state.newActivity;
  const sum = document.getElementById('i-act-summary');
  if (!a){ sum.style.display = 'none'; document.getElementById('step2').style.display = 'none'; return; }
  sum.style.display = 'block';
  sum.innerHTML = `✅ Actividad: <b>${escape(a.name)}</b> · Tipo: ${ACTIVITY_TYPES[a.type]||a.type} · Escala 0-${a.max_points}${a.weight?` · ${a.weight}% del curso`:''}`;
  document.getElementById('step2').style.display = 'block';
}

function renderNewActivityForm(){
  const div = document.getElementById('i-act-form');
  div.style.display = 'block';
  div.innerHTML = `
    <div style="background:#fff;padding:12px;border-radius:6px;margin-top:10px">
      <div class="grid-2">
        <div class="field"><label>Nombre *</label><input id="na-name" placeholder="Ej: Sustentación 1, Taller 2"></div>
        <div class="field"><label>Tipo *</label>
          <select id="na-type">
            ${Object.entries(ACTIVITY_TYPES).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Escala máxima *</label><input id="na-max" type="number" step="0.1" value="5" min="1"></div>
        <div class="field"><label>Peso del curso (%)</label><input id="na-weight" type="number" step="1" min="0" max="100" placeholder="Opcional"></div>
        <div class="field"><label>Fecha</label><input id="na-date" type="date"></div>
        <div class="field"><label>Tema</label><input id="na-topic" placeholder="Opcional"></div>
      </div>
      <button class="btn" id="na-create">Crear y continuar</button>
    </div>
  `;
  document.getElementById('na-create').onclick = async () => {
    const payload = {
      course_id: courseId,
      name: document.getElementById('na-name').value.trim(),
      type: document.getElementById('na-type').value,
      max_points: parseFloat(document.getElementById('na-max').value) || 5,
      weight: parseFloat(document.getElementById('na-weight').value) || null,
      date: document.getElementById('na-date').value || null,
      topic: document.getElementById('na-topic').value.trim() || null,
    };
    if (!payload.name){ toast('Nombre requerido','error'); return; }
    const { data, error } = await supabase.from('v5_activities').insert(payload).select().single();
    if (error){ toast('Error: '+error.message,'error'); return; }
    state.newActivity = data;
    activities.unshift(data);
    div.style.display = 'none';
    // Refrescar el dropdown con la nueva opción seleccionada
    const sel = document.getElementById('i-act-existing');
    sel.innerHTML = '<option value="">— Selecciona —</option>' +
      activities.map(a => `<option value="${a.id}" ${a.id===data.id?'selected':''}>${escape(a.name)} (escala 0-${a.max_points})</option>`).join('');
    state.selectedActivity = data;
    showActivitySummary();
    toast('Actividad creada','success');
  };
}

function setupDropzone(){
  const dz = document.getElementById('dz-ingest');
  const inp = document.getElementById('f-ingest');
  dz.onclick = () => inp.click();
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('dragover'); };
  dz.ondragleave = () => dz.classList.remove('dragover');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); };
  inp.onchange = () => inp.files[0] && handleFile(inp.files[0]);
}

async function handleFile(f){
  state.file = f;
  const ext = f.name.split('.').pop().toLowerCase();
  if (['xlsx','xls','csv'].includes(ext)) state.fileType = 'excel';
  else if (ext === 'pdf') state.fileType = 'pdf';
  else if (['jpg','jpeg','png','webp'].includes(ext)) state.fileType = 'image';
  else { toast('Formato no soportado','error'); return; }

  const preview = document.getElementById('i-file-preview');
  let preInner = `<div style="background:#fff;padding:10px;border-radius:6px"><b>📎 ${escape(f.name)}</b> · ${(f.size/1024).toFixed(1)} KB · <span class="chip">${state.fileType.toUpperCase()}</span></div>`;

  if (state.fileType === 'excel'){
    let XLSX;
    try { XLSX = await loadXLSX(); }
    catch(e){ toast(e.message,'error'); return; }
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type:'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    state.rawData = XLSX.utils.sheet_to_json(ws, { defval:'' });
    preInner += `<div style="margin-top:8px;font-size:12px;color:var(--ean-gray)">Detecté <b>${state.rawData.length}</b> filas con columnas: ${Object.keys(state.rawData[0]||{}).map(k=>`<code style="font-size:10px">${escape(k)}</code>`).join(' ')}</div>`;
  } else if (state.fileType === 'image'){
    const url = URL.createObjectURL(f);
    preInner += `<div style="margin-top:8px;text-align:center"><img src="${url}" style="max-height:200px;max-width:100%;border-radius:6px;border:1px solid var(--ean-border)"></div>`;
  } else {
    preInner += `<div style="margin-top:8px;font-size:12px;color:var(--ean-gray)">PDF listo para enviar a la IA</div>`;
  }

  preview.innerHTML = preInner;
  document.getElementById('step3').style.display = 'block';
}

async function processWithAI(store){
  const a = state.selectedActivity;
  if (!a){ toast('Selecciona una actividad primero','error'); return; }
  if (!state.file){ toast('Sube un archivo primero','error'); return; }

  const status = document.getElementById('i-process-status');
  const btn = document.getElementById('i-process');
  btn.disabled = true;
  status.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span class="loader"></span> <b>Procesando con Claude…</b> esto puede tomar 10-30 segundos</div>`;

  try {
    const session = await currentSession();
    if (!session?.access_token) throw new Error('Sesión expirada, recarga la página');

    let messages;
    const systemPrompt = buildSystemPrompt(a);

    if (state.fileType === 'excel'){
      // Excel: enviar JSON estructurado como texto
      const txt = JSON.stringify(state.rawData, null, 2);
      messages = [{ role:'user', content: [{ type:'text', text: `Aquí están las notas en formato JSON (extraídas del Excel):\n\n\`\`\`json\n${txt.substring(0, 20000)}\n\`\`\`\n\nExtrae cada calificación. Si una fila tiene múltiples estudiantes (grupo), genera una entrada por cada uno.` }] }];
    } else {
      // Imagen o PDF: convertir a base64 y enviar como vision
      const b64 = await fileToBase64(state.file);
      const mediaType = state.file.type || (state.fileType==='pdf'?'application/pdf':'image/jpeg');
      const contentBlock = state.fileType === 'pdf'
        ? { type:'document', source:{ type:'base64', media_type:'application/pdf', data:b64 } }
        : { type:'image', source:{ type:'base64', media_type: mediaType, data:b64 } };
      messages = [{ role:'user', content: [contentBlock, { type:'text', text:'Extrae todas las calificaciones visibles. Si hay rúbricas con múltiples criterios, suma los puntos por estudiante o grupo.' }] }];
    }

    const r = await fetch(WORKER_URL + '/', {
      method:'POST',
      headers:{ 'Authorization':'Bearer '+session.access_token, 'Content-Type':'application/json' },
      body: JSON.stringify({ messages, system: systemPrompt, max_tokens: 4096 })
    });

    const txt = await r.text();
    if (!r.ok){ throw new Error(`Worker ${r.status}: ${txt}`); }
    const data = JSON.parse(txt);

    // El Worker devuelve la respuesta completa de Anthropic en data.result
    // Extraer el texto del content array
    const aiText = data.result?.content?.[0]?.text || data.result?.text || (typeof data.result === 'string' ? data.result : '');
    if (!aiText) throw new Error('Respuesta vacía de la IA');
    state.aiResponse = aiText;

    const extracted = parseAIResponse(aiText);
    state.matches = matchToRoster(extracted);

    status.innerHTML = `<div style="color:var(--green);font-weight:600">✅ IA procesó. ${state.matches.length} calificaciones extraídas. Plan: ${data.plan} (quedan ${data.calls_remaining} llamadas).</div>`;
    document.getElementById('step4').style.display = 'block';
    renderMatches(store);
  } catch(e){
    status.innerHTML = `<div style="background:#FFEBEE;color:var(--red);padding:10px;border-radius:6px"><b>❌ Error:</b> ${escape(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

function buildSystemPrompt(activity){
  const studentsSummary = students.map(s => `${s.cedula}|${s.name}`).join('\n');
  const groupsSummary = groups.map(g => {
    const mems = memberships.filter(m=>m.group_id===g.id).map(m => students.find(s=>s.id===m.student_id)?.name).filter(Boolean);
    return `${g.name}: ${mems.join(', ')}`;
  }).join('\n');

  return `Eres un asistente para un docente universitario que ingresa calificaciones a su sistema.

CONTEXTO DEL CURSO:
- Actividad: "${activity.name}" (tipo: ${activity.type})
- Escala: 0 a ${activity.max_points} puntos
- Estudiantes (cédula|nombre):
${studentsSummary}

- Grupos del curso:
${groupsSummary || '(no hay grupos definidos)'}

TAREA:
Lee el archivo del usuario (Excel JSON, foto de cuaderno con rúbrica a mano, o PDF) y extrae cada calificación.

REGLAS:
1. Si una fila tiene varios estudiantes (grupo), genera una entrada por CADA estudiante con la misma nota.
2. Para rúbricas con múltiples criterios, SUMA los puntos.
3. Si la nota está en escala diferente a 0-${activity.max_points}, escálala proporcionalmente.
4. El "desglose" debe explicar de dónde sale la nota (si es texto del archivo o suma de criterios).
5. Identifica al estudiante por su cédula o por su nombre (con tolerancia a errores tipográficos).
6. Si no puedes identificar a alguien, ponlo igual con "matchHint" para que el docente lo asigne manualmente.

DEVUELVE ÚNICAMENTE JSON VÁLIDO con esta estructura, sin markdown:

{
  "grades": [
    {
      "studentRef": "cédula o nombre tal como aparece en el archivo",
      "groupRef": "nombre del grupo si la nota es grupal, sino null",
      "value": 18,
      "desglose": "10 presentación + 5 humildad + 3 modelo de negocio",
      "matchHint": "info adicional para identificar al estudiante si la cédula no coincide"
    }
  ]
}`;
}

function parseAIResponse(text){
  // Tolerancia a markdown wrapping
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  const jsonText = (m[1] || text).trim();
  try {
    const parsed = JSON.parse(jsonText);
    return parsed.grades || [];
  } catch(e){
    // Reintentar buscando solo el objeto principal
    const m2 = text.match(/\{[\s\S]*\}/);
    if (m2){ try { return (JSON.parse(m2[0]).grades) || []; } catch{} }
    throw new Error('La IA devolvió un formato no parseable. Respuesta: ' + text.substring(0, 300));
  }
}

function matchToRoster(extracted){
  // Para cada nota extraída, intentar matchear con un estudiante
  return extracted.map(e => {
    let matched = null, confidence = 0, status = 'unmatched';

    // 1. Match exacto por cédula
    if (e.studentRef){
      const ref = String(e.studentRef).trim();
      matched = students.find(s => s.cedula === ref);
      if (matched){ confidence = 1; status = 'matched'; }
    }

    // 2. Match por nombre (fuzzy)
    if (!matched && e.studentRef){
      const ref = normalize(e.studentRef);
      // Match exacto por nombre
      matched = students.find(s => normalize(s.name) === ref);
      if (matched){ confidence = 0.95; status = 'matched'; }
    }
    if (!matched && e.studentRef){
      const ref = normalize(e.studentRef);
      const candidates = students.map(s => ({ s, score: nameSimilarity(normalize(s.name), ref) }));
      const best = candidates.sort((a,b)=>b.score-a.score)[0];
      if (best && best.score >= 0.7){ matched = best.s; confidence = best.score; status = 'fuzzy'; }
    }

    return {
      studentRef: e.studentRef,
      groupRef: e.groupRef,
      matchHint: e.matchHint,
      value: e.value,
      desglose: e.desglose,
      studentId: matched?.id || null,
      studentName: matched?.name || null,
      studentCedula: matched?.cedula || null,
      confidence,
      status,
    };
  });
}

function normalize(s){
  return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
}
function nameSimilarity(a, b){
  // Coincidencia por palabras compartidas (apellidos cuentan más por longitud)
  const aw = new Set(a.split(' ').filter(w => w.length > 2));
  const bw = new Set(b.split(' ').filter(w => w.length > 2));
  if (!aw.size || !bw.size) return 0;
  let shared = 0; aw.forEach(w => bw.has(w) && shared++);
  return shared / Math.max(aw.size, bw.size);
}

function renderMatches(store){
  const div = document.getElementById('i-matches');
  const matched = state.matches.filter(m => m.status==='matched');
  const fuzzy = state.matches.filter(m => m.status==='fuzzy');
  const unmatched = state.matches.filter(m => m.status==='unmatched');

  div.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <span class="chip chip-green">✅ ${matched.length} exactos</span>
      <span class="chip chip-yellow">⚠️ ${fuzzy.length} aproximados (revisar)</span>
      <span class="chip chip-red">❌ ${unmatched.length} sin match (asignar manual)</span>
    </div>
    <div class="tbl-wrap" style="max-height:500px">
      <table>
        <thead><tr>
          <th>#</th><th>Detectado en archivo</th>
          <th style="min-width:220px">Estudiante destino</th>
          <th class="num">Nota</th>
          <th>Desglose</th>
          <th class="num"></th>
        </tr></thead>
        <tbody id="matches-tbody"></tbody>
      </table>
    </div>
    <div style="margin-top:12px;text-align:right;display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-out" id="i-discard">🗑 Descartar todo</button>
      <button class="btn btn-cyan btn-lg" id="i-save">💾 Guardar <b>${matched.length+fuzzy.length}</b> notas</button>
    </div>
  `;

  renderMatchRows();

  document.getElementById('i-discard').onclick = () => { state.matches = []; document.getElementById('step4').style.display='none'; };
  document.getElementById('i-save').onclick = () => saveAll(store);
}

function renderMatchRows(){
  const tbody = document.getElementById('matches-tbody');
  tbody.innerHTML = state.matches.map((m,i) => {
    const statusChip = m.status==='matched'?'<span class="chip chip-green" style="font-size:10px">✅</span>'
      : m.status==='fuzzy'?`<span class="chip chip-yellow" style="font-size:10px">⚠️ ${Math.round(m.confidence*100)}%</span>`
      : '<span class="chip chip-red" style="font-size:10px">❌</span>';
    return `
    <tr data-idx="${i}">
      <td class="num">${i+1}</td>
      <td>
        <div style="font-size:12px"><b>${escape(m.studentRef||'(sin ref)')}</b></div>
        ${m.groupRef?`<div style="font-size:10px;color:var(--ean-gray)">Grupo: ${escape(m.groupRef)}</div>`:''}
        ${m.matchHint?`<div style="font-size:10px;color:#E65100">Hint: ${escape(m.matchHint)}</div>`:''}
      </td>
      <td>
        ${statusChip}
        <select class="match-sel" data-idx="${i}" style="margin-top:4px;font-size:12px">
          <option value="">— Sin asignar —</option>
          ${students.map(s => `<option value="${s.id}" ${s.id===m.studentId?'selected':''}>${escape(s.name)} (${escape(s.cedula)})</option>`).join('')}
        </select>
      </td>
      <td class="num"><input type="number" class="input-grade" data-val="${i}" value="${m.value??''}" step="0.1" min="0"></td>
      <td><input type="text" class="obs-input" data-des="${i}" value="${escapeAttr(m.desglose||'')}" style="width:100%;font-size:11px"></td>
      <td class="num"><button class="btn btn-xs btn-danger" data-rm="${i}">✕</button></td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('select.match-sel').forEach(sel => sel.onchange = () => {
    const i = +sel.dataset.idx;
    state.matches[i].studentId = sel.value || null;
    state.matches[i].status = sel.value ? 'matched' : 'unmatched';
  });
  tbody.querySelectorAll('input[data-val]').forEach(inp => inp.onchange = () => {
    state.matches[+inp.dataset.val].value = parseFloat(inp.value);
  });
  tbody.querySelectorAll('input[data-des]').forEach(inp => inp.onchange = () => {
    state.matches[+inp.dataset.des].desglose = inp.value;
  });
  tbody.querySelectorAll('button[data-rm]').forEach(btn => btn.onclick = () => {
    state.matches.splice(+btn.dataset.rm, 1);
    renderMatches(null);
  });
}

async function saveAll(store){
  const a = state.selectedActivity;
  const valid = state.matches.filter(m => m.studentId && m.value !== null && !isNaN(m.value));
  if (!valid.length){ toast('No hay notas válidas para guardar','error'); return; }

  // Audit upload
  const uploadRecord = {
    user_id: store.user.id,
    course_id: courseId,
    activity_id: a.id,
    file_name: state.file?.name,
    file_type: state.fileType,
    ai_response: { raw: state.aiResponse?.substring(0, 4000), matches: state.matches },
    grades_created: valid.length,
    status: 'success',
  };
  await supabase.from('v5_ai_uploads').insert(uploadRecord);

  // Deduplicar por student_id (un mismo estudiante puede haber salido en varias filas)
  // Estrategia: si hay duplicados, usar el ÚLTIMO (que el usuario haya editado más recientemente)
  const dedup = new Map();
  valid.forEach(m => dedup.set(m.studentId, m));
  const dedupedRows = [...dedup.values()].map(m => ({
    activity_id: a.id,
    student_id: m.studentId,
    value: m.value,
    desglose: m.desglose || null,
    source: 'ai-' + state.fileType,
  }));
  const dupSkipped = valid.length - dedupedRows.length;

  const { error } = await supabase.from('v5_grades').upsert(dedupedRows, { onConflict: 'activity_id,student_id' });
  if (error){ toast('Error: '+error.message,'error'); return; }

  toast(`✅ ${dedupedRows.length} notas guardadas en "${a.name}"${dupSkipped>0?` (${dupSkipped} duplicadas omitidas)`:''}`,'success');
  // Reset
  state = { selectedActivity:null, newActivity:null, file:null, fileType:null, rawData:null, aiResponse:null, matches:[] };
  store.go('activities');
}

function fileToBase64(file){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

const escape = s => String(s||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const escapeAttr = s => escape(s).replace(/"/g,'&quot;');
