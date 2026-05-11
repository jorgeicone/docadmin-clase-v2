// Bootstrap principal — importa Alpine, registra store, arranca controladamente
import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3.13.10/dist/module.esm.js';
// v=20260510e — bumpear este sufijo si se cambian los módulos para invalidar caché
// Imports CRÍTICOS (necesarios para login + boot inicial):
import { supabase, currentSession } from './supabase-client.js?v=20260511p';
import { toast } from './toast.js?v=20260511p';
import { openPlanModal, checkPaymentSuccess, fetchPlanInfo, PLANS } from './plan.js?v=20260511p';

// Bloque 5 (LCP): lazy import de los 11 módulos de vistas.
// Solo se descarga al navegar a esa vista. Reduce JS inicial ~50 KiB.
const VERSION = '?v=20260511p';
const VIEWS = {
  courses:      { title:'Mis cursos',                loader: () => import('./courses.js'+VERSION).then(m => m.mountCourses) },
  students:     { title:'Estudiantes',               needsCourse:true, loader: () => import('./students.js'+VERSION).then(m => m.mountStudents) },
  groups:       { title:'Grupos',                    needsCourse:true, loader: () => import('./groups.js'+VERSION).then(m => m.mountGroups) },
  activities:   { title:'Actividades y notas',       needsCourse:true, loader: () => import('./activities.js'+VERSION).then(m => m.mountActivities) },
  ingest:       { title:'Ingesta IA',                needsCourse:true, loader: () => import('./ingest.js'+VERSION).then(m => m.mountIngest) },
  asistencia:   { title:'Asistencia',                needsCourse:true, loader: () => import('./asistencia.js'+VERSION).then(m => m.mountAsistencia) },
  sustentacion: { title:'Sustentación',              needsCourse:true, loader: () => import('./sustentacion.js'+VERSION).then(m => m.mountSustentacion) },
  conAsistencia:{ title:'Consolidado Asistencia',    needsCourse:true, loader: () => import('./consolidado-asistencia.js'+VERSION).then(m => m.mountConsolidadoAsistencia) },
  consolidated: { title:'Consolidado',               needsCourse:true, loader: () => import('./consolidated.js'+VERSION).then(m => m.mountConsolidated) },
  chat:         { title:'AI Chat',                   needsCourse:true, loader: () => import('./chat.js'+VERSION).then(m => m.mountChat) },
  syllabus:     { title:'Plan del semestre',         needsCourse:true, loader: () => import('./syllabus.js'+VERSION).then(m => m.mountSyllabus) },
};

// 1. Registrar store ANTES de arrancar Alpine
Alpine.store('app', {
  user: undefined,    // undefined = aún no chequeado, null = sin sesión, object = logueado
  plan: 'trial',      // se actualiza con refreshPlan() después del login
  planInfo: null,     // { plan, calls_used, calls_limit, calls_remaining, plan_expires_at }
  view: 'courses',
  activeCourse: null,
  courses: [],

  viewTitle(){ return VIEWS[this.view]?.title || ''; },

  async init(){
    // P0 mobile fix: usar getSession() (lee localStorage, sin red) en vez de getUser()
    // (que dispara /v1/user con 401 ~2s en cadena crítica si no hay token).
    // Render del login no se bloquea más con un round-trip a Supabase.
    const session = await currentSession();
    this.user = session?.user || null;

    // Bug fix: el listener dispara con INITIAL_SESSION + TOKEN_REFRESHED en cada boot.
    // Antes ejecutaba go('courses') en cada disparo → 3 queries v5_courses paralelas.
    // Ahora solo reaccionamos a cambios REALES de auth (login fresco o logout).
    let wasLoggedIn = !!this.user;
    supabase.auth.onAuthStateChange((event, session) => {
      const newUser = session?.user || null;
      this.user = newUser;
      const isLoggedIn = !!newUser;
      // Solo cambio real de estado: de fuera a dentro, o de dentro a fuera
      if (isLoggedIn && !wasLoggedIn){
        this.refreshPlan();
        this.go('courses');
      } else if (!isLoggedIn && wasLoggedIn){
        this.activeCourse = null;
      }
      wasLoggedIn = isLoggedIn;
    });

    // Si había sesión persistida, refrescar plan en background (no bloquea UI)
    if (this.user) this.refreshPlan();
  },

  go(view){
    if (!VIEWS[view]) return;
    if (VIEWS[view].needsCourse && !this.activeCourse){
      toast('Selecciona un curso primero', 'error');
      return;
    }
    this.view = view;
    this.renderView();
  },

  setActiveCourse(c){
    this.activeCourse = c;
    this.go('students');
  },

  clearActiveCourse(){
    this.activeCourse = null;
    this.go('courses');
  },

  async renderView(){
    const root = document.getElementById('view-root');
    if (!root) return;
    const def = VIEWS[this.view];
    if (!def) return;
    // Spinner mientras se descarga el chunk del módulo (primera vez)
    root.innerHTML = `<div style="padding:30px;text-align:center;color:var(--ean-gray)"><span class="loader" style="margin-right:8px"></span>Cargando vista…</div>`;
    try {
      const mount = await def.loader();
      // Verificar que el usuario no haya cambiado de vista mientras se descargaba
      if (this.view !== Object.keys(VIEWS).find(k => VIEWS[k] === def)) return;
      root.innerHTML = '';
      mount(root, this);
    } catch(err){
      root.innerHTML = `<div class="card" style="color:var(--red)"><b>❌ Error cargando la vista</b><br><small>${err.message||err}</small></div>`;
    }
  },

  async signOut(){
    await supabase.auth.signOut();
    this.user = null;
    this.activeCourse = null;
    toast('Sesión cerrada');
  },

  openPlan(){
    if (!this.user) return;
    openPlanModal(this.user);
  },

  // Emails con plan SUPER USUARIO (override del Worker).
  // TODO: mover esta lista al backend Worker para no hardcodear en frontend.
  isSuperUser(){
    const SUPER_USERS = [
      'test.docadmin.ga@gmail.com',
      'profe1.icone@gmail.com',
      'profe2.icone@gmail.com',
      'profe3.icone@gmail.com',
    ];
    return SUPER_USERS.includes(this.user?.email);
  },

  async refreshPlan(){
    // Override para superusuarios ICONE: salta el Worker, plan ilimitado.
    if (this.isSuperUser()){
      this.plan = 'superuser';
      this.planInfo = {
        plan:'superuser', calls_used:0, calls_limit:99999, calls_remaining:99999,
        plan_expires_at:null,
      };
      return;
    }
    const info = await fetchPlanInfo();
    if (info){
      this.planInfo = info;
      this.plan = info.plan;
    }
  },

  maxCourses(){
    return PLANS[this.plan]?.maxCourses ?? 1;
  },

  planIcon(){
    return ({ trial:'🎓', starter:'🚀', pro:'⚡', premium:'🌟', superuser:'⭐' })[this.plan] || '🎓';
  },
  // HTML del icono (para topbar que soporta img). Devuelve string HTML seguro.
  planIconHtml(){
    if (this.plan === 'superuser'){
      return '<img src="assets/icone-logo-32.png" alt="ICONE" style="width:24px;height:24px;border-radius:5px;display:block">';
    }
    return this.planIcon();
  },
  planLabel(){
    return ({ trial:'Trial', starter:'Starter', pro:'Pro', premium:'Premium', superuser:'Super Usuario' })[this.plan] || this.plan;
  },
  planColor(){
    return ({ trial:'#9E9E9E', starter:'#00B7C6', pro:'#3055A6', premium:'#6A1B9A', superuser:'#1AC8DB' })[this.plan] || '#9E9E9E';
  },
});

// 2. Definir factories globales (loginForm) que las plantillas referencian
window.loginForm = () => ({
  email:'', password:'', loading:false, error:'',
  async submit(){
    this.loading = true; this.error = '';
    const { error } = await supabase.auth.signInWithPassword({ email:this.email, password:this.password });
    this.loading = false;
    if (error) { this.error = error.message; return; }
    toast('Bienvenido','success');
  },
  async signup(){
    if (!this.email || !this.password){ this.error='Email y contraseña requeridos'; return; }
    if (this.password.length < 6){ this.error='Mínimo 6 caracteres'; return; }
    this.loading = true; this.error = '';
    const { error } = await supabase.auth.signUp({ email:this.email, password:this.password });
    this.loading = false;
    if (error) { this.error = error.message; return; }
    toast('Revisa tu correo para confirmar','success');
  }
});

// 3. Arrancar Alpine ahora que todo está registrado
window.Alpine = Alpine;
Alpine.start();

// ── Protección anti-back accidental ──
// Si el usuario presiona ← del navegador estando logueado, lo navegamos
// dentro de la app en vez de sacarlo. Solo se sale cerrando la pestaña.
// Se "ancla" un estado dummy en el history; al popstate hacemos push otra
// vez para mantener el ancla, y navegamos al nivel anterior dentro de la app.
history.pushState({ docadmin:true }, '', location.href);
window.addEventListener('popstate', () => {
  const store = Alpine.store('app');
  if (!store?.user){
    // Sin sesión: comportamiento normal del browser (deja salir)
    return;
  }
  // Con sesión: re-anclamos y navegamos internamente
  history.pushState({ docadmin:true }, '', location.href);
  if (store.activeCourse && store.view !== 'courses'){
    // Estás dentro de una vista del curso → vuelve a Mis cursos
    store.go('courses');
    toast('← Volviste a Mis cursos');
  } else if (store.activeCourse){
    // Estás en Mis cursos con curso activo → suelta el curso
    store.clearActiveCourse();
    toast('← Saliste del curso');
  } else {
    // Ya estás en el nivel raíz
    toast('Cierra la pestaña para salir de la app');
  }
});

// 4. Lanzar init asíncrono del store y montar primera vista
Alpine.store('app').init().then(() => {
  // Quitar pantalla de carga
  document.getElementById('boot-fallback')?.remove();
  if (Alpine.store('app').user){
    Alpine.store('app').renderView();
    // Detectar regreso desde Wompi
    checkPaymentSuccess(Alpine.store('app'));
  }
}).catch(err => {
  document.getElementById('boot-msg').textContent = 'Error al iniciar';
  const box = document.getElementById('boot-err');
  if (box){ box.style.display = 'block'; box.textContent = '❌ ' + (err?.message||err); }
});
