// ============================================================================
// Die Seite ist zu – wer sieht was, und wer kommt herein
//
// Zwei Aussagen, und nur eine davon ist eine Sperre:
//
//   1. Steht app_config.open_to_public auf false, sieht ein Besucher
//      "Launching soon" und darunter einen kleinen Knopf "Team access".
//      Das ist eine FASSADE. Sie haelt niemanden auf, sie zeigt nur etwas
//      anderes.
//
//   2. Herein kommt nur, wer in admin_wallet oder test_wallet steht. Das ist
//      die Sperre, sie steht in der Function, und keine Zeile im Browser kann
//      sie umgehen.
//
// Beide werden hier geprueft, und zwar getrennt – weil sie verschieden viel
// wert sind. Wer die zweite fuer die erste haelt, baut eine Seite, die man mit
// der Entwicklerkonsole aufmacht.
//
// ----------------------------------------------------------------------------
// Warum mayEnter aus der echten Datei kommt
//
// _shared/freischaltung.ts ist absichtlich eine Datei ohne Importe – genau
// damit ein Test sie laden kann. Waere die Regel in common.ts, zoege sie den
// Supabase-Client aus jsr: nach und liesse sich aus Node gar nicht anfassen.
// Eine Sperre, die nur im Betrieb existiert, kann niemand pruefen.
//
//   node scripts/test-zu.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${label}${detail && !ok ? `\n         ${detail}` : ''}`);
};

console.log('\nDie Seite ist zu\n');

// ---------------------------------------------------------------------------
// Teil 1: die Sperre – mayEnter, aus der echten Datei
// ---------------------------------------------------------------------------
// TypeScript ohne Werkzeug: Die Datei enthaelt nur ein Interface und eine
// Funktion. Das Interface wird weggeschnitten, der Rest ist gueltiges
// JavaScript. Nachgebaut wird nichts – aendert jemand die Regel, aendert sich
// diese Pruefung mit.
const torQuelle = fs.readFileSync(
  path.join(root, 'supabase', 'functions', '_shared', 'freischaltung.ts'), 'utf8');
const alsJs = torQuelle
  .replace(/export interface TorConfig \{[\s\S]*?\n\}/, '')
  .replace('export function mayEnter(cfg: TorConfig, wallet: string | null): boolean {',
           'function mayEnter(cfg, wallet) {');
// eslint-disable-next-line no-new-func
const mayEnter = new Function(`${alsJs}\nreturn mayEnter;`)();

const ANSEM = '4boaBdaCkqtgPmWV4JzwJ81azM9XTNhgVPqCZW7b7Kyo';
const NUTZER = 'Hs7QvNmK4dGbXe2LpRcTfZaU9wYjB6xM1noAiEuS3rVt';
const FREMD = 'So1anaFremdeAdresse11111111111111111111111';

const zu = { open_to_public: false, admin_wallet: ANSEM, test_wallet: NUTZER };
const auf = { open_to_public: true, admin_wallet: ANSEM, test_wallet: NUTZER };

check('Zu: Ansem kommt herein', mayEnter(zu, ANSEM));
check('Zu: die Testadresse kommt herein', mayEnter(zu, NUTZER));
check('Zu: sonst niemand', !mayEnter(zu, FREMD));
check('Zu: und ohne Adresse erst recht nicht', !mayEnter(zu, null));
// Die Gegenprobe, ohne die alles darueber auch dann gruen waere, wenn mayEnter
// stur false zurueckgaebe.
check('Gegenprobe: offen kommt derselbe Fremde sehr wohl herein',
  mayEnter(auf, FREMD));

// Ein leeres Feld darf nicht zum Generalschluessel werden: Steht in
// test_wallet nichts, faengt Boolean() das ab – sonst kaeme jeder herein, der
// keine Adresse schickt.
check('Zu: ein leeres test_wallet oeffnet nichts',
  !mayEnter({ open_to_public: false, admin_wallet: ANSEM, test_wallet: null }, null)
  && !mayEnter({ open_to_public: false, admin_wallet: ANSEM, test_wallet: '' }, ''));
// Und die Richtung des Schalters: Nur ein ausdrueckliches false sperrt zu.
// Fehlt die Spalte, ist offen – die Begruendung steht in der Datei.
check('Fehlt die Spalte, ist die Seite offen',
  mayEnter({ admin_wallet: ANSEM, test_wallet: NUTZER }, FREMD));

// ---------------------------------------------------------------------------
// Teil 2: die Fassade – was der Besucher sieht
// ---------------------------------------------------------------------------
const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const datei = path.join(pub, pfad);
  if (!datei.startsWith(pub) || !fs.existsSync(datei)) return res.writeHead(404).end('');
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(datei));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const appJs = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a + von.length);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b + bis.length);
};
// Die echten Teile, woertlich.
const TEILE = [
  schneide("const TEAM_ZUGANG =", '\n'),
  schneide('function teamFrei() {', '\n}'),
  schneide('const ZU_ABFRAGE_MS =', '\n'),
  schneide('async function seiteIstZu() {', '\n}'),
  schneide('function zeigeBald() {', '\n}'),
  schneide("$('#btn-team').addEventListener('click'", '\n});'),
].join('\n\n');

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

/**
 * Laedt die Seite mit einer nachgestellten Datenbank.
 *
 * @param offen  was app_config.open_to_public zurueckgibt – oder 'fehler',
 *               wenn die Abfrage scheitern soll, oder 'haengt', wenn sie gar
 *               nicht antwortet.
 */
async function lage({ offen, jwt = null, gemerkt = false }) {
  const seite = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await seite.goto(base, { waitUntil: 'load' });
  // Mit eigenem Zeitlimit, und das ist kein Beiwerk.
  // ---------------------------------------------------------------------------
  // Nimmt jemand die Zeitgrenze aus seiteIstZu() heraus, kehrt der Aufruf beim
  // Fall 'haengt' nie zurueck – und dieser Test HAENGT dann, statt
  // fehlzuschlagen. Ein haengender Test sagt einem nicht, was kaputt ist; man
  // sieht nur, dass nichts weitergeht. Also lieber ein sauberes Nein nach acht
  // Sekunden.
  const abbruch = new Promise((r) => setTimeout(
    () => r({ haenger: true, bald: false, login: false }), 8000));
  return Promise.race([abbruch, seite.evaluate(async ({ teile, offen: o, jwt: j, gemerkt: g }) => {
    const $ = (s, w = document) => w.querySelector(s);
    window.$ = $;
    window.state = { jwt: j, db: null };
    window.makeClient = () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => {
              if (o === 'fehler') throw new Error('kein Netz');
              // Antwortet nie – nicht einmal mit einem Fehler.
              if (o === 'haengt') return new Promise(() => {});
              return { data: { open_to_public: o }, error: null };
            },
          }),
        }),
      }),
    });
    window.zeigeLogin = () => { $('#app').hidden = true; $('#login').hidden = false; };
    window.maybeShowInstallStep = () => {};
    try { localStorage.setItem('size_team', g ? '1' : ''); } catch { /* egal */ }

    // eslint-disable-next-line no-eval
    (0, eval)(teile);

    // Das, was boot() als Erstes tut.
    if (await window.seiteIstZu()) window.zeigeBald();
    else window.zeigeLogin();

    const sichtbar = (s) => !$(s).hidden;
    return {
      bald: sichtbar('#soon'),
      login: sichtbar('#login'),
      knopf: Boolean($('#btn-team')),
      knopfText: $('#btn-team')?.textContent.trim(),
      satz: $('#soon .lede')?.textContent.trim(),
      // Alles, was in der Karte ausser Marke und dem einen Satz steht.
      mehrText: [...$('#soon .login-card').children]
        .filter((e) => !e.classList.contains('brand') && !e.classList.contains('lede'))
        .map((e) => e.textContent.trim()).join(' '),
    };
  }, { teile: TEILE, offen, jwt, gemerkt })]).finally(() => seite.close());
}

// Und zuerst: RUFT boot() das ueberhaupt auf?
// ---------------------------------------------------------------------------
// Die Pruefungen darunter rufen seiteIstZu() selbst auf – sie zeigen, dass die
// Funktion das Richtige tut, nicht dass sie jemand benutzt. Genau das hat die
// Gegenprobe aufgedeckt: Die Zeile aus boot() zu entfernen liess alles gruen,
// und der Vorhang waere im Betrieb nie erschienen.
//
// Als Erstes muss sie stehen, noch vor der Sitzungspruefung: Wer eine
// abgelaufene Sitzung hat, wuerde sonst ausgeloggt und saehe den Login statt
// des Vorhangs.
const bootBlock = appJs.slice(appJs.indexOf('(async function boot() {'));
check('boot() fragt als Erstes, ob die Seite zu ist',
  /^\(async function boot\(\) \{\s*\n\s*if \(await seiteIstZu\(\)\) \{ zeigeBald\(\); return; \}/
    .test(bootBlock),
  bootBlock.slice(0, 160));

const geschlossen = await lage({ offen: false });
check('Zu: der Besucher sieht "Launching soon"',
  geschlossen.bald && !geschlossen.login, JSON.stringify(geschlossen));
check('Und darunter steht der Knopf',
  geschlossen.knopf && geschlossen.knopfText === 'Team access', geschlossen.knopfText);
// Und sonst nichts. Unter "Launching soon." stand eine Zeile, was SIZED ist;
// sie ist raus, und dass sie draussen bleibt, steht hier fest: Wer die Seite
// vor dem Start aufruft, soll es hier nicht erfahren.
check('Und sonst nichts – kein Satz darueber, was SIZED ist',
  geschlossen.satz === 'Launching soon.' && !geschlossen.mehrText,
  `${geschlossen.satz} | ${geschlossen.mehrText}`);

const offen = await lage({ offen: true });
check('Gegenprobe: offen sieht er den Login',
  offen.login && !offen.bald, JSON.stringify(offen));

// Wer schon eine Sitzung hat, wird nicht aufgehalten: Ob er hereindarf,
// entscheidet ohnehin die Function bei der naechsten Verlaengerung.
const mitSitzung = await lage({ offen: false, jwt: 'irgendein.token.hier' });
check('Zu, aber mit Sitzung: kein Vorhang', mitSitzung.login && !mitSitzung.bald);

// Einmal getippt, danach direkt zum Login.
const gemerkt = await lage({ offen: false, gemerkt: true });
check('Nach "Team access" kommt der Vorhang nicht wieder',
  gemerkt.login && !gemerkt.bald);

// Und der Fall, der leise schiefgehen koennte: Faellt die Abfrage aus, darf
// NICHT ausgesperrt werden. Ein Netzfehler zeigte sonst "Launching soon" auf
// einer laengst offenen Seite – ein Fehler, den niemand meldet, weil er wie
// Absicht aussieht.
const kaputt = await lage({ offen: 'fehler' });
check('Faellt die Abfrage aus, wird nicht ausgesperrt',
  kaputt.login && !kaputt.bald, JSON.stringify(kaputt));

// Und der schlimmere Fall: Die Abfrage ANTWORTET NIE.
// ---------------------------------------------------------------------------
// Ein Fehler kommt zurueck und laesst sich abfangen. Ein Funkloch, ein
// Hotel-WLAN mit Anmeldeseite davor, ein Ausfall bei Supabase – da kommt
// nichts, auch kein Fehler. Ohne Zeitgrenze wartet boot() dann unbegrenzt, und
// der Besucher sieht NIE etwas: weder Login noch Vorhang, nur Schwarz.
//
// Genau das war der Zustand, bevor ZU_ABFRAGE_MS dazukam, und aufgefallen ist
// es nicht durch Nachdenken, sondern weil zwei andere Suiten danach fuer immer
// auf eine leere Seite schauten.
const haengt = await lage({ offen: 'haengt' });
check('Antwortet die Abfrage gar nicht, kommt trotzdem der Login',
  haengt.login && !haengt.bald,
  haengt.haenger ? 'boot() kam nie zurueck – fehlt die Zeitgrenze?'
    : JSON.stringify(haengt));

await browser.close();
server.close();

console.log(failed ? `\n  ${failed} Pruefung(en) fehlgeschlagen\n` : '\n  Alles bestanden\n');
process.exit(failed ? 1 : 0);
