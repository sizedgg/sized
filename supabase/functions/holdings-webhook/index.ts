/**
 * Webhook for token transfers (Helius).
 *
 * Solana doesn't report anything on its own. For a vote to disappear
 * promptly when someone sends their tokens away, a push source is needed:
 * Helius calls this function on every transfer of the $ANSEM mint, we
 * refresh the affected wallets, and the database trigger pulls the votes
 * in open polls along with it.
 *
 * Setup in the Helius dashboard:
 *   Webhook Type   : Enhanced
 *   Transaction Type: TRANSFER, SWAP  (or "Any")
 *   Account Address: the mint address of $ANSEM
 *   Webhook URL    : https://<project>.supabase.co/functions/v1/holdings-webhook
 *   Auth Header    : the same value as the WEBHOOK_SECRET secret
 *
 * The `refresh-holdings` cron run is still needed regardless: it's the
 * safety net for anything the webhook misses (an outage, a price change
 * with no transfer).
 *
 * IMPORTANT: the webhook never creates new wallets, it only refreshes
 * known ones. Helius reports every movement of the mint, including that of
 * thousands of addresses that will never visit this site. Whoever gets a
 * row here has verified - nobody else. See the reasoning below at the
 * filter.
 */
import { serviceClient, loadConfig, json, fail, CORS } from '../_shared/common.ts';
import { isSolanaAddress } from '../_shared/base58.ts';
import { refreshWallet } from '../_shared/holdings.ts';

/**
 * Character-by-character comparison in constant time.
 *
 * An ordinary !== bails out at the first difference. Over the network
 * that's barely exploitable, but verify/index.ts does it right at the same
 * spot - and having two different standards for the same thing in one
 * project is worse than applying the stricter one everywhere.
 */
function gleich(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const MAX_WALLETS_PER_CALL = 60;

const db = serviceClient();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('POST only', 405);

  const secret = Deno.env.get('WEBHOOK_SECRET');
  if (!secret) return fail('WEBHOOK_SECRET is not set', 503);
  const presented = req.headers.get('authorization') ?? '';
  if (!gleich(presented, secret) && !gleich(presented, `Bearer ${secret}`)) return fail('Not allowed', 403);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return fail('Invalid body');
  }

  try {
    const cfg = await loadConfig(db);
    if (!cfg.ansem_mint) return fail('Token mint is not configured', 503);

    const wallets = extractWallets(payload, cfg.ansem_mint);
    if (!wallets.length) return json({ updated: 0, note: 'no token transfer in payload' });

    // Only touch addresses the table already knows about.
    //
    // This is the most important line in this function. refreshWallet()
    // writes via upsert - without this filter, the webhook would create a
    // row for EVERY address that has ever moved the token. That would turn
    // `wallets` from a directory of members into one of the entire token:
    // 27,477 rows, two of which belonged to someone who actually uses the
    // site.
    //
    // That costs more than just space. The price tick rewrites every one
    // of these rows every minute, and the catch-up job works its way
    // through the same list forever, a hundred at a time. Both then grow
    // with the token's popularity instead of the number of users - the
    // database can end up under load without a single human having
    // visited the site.
    //
    // New addresses still get in, just at the right point: on
    // verification. Whoever has paid is in the table, and from then on
    // the webhook reports their movements.
    const { data: bekannt, error: leseFehler } = await db
      .from('wallets').select('address').in('address', wallets);
    if (leseFehler) throw new Error(`known wallets lookup failed: ${leseFehler.message}`);

    const zuHolen = new Set((bekannt ?? []).map((w) => w.address));
    const relevant = wallets.filter((w) => zuHolen.has(w));
    if (!relevant.length) {
      return json({ updated: 0, seen: wallets.length, note: 'no known wallet in payload' });
    }

    let updated = 0;
    for (const wallet of relevant.slice(0, MAX_WALLETS_PER_CALL)) {
      try { await refreshWallet(db, wallet, cfg.ansem_mint); updated++; }
      catch (err) { console.warn('[webhook] ', wallet, err); }
    }
    return json({ updated, seen: wallets.length, known: relevant.length });
  } catch (err) {
    console.error('[holdings-webhook]', err);
    return fail(err instanceof Error ? err.message : 'Internal error', 500);
  }
});

/**
 * Collects every wallet address whose $ANSEM balance might have changed -
 * sender and recipient, plus accounts from the balance change data.
 */
function extractWallets(payload: unknown, mint: string): string[] {
  const events = Array.isArray(payload) ? payload : [payload];
  const found = new Set<string>();

  for (const ev of events) {
    const e = ev as Record<string, any>;

    for (const t of e?.tokenTransfers ?? []) {
      if (t?.mint !== mint) continue;
      for (const a of [t.fromUserAccount, t.toUserAccount]) {
        if (isSolanaAddress(a)) found.add(a);
      }
    }

    for (const acc of e?.accountData ?? []) {
      for (const ch of acc?.tokenBalanceChanges ?? []) {
        if (ch?.mint !== mint) continue;
        if (isSolanaAddress(ch.userAccount)) found.add(ch.userAccount);
      }
    }
  }

  return [...found];
}
