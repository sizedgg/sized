// ---------------------------------------------------------------------------
// Connection to the Supabase project.
// Both values are in the dashboard under Project Settings -> API, and both are
// public: the anon key is allowed to sit in the browser, because every access
// goes through Row Level Security. The service_role key NEVER belongs here.
// ---------------------------------------------------------------------------

const override = globalThis.ANSEM_CONFIG ?? {};

export const SUPABASE_URL = override.url ?? 'https://DEIN-PROJEKT.supabase.co';
export const SUPABASE_ANON_KEY = override.anonKey ?? 'DEIN_ANON_KEY';
