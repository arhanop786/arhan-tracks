/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL — omit both vars to run in local demo mode. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon (public) key — safe to expose with RLS enabled. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
