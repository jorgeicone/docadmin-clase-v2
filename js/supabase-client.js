import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
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
