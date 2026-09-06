import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { tokenBalance, tokenPrice } from './solana.ts';
import { MOCK } from './common.ts';

/** Deterministischer Fake-Bestand für den Mock-Modus. */
async function mockAmount(wallet: string): Promise<number> {
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(wallet)),
  );
  const tiers = [0, 1_200, 15_000, 48_000, 120_000, 310_000, 900_000, 2_400_000, 7_500_000, 21_000_000];
  return tiers[hash[0] % 10] + (((hash[1] << 8) | hash[2]) % 997) * 13;
}

/**
 * Holt Bestand und Preis frisch von der Chain und schreibt sie nach `wallets`.
 * Nur diese Funktion (Service-Role) darf die Tabelle schreiben – deshalb kann
 * kein Client sein eigenes Gewicht manipulieren.
 */
export async function refreshWallet(
  db: SupabaseClient,
  wallet: string,
  mint: string,
  /**
   * Bereits bekannter Kurs. Ohne diesen Parameter holt jede einzelne Wallet
   * ihren eigenen – bei einem Stapellauf über 200 Wallets wären das 200
   * Abfragen desselben Werts an dieselbe Preisquelle, die einen im Zweifel
   * dafür aussperrt. Der Kurs ist für alle gleich, also holt der Aufrufer ihn
   * einmal und reicht ihn durch.
   */
  knownPrice?: number,
): Promise<{ uiAmount: number; usdValue: number; price: number }> {
  const holePreis = async () =>
    knownPrice !== undefined && knownPrice > 0 ? knownPrice : await tokenPrice(mint);

  const [uiAmount, price] = MOCK
    ? [await mockAmount(wallet), knownPrice ?? 0.0042]
    : await Promise.all([tokenBalance(wallet, mint), holePreis()]);

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
