import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export { mayEnter } from './freischaltung.ts';

export const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

export const fail = (message: string, status = 400) => json({ error: message }, status);

/** Client mit Service-Role – umgeht RLS, darf also nur serverseitig laufen. */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export interface AppConfig {
  admin_wallet: string | null;
  treasury: string | null;
  ansem_mint: string | null;
  symbol: string;
  base_lamports: number;
  open_to_public: boolean;
  test_wallet: string | null;
}

export async function loadConfig(db: SupabaseClient): Promise<AppConfig> {
  const { data, error } = await db.from('app_config').select('*').eq('id', 1).single();
  if (error) throw new Error(`Cannot read configuration: ${error.message}`);
  return data as AppConfig;
}

export const MOCK = (Deno.env.get('MOCK_CHAIN') ?? '') === '1';
