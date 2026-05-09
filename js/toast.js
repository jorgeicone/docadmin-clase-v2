// Toast simple — no requiere DOM previo
let toastTimer;
export function toast(msg, type='info'){
  document.querySelectorAll('.toast').forEach(t=>t.remove());
  const el = document.createElement('div');
  el.className = 'toast ' + (type==='error'?'error':type==='success'?'success':'');
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>el.remove(), 3500);
}
