// 💳 PLAN — modal de plan actual + upgrade con Wompi
import { supabase, currentSession } from './supabase-client.js';
import { WORKER_URL } from './config.js';
import { toast } from './toast.js';

// Wompi public key sandbox (igual que v4)
const WOMPI_PUBLIC_KEY = 'pub_test_wXVTaUtLWOLZFA43MNc7ZFawWLqMOmvo';

const PLANS = {
  trial: { name:'Trial', price:0, icon:'🎓', color:'var(--ean-gray)', calls:50, model:'Haiku', features:[
    '50 llamadas IA',
    'Modelo Haiku (rápido)',
    'Sin sincronización en nube',
    'Para evaluar la app',
  ]},
  starter: { name:'Starter', price:49000, icon:'🚀', color:'var(--ean-cyan)', calls:200, model:'Haiku', features:[
    '200 llamadas IA / mes',
    'Modelo Haiku (rápido)',
    'Sincronización en nube',
    'Soporte por email',
  ]},
  pro: { name:'Pro', price:149000, icon:'⚡', color:'var(--ean-blue)', calls:1000, model:'Sonnet', popular:true, features:[
    '1000 llamadas IA / mes',
    'Modelo Sonnet (más potente)',
    'Sincronización en nube',
    'Análisis avanzado y reportes',
    'Soporte prioritario',
  ]},
  premium: { name:'Premium', price:349000, icon:'🌟', color:'var(--purple)', calls:9999, model:'Sonnet ilimitado', features:[
    'Llamadas IA ilimitadas',
    'Modelo Sonnet sin límites',
    'Sincronización + backup',
    'Soporte prioritario 24/7',
    'Sesiones de capacitación',
  ]},
};

let planInfo = null;          // { plan, calls_used, calls_limit, calls_remaining, plan_expires_at }
let selectedPlan = null;
let currentUser = null;

export async function openPlanModal(user){
  currentUser = user;
  await loadPlanInfo();
  renderModal();
}

async function loadPlanInfo(){
  try {
    const session = await currentSession();
    if (!session?.access_token) throw new Error('Sin sesión');
    const r = await fetch(WORKER_URL + '/plan', {
      headers:{ 'Authorization':'Bearer '+session.access_token }
    });
    if (r.ok) planInfo = await r.json();
  } catch(e){
    planInfo = { plan:'trial', calls_used:0, calls_limit:50, calls_remaining:50 };
  }
}

function renderModal(){
  let host = document.getElementById('plan-modal-host');
  if (!host){ host = document.createElement('div'); host.id='plan-modal-host'; document.body.appendChild(host); }

  const cur = PLANS[planInfo.plan] || PLANS.trial;
  const usedPct = planInfo.calls_limit > 0 ? Math.round(planInfo.calls_used / planInfo.calls_limit * 100) : 0;
  const expDate = planInfo.plan_expires_at ? new Date(planInfo.plan_expires_at).toLocaleDateString('es-CO', { year:'numeric', month:'long', day:'numeric' }) : 'No vence';

  host.innerHTML = `
    <div class="modal-bg">
      <div class="modal" style="max-width:880px;padding:0;overflow:hidden">

        <!-- Header con plan actual -->
        <div style="background:linear-gradient(135deg,var(--ean-dark),var(--ean-blue));color:#fff;padding:18px 24px">
          <div style="display:flex;justify-content:space-between;align-items:start">
            <div>
              <div style="font-size:11px;opacity:.8;text-transform:uppercase;letter-spacing:1px">Tu plan actual</div>
              <h2 style="font-size:22px;margin-top:4px">${cur.icon} ${cur.name}</h2>
            </div>
            <button class="modal-close" id="pm-close" style="background:rgba(255,255,255,.2);color:#fff;border:none;width:30px;height:30px;border-radius:6px;cursor:pointer;font-size:16px">✕</button>
          </div>

          <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div>
              <div style="font-size:11px;opacity:.8">USO IA ESTE MES</div>
              <div style="font-size:18px;font-weight:700;margin-top:4px">${planInfo.calls_used} / ${planInfo.calls_limit} llamadas</div>
              <div style="margin-top:6px;height:6px;background:rgba(255,255,255,.15);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${Math.min(usedPct,100)}%;background:${usedPct>=90?'#FFCDD2':usedPct>=70?'#FFE082':'#A5D6A7'};border-radius:3px"></div>
              </div>
              <div style="font-size:11px;opacity:.8;margin-top:4px">${planInfo.calls_remaining} llamadas restantes</div>
            </div>
            <div>
              <div style="font-size:11px;opacity:.8">VIGENCIA</div>
              <div style="font-size:14px;font-weight:600;margin-top:4px">${expDate}</div>
            </div>
          </div>
        </div>

        <!-- Cuerpo: 3 planes -->
        <div style="padding:18px 24px">
          <h3 style="text-align:center;margin-bottom:14px">⚡ Planes disponibles</h3>
          <div class="grid-3" id="pm-plans" style="gap:12px"></div>

          <!-- Wompi widget container -->
          <div id="wompi-widget-container" style="display:flex;justify-content:center;min-height:48px;margin-top:14px"></div>
          <button id="btn-wompi-pay" style="display:none;width:100%;background:linear-gradient(135deg,var(--ean-cyan),var(--ean-blue));color:#fff;border:none;border-radius:10px;padding:14px;font-size:15px;font-weight:800;cursor:pointer;margin-top:10px;box-shadow:0 0 24px rgba(0,212,255,.3)">
            💳 Pagar con Wompi (PSE · Nequi · Tarjeta)
          </button>
          <p style="font-size:10px;color:var(--ean-gray);text-align:center;margin-top:10px">
            Pago seguro vía Wompi (Bancolombia) en sandbox. Tu plan se activa automáticamente en segundos tras confirmar.
          </p>
        </div>
      </div>
    </div>
  `;

  document.getElementById('pm-close').onclick = () => host.innerHTML='';
  renderPlanCards();
}

function renderPlanCards(){
  const div = document.getElementById('pm-plans');
  const upgradablePlans = ['starter', 'pro', 'premium'];
  div.innerHTML = upgradablePlans.map(key => {
    const p = PLANS[key];
    const isCurrent = planInfo.plan === key;
    const isSelected = selectedPlan === key;
    const isPopular = p.popular;
    return `
    <div class="plan-card ${isSelected?'selected':''}" data-plan="${key}" style="
      background:${isPopular?'linear-gradient(135deg,rgba(48,85,166,.05),rgba(0,183,198,.05))':'#fff'};
      border:2px solid ${isSelected?p.color:isPopular?'var(--ean-cyan)':'var(--ean-border)'};
      border-radius:12px;padding:18px;cursor:${isCurrent?'default':'pointer'};
      position:relative;transition:.2s;${isCurrent?'opacity:.7':''}">
      ${isPopular?'<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--ean-cyan);color:#fff;font-size:9px;font-weight:700;padding:3px 10px;border-radius:10px;letter-spacing:.5px">MÁS POPULAR</div>':''}
      ${isCurrent?'<div style="position:absolute;top:-10px;right:14px;background:var(--green);color:#fff;font-size:9px;font-weight:700;padding:3px 10px;border-radius:10px">TU PLAN ACTUAL</div>':''}

      <div style="text-align:center;margin-bottom:10px">
        <div style="font-size:30px">${p.icon}</div>
        <div style="font-weight:800;font-size:16px;color:var(--ean-dark);margin-top:4px">${p.name}</div>
        <div style="color:${p.color};font-size:24px;font-weight:900;margin-top:6px">$${(p.price/1000).toFixed(0)}K</div>
        <div style="font-size:10px;color:var(--ean-gray)">COP / mes</div>
      </div>

      <ul style="list-style:none;padding:0;margin:14px 0 0;font-size:12px;color:var(--ean-dark)">
        ${p.features.map(f => `<li style="padding:4px 0;display:flex;gap:6px"><span style="color:${p.color};font-weight:700">✓</span><span>${f}</span></li>`).join('')}
      </ul>
    </div>
    `;
  }).join('');

  div.querySelectorAll('.plan-card').forEach(card => card.onclick = () => {
    const key = card.dataset.plan;
    if (planInfo.plan === key) return;
    selectedPlan = key;
    renderPlanCards();
    launchWompiButton(key);
  });
}

async function launchWompiButton(plan){
  const p = PLANS[plan];
  const amountCents = p.price * 100;
  const reference = `docadmin_${plan}_${currentUser.id}`;
  const currency = 'COP';

  try {
    // Pedir hash de integridad al Worker
    const session = await currentSession();
    const r = await fetch(WORKER_URL + '/wompi-hash', {
      method:'POST',
      headers:{ 'Authorization':'Bearer '+session.access_token, 'Content-Type':'application/json' },
      body: JSON.stringify({ reference, amountCents, currency })
    });
    if (!r.ok) throw new Error('Worker hash error');
    const { hash } = await r.json();

    // Inyectar widget Wompi
    const container = document.getElementById('wompi-widget-container');
    container.innerHTML = '';
    const old = document.getElementById('wompi-checkout-script');
    if (old) old.remove();

    const s = document.createElement('script');
    s.src = 'https://checkout.wompi.co/widget.js';
    s.setAttribute('data-render', 'button');
    s.setAttribute('data-public-key', WOMPI_PUBLIC_KEY);
    s.setAttribute('data-currency', currency);
    s.setAttribute('data-amount-in-cents', String(amountCents));
    s.setAttribute('data-reference', reference);
    s.setAttribute('data-signature:integrity', hash);
    s.setAttribute('data-redirect-url', `${location.origin}${location.pathname}?payment=success&plan=${plan}`);
    s.id = 'wompi-checkout-script';
    container.appendChild(s);

    document.getElementById('btn-wompi-pay').style.display = 'block';
    document.getElementById('btn-wompi-pay').onclick = () => {
      const btn = container.querySelector('button');
      if (btn) btn.click();
      else toast('Esperando carga de Wompi…', 'info');
    };
  } catch(e){
    toast('Error al preparar pago: '+e.message, 'error');
  }
}

// Detectar payment=success al cargar la app
export function checkPaymentSuccess(store){
  const params = new URLSearchParams(location.search);
  if (params.get('payment') !== 'success') return;
  const plan = params.get('plan') || '';

  // Limpiar URL
  history.replaceState({}, '', location.pathname);

  // Modal de éxito
  let host = document.getElementById('payment-success-host');
  if (!host){ host = document.createElement('div'); host.id='payment-success-host'; document.body.appendChild(host); }
  const p = PLANS[plan] || { icon:'🎉', name:plan };
  host.innerHTML = `
    <div class="modal-bg">
      <div class="modal" style="max-width:440px;text-align:center;padding:40px 30px">
        <div style="font-size:64px">${p.icon}</div>
        <h2 style="margin-top:14px;color:var(--green)">¡Pago confirmado!</h2>
        <p style="font-size:14px;color:var(--ean-gray);margin-top:10px">
          Tu plan <b>${p.name}</b> está activo. La actualización puede tardar unos segundos en propagarse.
        </p>
        <button class="btn btn-cyan btn-lg" id="ps-close" style="width:100%;margin-top:20px">Comenzar a usar →</button>
      </div>
    </div>
  `;
  document.getElementById('ps-close').onclick = async () => {
    host.innerHTML = '';
    // Refrescar plan en el store
    await loadPlanInfo();
    if (planInfo) store.plan = planInfo.plan;
  };
}
