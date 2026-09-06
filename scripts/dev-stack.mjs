/**
 * Lokaler Nachbau des Supabase-Stacks, um das Frontend ohne Cloud-Projekt zu
 * testen: echtes Postgres + echtes PostgREST (also echte RLS) und eine
 * Node-Nachbildung der beiden Edge Functions im Mock-Modus.
 *
 * Nicht enthalten: Realtime. Live-Updates funktionieren erst gegen ein echtes
 * Supabase-Projekt; die Oberfläche lädt hier nach jeder Aktion neu.
 *
 *   PGURL=postgres://postgres:test@localhost/ansem_dev node scripts/dev-stack.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { isSolanaAddress } from '../supabase/functions/_shared/base58.ts';
import { signWalletJwt, verifyWalletJwt } from '../supabase/functions/_shared/jwt.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PGURL = process.env.PGURL || 'postgres://postgres:test@localhost/ansem_dev';
const PGRST_BIN = process.env.PGRST_BIN || '/tmp/postgrest';
const JWT_SECRET = 'dev-secret-nur-lokal-mindestens-32-zeichen-lang';
const ANON_KEY = 'dev-anon-key';
const PORT = Number(process.env.PORT || 4000);
const PGRST_PORT = 4001;

const db = new pg.Pool({ connectionString: PGURL });

// ---------------------------------------------------------------------------
// Mock-Chain
// ---------------------------------------------------------------------------

const MOCK_PRICE = 0.0042;
function mockAmount(wallet) {
  const h = crypto.createHash('sha256').update(wallet).digest();
  const tiers = [0, 1_200, 15_000, 48_000, 120_000, 310_000, 900_000, 2_400_000, 7_500_000, 21_000_000];
  return tiers[h[0] % 10] + (h.readUInt16BE(1) % 997) * 13;
}

async function refreshWallet(wallet) {
  const ui = mockAmount(wallet);
  const usd = ui * MOCK_PRICE;
  await db.query(
    `insert into public.wallets (address, ui_amount, usd_value, price, updated_at)
     values ($1,$2,$3,$4, now())
     on conflict (address) do update set ui_amount=excluded.ui_amount,
       usd_value=excluded.usd_value, price=excluded.price, updated_at=now()`,
    [wallet, ui, usd, MOCK_PRICE]);
  return { tokens: ui, usd };
}

// ---------------------------------------------------------------------------
// Edge Functions (Node-Nachbildung)
// ---------------------------------------------------------------------------

async function fnVerify(body, _req) {
  const cfg = (await db.query('select * from public.app_config where id=1')).rows[0];

  if (body.action === 'challenge') {
    if (!isSolanaAddress(body.wallet)) return [400, { error: 'Not a valid Solana address' }];
    const open = (await db.query(
      `select * from public.challenges where wallet=$1 and status='pending' and expires_at > now()
       order by created_at desc limit 1`, [body.wallet])).rows[0];
    const c = open ?? (await createChallenge(body.wallet, cfg));
    return [200, {
      challengeId: c.id, wallet: c.wallet, treasury: cfg.treasury,
      lamports: Number(c.lamports), sol: Number(c.lamports) / 1e9,
      expiresAt: c.expires_at, mock: true,
    }];
  }

  if (body.action === 'mock-pay') {
    const r = await db.query(
      `update public.challenges set status='paid', tx_sig=$2
       where id=$1 and status='pending' returning *`,
      [body.challengeId, 'mock-' + crypto.randomUUID()]);
    return r.rowCount ? [200, { ok: true }] : [400, { error: 'No open request' }];
  }

  if (body.action === 'status') {
    const c = (await db.query('select * from public.challenges where id=$1', [body.challengeId])).rows[0];
    if (!c) return [404, { error: 'Unknown request' }];
    if (c.status === 'pending' && new Date(c.expires_at) < new Date()) {
      await db.query(`update public.challenges set status='expired' where id=$1`, [c.id]);
      return [200, { status: 'expired' }];
    }
    if (c.status !== 'paid') return [200, { status: c.status }];

    const claimed = await db.query(
      `update public.challenges set status='used' where id=$1 and status='paid' returning *`, [c.id]);
    if (!claimed.rowCount) return [200, { status: 'used' }];

    const h = await refreshWallet(c.wallet);
    const isAdmin = c.wallet === cfg.admin_wallet;
    const token = await signWalletJwt(JWT_SECRET, { wallet: c.wallet, isAdmin, ttlSeconds: 90 * 24 * 3600 });
    return [200, {
      status: 'verified', token, txSig: c.tx_sig,
      profile: { wallet: c.wallet, handle: c.wallet.slice(0, 3), tokens: h.tokens, usd: h.usd, isAdmin },
    }];
  }

  if (body.action === 'renew') {
    const auth = _req.headers.authorization || '';
    const claims = auth.startsWith('Bearer ') ? await verifyWalletJwt(JWT_SECRET, auth.slice(7)) : null;
    if (!claims) return [401, { error: 'Session expired - please verify again' }];
    const isAdmin = claims.wallet === cfg.admin_wallet;
    const token = await signWalletJwt(JWT_SECRET, {
      wallet: claims.wallet, isAdmin, ttlSeconds: 90 * 24 * 3600, origIat: claims.origIat,
    });
    const w = (await db.query('select ui_amount, usd_value from public.wallets where address=$1',
      [claims.wallet])).rows[0];
    return [200, {
      status: 'verified', token,
      profile: {
        wallet: claims.wallet, handle: claims.wallet.slice(0, 3),
        tokens: Number(w?.ui_amount ?? 0), usd: Number(w?.usd_value ?? 0), isAdmin,
      },
    }];
  }

  return [400, { error: 'Unknown action' }];
}

async function createChallenge(wallet, cfg) {
  for (let i = 0; i < 20; i++) {
    const lamports = Number(cfg.base_lamports) + 1 + crypto.randomInt(99_998);
    try {
      const r = await db.query(
        `insert into public.challenges (wallet, lamports, expires_at)
         values ($1,$2, now() + interval '25 minutes') returning *`, [wallet, lamports]);
      return r.rows[0];
    } catch (e) { if (e.code !== '23505') throw e; }
  }
  throw new Error('No free verification amount');
}

async function fnRefreshHoldings(_body, req) {
  const auth = req.headers.authorization || '';
  const claims = auth.startsWith('Bearer ') ? await verifyWalletJwt(JWT_SECRET, auth.slice(7)) : null;
  if (!claims) return [401, { error: 'Not verified' }];
  const h = await refreshWallet(claims.wallet);
  return [200, { wallet: claims.wallet, ...h, cached: false }];
}

// ---------------------------------------------------------------------------
// HTTP: statische Dateien, Function-Routen, PostgREST-Proxy
// ---------------------------------------------------------------------------

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors()).end();
    return;
  }

  // Konfiguration für den Browser überschreiben
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' }).end(
      `export const SUPABASE_URL = 'http://localhost:${PORT}';\n` +
      `export const SUPABASE_ANON_KEY = '${ANON_KEY}';\n`);
    return;
  }

  if (url.pathname.startsWith('/functions/v1/')) {
    const name = url.pathname.split('/').pop();
    const body = await readJson(req);
    const handler = name === 'verify' ? fnVerify : name === 'refresh-holdings' ? fnRefreshHoldings : null;
    if (!handler) return send(res, 404, { error: 'Unknown function' });
    try {
      const [status, payload] = await handler(body, req);
      return send(res, status, payload);
    } catch (err) {
      console.error('[fn]', err);
      return send(res, 500, { error: String(err.message || err) });
    }
  }

  if (url.pathname.startsWith('/rest/v1/')) {
    const target = `http://127.0.0.1:${PGRST_PORT}${url.pathname.replace('/rest/v1', '')}${url.search}`;
    const headers = { ...req.headers };
    delete headers.host; delete headers.apikey; delete headers['content-length'];
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readRaw(req);
    const upstream = await fetch(target, { method: req.method, headers, body });
    const text = await upstream.text();
    const out = { ...cors(), 'content-type': upstream.headers.get('content-type') || 'application/json' };
    for (const h of ['content-range', 'content-profile']) {
      const v = upstream.headers.get(h);
      if (v) out[h] = v;
    }
    res.writeHead(upstream.status, out).end(text);
    return;
  }

  // Realtime gibt es lokal nicht – sauber ablehnen statt endlos retryen.
  if (url.pathname.startsWith('/realtime/')) {
    res.writeHead(501).end('Realtime nur gegen ein echtes Supabase-Projekt');
    return;
  }

  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  const abs = path.join(root, 'public', path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(path.join(root, 'public')) || !fs.existsSync(abs)) {
    res.writeHead(404).end('nicht gefunden');
    return;
  }
  // Kein Zwischenspeichern beim Entwickeln. Ohne Cache-Control entscheidet der
  // Browser selbst, wie lange er eine Antwort behält – und tut das großzügig.
  // Genau das führt zu dem Fall, in dem man eine Datei ändert, neu lädt und
  // trotzdem die alte Seite sieht.
  res.writeHead(200, {
    'content-type': MIME[path.extname(abs)] || 'application/octet-stream',
    'cache-control': 'no-store, must-revalidate',
  }).end(fs.readFileSync(abs));
});

const cors = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'content-range, content-profile',
});
const send = (res, status, obj) =>
  res.writeHead(status, { ...cors(), 'content-type': 'application/json' }).end(JSON.stringify(obj));
const readRaw = (req) => new Promise((r) => {
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => r(Buffer.concat(chunks)));
});
const readJson = async (req) => { try { return JSON.parse((await readRaw(req)).toString() || '{}'); } catch { return {}; } };

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const pgrst = spawn(PGRST_BIN, [], {
  env: {
    ...process.env,
    PGRST_DB_URI: PGURL.replace('postgres://postgres:test@', 'postgres://authenticator:test@'),
    PGRST_DB_SCHEMAS: 'public',
    PGRST_DB_ANON_ROLE: 'anon',
    PGRST_JWT_SECRET: JWT_SECRET,
    PGRST_SERVER_PORT: String(PGRST_PORT),
    PGRST_LOG_LEVEL: 'error',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});

server.listen(PORT, () => {
  console.log(`\n  SIZED (lokaler Stack)  http://localhost:${PORT}`);
  console.log(`  PostgREST                  http://localhost:${PGRST_PORT}`);
  console.log(`  Mock-Chain aktiv, Realtime deaktiviert, Zahlung wird simuliert\n`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { pgrst.kill(); server.close(); process.exit(0); });
}
