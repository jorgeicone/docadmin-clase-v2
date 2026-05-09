// Usa el global window.supabase del UMD cargado en index.html
import { SUPABASE_URL, SUPABASE_ANON } from './config.js';

if (!window.supabase || !window.supabase.createClient){
  throw new Error('Supabase UMD no se cargó. Verifica conexión a internet.');
}

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

export async function currentUser(){
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function currentSession(){
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}
