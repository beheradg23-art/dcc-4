import { createClient } from '@supabase/supabase-js';

// These come from your .env file (local) and from your host's
// environment variable settings (Vercel/Netlify/etc) in production.
// See SETUP_INSTRUCTIONS.md for exactly where to get these two values.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // This will show up loudly in the console instead of failing silently,
  // so it's obvious the env vars are missing rather than some auth bug.
  console.error(
    '[supabaseClient] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Check your .env file (local) or host env var settings (deployed).'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,   // keeps you logged in across reloads/restarts
    autoRefreshToken: true, // silently refreshes the session token
    storageKey: 'dcc_auth_session',
  },
});