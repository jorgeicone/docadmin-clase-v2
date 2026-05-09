// Bootstrap principal — importa Alpine, registra store, arranca controladamente
import Alpine from 'https://cdn.jsdelivr.net/npm/alpinejs@3.13.10/dist/module.esm.js';
// v=20260509l — bumpear este sufijo si se cambian los módulos para invalidar caché
import { supabase, currentUser } from './supabase-client.js?v=20260509l';
import { toast } from './toast.js?v=20260509l';
import { mountCourses } from './courses.js?v=20260509l';
import { mountStudents } from './students.js?v=20260509l';
import { mountGroups } from './groups.js?v=20260509l';
import { mountActivities } from './activities.js?v=20260509l';
import { mountIngest } from './ingest.js?v=20260509l';
import { mountConsolidated } from './consolidated.js?v=20260509l';
import { mountAsistencia } from './asistencia.js?v=20260509l';
import { mountConsolidadoAsistencia } from './consolidado-asistencia.js?v=20260509l';
import { mountSustentacion } from './sustentacion.js?v=20260509l';

const VIEWS = {
  courses:      { title:'Mis cursos',          mount: mountCourses },
  students:     { title:'Estudiantes',         mount: mountStudents,    needsCourse:true },
  groups:       { title:'Grupos',              mount: mountGroups,      needsCourse:true },
  activities:   { title:'Actividades y notas', mount: mountActivities,  needsCourse:true },
  ingest:       { title:'Ingesta IA',          mount: mountIngest,      needsCourse:true },
  asistencia:   { title:'Asistencia',          mount: mountAsistencia,  needsCourse:true },
  sustentacion: { title:'Sustentación',        mount: mountSustentacion,needsCourse:true },
  conAsistencia:{ title:'Consolidado Asistencia',mount: mountConsolidadoAsistencia, needsCourse:true },
  consolidated: { title:'Consolidado',         mount: mountConsolidated,needsCourse:true },
};

// 1. Registrar store ANTES de arrancar Alpine
Alpine.store('app', {
  user: undefined,    // undefined = aún no chequeado, null = sin sesión, object = logueado
  plan: 'starter',
  view: 'courses',
  activeCourse: null,
  courses: [],

  viewTitle(){ return VIEWS[this.view]?.title || ''; },

  async init(){
    const u = await currentUser();
    this.user = u || null;
    supabase.auth.onAuthStateChange((_event, session) => {
      this.user = session?.user || null;
      if (this.user) this.go('courses');
    });
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

  renderView(){
    const root = document.getElementById('view-root');
    if (!root) return;
    root.innerHTML = '';
    const def = VIEWS[this.view];
    if (def) def.mount(root, this);
  },

  async signOut(){
    await supabase.auth.signOut();
    this.user = null;
    this.activeCourse = null;
    toast('Sesión cerrada');
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

// 4. Lanzar init asíncrono del store y montar primera vista
Alpine.store('app').init().then(() => {
  // Quitar pantalla de carga
  document.getElementById('boot-fallback')?.remove();
  if (Alpine.store('app').user) Alpine.store('app').renderView();
}).catch(err => {
  document.getElementById('boot-msg').textContent = 'Error al iniciar';
  const box = document.getElementById('boot-err');
  if (box){ box.style.display = 'block'; box.textContent = '❌ ' + (err?.message||err); }
});
