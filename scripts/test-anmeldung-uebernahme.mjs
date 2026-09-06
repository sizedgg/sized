// ============================================================================
// Kann sich jemand als Ansem anmelden, ohne seine Wallet zu besitzen?
//
// Die Anmeldung ist die empfindlichste Stelle der ganzen Seite. Wer sie
// überwindet, ist nicht irgendein Nutzer, sondern hat den Posteingang, legt
// Abstimmungen an und löscht sie, und stellt die DM-Schwelle. Und weil die
// Seite Ansem gehört, ist der Schaden nicht technisch, sondern seiner.
//
// ----------------------------------------------------------------------------
// Der Angriff, den es gab
//
// Beim Anlegen einer Challenge wird NICHT geprüft, ob der Anfragende die
// Wallet besitzt. Das ist Absicht: Die Zahlung ist der Nachweis, deshalb muss
// niemand ein Wallet verbinden. Der Fehler lag woanders:
//
//   1. Angreifer öffnet eine Challenge auf ANSEMS Adresse. Kostet nichts.
//   2. Ansem meldet sich an. createChallenge fand die offene Challenge über
//      die Wallet und gab ihm DIESELBE – gedacht gegen doppelte Kosten beim
//      Neuladen.
//   3. Ansem zahlt. Die Challenge wird 'paid'.
//   4. Der Angreifer fragt mit derselben Kennung den Status ab und bekommt
//      das JWT. Es trägt Ansems Wallet, und app.is_admin() sagt ja.
//
// Ansem hätte dabei nichts falsch gemacht.
//
// ----------------------------------------------------------------------------
// Was hier wirklich läuft und was nur gelesen wird
//
// Deno gibt es in dieser Umgebung nicht, die Edge Function lässt sich also
// nicht starten. Deshalb zwei Ebenen, und die Grenze dazwischen steht
// ausdrücklich da:
//
//   * ECHT AUSGEFÜHRT: die Eigentumsprüfung selbst – neuesGeheimnis, abdruck,
//     gleich und challengeMitGeheimnis, wörtlich aus verify/index.ts
//     herausgeschnitten und gegen eine kleine Attrappe der Datenbank
//     ausgeführt. Das ist der Kern, an dem der Angriff hing.
//
//   * GELESEN: dass checkStatus, mockPay und createChallenge diese Prüfung
//     auch wirklich benutzen. Eine perfekte Prüfung, die niemand aufruft, ist
//     der wahrscheinlichere Fehler von beiden.
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

const schneide = (von, bis) => {
  const a = src.indexOf(von);
  const b = src.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in verify/index.ts: ${von}`);
  return src.slice(a, b);
};

const befunde = [];
const pruefe = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

// ---------------------------------------------------------------------------
// Die Eigentumsprüfung, wörtlich – und ausgeführt
// ---------------------------------------------------------------------------
// Die TypeScript-Typen sind das Einzige, was hier wegfällt; Node versteht sie
// nicht. Der Rumpf bleibt Zeichen für Zeichen der der Function.
const kern = schneide('function neuesGeheimnis(): string', '\nDeno.serve(')
  .replace(/function neuesGeheimnis\(\): string/, 'function neuesGeheimnis()')
  .replace(/async function abdruck\(geheimnis: string\): Promise<string>/, 'async function abdruck(geheimnis)')
  .replace(/function gleich\(a: string, b: string\): boolean/, 'function gleich(a, b)')
  .replace(/async function challengeMitGeheimnis\(id: unknown, geheimnis: unknown\)/,
    'async function challengeMitGeheimnis(id, geheimnis)');

// Die Attrappe: eine Map, und genau die Kette, die die Function benutzt.
const zeilen = new Map();
const db = {
  from: () => ({
    select: () => ({
      eq: (_spalte, wert) => ({ maybeSingle: async () => ({ data: zeilen.get(wert) ?? null }) }),
    }),
  }),
};

const lauf = new Function('db', 'crypto', 'TextEncoder', `
  ${kern}
  return { neuesGeheimnis, abdruck, gleich, challengeMitGeheimnis };
`)(db, globalThis.crypto, TextEncoder);

console.log('\nDas Geheimnis selbst\n');

const g1 = lauf.neuesGeheimnis();
const g2 = lauf.neuesGeheimnis();
pruefe('Das Geheimnis ist 64 Hexzeichen lang (32 Byte)',
  /^[0-9a-f]{64}$/.test(g1), `${g1.length} Zeichen`);
pruefe('Zwei Geheimnisse sind verschieden', g1 !== g2);
// Nicht Math.random: Das ist vorhersagbar, wenn man genug Werte gesehen hat,
// und hier haengt eine Anmeldung daran.
pruefe('Es kommt aus dem Zufallsgenerator für Kryptografie, nicht aus Math.random',
  /crypto\.getRandomValues/.test(kern) && !/Math\.random/.test(kern));

const a1 = await lauf.abdruck(g1);
pruefe('Der Abdruck ist ein SHA-256 in Hex', /^[0-9a-f]{64}$/.test(a1));
pruefe('Derselbe Wert ergibt denselben Abdruck', (await lauf.abdruck(g1)) === a1);
pruefe('Ein anderer einen anderen', (await lauf.abdruck(g2)) !== a1);
// Gegenprobe gegen einen bekannten Wert – sonst prueft der Test nur, dass die
// Funktion mit sich selbst uebereinstimmt.
pruefe('Und es ist wirklich SHA-256',
  (await lauf.abdruck('abc'))
    === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

pruefe('Der Vergleich bricht nicht beim ersten Unterschied ab',
  /diff \|=/.test(kern) && !/return a === b/.test(kern));

// ---------------------------------------------------------------------------
console.log('\nDer Angriff\n');

const ANSEM = 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw';

// Schritt 1: Der Angreifer oeffnet eine Challenge auf Ansems Adresse. Das
// geht weiterhin – und soll es auch: Ohne Wallet-Verbindung kann niemand
// beweisen, wem eine Adresse gehoert. Der Nachweis ist die Zahlung.
const angreiferGeheimnis = lauf.neuesGeheimnis();
zeilen.set('challenge-des-angreifers', {
  id: 'challenge-des-angreifers',
  wallet: ANSEM,
  lamports: 2_042_779,
  status: 'pending',
  secret_hash: await lauf.abdruck(angreiferGeheimnis),
  expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
});

pruefe('Eine Challenge auf eine fremde Adresse anzulegen bleibt erlaubt',
  zeilen.has('challenge-des-angreifers'));

// Schritt 2 war der Bruch: Ansems Anmeldung bekam dieselbe Challenge zurueck.
// createChallenge setzt jetzt nur noch mit dem passenden Geheimnis fort – und
// das hat nur der Angreifer.
const weiter = schneide('  if (weiterId) {', '  const expiresAt =');
pruefe('Fortgesetzt wird nur mit dem eigenen Geheimnis',
  /challengeMitGeheimnis\(weiterId, weiterGeheimnis\)/.test(weiter));
pruefe('Und nur die eigene Wallet und nur solange sie läuft',
  /c\.wallet === wallet/.test(weiter) && /c\.status === 'pending'/.test(weiter)
  && /expires_at\)\.getTime\(\) > Date\.now\(\)/.test(weiter));
// Die Zeile, die den Angriff moeglich machte: Suche allein ueber die Wallet.
pruefe('Es gibt keine Suche mehr, die allein über die Wallet geht',
  !/\.eq\('wallet', wallet\)\s*\.eq\('status', 'pending'\)/.test(src),
  'die alte Wiederverwendung ist weg');

// Schritt 4: Mit der Kennung allein kommt niemand mehr an den Nachweis.
zeilen.get('challenge-des-angreifers').status = 'paid';

pruefe('Mit der Kennung allein gibt es nichts',
  (await lauf.challengeMitGeheimnis('challenge-des-angreifers', undefined)) === null);
pruefe('Mit einem falschen Geheimnis auch nicht',
  (await lauf.challengeMitGeheimnis('challenge-des-angreifers', lauf.neuesGeheimnis())) === null);
// Ein Geheimnis der richtigen LAENGE, aber falsch – sonst koennte die
// Laengenpruefung oben allein den Test bestehen lassen.
pruefe('Und auch nicht mit einem, das nur richtig aussieht',
  (await lauf.challengeMitGeheimnis('challenge-des-angreifers', 'f'.repeat(64))) === null);
pruefe('Mit dem richtigen schon – sonst prüfte hier nichts',
  (await lauf.challengeMitGeheimnis('challenge-des-angreifers', angreiferGeheimnis))?.id
    === 'challenge-des-angreifers');
pruefe('Eine unbekannte Kennung ergibt dieselbe Absage wie ein falsches Geheimnis',
  (await lauf.challengeMitGeheimnis('gibt-es-nicht-12345', angreiferGeheimnis)) === null);

// Altbestand: offene Challenges ohne Abdruck sind wertlos, bezahlte nicht.
zeilen.set('alt-offen', { id: 'alt-offen', wallet: ANSEM, status: 'pending', secret_hash: null });
zeilen.set('alt-bezahlt', { id: 'alt-bezahlt', wallet: ANSEM, status: 'paid', secret_hash: null });
pruefe('Eine offene Challenge aus der Zeit ohne Geheimnis ist wertlos',
  (await lauf.challengeMitGeheimnis('alt-offen', lauf.neuesGeheimnis())) === null);
pruefe('Eine bereits BEZAHLTE darf noch eingelöst werden – dort ist Geld geflossen',
  (await lauf.challengeMitGeheimnis('alt-bezahlt', lauf.neuesGeheimnis()))?.id === 'alt-bezahlt');

// ---------------------------------------------------------------------------
console.log('\nWird die Prüfung auch benutzt?\n');
//
// Der wahrscheinlichere Fehler ist nicht eine schlechte Pruefung, sondern eine
// gute, die an einer Stelle vergessen wurde.

const statusFn = schneide('async function checkStatus(', '\n/**\n * Liest die letzten');
pruefe('checkStatus holt die Challenge über die Prüfung',
  /await challengeMitGeheimnis\(id, geheimnis\)/.test(statusFn));
pruefe('Und liest sie nirgends mehr direkt über die Kennung',
  !/from\('challenges'\)\s*\.select\('\*'\)\.eq\('id', id\)/.test(statusFn));

const mockFn = schneide('async function mockPay(', '\n}');
pruefe('mock-pay verlangt es ebenfalls',
  /await challengeMitGeheimnis\(id, geheimnis\)/.test(mockFn));

// Und es darf nur an EINER Stelle herausgehen.
const stellen = (src.match(/secret: /g) || []).length;
pruefe('Das Geheimnis wird an genau einer Stelle ausgeliefert', stellen === 1,
  `${stellen} Stelle(n)`);
pruefe('In der Datenbank steht nur der Abdruck, nie das Geheimnis',
  /secret_hash/.test(src) && !/insert\(\{[^}]*secret:/.test(src));

// Das JWT entscheidet nicht selbst ueber Adminrechte – die Wallet tut es.
// Wichtig fuer die Frage "kann sich jemand als Ansem anmelden": Selbst ein
// gefaelschtes is_admin im Token bringt nichts, solange die Wallet nicht passt.
pruefe('Adminrechte kommen aus der Konfiguration, nicht aus dem alten Token',
  /const isAdmin = Boolean\(cfg\.admin_wallet\) && c\.wallet === cfg\.admin_wallet/.test(src)
  && /const isAdmin = Boolean\(cfg\.admin_wallet\) && claims\.wallet === cfg\.admin_wallet/.test(src));

// ---------------------------------------------------------------------------
console.log('\nDie Seite führt es mit\n');
//
// Ohne das waere die Sperre eine Verschlechterung: Wer beim Neuladen sein
// Geheimnis verliert, bekaeme eine zweite Challenge mit einem zweiten Betrag
// und zahlte zweimal.
pruefe('Die laufende Anmeldung wird gemerkt',
  /const CHALLENGE_KEY = 'ansem_challenge'/.test(appJs)
  && /merkeChallenge\(c\)/.test(appJs));
pruefe('Und beim nächsten Versuch für dieselbe Adresse fortgesetzt',
  /challengeId: weiter\.challengeId, secret: weiter\.secret/.test(appJs));
pruefe('Die Statusabfrage schickt das Geheimnis mit',
  /action: 'status', challengeId: id, secret: geheimnis/.test(appJs));
pruefe('Nach der Anmeldung wird es weggeräumt',
  /stopPolling\(\);\s*\n\s*vergissChallenge\(\);/.test(appJs));

// ---------------------------------------------------------------------------
console.log('\nDie Fassung fürs Dashboard\n');
//
// verify wird nicht ueber die CLI ausgerollt, sondern in den Dashboard-Editor
// eingefuegt – dort gibt es die Nachbardateien nicht. Die eigenstaendige
// Fassung entsteht aus derselben Quelle (scripts/verify-eigenstaendig.mjs).
//
// Was hier geprueft wird, ist nicht ihr Inhalt, sondern dass sie NICHT
// veraltet ist. Eine alte Fassung im Editor waere die schlimmste Sorte
// Fehler: Der Code im Projekt ist repariert, die laufende Function nicht, und
// beide sehen fuer sich richtig aus.
const dashPfad = path.join(root, 'supabase/functions/verify/index.dashboard.ts');
if (!fs.existsSync(dashPfad)) {
  pruefe('Die Fassung fürs Dashboard ist gebaut', false,
    'node scripts/verify-eigenstaendig.mjs');
} else {
  const dash = fs.readFileSync(dashPfad, 'utf8');
  pruefe('Sie enthält keine relativen Importe',
    !/from\s+'\.[^']*'/.test(dash));
  // Der Rumpf jeder Datei muss woertlich drinstehen. Verglichen wird an einer
  // markanten Zeile je Quelle statt am Ganzen – der Kopf und die
  // export-Woerter fallen beim Bauen weg, ein Vergleich Zeichen fuer Zeichen
  // schluege deshalb immer fehl.
  const merkmale = [
    ['verify/index.ts', 'await challengeMitGeheimnis(id, geheimnis)'],
    ['_shared/jwt.ts', "const header = { alg: 'HS256', typ: 'JWT' }"],
    ['_shared/freischaltung.ts', 'if (cfg.open_to_public !== false) return true'],
    ['_shared/base58.ts', 'isSolanaAddress'],
    ['_shared/solana.ts', 'recentTreasuryPayments'],
    ['_shared/holdings.ts', 'refreshWallet'],
  ];
  for (const [datei, zeile] of merkmale) {
    pruefe(`${datei} steckt darin`, dash.includes(zeile));
  }
  // Und die Reparatur selbst muss angekommen sein.
  pruefe('Und die Eigentumsprüfung ist darin gelandet',
    dash.includes('function challengeMitGeheimnis') && dash.includes('secret_hash'));
}

// ---------------------------------------------------------------------------
console.log('\nDer Anmeldebetrag muss sich eintippen lassen\n');
// ---------------------------------------------------------------------------
//
// Der Fund kam aus dem Betrieb, nicht aus einem Test: In Phantom auf dem Handy
// laesst sich ein Betrag mit neun Nachkommastellen nicht eingeben. Das Feld
// nimmt weniger Stellen an, die letzte faellt weg – und der Betrag passt
// danach auf keine Challenge. Das Geld ist ueberwiesen, die Anmeldung
// scheitert, und von aussen ist kein Grund zu sehen.
//
// Bei einer Seite, deren einziger Weg hinein eine Zahlung ist, ist das die
// Tuer. Deshalb wird hier JEDER moegliche Betrag durchgerechnet, nicht einer
// als Stichprobe.

const schritt = Number(/const NONCE_SCHRITT = ([\d_]+)/.exec(src)?.[1]?.replace(/_/g, ''));
const stufen = Number(/const NONCE_STUFEN = ([\d_]+)/.exec(src)?.[1]?.replace(/_/g, ''));
const initSql = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260823020000_init.sql'), 'utf8');
const basis = Number(/base_lamports bigint not null default (\d+)/.exec(initSql)?.[1]);

pruefe('Schrittweite und Stufen stehen als Konstanten in verify/index.ts',
  Number.isFinite(schritt) && Number.isFinite(stufen), `${schritt} / ${stufen}`);
pruefe('Und der Grundbetrag in der Wanderung', Number.isFinite(basis), String(basis));

const stellenVon = (lamports) => {
  const t = (lamports / 1e9).toFixed(9).replace(/0+$/, '');
  return t.includes('.') ? t.split('.')[1].length : 0;
};
let maxStellen = 0, schlimmster = 0;
const alle = new Set();
for (let k = 1; k <= stufen; k++) {
  const l = basis + k * schritt;
  alle.add(l);
  const st = stellenVon(l);
  if (st > maxStellen) { maxStellen = st; schlimmster = l; }
}

// SECHS ist die Grenze, die hier zaehlt – nicht weil Phantoms genaues Limit
// verlaesslich dokumentiert waere, sondern weil sechs Stellen von jeder
// Wallet-App angenommen werden und die Zahl von Hand abtippbar bleibt.
pruefe('KEIN moeglicher Betrag braucht mehr als 6 Nachkommastellen',
  maxStellen <= 6,
  `schlimmster Fall ${(schlimmster / 1e9).toFixed(9).replace(/0+$/, '')} (${maxStellen} Stellen)`);
pruefe('Es gibt trotzdem genug verschiedene Betraege', alle.size >= 500, `${alle.size} Stueck`);
const maxSol = Math.max(...alle) / 1e9;
pruefe('Und der teuerste bleibt unter 0,01 SOL', maxSol < 0.01, `${maxSol.toFixed(6)} SOL`);

// Zwei Konstanten oben im Blatt, die unten niemand benutzt, waeren die
// uebliche Falle. Also nachsehen, dass die Rechnung sie wirklich verwendet.
pruefe('createChallenge rechnet mit genau diesen beiden Konstanten',
  /Math\.floor\(Math\.random\(\) \* NONCE_STUFEN\)\)\s*\*\s*NONCE_SCHRITT/.test(src));
pruefe('Und die lamportgenaue Fassung ist weg', !/NONCE_MAX/.test(src));

// Weniger Stellen gehen nur, weil der Betrag nicht mehr global eindeutig sein
// muss. Das traegt genau dann, wenn der Abgleich die Absenderadresse mitprueft.
pruefe('scanTreasury gleicht auch die Absenderadresse ab',
  /\.eq\('wallet',\s*p\.sender\)/.test(src));
const betragWanderung = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260904020000_betrag_weniger_stellen.sql'), 'utf8');
pruefe('Und der Index steht auf (wallet, lamports)',
  /on public\.challenges \(wallet, lamports\) where status = 'pending'/.test(betragWanderung));

// ---------------------------------------------------------------------------
const fehler = befunde.filter((b) => !b.ok);
console.log(fehler.length
  ? `\n  ${fehler.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(fehler.length ? 1 : 0);
