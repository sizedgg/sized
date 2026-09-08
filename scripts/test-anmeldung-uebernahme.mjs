// ============================================================================
// Can someone log in as Ansem without owning his wallet?
//
// Logging in is the most sensitive spot on the whole site. Whoever gets
// past it isn't just some user - they get the inbox, they create and delete
// polls, and they set the DM threshold. And because the site belongs to
// Ansem, the damage isn't technical, it's personal.
//
// ----------------------------------------------------------------------------
// The attack that existed
//
// When a challenge is created, whether the requester owns the wallet is NOT
// checked. That's intentional: the payment is the proof, so nobody needs to
// connect a wallet. The bug was elsewhere:
//
//   1. Attacker opens a challenge on ANSEM'S address. Costs nothing.
//   2. Ansem logs in. createChallenge found the open challenge via the
//      wallet and handed him the SAME one - meant to guard against paying
//      twice on a reload.
//   3. Ansem pays. The challenge becomes 'paid'.
//   4. The attacker queries the status with the same id and gets the JWT.
//      It carries Ansem's wallet, and app.is_admin() says yes.
//
// Ansem would not have done anything wrong in any of this.
//
// ----------------------------------------------------------------------------
// What actually runs here and what's only read
//
// Deno doesn't exist in this environment, so the Edge Function can't be
// started. Hence two levels, and the line between them is stated explicitly:
//
//   * ACTUALLY EXECUTED: the ownership check itself - newSecret,
//     abdruck, gleich and challengeWithSecret, cut verbatim out of
//     verify/index.ts and run against a small stand-in for the database.
//     That's the core the attack hinged on.
//
//   * READ: that checkStatus, mockPay and createChallenge actually use this
//     check too. A perfect check nobody calls is the more likely bug of the
//     two.
//
//   node scripts/test-anmeldung-uebernahme.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(
  path.join(root, 'supabase/functions/verify/index.ts'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');

const cut = (von, bis) => {
  const a = src.indexOf(von);
  const b = src.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in verify/index.ts: ${von}`);
  return src.slice(a, b);
};

const befunde = [];
const check = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

// ---------------------------------------------------------------------------
// The ownership check, verbatim - and executed
// ---------------------------------------------------------------------------
// The TypeScript types are the only thing dropped here; Node doesn't
// understand them. The body stays character for character that of the
// function.
const kern = cut('function newSecret(): string', '\nDeno.serve(')
  .replace(/function newSecret\(\): string/, 'function newSecret()')
  .replace(/async function abdruck\(geheimnis: string\): Promise<string>/, 'async function abdruck(geheimnis)')
  .replace(/function gleich\(a: string, b: string\): boolean/, 'function gleich(a, b)')
  .replace(/async function challengeWithSecret\(id: unknown, geheimnis: unknown\)/,
    'async function challengeWithSecret(id, geheimnis)');

// The stand-in: a map, and exactly the chain the function uses.
const lines = new Map();
const db = {
  from: () => ({
    select: () => ({
      eq: (_spalte, wert) => ({ maybeSingle: async () => ({ data: lines.get(wert) ?? null }) }),
    }),
  }),
};

const lauf = new Function('db', 'crypto', 'TextEncoder', `
  ${kern}
  return { newSecret, abdruck, gleich, challengeWithSecret };
`)(db, globalThis.crypto, TextEncoder);

console.log('\nDas Geheimnis selbst\n');

const g1 = lauf.newSecret();
const g2 = lauf.newSecret();
check('Das Geheimnis ist 64 Hexzeichen long (32 Byte)',
  /^[0-9a-f]{64}$/.test(g1), `${g1.length} Zeichen`);
check('Zwei Geheimnisse sind verschieden', g1 !== g2);
// Not Math.random: that's predictable once you've seen enough values, and
// here a login hangs off it.
check('Es kommt aus dem Zufallsgenerator für Kryptografie, nicht aus Math.random',
  /crypto\.getRandomValues/.test(kern) && !/Math\.random/.test(kern));

const a1 = await lauf.abdruck(g1);
check('Der Abdruck ist ein SHA-256 in Hex', /^[0-9a-f]{64}$/.test(a1));
check('Derselbe Wert ergibt denselben Abdruck', (await lauf.abdruck(g1)) === a1);
check('Ein anderer einen anderen', (await lauf.abdruck(g2)) !== a1);
// Counter-check against a known value - otherwise the test only checks that
// the function agrees with itself.
check('Und es ist wirklich SHA-256',
  (await lauf.abdruck('abc'))
    === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

check('Der Vergleich bricht nicht beim ersten Unterschied ab',
  /diff \|=/.test(kern) && !/return a === b/.test(kern));

// ---------------------------------------------------------------------------
console.log('\nDer Angriff\n');

const ANSEM = 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw';

// Step 1: the attacker opens a challenge on Ansem's address. That's still
// allowed - and should be: without a wallet connection, nobody can prove who
// an address belongs to. The payment is the proof.
const angreiferGeheimnis = lauf.newSecret();
lines.set('challenge-des-angreifers', {
  id: 'challenge-des-angreifers',
  wallet: ANSEM,
  lamports: 2_042_779,
  status: 'pending',
  secret_hash: await lauf.abdruck(angreiferGeheimnis),
  expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
});

check('Eine Challenge auf eine fremde Adresse anzulegen bleibt erlaubt',
  lines.has('challenge-des-angreifers'));

// Step 2 was the break: Ansem's login got back the same challenge.
// createChallenge now only continues with the matching secret - and only
// the attacker has that.
const next = cut('  if (weiterId) {', '  const expiresAt =');
check('Fortgesetzt wird nur mit dem eigenen Geheimnis',
  /challengeWithSecret\(weiterId, weiterGeheimnis\)/.test(next));
check('Und nur die eigene Wallet und nur solange sie läuft',
  /c\.wallet === wallet/.test(next) && /c\.status === 'pending'/.test(next)
  && /expires_at\)\.getTime\(\) > Date\.now\(\)/.test(next));
// Die Zeile, die den Angriff moeglich machte: eine Suche allein ueber die
// Wallet, deren Ergebnis dem Aufrufer ZURUECKGEGEBEN wurde.
//
// Ein blosses Verbot von "wallet + pending" im Quelltext trifft es nicht
// mehr: seit der Raeumung des aeltesten offenen Fensters (P0001) gibt es so
// eine Suche wieder, und sie ist richtig. Der Unterschied ist, was danach
// mit der Zeile passiert. Also wird genau das geprueft - jede Suche dieser
// Form holt nur die Kennung und schreibt sie auf 'expired'; keine holt eine
// ganze Zeile, aus der eine Anmeldung werden koennte.
const walletSuchen = [...src.matchAll(/\.select\((.{1,8}?)\)\s*\.eq\('wallet', wallet\)\s*\.eq\('status', 'pending'\)([\s\S]{0,320})/g)];
check('Keine Suche allein über die Wallet gibt eine Challenge heraus',
  walletSuchen.every((m) => m[1] === "'id'" && /update\(\{ status: 'expired' \}\)/.test(m[2])),
  `${walletSuchen.length} Suche(n), alle nur zum Räumen`);
// Gegenprobe: die alte Form - eine ganze Zeile ueber die Wallet - gibt es
// nirgends mehr. Ohne diese Zeile wuerde die Pruefung oben auch bestehen,
// wenn die Suche gar nicht existierte.
check('Und die alte Wiederverwendung über die Wallet ist weg',
  !/\.select\('\*'\)\s*\.eq\('wallet', wallet\)/.test(src));

// Und die Raeumung fasst nur an, was noch LAEUFT.
//
// Sie holt die aelteste offene Zeile dieser Wallet und setzt sie auf
// 'expired', damit die Obergrenze niemanden aussperrt. Ohne die Zeitgrenze
// traf das auch eine Zeile im Nachlauf - also eine abgelaufene, deren spaet
// bestaetigte Zahlung noch zugeordnet werden soll. Genau die haette dabei ihr
// Geld verloren. Eine laufende gibt es immer: die Obergrenze zaehlt nur
// laufende Fenster, sie kann ohne drei davon gar nicht greifen.
check('Geräumt wird nur eine Challenge, die noch läuft',
  walletSuchen.every((m) => /\.gt\('expires_at', new Date\(\)\.toISOString\(\)\)/.test(m[2])));

// Step 4: with just the id, nobody gets at the proof any more.
lines.get('challenge-des-angreifers').status = 'paid';

check('Mit der Kennung allein gibt es nichts',
  (await lauf.challengeWithSecret('challenge-des-angreifers', undefined)) === null);
check('Mit einem falschen Geheimnis auch nicht',
  (await lauf.challengeWithSecret('challenge-des-angreifers', lauf.newSecret())) === null);
// A secret of the right LENGTH, but wrong - otherwise the length check above
// alone could make this test pass.
check('Und auch nicht mit einem, das nur richtig aussieht',
  (await lauf.challengeWithSecret('challenge-des-angreifers', 'f'.repeat(64))) === null);
check('Mit dem richtigen schon – sonst prüfte hier nichts',
  (await lauf.challengeWithSecret('challenge-des-angreifers', angreiferGeheimnis))?.id
    === 'challenge-des-angreifers');
check('Eine unbekannte Kennung ergibt dieselbe Absage wie ein falsches Geheimnis',
  (await lauf.challengeWithSecret('gibt-es-nicht-12345', angreiferGeheimnis)) === null);

// Zeilen aus der Zeit vor den Geheimnissen: keine ist einloesbar, auch die
// bezahlte nicht.
//
// Hier stand das Gegenteil: eine BEZAHLTE ohne Fingerabdruck durfte noch
// durch, weil dort Geld geflossen ist. Das war dieselbe Luecke nochmal - fuer
// so eine Zeile genuegt die Kennung plus irgendeine Zeichenkette ab 32
// Zeichen, und die Kennung hatte damals auch der, der das Fenster fuer eine
// FREMDE Adresse aufgemacht hat. Wer noch so eine Zahlung hat, bekommt sie
// von Hand gutgeschrieben.
lines.set('alt-offen', { id: 'alt-offen', wallet: ANSEM, status: 'pending', secret_hash: null });
lines.set('alt-bezahlt', { id: 'alt-bezahlt', wallet: ANSEM, status: 'paid', secret_hash: null });
check('Eine offene Challenge aus der Zeit ohne Geheimnis ist wertlos',
  (await lauf.challengeWithSecret('alt-offen', lauf.newSecret())) === null);
check('Eine BEZAHLTE ohne Fingerabdruck ebenfalls – auch sie ist nicht einlösbar',
  (await lauf.challengeWithSecret('alt-bezahlt', lauf.newSecret())) === null);
// Gegenprobe: es ist wirklich der fehlende Fingerabdruck, der sie sperrt,
// nicht etwa der Status 'paid'. Sonst haette die Zeile oben mit
// 'challenge-des-angreifers' (auch 'paid') nicht bestehen koennen.
const abdruckDa = await lauf.abdruck(g1);
lines.set('neu-bezahlt', { id: 'neu-bezahlt', wallet: ANSEM, status: 'paid', secret_hash: abdruckDa });
check('Eine bezahlte MIT Fingerabdruck geht durch – gesperrt ist der fehlende Abdruck',
  (await lauf.challengeWithSecret('neu-bezahlt', g1))?.id === 'neu-bezahlt');

// ---------------------------------------------------------------------------
console.log('\nWird die Prüfung auch benutzt?\n');
//
// The more likely bug isn't a bad check, it's a good one that got forgotten
// at one spot.

const statusFn = cut('async function checkStatus(', 'async function scanTreasury(treasury: string) {');
check('checkStatus holt die Challenge über die Prüfung',
  /await challengeWithSecret\(id, geheimnis\)/.test(statusFn));
check('Und liest sie nirgends mehr direkt über die Kennung',
  !/from\('challenges'\)\s*\.select\('\*'\)\.eq\('id', id\)/.test(statusFn));

const mockFn = cut('async function mockPay(', '\n}');
check('mock-pay verlangt es ebenfalls',
  /await challengeWithSecret\(id, geheimnis\)/.test(mockFn));

// And it's only allowed to go out at ONE spot.
const stellen = (src.match(/secret: /g) || []).length;
check('Das Geheimnis wird an genau einer Stelle ausgeliefert', stellen === 1,
  `${stellen} Stelle(n)`);
check('In der Datenbank steht nur der Abdruck, nie das Geheimnis',
  /secret_hash/.test(src) && !/insert\(\{[^}]*secret:/.test(src));

// The JWT doesn't decide admin rights on its own - the wallet does. Important
// for the question "can someone log in as Ansem": even a forged is_admin in
// the token gets you nowhere as long as the wallet doesn't match.
check('Adminrechte kommen aus der Konfiguration, nicht aus dem alten Token',
  /const isAdmin = Boolean\(cfg\.admin_wallet\) && c\.wallet === cfg\.admin_wallet/.test(src)
  && /const isAdmin = Boolean\(cfg\.admin_wallet\) && claims\.wallet === cfg\.admin_wallet/.test(src));

// ---------------------------------------------------------------------------
console.log('\nDie Seite führt es mit\n');
//
// Without this, the lock would be a step backwards: whoever loses their
// secret on a reload would get a second challenge with a second amount and
// pay twice.
check('Die laufende Anmeldung wird gemerkt',
  /const CHALLENGE_KEY = 'ansem_challenge'/.test(appJs)
  && /rememberChallenge\(c\)/.test(appJs));
check('Und beim nächsten Versuch für dieselbe Adresse fortgesetzt',
  /challengeId: next\.challengeId, secret: next\.secret/.test(appJs));
check('Die Statusabfrage schickt das Geheimnis mit',
  /action: 'status', challengeId: id, secret: geheimnis/.test(appJs));
check('Nach der Anmeldung wird es weggeräumt',
  /stopPolling\(\);\s*\n\s*forgetChallenge\(\);/.test(appJs));

// ---------------------------------------------------------------------------
console.log('\nDie Fassung fürs Dashboard\n');
//
// verify isn't rolled out via the CLI, it's pasted into the dashboard
// editor - there the neighboring files don't exist. The standalone version
// is built from the same source (scripts/verify-eigenstaendig.mjs).
//
// What's checked here isn't its content, but that it's NOT out of date. A
// stale version in the editor would be the worst kind of bug: the code in
// the project is fixed, the running function isn't, and each looks correct
// on its own.
const dashPfad = path.join(root, 'supabase/functions/verify/index.dashboard.ts');
if (!fs.existsSync(dashPfad)) {
  check('Die Fassung fürs Dashboard ist gebaut', false,
    'node scripts/verify-eigenstaendig.mjs');
} else {
  const dash = fs.readFileSync(dashPfad, 'utf8');
  check('Sie enthält keine relativen Importe',
    !/from\s+'\.[^']*'/.test(dash));
  // The body of every file has to be in there verbatim. Compared via one
  // distinctive line per source rather than the whole thing - the header
  // and the export keywords drop out during the build, so a character-for-
  // character comparison would always fail.
  const merkmale = [
    ['verify/index.ts', 'await challengeWithSecret(id, geheimnis)'],
    ['_shared/jwt.ts', "const header = { alg: 'HS256', typ: 'JWT' }"],
    ['_shared/freischaltung.ts', 'if (cfg.open_to_public !== false) return true'],
    ['_shared/base58.ts', 'isSolanaAddress'],
    ['_shared/solana.ts', 'recentTreasuryPayments'],
    ['_shared/holdings.ts', 'refreshWallet'],
  ];
  for (const [file, line] of merkmale) {
    check(`${file} steckt darin`, dash.includes(line));
  }
  // And the fix itself has to have landed.
  check('Und die Eigentumsprüfung ist darin gelandet',
    dash.includes('function challengeWithSecret') && dash.includes('secret_hash'));
}

// ---------------------------------------------------------------------------
console.log('\nDer Anmeldebetrag muss sich eintippen lassen\n');
// ---------------------------------------------------------------------------
//
// This was found in production, not in a test: in Phantom on a phone, an
// amount with nine decimal places can't be entered. The field accepts fewer
// digits, the last one gets dropped - and afterwards the amount matches no
// challenge. The money is transferred, the login fails, and from the outside
// there's no reason visible.
//
// On a site whose only way in is a payment, that's the door. So EVERY
// possible amount is computed through here, not just one as a sample.

const step = Number(/const NONCE_STEP = ([\d_]+)/.exec(src)?.[1]?.replace(/_/g, ''));
const tiers = Number(/const NONCE_TIERS = ([\d_]+)/.exec(src)?.[1]?.replace(/_/g, ''));
const initSql = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260823020000_init.sql'), 'utf8');
const basis = Number(/base_lamports bigint not null default (\d+)/.exec(initSql)?.[1]);

check('Schrittweite und Stufen stehen als Konstanten in verify/index.ts',
  Number.isFinite(step) && Number.isFinite(tiers), `${step} / ${tiers}`);
check('Und der Grundbetrag in der Wanderung', Number.isFinite(basis), String(basis));

const stellenVon = (lamports) => {
  const t = (lamports / 1e9).toFixed(9).replace(/0+$/, '');
  return t.includes('.') ? t.split('.')[1].length : 0;
};
let maxStellen = 0, schlimmster = 0;
const alle = new Set();
for (let k = 1; k <= tiers; k++) {
  const l = basis + k * step;
  alle.add(l);
  const st = stellenVon(l);
  if (st > maxStellen) { maxStellen = st; schlimmster = l; }
}

// SIX is the limit that matters here - not because Phantom's exact cap is
// reliably documented anywhere, but because six digits are accepted by
// every wallet app and the number stays typeable by hand.
check('KEIN moeglicher Betrag braucht mehr als 6 Nachkommastellen',
  maxStellen <= 6,
  `schlimmster Fall ${(schlimmster / 1e9).toFixed(9).replace(/0+$/, '')} (${maxStellen} Stellen)`);
check('Es gibt trotzdem genug verschiedene Betraege', alle.size >= 500, `${alle.size} Stueck`);
const maxSol = Math.max(...alle) / 1e9;
check('Und der teuerste bleibt under 0,01 SOL', maxSol < 0.01, `${maxSol.toFixed(6)} SOL`);

// Two constants up top that nobody down below actually uses would be the
// usual trap. So check that the calculation really uses them.
// Der Aufschlag kommt aus crypto.getRandomValues, nicht aus Math.random -
// er IST das Geheimnis des Verfahrens und wird dem Aufrufer als Betrag
// zurueckgegeben.
check('createChallenge rechnet mit genau diesen beiden Konstanten',
  /\(1 \+ \(wuerfel\[0\] % NONCE_TIERS\)\)\s*\*\s*NONCE_STEP/.test(src));
check('Und der Würfel kommt aus dem Kryptozufall',
  /crypto\.getRandomValues\(wuerfel\)/.test(src) && !/Math\.random\(/.test(src));
check('Und die lamportgenaue Fassung ist weg', !/NONCE_MAX/.test(src));

// Fewer digits only work because the amount no longer needs to be globally
// unique. That holds exactly as long as the match also checks the sender
// address.
check('scanTreasury gleicht auch die Absenderadresse ab',
  /\.eq\('wallet',\s*p\.sender\)/.test(src));
const amountMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260904020000_betrag_weniger_stellen.sql'), 'utf8');
check('Und der Index steht auf (wallet, lamports)',
  /on public\.challenges \(wallet, lamports\) where status = 'pending'/.test(amountMigration));

// ---------------------------------------------------------------------------
const fehler = befunde.filter((b) => !b.ok);
console.log(fehler.length
  ? `\n  ${fehler.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(fehler.length ? 1 : 0);
