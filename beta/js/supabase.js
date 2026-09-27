/* ============================================================
   supabase.js — the single Supabase client for the app.
   Loads supabase-js from a CDN (this is GitHub Pages, not a
   sandboxed Artifact, so external ES modules are allowed).
   ============================================================ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js?v=20260927a';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,       // keep the session across reloads
    autoRefreshToken: true,
    detectSessionInUrl: true,   // complete the magic-link redirect automatically
  },
});
