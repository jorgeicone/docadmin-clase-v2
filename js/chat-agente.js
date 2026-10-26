// 🤖 AI Chat con agente — el modelo consulta el curso con herramientas y
// propone cambios. Nada se guarda sin que el docente pulse Confirmar: la
// escritura la hace este navegador con la sesión del docente (RLS).
import { supabase, currentSession } from './supabase-client.js';
import { AGENT_URL } from './config.js';
import { toast } from './toast.js';

let historial = [];        // [{ role:'user'|'assistant', content:string }] solo texto
let confirmaciones = [];   // resúmenes confirmados que se avisan al agente en el próximo mensaje
let propuestas = new Map(); // id → { propuesta, estado:'pendiente'|'guardando'|'guardada'|'descartada' }
let store = null;
let enviando = false;
let abortar = null;

const SUGERENCIAS = [
  '¿Quiénes tienen peor asistencia?',
  '¿Qué grupos no han sustentado?',
  'Registra la asistencia de hoy: todos presentes',
  'Crea un taller individual sobre Customer Journey, escala 0-5',
  'Genera un Excel con el consolidado de notas',
  'Propón 3 temas para la próxima clase con bibliografía',
];

export async function mountChatAgente(root, appStore){
  store = appStore;
  root.innerHTML = `
    <div class="card">
      <div class="card-row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
        <h2>🤖 Asistente del curso — ${esc(store.activeCourse.name)}</h2>
        <button class="btn btn-out btn-xs" id="ag-limpiar">🗑 Nueva conversación</button>
      </div>
      <div style="margin-top:6px;font-size:12px;color:var(--ean-gray)">
        Consulta estudiantes, notas, asistencia y sustentaciones; propone cambios que tú confirmas; genera Excel, PowerPoint, Word o PDF.
      </div>
    </div>
    <div class="card" style="display:flex;flex-direction:column;height:calc(100vh - 260px);min-height:420px">
      <div id="ag-mensajes" style="flex:1;overflow-y:auto;padding:8px;background:#fafafa;border-radius:6px;margin-bottom:10px"></div>
      <div id="ag-sugerencias"></div>
      <div style="display:flex;gap:8px;align-items:flex-end">
        <textarea id="ag-entrada" rows="2" placeholder="Pide algo sobre el curso… (Enter envía, Shift+Enter nueva línea)"
          style="flex:1;resize:none;border:1px solid var(--ean-border);border-radius:6px;padding:8px;font-family:inherit;font-size:13px"></textarea>
        <button class="btn btn-cyan btn-lg" id="ag-enviar" aria-label="Enviar">➤</button>
      </div>
      <div style="font-size:10px;color:var(--ean-gray);margin-top:6px">
        💡 Cada paso del asistente consume 1 llamada IA de tu plan. Los cambios solo se guardan cuando pulsas <b>Confirmar</b>.
      </div>
    </div>`;

  document.getElementById('ag-limpiar').onclick = () => {
    if (enviando && abortar) abortar.abort();
    historial = []; confirmaciones = []; propuestas = new Map();
    document.getElementById('ag-mensajes').innerHTML = '';
    pintarVacio(); pintarSugerencias();
  };
  document.getElementById('ag-enviar').onclick = enviar;
  document.getElementById('ag-entrada').onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); enviar(); }
  };
  pintarVacio();
  pintarSugerencias();
}

function pintarVacio(){
  const div = document.getElementById('ag-mensajes');
  if (div.children.length) return;
  div.innerHTML = `<div id="ag-vacio" style="text-align:center;padding:30px 20px;color:var(--ean-gray)">
    <div style="font-size:36px;margin-bottom:8px">🤖</div>
    <div style="font-size:14px;font-weight:600;margin-bottom:4px">¿Qué hacemos hoy con el curso?</div>
    <div style="font-size:12px">Puedo consultar, preparar cambios para que los confirmes y generar archivos.</div></div>`;
}

function pintarSugerencias(){
  const div = document.getElementById('ag-sugerencias');
  if (!div) return;
  if (historial.length){ div.innerHTML = ''; return; }
  div.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
    ${SUGERENCIAS.map(s => `<button class="btn btn-out btn-xs" data-sug="${escAttr(s)}" style="font-size:11px">${esc(s)}</button>`).join('')}</div>`;
  div.querySelectorAll('[data-sug]').forEach(b => b.onclick = () => {
    document.getElementById('ag-entrada').value = b.dataset.sug;
    enviar();
  });
}

function burbuja(rol){
  document.getElementById('ag-vacio')?.remove();
  const div = document.getElementById('ag-mensajes');
  const fila = document.createElement('div');
  fila.style.cssText = `display:flex;${rol === 'user' ? 'justify-content:flex-end' : ''};margin-bottom:10px`;
  const b = document.createElement('div');
  b.style.cssText = `max-width:85%;min-width:0;padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.5;word-wrap:break-word;` +
    (rol === 'user' ? 'background:var(--ean-blue);color:#fff;border:1px solid var(--ean-blue);white-space:pre-wrap'
                    : 'width:85%;background:#fff;color:var(--ean-dark);border:1px solid var(--ean-border)');
  fila.appendChild(b);
  div.appendChild(fila);
  div.scrollTop = div.scrollHeight;
  return b;
}

async function enviar(){
  if (enviando) return;
  const inp = document.getElementById('ag-entrada');
  const texto = inp.value.trim();
  if (!texto) return;
  inp.value = '';
  enviando = true;
  document.getElementById('ag-enviar').disabled = true;

  burbuja('user').textContent = texto;
  // El agente se entera de lo que el docente confirmó desde el último mensaje
  const contenido = confirmaciones.length
    ? `[El docente confirmó y ya quedó guardado: ${confirmaciones.join('; ')}]\n\n${texto}` : texto;
  confirmaciones = [];
  historial.push({ role:'user', content: contenido });
  pintarSugerencias();

  const b = burbuja('assistant');
  b.innerHTML = `<div class="ag-pasos" style="display:flex;flex-direction:column;gap:3px;margin-bottom:6px"></div>
    <div class="ag-texto"><span class="loader"></span></div><div class="ag-extra"></div>`;
  const pasos = b.querySelector('.ag-pasos');
  const caja = b.querySelector('.ag-texto');
  const extra = b.querySelector('.ag-extra');
  let respuesta = '';
  const scroll = () => { const d = document.getElementById('ag-mensajes'); d.scrollTop = d.scrollHeight; };

  try {
    const session = await currentSession();
    if (!session?.access_token) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    abortar = new AbortController();
    const r = await fetch(AGENT_URL + '/agente', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ course_id: store.activeCourse.id, messages: historial.slice(-20) }),
      signal: abortar.signal,
    });
    if (!r.ok || !r.body){
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `El asistente respondió ${r.status}`);
    }

    const lector = r.body.getReader();
    const dec = new TextDecoder();
    let buffer = '';
    for (;;){
      const { value, done } = await lector.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      let corte;
      while ((corte = buffer.indexOf('\n\n')) >= 0){
        const bloque = buffer.slice(0, corte); buffer = buffer.slice(corte + 2);
        const linea = bloque.split('\n').find(l => l.startsWith('data: '));
        if (!linea) continue;
        let ev; try { ev = JSON.parse(linea.slice(6)); } catch { continue; }
        switch (ev.tipo){
          case 'texto':
            respuesta += ev.texto;
            caja.innerHTML = md(respuesta);
            break;
          case 'herramienta': {
            if (ev.estado === 'inicio'){
              const p = document.createElement('div');
              p.style.cssText = 'font-size:11px;color:var(--ean-gray)';
              p.dataset.nombre = ev.nombre;
              p.innerHTML = `<span class="loader" style="width:10px;height:10px;margin-right:6px"></span>${esc(ev.nombre)}…`;
              pasos.appendChild(p);
            } else {
              const p = [...pasos.children].reverse().find(x => x.dataset.nombre === ev.nombre && !x.dataset.listo);
              if (p){ p.dataset.listo = '1'; p.innerHTML = `${ev.resumen === 'falló' ? '⚠️' : '✓'} ${esc(ev.nombre)}`; }
            }
            break;
          }
          case 'propuesta':
            propuestas.set(ev.propuesta.id, { propuesta: ev.propuesta, estado:'pendiente' });
            extra.appendChild(tarjetaPropuesta(ev.propuesta));
            break;
          case 'archivo': {
            const a = document.createElement('a');
            a.href = ev.url; a.target = '_blank'; a.rel = 'noopener';
            a.className = 'btn btn-green btn-xs'; a.style.cssText = 'display:inline-block;margin:6px 6px 0 0';
            a.textContent = '⬇ ' + ev.nombre;
            extra.appendChild(a);
            break;
          }
          case 'uso': {
            const u = document.createElement('div');
            u.style.cssText = 'font-size:10px;color:var(--ean-gray);margin-top:6px';
            u.textContent = `${ev.llamadas} llamada${ev.llamadas === 1 ? '' : 's'} IA · ${Math.round((ev.entrada + ev.salida) / 100) / 10} mil tokens`;
            extra.appendChild(u);
            break;
          }
          case 'error': {
            const e = document.createElement('div');
            e.style.cssText = 'color:var(--red);font-size:12px;margin-top:6px';
            e.textContent = '❌ ' + ev.mensaje;
            extra.appendChild(e);
            break;
          }
        }
        scroll();
      }
    }
  } catch (e){
    if (e.name !== 'AbortError'){
      const d = document.createElement('div');
      d.style.cssText = 'color:var(--red);font-size:12px';
      d.textContent = '❌ ' + (e.message || e);
      extra.appendChild(d);
    }
  } finally {
    pasos.querySelectorAll('.loader').forEach(l => l.replaceWith('· '));
    if (!respuesta) caja.innerHTML = '';
    if (respuesta) historial.push({ role:'assistant', content: respuesta });
    else historial.pop(); // sin respuesta: el próximo mensaje no queda con dos turnos del docente seguidos
    enviando = false; abortar = null;
    document.getElementById('ag-enviar').disabled = false;
    document.getElementById('ag-entrada')?.focus();
    store.refreshPlan?.();
    scroll();
  }
}

// ── Propuestas ─────────────────────────────────────────────

function tarjetaPropuesta(p){
  const t = document.createElement('div');
  t.style.cssText = 'border:1px solid var(--ean-cyan);background:var(--ean-cyan-soft);border-radius:8px;padding:10px;margin-top:8px';
  const titulo = { notas:'📝 Notas', actividad:'➕ Nueva actividad', asistencia:'📅 Asistencia', sesion_plan:'🗓 Plan del semestre' }[p.tipo] || 'Propuesta';
  t.innerHTML = `<div style="font-weight:700;font-size:12px;margin-bottom:4px">${titulo} · pendiente de confirmar</div>
    <div style="font-size:12px;margin-bottom:6px">${esc(p.resumen)}</div>
    ${detalle(p)}
    <div class="ag-acciones" style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
      <button class="btn btn-cyan btn-xs" data-accion="confirmar">✓ Confirmar</button>
      <button class="btn btn-out btn-xs" data-accion="descartar">Descartar</button>
    </div>`;
  t.querySelector('[data-accion="confirmar"]').onclick = () => confirmar(p.id, t);
  t.querySelector('[data-accion="descartar"]').onclick = () => {
    propuestas.get(p.id).estado = 'descartada';
    t.querySelector('.ag-acciones').innerHTML = '<span style="font-size:11px;color:var(--ean-gray)">Descartada</span>';
    t.style.opacity = '.6';
  };
  return t;
}

function detalle(p){
  const tabla = (cab, filas) => `<div style="overflow-x:auto;max-height:220px;overflow-y:auto;background:#fff;border-radius:6px">
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr>${cab.map(c => `<th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--ean-border)">${c}</th>`).join('')}</tr></thead>
      <tbody>${filas.map(f => `<tr>${f.map(c => `<td style="padding:4px 6px;border-bottom:1px solid var(--ean-border)">${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  switch (p.tipo){
    case 'notas':
      return tabla(['Estudiante', 'Actual', 'Nueva', 'Observación'],
        p.filas.map(f => [esc(f.nombre), f.anterior ?? '—', `<b>${f.valor}</b>`, esc(f.observacion || '')]));
    case 'asistencia':
      return tabla(['Estudiante', 'Estado', 'Observación'],
        p.filas.map(f => [esc(f.nombre), { P:'✅ P', T:'⏰ T', A:'❌ A' }[f.estado], esc(f.observacion || '')]));
    case 'actividad': {
      const d = p.datos;
      return tabla(['Campo', 'Valor'], [
        ['Nombre', esc(d.name)], ['Tipo', d.type === 'group' ? 'Grupal' : 'Individual'], ['Escala', `0-${d.max_points}`],
        ['Peso', d.weight != null ? d.weight + '%' : '—'], ['Fecha', d.date || '—'], ['Tema', esc(d.topic || '—')]]);
    }
    case 'sesion_plan': {
      const d = p.datos;
      return tabla(['Campo', 'Valor'], [['Sesión', d.number ?? '—'], ['Fecha', d.date], ['Tema', esc(d.topic)], ['Tipo', esc(d.type)], ['Notas', esc(d.notes || '—')]]);
    }
  }
  return '';
}

async function confirmar(id, tarjeta){
  const item = propuestas.get(id);
  if (!item || item.estado !== 'pendiente') return;
  item.estado = 'guardando';
  const acciones = tarjeta.querySelector('.ag-acciones');
  acciones.innerHTML = '<span class="loader"></span> <span style="font-size:11px">Guardando…</span>';
  try {
    await ejecutar(item.propuesta);
    item.estado = 'guardada';
    confirmaciones.push(item.propuesta.resumen);
    acciones.innerHTML = '<span class="chip chip-green">✓ Guardado</span>';
    tarjeta.style.borderColor = 'var(--green)';
    toast('Cambios guardados', 'success');
  } catch (e){
    item.estado = 'pendiente';
    acciones.innerHTML = `<span style="color:var(--red);font-size:11px">No se guardó: ${esc(e.message || e)}</span>`;
    const reintentar = document.createElement('button');
    reintentar.className = 'btn btn-out btn-xs'; reintentar.textContent = 'Reintentar';
    reintentar.onclick = () => confirmar(id, tarjeta);
    acciones.appendChild(reintentar);
  }
}

/** Escribe la propuesta con la sesión del docente, igual que las vistas de la app. */
async function ejecutar(p){
  const courseId = store.activeCourse.id;
  const ok = ({ error }) => { if (error) throw new Error(error.message); };

  if (p.tipo === 'notas'){
    const base = f => ({ activity_id: p.actividad.id, student_id: f.student_id, group_id: f.group_id, value: f.valor, source: 'agente' });
    // Las filas sin observación no deben borrar la que ya existía
    const conObs = p.filas.filter(f => f.observacion).map(f => ({ ...base(f), observation: f.observacion }));
    const sinObs = p.filas.filter(f => !f.observacion).map(base);
    if (conObs.length) ok(await supabase.from('v5_grades').upsert(conObs, { onConflict: 'activity_id,student_id' }));
    if (sinObs.length) ok(await supabase.from('v5_grades').upsert(sinObs, { onConflict: 'activity_id,student_id' }));
    return;
  }
  if (p.tipo === 'actividad'){
    ok(await supabase.from('v5_activities').insert({ course_id: courseId, ...p.datos }));
    return;
  }
  if (p.tipo === 'asistencia'){
    const datos = { course_id: courseId, type: 'attendance', name: `Asistencia ${p.fecha}`, date: p.fecha, max_points: 1, ...(p.tema ? { topic: p.tema } : {}) };
    let actId = p.existente_id;
    if (actId){
      ok(await supabase.from('v5_activities').update(datos).eq('id', actId));
      ok(await supabase.from('v5_grades').delete().eq('activity_id', actId));
    } else {
      const r = await supabase.from('v5_activities').insert(datos).select().single();
      ok(r); actId = r.data.id;
    }
    const filas = p.filas.map(f => ({ activity_id: actId, student_id: f.student_id, status: f.estado, observation: f.observacion,
      value: f.estado === 'P' ? 1 : (f.estado === 'T' ? 0.5 : 0), source: 'agente' }));
    ok(await supabase.from('v5_grades').upsert(filas, { onConflict: 'activity_id,student_id' }));
    return;
  }
  if (p.tipo === 'sesion_plan'){
    ok(await supabase.from('v5_sessions').insert({ course_id: courseId, ...p.datos }));
    return;
  }
  throw new Error('Tipo de propuesta desconocido');
}

// ── Markdown seguro (escapa primero) ───────────────────────

function md(texto){
  const lineas = esc(texto).split('\n');
  const out = [];
  for (let i = 0; i < lineas.length; i++){
    // Tablas Markdown: | a | b | seguida de |---|---|
    if (/^\s*\|.*\|\s*$/.test(lineas[i]) && /^\s*\|?\s*:?-{2,}/.test(lineas[i + 1] || '')){
      const celdas = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
      const cab = celdas(lineas[i]); i += 2;
      const filas = [];
      while (i < lineas.length && /^\s*\|.*\|\s*$/.test(lineas[i])) filas.push(celdas(lineas[i++]));
      i--;
      out.push(`<div style="overflow-x:auto;margin:6px 0"><table style="border-collapse:collapse;font-size:12px;min-width:100%">
        <thead><tr>${cab.map(c => `<th style="text-align:left;padding:4px 8px;border-bottom:2px solid var(--ean-border);white-space:nowrap">${c}</th>`).join('')}</tr></thead>
        <tbody>${filas.map(f => `<tr>${f.map(c => `<td style="padding:4px 8px;border-bottom:1px solid var(--ean-border)">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const l = lineas[i];
    if (/^#{1,4} /.test(l)) out.push(`<div style="font-weight:700;margin:8px 0 2px">${inline(l.replace(/^#+ /, ''))}</div>`);
    else if (/^\s*[-*] /.test(l)) out.push(`<div style="padding-left:12px">• ${inline(l.replace(/^\s*[-*] /, ''))}</div>`);
    else if (/^\s*\d+[.)] /.test(l)) out.push(`<div style="padding-left:12px">${inline(l.trim())}</div>`);
    else out.push(l.trim() ? `<div>${inline(l)}</div>` : '<div style="height:6px"></div>');
  }
  return out.join('');
}

function inline(s){
  return s
    .replace(/`([^`]+)`/g, '<code style="background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:12px">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(?<![*\w])\*([^*\n]+?)\*(?!\*)/g, '<i>$1</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

const esc = s => String(s ?? '').replace(/[<>&"]/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' }[c]));
const escAttr = esc;
