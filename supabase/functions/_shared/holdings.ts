import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { tokenBalance, tokenPrice } from './solana.ts';
import { MOCK } from './common.ts';

/** Deterministic fake balance for mock mode. */
async function mockAmount(wallet: string): Promise<number> {
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(wallet)),
  );
  const tiers = [0, 1_200, 15_000, 48_000, 120_000, 310_000, 900_000, 2_400_000, 7_500_000, 21_000_000];
  return tiers[hash[0] % 10] + (((hash[1] << 8) | hash[2]) % 997) * 13;
}

/**
 * Fetches holdings and price fresh from the chain and writes them to
 * `wallets`. Only this function (service role) may write the table - so no
 * client can manipulate its own weight.
 */
export async function refreshWallet(
  db: SupabaseClient,
  wallet: string,
  mint: string,
  /**
   * Already-known price. Without this parameter, every single wallet fetches
   * its own - for a batch run over 200 wallets that would be 200 queries for
   * the same value against the same price source, which might well lock you
   * out for it. The price is the same for everyone, so the caller fetches it
   * once and passes it through.
   */
  knownPrice?: number,
): Promise<{ uiAmount: number; usdValue: number; price: number }> {
  const getPrice = async () =>
    knownPrice !== undefined && knownPrice > 0 ? knownPrice : await tokenPrice(mint);

  const [uiAmount, price] = MOCK
    ? [await mockAmount(wallet), knownPrice ?? 0.0042]
    : await Promise.all([tokenBalance(wallet, mint), getPrice()]);

  const usdValue = uiAmount * price;

  const { error } = await db.from('wallets').upsert({
    address: wallet,
    ui_amount: uiAmount,
    usd_value: usdValue,
    price,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'address' });
  if (error) throw new Error(`wallets update failed: ${error.message}`);

  return { uiAmount, usdValue, price };
}
