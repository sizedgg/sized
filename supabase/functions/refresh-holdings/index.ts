/**
 * Refreshes token balance and $ value in the `wallets` table.
 *
 *   POST {}                                    with wallet JWT  -> own wallet
 *   POST { all: true, stale: 300 }             with CRON_SECRET -> stale entries
 *   POST { all: true, votersOnly: true, stale: 60 }             -> only wallets
 *        that have a vote in an open poll
 *
 * Only this function writes `wallets`; every weight in chat, polls, and DM
 * sorting hangs off it. If a wallet's balance drops, a trigger in the
 * database pulls its votes in open polls down with it - the `votersOnly`
 * run is therefore the most important one: it keeps a running poll honest.
 */
import { serviceClient, loadConfig, json, fail, CORS, MOCK } from '../_shared/common.ts';
import { verifyWalletJwt } from '../_shared/jwt.ts';
import { refreshWallet } from '../_shared/holdings.ts';
import { tokenPrice } from '../_shared/solana.ts';

/**
 * Character-by-character comparison in constant time.
 *
 * An ordinary !== bails out at the first difference. Over the network that
 * is barely exploitable, but verify/index.ts gets it right at the same
 * spot - and two different standards for the same thing in one project
 * are worse than the stricter one everywhere.
 */
function gleich(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Cooldown between two self-triggered refreshes.
 *
 * It protects the RPC quota from someone hammering the button every
 * second. 60 seconds were too long for that: right at the moment that
 * mattered most - you just bought tokens and want to post - the function
 * stubbornly kept returning the old zero for a full minute, and the
 * button spun as if it had done something. 15 seconds slow down repeat
 * clickers just as well, but are shorter than the patience of a person
 * waiting on their balance.
 */
const MIN_INTERVAL_MS = Number(Deno.env.get('HOLDINGS_MIN_INTERVAL_SEC') ?? 15) * 1000;
const CRON_BATCH = 120;

/**
 * How many wallets are read at once. One at a time would hit the
 * function's runtime limit before getting through 120 wallets; all at
 * once would slam the RPC in one shot and run into a rate limit. Eight is
 * the middle ground.
 */
const PARALLEL = 8;

/** Runs `arbeit` over all entries, but at most `PARALLEL` at a time. */
async function inChunks<T>(items: T[], arbeit: (item: T) => Promise<void>) {
  let i = 0;
  const runner = Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
    while (i < items.length) await arbeit(items[i++]);
  });
  await Promise.all(runner);
}

const db = serviceClient();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('POST only', 405);

  const body = await req.json().catch(() => ({}));

  try {
    const cfg = await loadConfig(db);
    if (!cfg.ansem_mint) return fail('Token mint is not configured', 503);

    // --- Price tick: one price, one statement, all wallets ---
    //
    // This is the run that fires every minute. It does not read a single
    // wallet from the chain; instead it fetches exactly one price and has
    // the database apply it to every balance. That way all amounts change
    // in the same instant, instead of jumping individually spread over a
    // minute.
    if (body.prices === true) {
      const secret = Deno.env.get('CRON_SECRET');
      if (!secret || !gleich(req.headers.get('x-cron-secret') ?? '', secret)) return fail('Not allowed', 403);

      const price = MOCK ? 0.0042 : await tokenPrice(cfg.ansem_mint);

      // A failed price fetch returns 0. Applying that would mean setting
      // every balance in the house to null - chat filter empty, write
      // locks everywhere, vote weights gone. Better to skip this tick;
      // the last known price stays in place.
      if (!(price > 0)) return fail('Price lookup failed - keeping the last known price', 503);

      const { data: touched, error } = await db.rpc('apply_token_price', { p_price: price });
      if (error) throw new Error(error.message);
      return json({ price, wallets: Number(touched ?? 0) });
    }

    // --- Cron variant: refresh many wallets at once ---
    if (body.all === true) {
      const secret = Deno.env.get('CRON_SECRET');
      if (!secret || !gleich(req.headers.get('x-cron-secret') ?? '', secret)) return fail('Not allowed', 403);

      const { data: rows, error } = await db.rpc('wallets_to_refresh', {
        stale_seconds: Number(body.stale ?? 300),
        max_rows: Number(body.limit ?? CRON_BATCH),
        voters_only: body.votersOnly === true,
      });
      if (error) throw new Error(error.message);

      // The price is the same for everyone - fetch it once instead of once per wallet.
      const price = MOCK ? 0.0042 : await tokenPrice(cfg.ansem_mint);

      let updated = 0;
      await inChunks(rows ?? [], async (row: { address: string }) => {
        try {
          await refreshWallet(db, row.address, cfg.ansem_mint, price > 0 ? price : undefined);
          updated++;
        } catch (err) { console.warn('[refresh] ', row.address, err); }
      });
      return json({ updated, considered: rows?.length ?? 0, votersOnly: body.votersOnly === true });
    }

    // --- Normal case: the caller refreshes their own wallet ---
    const auth = req.headers.get('authorization') ?? '';
    const claims = auth.startsWith('Bearer ')
      ? await verifyWalletJwt(Deno.env.get('APP_JWT_SECRET')!, auth.slice(7).trim())
      : null;
    if (!claims) return fail('Not verified', 401);

    const { data: existing } = await db.from('wallets')
      .select('ui_amount, usd_value, updated_at').eq('address', claims.wallet).maybeSingle();

    // Within the cooldown, nothing is re-read. What matters is that the
    // caller finds out: an unchanged value without explanation is
    // indistinguishable from a broken button. retryInSec says how much
    // longer it will take.
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
