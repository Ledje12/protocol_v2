import { createClient } from "@supabase/supabase-js";

/* =========================================================
   SUPABASE
   ========================================================= */

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL;

const supabaseKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Configuration Supabase manquante dans .env.local"
  );
}

/*
 * Singleton global.
 *
 * Important avec Vite/HMR :
 * ce module peut être réévalué plusieurs fois en développement.
 * Sans ça, chaque refresh à chaud recrée un client Supabase.
 */
export const supabase =
  globalThis.__protocolSupabase ??
  createClient(
    supabaseUrl,
    supabaseKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    }
  );

globalThis.__protocolSupabase =
  supabase;
