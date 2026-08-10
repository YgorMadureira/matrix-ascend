import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY precisam estar definidas (.env). Veja .env.example.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  }
});

// Fix for Supabase Deadlock when switching browser tabs (Sleeping Tabs)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      supabase.auth.stopAutoRefresh();
    } else if (document.visibilityState === 'visible') {
      supabase.auth.startAutoRefresh();
      // Force a fast heartbeat check to un-queue any pending database promises
      supabase.auth.getSession().catch(() => {});
    }
  });
}
