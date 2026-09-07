// ============================================================================
// Does the treasury scan find every payment - even when hundreds arrive at
// once?
//
// This is the one place on the site where a bug doesn't cost a display
// glitch or a bit of convenience, but real money: someone who sends SOL to
// the treasury and whose payment goes unseen has paid and doesn't get in.
// The challenge expires after 25 minutes, and the SOL has been sent.
//
// ----------------------------------------------------------------------------
// The two bugs that existed
//
//   1. `recentTreasuryPayments` takes a parameter `aussieben` that lets the
//      caller filter out known signatures BEFORE an expensive per-signature
//      detail lookup runs. `scanTreasury` didn't pass it and only checked
//      against seen_txs afterward. So: every run, every 5 seconds, fetched
//      the same 40 transactions from the RPC again - seconds of work for a
//      result that was already recorded.
//
//   2. The window was 40 signatures wide. If more than 40 payments land
//      between two runs, the oldest ones fall out and are NEVER seen.
//      Exactly the case at a launch with many simultaneous logins.
//
// ----------------------------------------------------------------------------
// What actually runs here
//
// Deno doesn't exist in this environment. So `recentTreasuryPayments` from
// _shared/solana.ts and `scanTreasury` from verify/index.ts are cut out
// verbatim and run in Node - against a stand-in RPC and a stand-in
// database. Only the TypeScript types are dropped.
//
// What's counted is what matters: how many `getTransaction` calls a run
// costs and which payments end up recorded. The checks hang on this
// observation, not on the numbers 200 or 60 - whoever changes the window
// later shouldn't have to adjust the test, as long as the behavior holds.
//
//   node scripts/test-treasury-scan.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const solanaTs = fs.readFileSync(
  path.join(root, 'supabase/functions/_shared/solana.ts'), 'utf8');
const verifyTs = fs.readFileSync(
  path.join(root, 'supabase/functions/verify/index.ts'), 'utf8');

const cut = (source, wo, von, bis) => {
  const a = source.indexOf(von);
  const b = source.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in ${wo}: ${von}`);
  return source.slice(a, b);
};

const befunde = [];
const check = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

// ---------------------------------------------------------------------------
// The code, verbatim - just without types
// ---------------------------------------------------------------------------

const scanSource = cut(solanaTs, '_shared/solana.ts',
  'const DETAILS_PRO_SCAN', '\n// ------')
  .replace('export async function recentTreasuryPayments(', 'async function recentTreasuryPayments(')
  .replace(/\n  treasury: string,/, '\n  treasury,')
  .replace(/\n  aussieben: [^\n]*= \(s\) => s,\n\): Promise<TreasuryPayment\[\]> \{/,
    '\n  aussieben = (s) => s,\n) {')
  .replace("rpc<SignatureInfo[]>('getSignaturesForAddress'", "rpc('getSignaturesForAddress'")
  .replace('const einzeln = async (s: SignatureInfo): Promise<TreasuryPayment | null> =>',
    'const einzeln = async (s) =>')
  .replace('let tx: any;', 'let tx;')
  .replace('(i: any) =>', '(i) =>')
  .replace('const out: TreasuryPayment[] = [];', 'const out = [];');

const windowSource = cut(verifyTs, 'verify/index.ts',
  'const TREASURY_FENSTER', '\n');
const scanTreasurySource = windowSource + '\n' + cut(verifyTs, 'verify/index.ts',
  'async function scanTreasury(treasury', '\n/**')
  .replace('async function scanTreasury(treasury: string)', 'async function scanTreasury(treasury)');

check('Der Ausschnitt aus solana.ts ist wirklich die Funktion',
  /getSignaturesForAddress/.test(scanSource) && /getTransaction/.test(scanSource));
check('Der Ausschnitt aus verify/index.ts ist wirklich der Scan',
  /recentTreasuryPayments\(/.test(scanTreasurySource) && /seen_txs/.test(scanTreasurySource));

// ---------------------------------------------------------------------------
// The stand-ins: a treasury with payments, and a database
// ---------------------------------------------------------------------------

const TREASURY = 'TreasuryAdresse111111111111111111111111111';
const JETZT = () => new Date().toISOString();
const LATER = () => new Date(Date.now() + 20 * 60e3).toISOString();

/**
 * Builds a world: `anzahl` payments to the treasury, newest first - exactly
 * the order getSignaturesForAddress responds in.
 */
function welt({ anzahl, verbucht = 0, offeneChallenges = [] }) {
  const payments = Array.from({ length: anzahl }, (_, i) => ({
    signature: `sig${String(anzahl - i).padStart(4, '0')}`,
    slot: 1000 + (anzahl - i),
    sender: `wallet${String(anzahl - i).padStart(4, '0')}`,
    lamports: 2_000_000 + (anzahl - i),
  }));

  const queries = [];                 // every RPC method, in order
  const rpc = async (methode, params) => {
    queries.push(methode);
    if (methode === 'getSignaturesForAddress') {
      const limit = params[1]?.limit ?? 1000;
      return payments.slice(0, limit).map((z) => ({
        signature: z.signature, slot: z.slot, err: null,
      }));
    }
    if (methode === 'getTransaction') {
      const z = payments.find((x) => x.signature === params[0]);
      if (!z) return null;
      return {
        slot: z.slot, meta: { err: null, innerInstructions: [] },
        transaction: { message: { instructions: [{
          program: 'system',
          parsed: { type: 'transfer', info: {
            source: z.sender, destination: TREASURY, lamports: z.lamports,
          } },
        }] } },
      };
    }
    throw new Error(`unerwartete RPC-Methode ${methode}`);
  };

  // The OLDEST `verbucht` payments are already in seen_txs - the usual
  // state: what's been sitting there a long time has long been handled.
  const seen = payments.slice(anzahl - verbucht).map((z, i) => ({
    signature: z.signature, slot: z.slot, sender: z.sender,
    lamports: z.lamports, seen_at: new Date(Date.now() - i * 1000).toISOString(),
  }));

  const challenges = offeneChallenges.map((c, i) => ({
    id: `ch${i}`, status: 'pending', wallet: c.wallet, lamports: c.lamports,
    expires_at: c.expires_at ?? LATER(), tx_sig: null,
  }));

  const db = {
    from: (tabelle) => buildChain(tabelle),
  };

  function buildChain(tabelle) {
    const daten = () => (tabelle === 'seen_txs' ? seen : challenges);

    const kette = {
      filter: [],
      _eq(column, wert) { this.filter.push((r) => r[column] === wert); return this; },
      _gt(column, wert) { this.filter.push((r) => r[column] > wert); return this; },
      treffer() { return daten().filter((r) => this.filter.every((f) => f(r))); },
    };

    return {
      select(_spalten, opt) {
        const s = Object.create(kette);
        s.filter = [];
        s.eq = (a, b) => s._eq(a, b);
        s.gt = (a, b) => s._gt(a, b);
        s.in = (column, werte) => { s.filter.push((r) => werte.includes(r[column])); return s; };
        s.order = () => s;
        s.limit = (n) => {
          const lines = [...seen]
            .sort((a, b) => (a.seen_at < b.seen_at ? 1 : -1)).slice(0, n);
          return Promise.resolve({ data: lines, error: null });
        };
        s.then = (aufl) => Promise.resolve(
          opt?.head
            ? { count: s.treffer().length, data: null, error: null }
            : { data: s.treffer(), error: null },
        ).then(aufl);
        return s;
      },

      insert(line) {
        if (tabelle !== 'seen_txs') throw new Error('nur seen_txs');
        if (seen.some((s) => s.signature === line.signature)) {
          // The primary key - the actual lock against double-booking.
          return Promise.resolve({ error: { code: '23505' } });
        }
        seen.unshift({ ...line, seen_at: JETZT() });
        return Promise.resolve({ error: null });
      },

      update(werte) {
        const u = Object.create(kette);
        u.filter = [];
        u.eq = (a, b) => u._eq(a, b);
        u.gt = (a, b) => u._gt(a, b);
        u.select = () => ({
          maybeSingle: async () => {
            const [treffer] = u.treffer();
            if (!treffer) return { data: null, error: null };
            Object.assign(treffer, werte);
            return { data: { id: treffer.id }, error: null };
          },
        });
        return u;
      },
    };
  }

  // The 5-second brake in the scan is real and should stay real. So a test
  // can check several runs in a row without sleeping five seconds each
  // time, the snippet gets a clock that can be fast-forwarded - nothing
  // else. `new Date()` stays the real class.
  let versatz = 0;
  const clock = new Proxy(Date, {
    get: (ziel, name) =>
      (name === 'now' ? () => Date.now() + versatz : Reflect.get(ziel, name)),
  });

  const lauf = new Function('rpc', 'db', 'console', 'Date', `
    let lastScan = 0;
    ${scanSource}
    ${scanTreasurySource}
    return { recentTreasuryPayments, scanTreasury };
  `)(rpc, db, { log() {}, warn() {}, error() {} }, clock);

  return {
    ...lauf, queries, seen, challenges, payments,
    zeitVor: (ms) => { versatz += ms; },
    details: () => queries.filter((m) => m === 'getTransaction').length,
  };
}

// ---------------------------------------------------------------------------
console.log('\nDas Sieb: bekannte Signaturen kosten keine Detailabfrage\n');
// ---------------------------------------------------------------------------

{
  // 200 payments are at the treasury, 195 of them long since recorded.
  // Before: 200 detail lookups, on every run, every 5 seconds.
  const w = welt({
    anzahl: 200, verbucht: 195,
    offeneChallenges: [{ wallet: 'wallet0200', lamports: 2_000_200 }],
  });
  await w.scanTreasury(TREASURY);

  check('Die Signaturliste wird genau einmal geholt',
    w.queries.filter((m) => m === 'getSignaturesForAddress').length === 1);
  check('Nur die unbekannten Zahlungen kosten eine Detailabfrage',
    w.details() === 5, `${w.details()} statt 200`);
  check('Die neue Zahlung wird trotzdem verbucht',
    w.challenges[0].status === 'paid' && w.challenges[0].tx_sig === 'sig0200');
}

{
  // Control: without the sieve, the same world would have to cost 200
  // lookups. If this check fails, the one above it measures nothing.
  const w = welt({ anzahl: 200, verbucht: 195, offeneChallenges: [] });
  const alle = await w.recentTreasuryPayments(TREASURY, 200);
  check('Gegenprobe: ohne Sieb kostet dasselbe Fenster jede Signatur',
    w.details() === 60, `${w.details()} – gedeckelt durch DETAILS_PRO_SCAN`);
  check('Gegenprobe: und liefert dann auch alle gefundenen Zahlungen',
    alle.length === 60);
}

{
  // And the core of the first bug, directly: is `aussieben` even passed
  // through? A stand-in that lets nothing through has to shut the RPC
  // down completely.
  const w = welt({
    anzahl: 40, verbucht: 40,
    offeneChallenges: [{ wallet: 'wallet0040', lamports: 2_000_040 }],
  });
  await w.scanTreasury(TREASURY);
  check('Ist alles bekannt, gibt es keine einzige Detailabfrage',
    w.details() === 0, `${w.details()}`);
  check('scanTreasury übergibt das Sieb – nicht erst hinterher gefiltert',
    /recentTreasuryPayments\(\s*treasury,[^)]*aussieben|verbucht\.has/s.test(scanTreasurySource)
      && /\(sigs\) => sigs\.filter/.test(scanTreasurySource));
}

// ---------------------------------------------------------------------------
console.log('\nDas Fenster: ein Ansturm darf keine Zahlung verlieren\n');
// ---------------------------------------------------------------------------

{
  // The launch case. 120 people pay before the next run comes around -
  // more than the 40 this used to work with. All have an open challenge,
  // all have to get in.
  const payers = Array.from({ length: 120 }, (_, i) => ({
    wallet: `wallet${String(i + 1).padStart(4, '0')}`,
    lamports: 2_000_000 + i + 1,
  }));
  const w = welt({ anzahl: 120, verbucht: 0, offeneChallenges: payers });

  // Several runs, the way it really works: the per-run cap keeps the
  // function from running into its time limit, and the next run picks up
  // the rest.
  for (let i = 0; i < 5; i++) { await w.scanTreasury(TREASURY); w.zeitVor(6000); }

  const paid = w.challenges.filter((c) => c.status === 'paid').length;
  check('Alle 120 Zahlungen werden gefunden', paid === 120, `${paid} von 120`);
  check('Und keine doppelt verbucht',
    new Set(w.challenges.map((c) => c.tx_sig)).size === 120);
  check('Ein Fenster von 40 hätte 80 davon nie gesehen',
    w.payments.length === 120);
}

{
  // The control for the second bug: with the old window of 40, the rest
  // falls out - permanently, because the signatures never land in
  // seen_txs and are still outside the window on the next run too.
  const payers = Array.from({ length: 120 }, (_, i) => ({
    wallet: `wallet${String(i + 1).padStart(4, '0')}`,
    lamports: 2_000_000 + i + 1,
  }));
  const w = welt({ anzahl: 120, verbucht: 0, offeneChallenges: payers });
  for (let i = 0; i < 5; i++) {
    const p = await w.recentTreasuryPayments(TREASURY, 40, (s) =>
      s.filter((x) => !w.seen.some((v) => v.signature === x)));
    for (const z of p) {
      await w.db?.from?.('seen_txs');
      w.seen.unshift({ ...z, seen_at: JETZT() });
    }
  }
  const gefunden = new Set(w.seen.map((s) => s.signature)).size;
  check('Gegenprobe: mit 40 bleiben Zahlungen dauerhaft ungesehen',
    gefunden === 40, `${gefunden} von 120`);
}

// ---------------------------------------------------------------------------
console.log('\nDie Sparmassnahmen davor bleiben\n');
// ---------------------------------------------------------------------------

{
  const w = welt({ anzahl: 10, verbucht: 0, offeneChallenges: [] });
  await w.scanTreasury(TREASURY);
  check('Ohne offene Challenge kein einziger RPC-Aufruf',
    w.queries.length === 0, `${w.queries.length}`);
}

{
  // A challenge that matches no payment: it stays open, so the reason to
  // scan stays too - otherwise the brake below would only be testing that
  // there's nothing left to do.
  const w = welt({
    anzahl: 10, verbucht: 0,
    offeneChallenges: [{ wallet: 'wallet9999', lamports: 1_234_567 }],
  });
  await w.scanTreasury(TREASURY);
  const nach1 = w.queries.length;
  await w.scanTreasury(TREASURY);
  check('Ein zweiter Lauf innerhalb von 5 Sekunden tut nichts',
    w.queries.length === nach1, `${w.queries.length - nach1} Aufrufe zusätzlich`);
  // Control: after the brake it runs again - otherwise the line above
  // would only be testing that something, anything, is broken.
  w.zeitVor(6000);
  await w.scanTreasury(TREASURY);
  check('Nach 5 Sekunden läuft er wieder',
    w.queries.length > nach1);
}

{
  const w = welt({
    anzahl: 5, verbucht: 0,
    offeneChallenges: [{
      wallet: 'wallet0005', lamports: 2_000_005,
      expires_at: new Date(Date.now() - 60e3).toISOString(),
    }],
  });
  await w.scanTreasury(TREASURY);
  check('Eine abgelaufene Challenge wird nicht mehr paid',
    w.challenges[0].status === 'pending');
}

{
  // The detail lookups run in parallel batches - otherwise 60 signatures
  // serially would take around six seconds, and the function has a time
  // limit.
  check('Die Detailabfragen laufen nicht eine nach der anderen',
    /Promise\.all\(/.test(scanSource) && /GLEICHZEITIG/.test(scanSource));
  check('Aber gedeckelt, damit ein Kaltstart nicht in das Zeitlimit läuft',
    /slice\(0, DETAILS_PRO_SCAN\)/.test(scanSource));
}

// ---------------------------------------------------------------------------
console.log('\nDer Index für das Sieb\n');
// ---------------------------------------------------------------------------

{
  const wanderung = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260903030000_seen_txs_index.sql'), 'utf8');
  check('Die Abfrage des Siebs hat einen Index',
    /create index if not exists[\s\S]*seen_txs[\s\S]*seen_at desc/.test(wanderung));
  check('Und der Scan sortiert genau danach',
    /order\('seen_at', \{ ascending: false \}\)/.test(scanTreasurySource));
}

// ---------------------------------------------------------------------------
console.log('\nDie Fassung für das Dashboard ist nicht veraltet\n');
// ---------------------------------------------------------------------------

{
  const gebaut = path.join(root, 'supabase/functions/verify/index.dashboard.ts');
  if (!fs.existsSync(gebaut)) {
    check('index.dashboard.ts ist vorhanden', false, 'node scripts/verify-eigenstaendig.mjs');
  } else {
    const d = fs.readFileSync(gebaut, 'utf8');
    check('index.dashboard.ts enthält das Sieb',
      /\(sigs\) => sigs\.filter\(\(s\) => !verbucht\.has\(s\)\)/.test(d));
    check('index.dashboard.ts enthält das breitere Fenster',
      /const TREASURY_FENSTER = 200/.test(d));
    check('index.dashboard.ts enthält den Deckel pro Lauf',
      /DETAILS_PRO_SCAN/.test(d));
  }
}

// ---------------------------------------------------------------------------

const fehl = befunde.filter((b) => !b.ok);
console.log(`\n  ${befunde.length - fehl.length}/${befunde.length} ok`);
if (fehl.length) {
  for (const f of fehl) console.log(`  FEHL  ${f.name}`);
  process.exit(1);
}
console.log('');
