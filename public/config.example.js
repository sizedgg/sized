// ---------------------------------------------------------------------------
// Verbindung zum Supabase-Projekt.
// Beide Werte stehen im Dashboard unter Project Settings → API und sind
// öffentlich: Der anon-Key darf im Browser stehen, weil jeder Zugriff über
// Row Level Security läuft. Der service_role-Key gehört NIEMALS hierher.
// ---------------------------------------------------------------------------

const override = globalThis.ANSEM_CONFIG ?? {};

export const SUPABASE_URL = override.url ?? 'https://DEIN-PROJEKT.supabase.co';
export const SUPABASE_ANON_KEY = override.anonKey ?? 'DEIN_ANON_KEY';
