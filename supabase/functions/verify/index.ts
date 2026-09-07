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
import { serviceClient, loadConfig, json, fail, CORS, MOCK, mayEnter } from '../_shared/common.ts';
import { isSolanaAddress } from '../_shared/base58.ts';
import { recentTreasuryPayments } from '../_shared/solana.ts';
import { signWalletJwt, verifyWalletJwt } from '../_shared/jwt.ts';
import { refreshWallet } from '../_shared/holdings.ts';

const CHALLENGE_TTL_MIN = Number(Deno.env.get('CHALLENGE_TTL_MIN') ?? 25);

// 90 days. A short session would mean someone has to pay again just to
// re-enter - for a site people open every few days, that would be an
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

  // Secret first, then the chain.
  // -------------------------------------------------------------------------
  // Without the matching secret there's nothing here - not even with the
  // right id. This is the line the takeover hinged on: it used to load the
  // challenge by id alone.
  //
  // Same refusal for "doesn't exist" and "wrong secret": otherwise the
  // response would be an oracle for which ids exist.
  //
  // The order is the second point, and it was backwards. The treasury scan
  // used to sit BEFORE this check - so a POST with a made-up id would
  // trigger it without the sender having to prove anything. A scan is up to
  // sixty getTransaction calls to the RPC provider, and those cost money and
  // quota. A script making cheap HTTP requests could use that to take down
  // login for everyone.
  //
  // For a legitimate caller the order changes nothing: they have their
  // secret, and they reach the scan one line later.
  const c = await challengeWithSecret(id, geheimnis);
  if (!c) return fail('Unknown request', 404);

  // Only now check the chain - and only if this challenge is still waiting
  // on a payment at all. For 'paid', 'used' or 'expired' there's nothing
  // left to find.
  if (!MOCK && c.status === 'pending') await scanTreasury(cfg.treasury!);

  // Re-read after the scan: it may have set exactly this challenge to
  // 'paid', which would make the row already in hand stale.
  if (!MOCK && c.status === 'pending') {
    const fresh = await challengeWithSecret(id, geheimnis);
    if (fresh) Object.assign(c, fresh);
  }

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
