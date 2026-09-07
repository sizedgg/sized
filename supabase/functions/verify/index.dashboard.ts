// ============================================================================
// verify - STANDALONE VERSION FOR THE DASHBOARD EDITOR
//
// WARNING: This file is NOT edited by hand. It is generated from
// supabase/functions/verify/index.ts and the files under _shared/ by
//
//     node scripts/verify-eigenstaendig.mjs
//
// Change something here and it's lost on the next run - and worse: the
// version in the dashboard and the one in the project then say different
// things, without either one showing it.
//
// Generated on 2026-09-04
// ============================================================================

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// from _shared/base58.ts
// ---------------------------------------------------------------------------
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAP = new Map([...ALPHABET].map((c, i) => [c, i]));

/** Decodes base58 to bytes. Throws on invalid characters. */
function decodeBase58(input: string): Uint8Array {
  if (input.length === 0) return new Uint8Array(0);
  const bytes: number[] = [0];
  for (const ch of input) {
    const value = MAP.get(ch);
    if (value === undefined) throw new Error(`Ungültiges Base58-Zeichen: ${ch}`);
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // The accumulator starts with a 0; the extra zero bytes at the top end
  // don't belong to the value and must go before the real leading zero
  // bytes (each '1' in the input) are appended.
  while (bytes.length > 0 && bytes[bytes.length - 1] === 0) bytes.pop();
  for (let k = 0; k < input.length && input[k] === '1'; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

/** Encodes bytes as base58. */
function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';

  // Count leading zero bytes and keep them out of the conversion - they get
  // appended as '1' at the end and would otherwise produce an extra digit.
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

/**
 * Checks whether a string is a valid Solana address: base58 and exactly
 * 32 bytes. That reliably rules out typos and injected values.
 */
function isSolanaAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  try {
    return decodeBase58(value).length === 32;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// from _shared/freischaltung.ts
// ---------------------------------------------------------------------------
/**
 * The gate in front of launch.
 *
 * A standalone file with no imports, deliberately: common.ts pulls in the
 * Supabase client from jsr: and so can't be loaded from Node at all. A rule
 * that only exists in production can't be touched by a test - and this is
 * the one rule standing between "nobody gets in" and "everybody gets in".
 */

interface TorConfig {
  admin_wallet: string | null;
  test_wallet?: string | null;
  /**
   * If the column is missing, this is undefined - and that's its own case,
   * see mayEnter(). Optional, not a plain boolean, for that reason.
   */
  open_to_public?: boolean | null;
}

/**
 * Is this wallet even allowed in?
 *
 * Before launch, only Ansem's own - everyone else gets refused BEFORE an
 * amount is named. That's not a nicety here, it's the whole point: logging
 * in consists of a transfer. Anyone who pays first and then gets rejected
 * has sent money for nothing. So the refusal has to come at the start, not
 * the end.
 *
 * As its own function rather than two lines in two places: it's needed at
 * both gates (a new login and renewing an old session), and a rule missing
 * from one of the two goes unnoticed by anyone - it still looks closed.
 *
 * Two addresses get through, not one: admin_wallet and test_wallet. The
 * reason isn't convenience, it's that the site behaves DIFFERENTLY for the
 * two sides - Ansem sees an inbox, a user sees a paywall. Checking only
 * against Ansem's wallet would mean never seeing the half that everyone
 * else sees.
 *
 * Exactly ONE test address, not a field with several. A list would be the
 * spot where eventually someone is left in that nobody remembered to
 * remove; a single field is visible at a glance.
 */
function mayEnter(cfg: TorConfig, wallet: string | null): boolean {
  // The site is only closed if it EXPLICITLY says so. If the column is
  // missing, it's open.
  //
  // This used to run the other way, with the argument: when in doubt, keep
  // people out. That was right as long as the site needed to stay locked
  // before launch - a deployment without the migration then simply stayed
  // shut instead of opening.
  //
  // After launch, the worse failure mode flips. By then the function has
  // been running for months, someone redeploys it for a completely
  // unrelated reason, the column is missing from that database - and the
  // site is closed without anyone wanting that or noticing right away.
  //
  // A trap that fires on FORGETTING is worse than one that fires on a
  // DECISION. Closing the site is now an action:
  //   update public.app_config set open_to_public = false where id = 1;
  if (cfg.open_to_public !== false) return true;

  if (cfg.admin_wallet && wallet === cfg.admin_wallet) return true;
  return Boolean(cfg.test_wallet) && wallet === cfg.test_wallet;
}

// ---------------------------------------------------------------------------
// from _shared/common.ts
// ---------------------------------------------------------------------------
const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

const fail = (message: string, status = 400) => json({ error: message }, status);

/** Client with the service role - bypasses RLS, so it may only run server-side. */
function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

interface AppConfig {
  admin_wallet: string | null;
  treasury: string | null;
  ansem_mint: string | null;
  symbol: string;
  base_lamports: number;
  open_to_public: boolean;
  test_wallet: string | null;
}

async function loadConfig(db: SupabaseClient): Promise<AppConfig> {
  const { data, error } = await db.from('app_config').select('*').eq('id', 1).single();
  if (error) throw new Error(`Cannot read configuration: ${error.message}`);
  return data as AppConfig;
}

const MOCK = (Deno.env.get('MOCK_CHAIN') ?? '') === '1';

// ---------------------------------------------------------------------------
// from _shared/jwt.ts
// ---------------------------------------------------------------------------
/**
 * A minimal HS256 JWT, signed with the Supabase JWT secret.
 *
 * That makes PostgREST and Realtime accept the token like a regular
 * Supabase auth token - except the identity here isn't email or OAuth, it's
 * the wallet proven by payment, in the "wallet" claim.
 */

const enc = new TextEncoder();

const b64url = (bytes: Uint8Array | string): string => {
  const raw = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

interface WalletClaims {
  wallet: string;
  isAdmin: boolean;
  ttlSeconds: number;
  /**
   * Time of the first login (Unix seconds). Stays the same across all
   * renewals, and so limits how long a wallet can stay valid without a new
   * payment.
   */
  origIat?: number;
}

async function signWalletJwt(secret: string, claims: WalletClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    // Fields Supabase expects
    aud: 'authenticated',
    role: 'authenticated',
    sub: claims.wallet,
    iat: now,
    exp: now + claims.ttlSeconds,
    // Our own fields - `wallet` is evaluated in the RLS policies
    wallet: claims.wallet,
    is_admin: claims.isAdmin,
    oiat: claims.origIat ?? now,
    app_metadata: { provider: 'solana-payment' },
  };

  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return `${data}.${b64url(sig)}`;
}

const fromB64url = (s: string): Uint8Array => {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

/**
 * Checks signature and expiry and returns the wallet - or null.
 * Never use the payload without this check: it's only base64, not
 * encrypted, and can otherwise be forged at will.
 */
async function verifyWalletJwt(
  secret: string,
  token: string,
): Promise<{ wallet: string; isAdmin: boolean; origIat: number } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    const ok = await crypto.subtle.verify(
      'HMAC', key, fromB64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    if (typeof payload.wallet !== 'string' || !payload.wallet) return null;
    return {
      wallet: payload.wallet,
      isAdmin: payload.is_admin === true,
      origIat: Number(payload.oiat) || Number(payload.iat) || 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// from _shared/solana.ts
// ---------------------------------------------------------------------------
/**
 * Solana access via plain JSON-RPC over fetch - deliberately without
 * @solana/web3.js, so the edge function stays small and starts up fast.
 *
 * Three things are needed: payments to the treasury, a wallet's token
 * balance, and the price.
 */

const RPC_URL = Deno.env.get('SOLANA_RPC_URL') ?? 'https://api.mainnet-beta.solana.com';

let rpcId = 0;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
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

interface TreasuryPayment {
  signature: string;
  slot: number;
  sender: string;
  lamports: number;
}

interface SignatureInfo { signature: string; slot: number; err: unknown }

/**
 * How many detail lookups a single scan makes at most - and how many of
 * those run at the same time.
 *
 * The signature list is ONE cheap call, whether for 40 or 200 entries. What
 * gets expensive after that is `getTransaction`, once per signature. So the
 * window can be wide as long as known signatures get filtered out first -
 * but a cold start (nothing known yet) would otherwise mean 200 lookups
 * back to back, serially over 20 seconds, and the function would hit its
 * time limit before finishing.
 *
 * So: at most DETAILS_PRO_SCAN per run, newest first, run GLEICHZEITIG
 * (concurrently) in parallel. Whatever doesn't fit gets picked up on the
 * next run 5 seconds later - the challenge lives 25 minutes, which is
 * plenty of margin.
 */
const DETAILS_PRO_SCAN = 60;
const GLEICHZEITIG = 4;

/**
 * Reads the treasury address's latest transactions and returns all plain
 * SOL transfers *to* that address.
 *
 * `aussieben` gets the complete signature list and returns which of them
 * are still unknown - BEFORE the expensive detail lookup. Without this
 * step, every run would fetch the same `limit` transactions from the RPC
 * again, even though they're long since recorded.
 */
async function recentTreasuryPayments(
  treasury: string,
  limit = 200,
  aussieben: (sigs: string[]) => Promise<string[]> | string[] = (s) => s,
): Promise<TreasuryPayment[]> {
  const sigs = await rpc<SignatureInfo[]>('getSignaturesForAddress', [treasury, { limit }]);
  const brauchbar = sigs.filter((s) => !s.err);

  // Newest first - so a payment from just now still gets processed even
  // when there's a pile of old signatures ahead of it.
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
      // Not recording it doesn't mean losing it: the signature stays
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
 * Sums all of a wallet's token accounts for a mint.
 *
 * Filter only by `mint`. The RPC accepts exactly one of `mint` OR
 * `programId` - both together get rejected. The mint filter applies
 * regardless of whether the token runs under the classic token program or
 * under Token-2022, so it covers both.
 *
 * Errors are deliberately NOT swallowed: a caught RPC error would look like
 * a balance of zero here and would silently zero out every vote weight,
 * every chat filter, and the DM sort order. Better to fail loudly.
 */
async function tokenBalance(owner: string, mint: string): Promise<number> {
  // commitment: 'confirmed' matters here. Without it the RPC answers with
  // 'finalized', which lags a good dozen seconds behind. Someone who just
  // bought tokens already sees them in their wallet and in the explorer,
  // but not here yet - which looks like a bug.
  //
  // For payments to the treasury that would be the wrong choice: that's
  // about money, and a confirmed but not yet finalized transaction can, in
  // rare cases, still disappear. A balance is not critical - it gets
  // re-read continuously anyway and corrects itself next time.
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
async function tokenPrice(mint: string): Promise<number> {
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

// ---------------------------------------------------------------------------
// from _shared/holdings.ts
// ---------------------------------------------------------------------------
/** Deterministic fake balance for mock mode. */
async function mockAmount(wallet: string): Promise<number> {
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(wallet)),
  );
  const tiers = [0, 1_200, 15_000, 48_000, 120_000, 310_000, 900_000, 2_400_000, 7_500_000, 21_000_000];
  return tiers[hash[0] % 10] + (((hash[1] << 8) | hash[2]) % 997) * 13;
}

/**
 * Fetches balance and price fresh from the chain and writes them to
 * `wallets`. Only this function (service role) may write the table - so no
 * client can manipulate its own weight.
 */
async function refreshWallet(
  db: SupabaseClient,
  wallet: string,
  mint: string,
  /**
   * An already-known price. Without this parameter, every single wallet
   * would fetch its own - in a batch run over 200 wallets that would be 200
   * queries for the same value against the same price source, which could
   * well lock you out for it. The price is the same for everyone, so the
   * caller fetches it once and passes it through.
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

// ---------------------------------------------------------------------------
// from verify/index.ts
// ---------------------------------------------------------------------------
/**
 * Wallet verification by payment.
 *
 *   POST { action: "challenge", wallet }      -> unique amount + recipient
 *   POST { action: "status", challengeId }    -> "pending" | "expired" | JWT
 *   POST { action: "mock-pay", challengeId }  -> only when MOCK_CHAIN=1
 *
 * Why a random-fraction amount and not a fixed price:
 * With a fixed amount, someone could enter a stranger's address, wait until
 * that person happens to pay, and redeem their payment as their own proof.
 * The nonce amount is unknown to the attacker, and every signature is
 * accepted exactly once.
 *
 * Why every challenge carries a secret:
 * The nonce amount alone was not enough. Anyone who opened a challenge for
 * SOMEONE ELSE'S address got the id back - and createChallenge later handed
 * that same challenge to the real owner, so a reload wouldn't cost twice.
 * The owner paid, and the attacker could fetch the JWT with the same id. For
 * Ansem's address that would have been admin access, without Ansem doing
 * anything wrong.
 *
 * So a challenge now belongs to whoever opened it: the secret goes out
 * exactly once, only its SHA-256 fingerprint sits in the database, and
 * status and mock-pay both require it. The full story is in
 * 20260903020000_challenge_gehoert_dem_ersteller.sql.
 */





const CHALLENGE_TTL_MIN = Number(Deno.env.get('CHALLENGE_TTL_MIN') ?? 25);

// 90 days. A short session would mean someone has to pay again just to
// re-enter - for a chat people open every few days, that would be an
// imposition.
const SESSION_TTL_HOURS = Number(Deno.env.get('SESSION_TTL_HOURS') ?? 24 * 90);

// Renewal can happen any number of times, but not forever: a year after the
// first login it stops, and verification runs again. That caps how long a
// leaked token stays usable.
const MAX_SESSION_AGE_SEC = Number(Deno.env.get('MAX_SESSION_DAYS') ?? 365) * 86_400;
// The surcharge that ties a payment to its login.
//
// It used to be 1 to 99,999 lamports, i.e. lamport-exact. The amount then
// looked like this: 0.002043217 SOL - NINE decimal places. On Phantom on a
// phone that can't be typed in; the field accepts fewer digits and the last
// one gets dropped. The amount then matches no challenge, the money has been
// sent, and the login fails for no visible reason.
//
// Now in steps of 1,000 lamports:
//
//   0.002001 ... 0.002999 SOL   ->  SIX decimal places
//
// Every wallet app accepts six digits, and the number can be typed by hand
// without losing count.
//
// That a thousand amounts are enough comes down to the matching: scanTreasury
// compares amount AND sender address. So the amount only needs to be unique
// within a single wallet, and there are at most three challenges open there
// at once. The full reasoning is in
// 20260904020000_betrag_weniger_stellen.sql.
const NONCE_STEP = 1_000;   // lamports per step -> 6 decimal places
const NONCE_TIERS = 999;      // 0.000001 to 0.000999 SOL surcharge

const db = serviceClient();

let lastScan = 0;

// ---------------------------------------------------------------------------
// The secret of a challenge
// ---------------------------------------------------------------------------

/** 32 random bytes as hex - the only output, then just the fingerprint. */
function newSecret(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

async function abdruck(geheimnis: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(geheimnis));
  return [...new Uint8Array(h)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/**
 * Compares two hex fingerprints in constant time.
 *
 * With a fingerprint an early exit is barely exploitable - but the
 * difference costs nothing here, and using === at the exact spot that
 * decides a login is the kind of detail nobody adds back in later.
 */
function gleich(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Fetches a challenge, but only with the matching secret.
 *
 * Returns null when the challenge doesn't exist, the secret is wrong - or
 * when it's still open and dates from before secrets existed. Both cases get
 * the same refusal, so the response doesn't reveal which ids exist.
 */
async function challengeWithSecret(id: unknown, geheimnis: unknown) {
  if (typeof id !== 'string' || id.length < 10) return null;
  if (typeof geheimnis !== 'string' || geheimnis.length < 32) return null;

  const { data: c } = await db.from('challenges').select('*').eq('id', id).maybeSingle();
  if (!c) return null;

  // Legacy rows: the migration set open challenges without a fingerprint
  // to 'expired'. A PAID one without a fingerprint may still be redeemed -
  // that's money that moved before the secret existed.
  if (!c.secret_hash) return c.status === 'paid' ? c : null;

  return gleich(await abdruck(geheimnis), c.secret_hash) ? c : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('POST only', 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail('Invalid request body');
  }

  try {
    const cfg = await loadConfig(db);
    switch (body.action) {
      case 'challenge': return await createChallenge(cfg, body.wallet, body.challengeId, body.secret);
      case 'status':    return await checkStatus(cfg, body.challengeId, body.secret);
      case 'renew':     return await renewSession(cfg, req);
      case 'mock-pay':  return await mockPay(body.challengeId, body.secret);
      default:          return fail('Unknown action');
    }
  } catch (err) {
    console.error('[verify]', err);
    return fail(err instanceof Error ? err.message : 'Internal error', 500);
  }
});

// ---------------------------------------------------------------------------

async function createChallenge(
  cfg: Awaited<ReturnType<typeof loadConfig>>,
  wallet: unknown,
  weiterId: unknown,
  weiterGeheimnis: unknown,
) {
  if (!isSolanaAddress(wallet)) return fail('Not a valid Solana address');

  // Before launch this bails out here - and specifically BEFORE the line
  // below that names an amount. Whoever gets refused has sent nothing and
  // can't send anything either: without a challenge there's no amount for
  // the treasury to listen for.
  if (!mayEnter(cfg, wallet)) {
    return fail('Not open yet - check back at launch.', 403);
  }

  if (!cfg.treasury) return fail('Verification address is not configured', 503);

  // Resume an open challenge so a reload doesn't cost twice.
  //
  // This used to search ONLY by wallet: "if there's something open for this
  // address, use it." That's exactly what handed a stranger's challenge on
  // to the real owner - see the top of this file. Now it only resumes for
  // whoever presents their own secret.
  if (weiterId) {
    const c = await challengeWithSecret(weiterId, weiterGeheimnis);
    if (c && c.wallet === wallet && c.status === 'pending'
        && new Date(c.expires_at).getTime() > Date.now()) {
      return challengeResponse(cfg, c, String(weiterGeheimnis));
    }
    // If it doesn't match, a new one gets created. No error message: the
    // most common cause is an expired challenge in localStorage, and nobody
    // should see a failure for that.
  }

  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MIN * 60_000).toISOString();
  const geheimnis = newSecret();
  const secret_hash = await abdruck(geheimnis);

  // The unique index on open amounts rejects collisions - reroll.
  for (let attempt = 0; attempt < 20; attempt++) {
    const lamports = Number(cfg.base_lamports)
      + (1 + Math.floor(Math.random() * NONCE_TIERS)) * NONCE_STEP;
    const { data, error } = await db.from('challenges')
      .insert({ wallet, lamports, expires_at: expiresAt, secret_hash })
      .select().single();
    if (!error) return challengeResponse(cfg, data, geheimnis);
    // P0001: the per-wallet cap on open challenges from the migration.
    // That's not a collision you can reroll away - it's a hard stop.
    if (error.code === 'P0001') return fail(error.message, 429);
    if (error.code !== '23505') throw new Error(error.message);
  }
  return fail('No free verification amount right now - please try again in a moment', 503);
}

/**
 * The secret goes out EXACTLY HERE and nowhere else. Only its fingerprint
 * sits in the database; whoever loses it starts over.
 */
function challengeResponse(
  cfg: Awaited<ReturnType<typeof loadConfig>>, c: any, geheimnis: string,
) {
  return json({
    challengeId: c.id,
    secret: geheimnis,
    wallet: c.wallet,
    treasury: cfg.treasury,
    lamports: Number(c.lamports),
    sol: Number(c.lamports) / 1e9,
    expiresAt: c.expires_at,
    mock: MOCK,
  });
}

// ---------------------------------------------------------------------------

async function checkStatus(
  cfg: Awaited<ReturnType<typeof loadConfig>>, id: unknown, geheimnis: unknown,
) {
  if (typeof id !== 'string' || id.length < 10) return fail('Invalid challengeId');

  if (!MOCK) await scanTreasury(cfg.treasury!);

  // Without the matching secret there's nothing here - not even with the
  // right id. This is the line the takeover hinged on: it used to load the
  // challenge by id alone.
  //
  // Same refusal for "doesn't exist" and "wrong secret": otherwise the
  // response would be an oracle for which ids exist.
  const c = await challengeWithSecret(id, geheimnis);
  if (!c) return fail('Unknown request', 404);

  if (c.status === 'pending' && new Date(c.expires_at).getTime() < Date.now()) {
    await db.from('challenges').update({ status: 'expired' }).eq('id', id);
    return json({ status: 'expired' });
  }
  if (c.status !== 'paid') return json({ status: c.status });

  // Redeemable exactly once: only whoever wins the status change gets the JWT.
  const { data: claimed } = await db.from('challenges')
    .update({ status: 'used' }).eq('id', id).eq('status', 'paid').select().maybeSingle();
  if (!claimed) return json({ status: 'used' });

  // A holdings lookup failure must not fail the login: the challenge is
  // already redeemed, and an error here would make the payment worthless.
  // The cron run picks up the holdings later anyway.
  let holdings = { uiAmount: 0, usdValue: 0, price: 0 };
  try {
    holdings = await refreshWallet(db, c.wallet, cfg.ansem_mint ?? '');
  } catch (err) {
    console.error('[verify] Bestandsabruf fehlgeschlagen für', c.wallet, err);
    const { data: known } = await db.from('wallets')
      .select('ui_amount, usd_value').eq('address', c.wallet).maybeSingle();
    if (known) holdings = { uiAmount: Number(known.ui_amount), usdValue: Number(known.usd_value), price: 0 };
  }

  const isAdmin = Boolean(cfg.admin_wallet) && c.wallet === cfg.admin_wallet;

  const token = await signWalletJwt(Deno.env.get('APP_JWT_SECRET')!, {
    wallet: c.wallet,
    isAdmin,
    ttlSeconds: SESSION_TTL_HOURS * 3600,
  });

  return json({
    status: 'verified',
    token,
    expiresAt: Date.now() + SESSION_TTL_HOURS * 3_600_000,
    txSig: c.tx_sig,
    profile: {
      wallet: c.wallet,
      handle: c.wallet.slice(0, 3),
      tokens: holdings.uiAmount,
      usd: holdings.usdValue,
      isAdmin,
    },
  });
}

/**
 * How far back the scan looks.
 *
 * This used to be 40 - and 40 is the number at which a launch with many
 * simultaneous logins loses real money: if more than 40 payments land at the
 * treasury between two scans, the oldest ones fall out of the window and are
 * NEVER seen. The challenge expires after 25 minutes, the SOL has been sent,
 * and nobody gets in.
 *
 * 200 costs almost nothing, because the signature list is a single RPC call
 * and known signatures get filtered out before that.
 */
const TREASURY_FENSTER = 200;

/**
 * Reads the latest treasury transactions and posts matching payments to
 * open challenges. At most every 5 seconds, so parallel polling by many
 * users doesn't blow through the RPC limit.
 */
async function scanTreasury(treasury: string) {
  if (Date.now() - lastScan < 5_000) return;
  lastScan = Date.now();

  const { count } = await db.from('challenges')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending').gt('expires_at', new Date().toISOString());
  if (!count) return; // nothing open -> no RPC call

  // The most recently recorded signatures, fetched ONCE and handed to the
  // scan as a filter: that drops everything already known before the RPC
  // does a per-signature detail lookup. It used to filter only afterward -
  // so every run fetched all 40 transactions again, once a second, for
  // nothing.
  //
  // 600 rows cover the 200-wide window with margin: a signature from the
  // window that we already know can only fall out of these 600 if more than
  // 600 payments have come in since - and by then it would be long out of
  // the window anyway. And even if the filter lets one slip through once,
  // the primary key on seen_txs.signature is the actual guard against double
  // booking: the filter saves work, it guarantees nothing.
  const { data: last } = await db.from('seen_txs')
    .select('signature').order('seen_at', { ascending: false }).limit(600);
  const verbucht = new Set((last ?? []).map((k) => k.signature));

  const payments = await recentTreasuryPayments(
    treasury,
    TREASURY_FENSTER,
    (sigs) => sigs.filter((s) => !verbucht.has(s)),
  );
  if (!payments.length) return;

  for (const p of payments) {
    // Commit that this signature has been used first. If that fails, a
    // parallel run already has it - so don't book it twice.
    const { error: insErr } = await db.from('seen_txs').insert({
      signature: p.signature, slot: p.slot, sender: p.sender, lamports: p.lamports,
    });
    if (insErr) continue;

    const { data: matched } = await db.from('challenges')
      .update({ status: 'paid', tx_sig: p.signature })
      .eq('status', 'pending')
      .eq('wallet', p.sender)
      .eq('lamports', p.lamports)
      .gt('expires_at', new Date().toISOString())
      .select('id').maybeSingle();

    if (matched) {
      console.log(`[verify] Zahlung bestätigt: ${p.sender.slice(0, 6)}… ${p.signature.slice(0, 10)}…`);
    }
  }
}

/**
 * Renews a still-valid session, without a new payment.
 *
 * Anyone who opens the app regularly stays logged in indefinitely this way.
 * Payment happens only once - and again if someone stays away for a year, or
 * their token has expired.
 */
async function renewSession(cfg: Awaited<ReturnType<typeof loadConfig>>, req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return fail('Not verified', 401);

  const secret = Deno.env.get('APP_JWT_SECRET')!;
  const claims = await verifyWalletJwt(secret, auth.slice(7).trim());
  if (!claims) return fail('Session expired - please verify again', 401);

  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.origIat && nowSec - claims.origIat > MAX_SESSION_AGE_SEC) {
    return fail('Session too old - please verify again', 401);
  }

  // Admin rights are read fresh from config, not from the old token: if
  // Ansem's wallet changes, the old token loses the rights.
  const isAdmin = Boolean(cfg.admin_wallet) && claims.wallet === cfg.admin_wallet;

  // Same gate here too. Otherwise any session issued before the site closed
  // would keep its access indefinitely - renewal runs on its own and
  // otherwise never asks anyone again.
  if (!mayEnter(cfg, claims.wallet)) {
    return fail('Not open yet - check back at launch.', 403);
  }

  const token = await signWalletJwt(secret, {
    wallet: claims.wallet,
    isAdmin,
    ttlSeconds: SESSION_TTL_HOURS * 3600,
    origIat: claims.origIat || nowSec,
  });

  const { data: known } = await db.from('wallets')
    .select('ui_amount, usd_value').eq('address', claims.wallet).maybeSingle();

  return json({
    status: 'verified',
    token,
    expiresAt: Date.now() + SESSION_TTL_HOURS * 3_600_000,
    profile: {
      wallet: claims.wallet,
      handle: claims.wallet.slice(0, 3),
      tokens: Number(known?.ui_amount ?? 0),
      usd: Number(known?.usd_value ?? 0),
      isAdmin,
    },
  });
}

async function mockPay(id: unknown, geheimnis: unknown) {
  if (!MOCK) return fail('Not available', 404);
  // The secret applies here too: MOCK_CHAIN is an environment variable, and
  // an environment variable ends up set to 1 by accident eventually. If it
  // does, the shortcut should at least not also work for someone else's
  // challenges.
  const c = await challengeWithSecret(id, geheimnis);
  if (!c) return fail('No open request', 400);
  const { data } = await db.from('challenges')
    .update({ status: 'paid', tx_sig: `mock-${crypto.randomUUID()}` })
    .eq('id', c.id).eq('status', 'pending').select().maybeSingle();
  return data ? json({ ok: true }) : fail('No open request', 400);
}
