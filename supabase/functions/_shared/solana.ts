/**
 * Solana access via plain JSON-RPC over fetch - deliberately without
 * @solana/web3.js, so the Edge Function stays small and cold-starts fast.
 *
 * Three things are needed: payments to the treasury, a wallet's token
 * balance, and the price.
 */

export const RPC_URL = Deno.env.get('SOLANA_RPC_URL') ?? 'https://api.mainnet-beta.solana.com';

let rpcId = 0;

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
  return json.result as T;
}

// ---------------------------------------------------------------------------
// Payments to the treasury
// ---------------------------------------------------------------------------

export interface TreasuryPayment {
  signature: string;
  slot: number;
  sender: string;
  lamports: number;
  /**
   * When the payment landed, in seconds since the epoch - straight from the
   * chain, not from our clock.
   *
   * The matching needs it: a payment may only settle a challenge that
   * existed BEFORE it. Without that comparison an old, still unbooked
   * payment from someone else's wallet can be claimed by a challenge opened
   * later, and whoever opened that challenge gets a session for a wallet
   * that is not theirs. See scanTreasury in verify/index.ts.
   *
   * null only for transactions so old that the node has dropped the time -
   * that cannot happen for a payment made minutes ago.
   */
  blockTime: number | null;
}

interface SignatureInfo { signature: string; slot: number; err: unknown; blockTime?: number | null }

/**
 * How many detail queries a single scan makes at most - and how many of
 * them run at the same time.
 *
 * The signature list is ONE cheap call, whether for 40 or 200 entries.
 * `getTransaction` is expensive after that, once per signature. So the
 * window is allowed to be wide, as long as known signatures fall away
 * beforehand - but a cold start (nothing known yet) would otherwise mean
 * 200 queries back to back, serially, over 20 seconds, and the function
 * would run into its time limit first.
 *
 * So: at most DETAILS_PRO_SCAN per run, newest first, CONCURRENTLY in
 * parallel. Whatever doesn't fit any more gets its turn on the next run,
 * 5 seconds later - the challenge lives for 25 minutes, which covers that
 * many times over.
 */
const DETAILS_PRO_SCAN = 60;
const GLEICHZEITIG = 4;

/**
 * Reads the treasury address's most recent transactions and returns all
 * plain SOL transfers *to* that address.
 *
 * `aussieben` gets the complete signature list and returns which of them are
 * still unknown - BEFORE the expensive detail query. Without this step,
 * every run would fetch the same `limit` transactions from the RPC again,
 * even though they were recorded long ago.
 */
export async function recentTreasuryPayments(
  treasury: string,
  limit = 200,
  aussieben: (sigs: string[]) => Promise<string[]> | string[] = (s) => s,
): Promise<TreasuryPayment[]> {
  const sigs = await rpc<SignatureInfo[]>('getSignaturesForAddress', [treasury, { limit }]);
  const brauchbar = sigs.filter((s) => !s.err);

  // Newest first - that way a payment from just now still gets its turn
  // even when a pile of old signatures sits in front of it.
  const offen = new Set(await aussieben(brauchbar.map((s) => s.signature)));
  const wanted = brauchbar.filter((s) => offen.has(s.signature)).slice(0, DETAILS_PRO_SCAN);

  const einzeln = async (s: SignatureInfo): Promise<TreasuryPayment | null> => {
    let tx: any;
    try {
      tx = await rpc('getTransaction', [
        s.signature,
        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
      ]);
    } catch {
      // Not recording it doesn't mean it's lost: the signature stays
      // unknown and the next run tries again.
      return null;
    }
    if (!tx || tx.meta?.err) return null;

    const instructions = [
      ...(tx.transaction?.message?.instructions ?? []),
      ...((tx.meta?.innerInstructions ?? []).flatMap((i: any) => i.instructions ?? [])),
    ];

    for (const ix of instructions) {
      if (ix?.program !== 'system') continue;
      if (ix?.parsed?.type !== 'transfer') continue;
      const info = ix.parsed.info;
      if (info?.destination !== treasury) continue;
      return {
        signature: s.signature,
        slot: tx.slot ?? s.slot,
        sender: info.source,
        lamports: Number(info.lamports),
        blockTime: tx.blockTime ?? s.blockTime ?? null,
      }; // one transfer per transaction is enough
    }
    return null;
  };

  const out: TreasuryPayment[] = [];
  for (let i = 0; i < wanted.length; i += GLEICHZEITIG) {
    const stapel = await Promise.all(wanted.slice(i, i + GLEICHZEITIG).map(einzeln));
    for (const p of stapel) if (p) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Token balance
// ---------------------------------------------------------------------------

/**
 * Sums up all of a wallet's token accounts for one mint.
 *
 * Filter only by `mint`. The RPC accepts exactly one of `mint` OR
 * `programId` - both together get rejected. The mint filter applies
 * regardless of whether the token runs under the classic token program or
 * under Token-2022, so it covers both.
 *
 * Errors are deliberately NOT swallowed: a caught RPC error would look like
 * a balance of zero here and would quietly set every vote weight, every
 * chat filter, and the DM sort order to zero. Better to fail loudly.
 */
export async function tokenBalance(owner: string, mint: string): Promise<number> {
  // commitment: 'confirmed' matters here. Without it the RPC answers with
  // 'finalized', which lags a good dozen seconds behind. Whoever just
  // bought tokens already sees them in their wallet and in the explorer,
  // but not here yet - that looks like a bug.
  //
  // For payments to the treasury this would be the wrong choice: that's
  // about money, and a confirmed but not yet final transaction can in rare
  // cases still disappear again. A balance is uncritical - it gets read
  // freshly all the time anyway and corrects itself next time.
  const res = await rpc<{ value?: any[] }>('getTokenAccountsByOwner', [
    owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' },
  ]);

  let total = 0;
  for (const acc of res?.value ?? []) {
    total += Number(acc.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

async function fetchJson(url: string, timeoutMs = 6000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** USD price of a token, Jupiter first, DexScreener as fallback. */
export async function tokenPrice(mint: string): Promise<number> {
  try {
    const data = await fetchJson(`https://lite-api.jup.ag/price/v3?ids=${mint}`);
    const p = Number(data?.[mint]?.usdPrice);
    if (p > 0) return p;
  } catch { /* fall through to the fallback */ }

  try {
    const data = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const pairs = (data?.pairs ?? []).filter((p: any) => p.priceUsd);
    pairs.sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const p = Number(pairs[0]?.priceUsd);
    if (p > 0) return p;
  } catch { /* price unknown */ }

  return 0;
}
