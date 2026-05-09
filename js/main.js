// Bootstrap principal — store global de Alpine + ruteo de vistas
import { supabase, currentUser } from './supabase-client.js';
import { toast } from './toast.js';
import { mountCourses } from './courses.js';
import { mountStudents } from './students.js';
import { mountGroups } from './groups.js';
import { mountActivities } from './activities.js';
import { mountIngest } from './ingest.js';
import { mountConsolidated } from './consolidated.js';

const VIEWS = {
  courses:      { title:'Mis cursos',         mount: mountCourses },
  students:     { title:'Estudiantes',        mount: mountStudents,    needsCourse:true },
  groups:       { title:'Grupos',             mount: mountGroups,      needsCourse:true },
  activities:   { title:'Actividades y notas',mount: mountActivities,  needsCourse:true },
  ingest:       { title:'Ingesta IA',         mount: mountIngest,      needsCourse:true },
  consolidated: { title:'Consolidado',        mount: mountConsolidated,needsCourse:true },
};

document.addEventListener('alpine:init', () => {
  Alpine.store('app', {
    user: null,
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

  // Login form factory
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

  Alpine.store('app').init().then(()=>{
    if (Alpine.store('app').user) Alpine.store('app').renderView();
  });
});
