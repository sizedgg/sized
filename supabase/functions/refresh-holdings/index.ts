/**
 * Aktualisiert Token-Bestand und $-Wert in der Tabelle `wallets`.
 *
 *   POST {}                                    mit Wallet-JWT  -> eigene Wallet
 *   POST { all: true, stale: 300 }             mit CRON_SECRET -> alte Einträge
 *   POST { all: true, votersOnly: true, stale: 60 }            -> nur Wallets,
 *        die in einer offenen Abstimmung eine Stimme haben
 *
 * Nur diese Funktion schreibt `wallets`; daran hängen alle Gewichte in Chat,
 * Abstimmungen und DM-Sortierung. Sinkt der Bestand einer Wallet, zieht ein
 * Trigger in der Datenbank ihre Stimmen in offenen Abstimmungen nach – der
 * `votersOnly`-Lauf ist deshalb der wichtigste: Er hält die laufende
 * Abstimmung ehrlich.
 */
import { serviceClient, loadConfig, json, fail, CORS, MOCK } from '../_shared/common.ts';
import { verifyWalletJwt } from '../_shared/jwt.ts';
import { refreshWallet } from '../_shared/holdings.ts';
import { tokenPrice } from '../_shared/solana.ts';

/**
 * Sperrfrist zwischen zwei selbst ausgelösten Auffrischungen.
 *
 * Sie schützt das RPC-Kontingent davor, dass jemand den Knopf im Sekundentakt
 * drückt. 60 Sekunden waren dafür zu lang: Genau im wichtigsten Moment – man
 * hat gerade Token gekauft und will schreiben – lieferte die Funktion eine
 * Minute lang stur die alte Null zurück, und der Knopf drehte sich dabei, als
 * hätte er etwas getan. 15 Sekunden bremsen Dauerdrücker genauso, sind aber
 * kürzer als die Geduld eines Menschen, der auf seinen Bestand wartet.
 */
const MIN_INTERVAL_MS = Number(Deno.env.get('HOLDINGS_MIN_INTERVAL_SEC') ?? 15) * 1000;
const CRON_BATCH = 120;

/**
 * Wie viele Wallets gleichzeitig gelesen werden. Nacheinander wäre bei 120
 * Wallets die Laufzeitgrenze der Function erreicht, bevor der Stapel durch
 * ist; alles auf einmal würde die RPC mit einem Schlag treffen und in ein
 * Ratenlimit laufen. Acht ist der Mittelweg.
 */
const PARALLEL = 8;

/** Führt `arbeit` über alle Einträge aus, aber höchstens `PARALLEL` zugleich. */
async function inHaeppchen<T>(items: T[], arbeit: (item: T) => Promise<void>) {
  let i = 0;
  const laeufer = Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
    while (i < items.length) await arbeit(items[i++]);
  });
  await Promise.all(laeufer);
}

const db = serviceClient();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('POST only', 405);

  const body = await req.json().catch(() => ({}));

  try {
    const cfg = await loadConfig(db);
    if (!cfg.ansem_mint) return fail('Token mint is not configured', 503);

    // --- Kurs-Takt: ein Kurs, eine Anweisung, alle Wallets ---
    //
    // Das ist der Lauf, der jede Minute läuft. Er liest keine einzige Wallet
    // von der Chain, sondern holt genau einen Kurs und lässt die Datenbank ihn
    // auf alle Bestände anwenden. Dadurch ändern sich alle Beträge im selben
    // Augenblick, statt über eine Minute verteilt einzeln zu springen.
    if (body.prices === true) {
      const secret = Deno.env.get('CRON_SECRET');
      if (!secret || req.headers.get('x-cron-secret') !== secret) return fail('Not allowed', 403);

      const price = MOCK ? 0.0042 : await tokenPrice(cfg.ansem_mint);

      // Ein fehlgeschlagener Kursabruf gibt 0 zurück. Den anzuwenden hieße,
      // jeden Bestand im Haus auf null zu setzen – Chat-Filter leer,
      // Schreibsperren überall, Stimmgewichte weg. Lieber diesen Takt
      // auslassen; der letzte bekannte Kurs bleibt stehen.
      if (!(price > 0)) return fail('Price lookup failed - keeping the last known price', 503);

      const { data: touched, error } = await db.rpc('apply_token_price', { p_price: price });
      if (error) throw new Error(error.message);
      return json({ price, wallets: Number(touched ?? 0) });
    }

    // --- Cron-Variante: viele Wallets auf einmal auffrischen ---
    if (body.all === true) {
      const secret = Deno.env.get('CRON_SECRET');
      if (!secret || req.headers.get('x-cron-secret') !== secret) return fail('Not allowed', 403);

      const { data: rows, error } = await db.rpc('wallets_to_refresh', {
        stale_seconds: Number(body.stale ?? 300),
        max_rows: Number(body.limit ?? CRON_BATCH),
        voters_only: body.votersOnly === true,
      });
      if (error) throw new Error(error.message);

      // Der Kurs ist für alle derselbe – einmal holen statt einmal pro Wallet.
      const price = MOCK ? 0.0042 : await tokenPrice(cfg.ansem_mint);

      let updated = 0;
      await inHaeppchen(rows ?? [], async (row: { address: string }) => {
        try {
          await refreshWallet(db, row.address, cfg.ansem_mint, price > 0 ? price : undefined);
          updated++;
        } catch (err) { console.warn('[refresh] ', row.address, err); }
      });
      return json({ updated, considered: rows?.length ?? 0, votersOnly: body.votersOnly === true });
    }

    // --- Normalfall: der Aufrufer frischt seine eigene Wallet auf ---
    const auth = req.headers.get('authorization') ?? '';
    const claims = auth.startsWith('Bearer ')
      ? await verifyWalletJwt(Deno.env.get('APP_JWT_SECRET')!, auth.slice(7).trim())
      : null;
    if (!claims) return fail('Not verified', 401);

    const { data: existing } = await db.from('wallets')
      .select('ui_amount, usd_value, updated_at').eq('address', claims.wallet).maybeSingle();

    // Innerhalb der Sperrfrist wird nicht neu gelesen. Wichtig ist, dass der
    // Aufrufer das erfährt: Ein unveränderter Wert ohne Erklärung ist von
    // einem kaputten Knopf nicht zu unterscheiden. retryInSec sagt, wie lange
    // es noch dauert.
    if (existing && Date.now() - new Date(existing.updated_at).getTime() < MIN_INTERVAL_MS) {
      const restMs = MIN_INTERVAL_MS - (Date.now() - new Date(existing.updated_at).getTime());
      return json({
        wallet: claims.wallet,
        tokens: Number(existing.ui_amount),
        usd: Number(existing.usd_value),
        cached: true,
        retryInSec: Math.max(1, Math.ceil(restMs / 1000)),
      });
    }

    const h = await refreshWallet(db, claims.wallet, cfg.ansem_mint);
    return json({ wallet: claims.wallet, tokens: h.uiAmount, usd: h.usdValue, price: h.price, cached: false });
  } catch (err) {
    console.error('[refresh-holdings]', err);
    return fail(err instanceof Error ? err.message : 'Internal error', 500);
  }
});
