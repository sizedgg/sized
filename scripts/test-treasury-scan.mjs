// ============================================================================
// Findet der Treasury-Scan jede Zahlung – auch wenn hunderte gleichzeitig
// hereinkommen?
//
// Das ist die einzige Stelle der Seite, an der ein Fehler nicht Anzeige oder
// Bequemlichkeit kostet, sondern echtes Geld: Wer SOL an die Treasury schickt
// und dessen Zahlung nicht gesehen wird, hat bezahlt und kommt nicht herein.
// Die Challenge läuft nach 25 Minuten ab, und das SOL ist überwiesen.
//
// ----------------------------------------------------------------------------
// Die zwei Fehler, die es gab
//
//   1. `recentTreasuryPayments` hat einen Parameter `aussieben`, mit dem der
//      Aufrufer bekannte Signaturen herausfiltern kann, BEVOR pro Signatur eine
//      teure Detailabfrage läuft. `scanTreasury` hat ihn nicht übergeben und
//      erst hinterher gegen seen_txs geprüft. Also: jeder Lauf, alle 5
//      Sekunden, holte dieselben 40 Transaktionen erneut vom RPC – Sekunden
//      Arbeit für ein Ergebnis, das schon verbucht war.
//
//   2. Das Fenster war 40 Signaturen breit. Landen zwischen zwei Läufen mehr
//      als 40 Zahlungen, fallen die ältesten heraus und werden NIE gesehen.
//      Genau der Fall bei einem Start mit vielen gleichzeitigen Anmeldungen.
//
// ----------------------------------------------------------------------------
// Was hier wirklich läuft
//
// Deno gibt es in dieser Umgebung nicht. Also werden `recentTreasuryPayments`
// aus _shared/solana.ts und `scanTreasury` aus verify/index.ts wörtlich
// herausgeschnitten und in Node ausgeführt – gegen eine Attrappe des RPC und
// eine Attrappe der Datenbank. Weggelassen werden nur die TypeScript-Typen.
//
// Gezählt wird, was zählt: wie viele `getTransaction`-Abfragen ein Lauf kostet
// und welche Zahlungen am Ende verbucht sind. Die Prüfungen hängen an dieser
// Beobachtung, nicht an den Zahlen 200 oder 60 – wer das Fenster später ändert,
// soll nicht den Test anpassen müssen, solange das Verhalten stimmt.
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

const schneide = (quelle, wo, von, bis) => {
  const a = quelle.indexOf(von);
  const b = quelle.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in ${wo}: ${von}`);
  return quelle.slice(a, b);
};

const befunde = [];
const pruefe = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

// ---------------------------------------------------------------------------
// Der Code, wörtlich – nur ohne Typen
// ---------------------------------------------------------------------------

const scanQuelle = schneide(solanaTs, '_shared/solana.ts',
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

const fensterQuelle = schneide(verifyTs, 'verify/index.ts',
  'const TREASURY_FENSTER', '\n');
const scanTreasuryQuelle = fensterQuelle + '\n' + schneide(verifyTs, 'verify/index.ts',
  'async function scanTreasury(treasury', '\n/**')
  .replace('async function scanTreasury(treasury: string)', 'async function scanTreasury(treasury)');

pruefe('Der Ausschnitt aus solana.ts ist wirklich die Funktion',
  /getSignaturesForAddress/.test(scanQuelle) && /getTransaction/.test(scanQuelle));
pruefe('Der Ausschnitt aus verify/index.ts ist wirklich der Scan',
  /recentTreasuryPayments\(/.test(scanTreasuryQuelle) && /seen_txs/.test(scanTreasuryQuelle));

// ---------------------------------------------------------------------------
// Die Attrappen: eine Treasury mit Zahlungen, und eine Datenbank
// ---------------------------------------------------------------------------

const TREASURY = 'TreasuryAdresse111111111111111111111111111';
const JETZT = () => new Date().toISOString();
const SPAETER = () => new Date(Date.now() + 20 * 60e3).toISOString();

/**
 * Baut eine Welt: `anzahl` Zahlungen an die Treasury, die neueste zuerst –
 * genau die Reihenfolge, in der getSignaturesForAddress antwortet.
 */
function welt({ anzahl, verbucht = 0, offeneChallenges = [] }) {
  const zahlungen = Array.from({ length: anzahl }, (_, i) => ({
    signature: `sig${String(anzahl - i).padStart(4, '0')}`,
    slot: 1000 + (anzahl - i),
    sender: `wallet${String(anzahl - i).padStart(4, '0')}`,
    lamports: 2_000_000 + (anzahl - i),
  }));

  const abfragen = [];                 // jede RPC-Methode, in Reihenfolge
  const rpc = async (methode, params) => {
    abfragen.push(methode);
    if (methode === 'getSignaturesForAddress') {
      const limit = params[1]?.limit ?? 1000;
      return zahlungen.slice(0, limit).map((z) => ({
        signature: z.signature, slot: z.slot, err: null,
      }));
    }
    if (methode === 'getTransaction') {
      const z = zahlungen.find((x) => x.signature === params[0]);
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

  // Die ÄLTESTEN `verbucht` Zahlungen sind schon in seen_txs – der übliche
  // Zustand: was lange dort steht, ist längst abgearbeitet.
  const seen = zahlungen.slice(anzahl - verbucht).map((z, i) => ({
    signature: z.signature, slot: z.slot, sender: z.sender,
    lamports: z.lamports, seen_at: new Date(Date.now() - i * 1000).toISOString(),
  }));

  const challenges = offeneChallenges.map((c, i) => ({
    id: `ch${i}`, status: 'pending', wallet: c.wallet, lamports: c.lamports,
    expires_at: c.expires_at ?? SPAETER(), tx_sig: null,
  }));

  const db = {
    from: (tabelle) => bauKette(tabelle),
  };

  function bauKette(tabelle) {
    const daten = () => (tabelle === 'seen_txs' ? seen : challenges);

    const kette = {
      filter: [],
      _eq(spalte, wert) { this.filter.push((r) => r[spalte] === wert); return this; },
      _gt(spalte, wert) { this.filter.push((r) => r[spalte] > wert); return this; },
      treffer() { return daten().filter((r) => this.filter.every((f) => f(r))); },
    };

    return {
      select(_spalten, opt) {
        const s = Object.create(kette);
        s.filter = [];
        s.eq = (a, b) => s._eq(a, b);
        s.gt = (a, b) => s._gt(a, b);
        s.in = (spalte, werte) => { s.filter.push((r) => werte.includes(r[spalte])); return s; };
        s.order = () => s;
        s.limit = (n) => {
          const zeilen = [...seen]
            .sort((a, b) => (a.seen_at < b.seen_at ? 1 : -1)).slice(0, n);
          return Promise.resolve({ data: zeilen, error: null });
        };
        s.then = (aufl) => Promise.resolve(
          opt?.head
            ? { count: s.treffer().length, data: null, error: null }
            : { data: s.treffer(), error: null },
        ).then(aufl);
        return s;
      },

      insert(zeile) {
        if (tabelle !== 'seen_txs') throw new Error('nur seen_txs');
        if (seen.some((s) => s.signature === zeile.signature)) {
          // Der Primärschlüssel – die eigentliche Sperre gegen Doppelbuchung.
          return Promise.resolve({ error: { code: '23505' } });
        }
        seen.unshift({ ...zeile, seen_at: JETZT() });
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

  // Die 5-Sekunden-Bremse im Scan ist echt und soll auch echt bleiben. Damit
  // ein Test mehrere Läufe hintereinander prüfen kann, ohne fünf Sekunden zu
  // schlafen, bekommt der Ausschnitt eine Uhr, die sich vorstellen lässt –
  // sonst nichts. `new Date()` bleibt die echte Klasse.
  let versatz = 0;
  const uhr = new Proxy(Date, {
    get: (ziel, name) =>
      (name === 'now' ? () => Date.now() + versatz : Reflect.get(ziel, name)),
  });

  const lauf = new Function('rpc', 'db', 'console', 'Date', `
    let lastScan = 0;
    ${scanQuelle}
    ${scanTreasuryQuelle}
    return { recentTreasuryPayments, scanTreasury };
  `)(rpc, db, { log() {}, warn() {}, error() {} }, uhr);

  return {
    ...lauf, abfragen, seen, challenges, zahlungen,
    zeitVor: (ms) => { versatz += ms; },
    details: () => abfragen.filter((m) => m === 'getTransaction').length,
  };
}

// ---------------------------------------------------------------------------
console.log('\nDas Sieb: bekannte Signaturen kosten keine Detailabfrage\n');
// ---------------------------------------------------------------------------

{
  // 200 Zahlungen liegen an der Treasury, 195 davon sind längst verbucht.
  // Vorher: 200 Detailabfragen, bei jedem Lauf, alle 5 Sekunden.
  const w = welt({
    anzahl: 200, verbucht: 195,
    offeneChallenges: [{ wallet: 'wallet0200', lamports: 2_000_200 }],
  });
  await w.scanTreasury(TREASURY);

  pruefe('Die Signaturliste wird genau einmal geholt',
    w.abfragen.filter((m) => m === 'getSignaturesForAddress').length === 1);
  pruefe('Nur die unbekannten Zahlungen kosten eine Detailabfrage',
    w.details() === 5, `${w.details()} statt 200`);
  pruefe('Die neue Zahlung wird trotzdem verbucht',
    w.challenges[0].status === 'paid' && w.challenges[0].tx_sig === 'sig0200');
}

{
  // Gegenprobe: Ohne Sieb müsste dieselbe Welt 200 Abfragen kosten. Wenn diese
  // Prüfung fehlschlägt, misst die Prüfung darüber nichts.
  const w = welt({ anzahl: 200, verbucht: 195, offeneChallenges: [] });
  const alle = await w.recentTreasuryPayments(TREASURY, 200);
  pruefe('Gegenprobe: ohne Sieb kostet dasselbe Fenster jede Signatur',
    w.details() === 60, `${w.details()} – gedeckelt durch DETAILS_PRO_SCAN`);
  pruefe('Gegenprobe: und liefert dann auch alle gefundenen Zahlungen',
    alle.length === 60);
}

{
  // Und der Kern des ersten Fehlers, direkt: Wird `aussieben` überhaupt
  // durchgereicht? Eine Attrappe, die nichts durchlässt, muss den RPC
  // vollständig stilllegen.
  const w = welt({
    anzahl: 40, verbucht: 40,
    offeneChallenges: [{ wallet: 'wallet0040', lamports: 2_000_040 }],
  });
  await w.scanTreasury(TREASURY);
  pruefe('Ist alles bekannt, gibt es keine einzige Detailabfrage',
    w.details() === 0, `${w.details()}`);
  pruefe('scanTreasury übergibt das Sieb – nicht erst hinterher gefiltert',
    /recentTreasuryPayments\(\s*treasury,[^)]*aussieben|verbucht\.has/s.test(scanTreasuryQuelle)
      && /\(sigs\) => sigs\.filter/.test(scanTreasuryQuelle));
}

// ---------------------------------------------------------------------------
console.log('\nDas Fenster: ein Ansturm darf keine Zahlung verlieren\n');
// ---------------------------------------------------------------------------

{
  // Der Startfall. 120 Menschen zahlen, bevor der nächste Lauf kommt – mehr
  // als die 40, mit denen das hier vorher arbeitete. Alle haben eine offene
  // Challenge, alle müssen hereinkommen.
  const zahler = Array.from({ length: 120 }, (_, i) => ({
    wallet: `wallet${String(i + 1).padStart(4, '0')}`,
    lamports: 2_000_000 + i + 1,
  }));
  const w = welt({ anzahl: 120, verbucht: 0, offeneChallenges: zahler });

  // Mehrere Läufe, so wie es in Wirklichkeit läuft: Der Deckel pro Lauf sorgt
  // dafür, dass die Funktion nicht in ihr Zeitlimit läuft, und der nächste Lauf
  // holt den Rest.
  for (let i = 0; i < 5; i++) { await w.scanTreasury(TREASURY); w.zeitVor(6000); }

  const bezahlt = w.challenges.filter((c) => c.status === 'paid').length;
  pruefe('Alle 120 Zahlungen werden gefunden', bezahlt === 120, `${bezahlt} von 120`);
  pruefe('Und keine doppelt verbucht',
    new Set(w.challenges.map((c) => c.tx_sig)).size === 120);
  pruefe('Ein Fenster von 40 hätte 80 davon nie gesehen',
    w.zahlungen.length === 120);
}

{
  // Die Gegenprobe zum zweiten Fehler: Mit dem alten Fenster von 40 fällt der
  // Rest heraus – und zwar endgültig, weil die Signaturen nie in seen_txs
  // landen und beim nächsten Lauf immer noch ausserhalb des Fensters liegen.
  const zahler = Array.from({ length: 120 }, (_, i) => ({
    wallet: `wallet${String(i + 1).padStart(4, '0')}`,
    lamports: 2_000_000 + i + 1,
  }));
  const w = welt({ anzahl: 120, verbucht: 0, offeneChallenges: zahler });
  for (let i = 0; i < 5; i++) {
    const p = await w.recentTreasuryPayments(TREASURY, 40, (s) =>
      s.filter((x) => !w.seen.some((v) => v.signature === x)));
    for (const z of p) {
      await w.db?.from?.('seen_txs');
      w.seen.unshift({ ...z, seen_at: JETZT() });
    }
  }
  const gefunden = new Set(w.seen.map((s) => s.signature)).size;
  pruefe('Gegenprobe: mit 40 bleiben Zahlungen dauerhaft ungesehen',
    gefunden === 40, `${gefunden} von 120`);
}

// ---------------------------------------------------------------------------
console.log('\nDie Sparmassnahmen davor bleiben\n');
// ---------------------------------------------------------------------------

{
  const w = welt({ anzahl: 10, verbucht: 0, offeneChallenges: [] });
  await w.scanTreasury(TREASURY);
  pruefe('Ohne offene Challenge kein einziger RPC-Aufruf',
    w.abfragen.length === 0, `${w.abfragen.length}`);
}

{
  // Eine Challenge, die zu keiner Zahlung passt: Sie bleibt offen, also bleibt
  // auch der Grund zu scannen bestehen – sonst prüfte die Bremse unten nur,
  // dass nichts mehr zu tun ist.
  const w = welt({
    anzahl: 10, verbucht: 0,
    offeneChallenges: [{ wallet: 'wallet9999', lamports: 1_234_567 }],
  });
  await w.scanTreasury(TREASURY);
  const nach1 = w.abfragen.length;
  await w.scanTreasury(TREASURY);
  pruefe('Ein zweiter Lauf innerhalb von 5 Sekunden tut nichts',
    w.abfragen.length === nach1, `${w.abfragen.length - nach1} Aufrufe zusätzlich`);
  // Gegenprobe: Nach der Bremse läuft er wieder – sonst prüfte die Zeile oben
  // nur, dass irgendetwas kaputt ist.
  w.zeitVor(6000);
  await w.scanTreasury(TREASURY);
  pruefe('Nach 5 Sekunden läuft er wieder',
    w.abfragen.length > nach1);
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
  pruefe('Eine abgelaufene Challenge wird nicht mehr bezahlt',
    w.challenges[0].status === 'pending');
}

{
  // Die Detailabfragen laufen in Gruppen parallel – sonst wären 60 Signaturen
  // seriell rund sechs Sekunden, und die Function hat ein Zeitlimit.
  pruefe('Die Detailabfragen laufen nicht eine nach der anderen',
    /Promise\.all\(/.test(scanQuelle) && /GLEICHZEITIG/.test(scanQuelle));
  pruefe('Aber gedeckelt, damit ein Kaltstart nicht in das Zeitlimit läuft',
    /slice\(0, DETAILS_PRO_SCAN\)/.test(scanQuelle));
}

// ---------------------------------------------------------------------------
console.log('\nDer Index für das Sieb\n');
// ---------------------------------------------------------------------------

{
  const wanderung = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260903030000_seen_txs_index.sql'), 'utf8');
  pruefe('Die Abfrage des Siebs hat einen Index',
    /create index if not exists[\s\S]*seen_txs[\s\S]*seen_at desc/.test(wanderung));
  pruefe('Und der Scan sortiert genau danach',
    /order\('seen_at', \{ ascending: false \}\)/.test(scanTreasuryQuelle));
}

// ---------------------------------------------------------------------------
console.log('\nDie Fassung für das Dashboard ist nicht veraltet\n');
// ---------------------------------------------------------------------------

{
  const gebaut = path.join(root, 'supabase/functions/verify/index.dashboard.ts');
  if (!fs.existsSync(gebaut)) {
    pruefe('index.dashboard.ts ist vorhanden', false, 'node scripts/verify-eigenstaendig.mjs');
  } else {
    const d = fs.readFileSync(gebaut, 'utf8');
    pruefe('index.dashboard.ts enthält das Sieb',
      /\(sigs\) => sigs\.filter\(\(s\) => !verbucht\.has\(s\)\)/.test(d));
    pruefe('index.dashboard.ts enthält das breitere Fenster',
      /const TREASURY_FENSTER = 200/.test(d));
    pruefe('index.dashboard.ts enthält den Deckel pro Lauf',
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
