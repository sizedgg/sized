// ============================================================================
// Prüft den Löschknopf.
//
// Das Heikle daran ist nicht das Löschen selbst – das ist eine Zeile – sondern
// die Sicherung davor. Sie muss zwei Dinge gleichzeitig tun: einen
// versehentlichen Treffer abfangen UND sich nicht so anfühlen, als sei der
// Knopf kaputt. Beides lässt sich nur nachmessen:
//
//   * Ein Tipper allein löscht nichts, er macht aus dem Papierkorb ein Häkchen.
//   * Der zweite löscht.
//   * Dabei poppt nichts auf und nichts wird rot – das Symbol ist die ganze
//     Rückfrage.
//   * Nach fünf Sekunden steht wieder der Papierkorb da; sonst bliebe ein
//     scharfer Knopf im Blatt, von dem niemand mehr weiß.
//   * Ein Fehler der Datenbank meldet sich sehr wohl – dass NICHT gelöscht
//     wurde, sieht man sonst nirgends.
//   * Nicht-Ansem sieht den Knopf gar nicht erst.
//
//   node scripts/test-poll-loeschen.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

// Wörtlich aus app.js – eine nachgebaute Kopie würde den Test bestehen,
// während die echte Fassung kaputt ist.
const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const loescher = schneide('async function loeschePoll', '\nasync function vote');
// Wer als führend markiert wird – und dass das erst nach dem Schliessen
// passiert. Die Rechnung steht an EINER Stelle in app.js, weil Liste und
// geteiltes Bild sonst auseinanderlaufen könnten.
const fuehrend = schneide('const fuehrenderAnteil =', '\nasync function zeichnePoll');
const pollBauer = schneide('function pollHtml(p) {', '\nasync function loeschePoll');
const TRASH_SVG = schneide('const TRASH_SVG =', '\n// ------');
const CHECK_SVG = schneide('const CHECK_SVG =', 'const DOWNLOAD_SVG =');
const ganzeZahl = schneide('const ganzeZahl =', '\n');
// Der Zustand der Knoepfe – der Kern dieser Fassung. Er liegt NICHT am
// DOM-Knoten, und genau das prueft Abschnitt 7.
const knopfStand = schneide('const KNOPF_ROLLEN = {', '\n/**\n * Die Adresse einer einzelnen');
// Und renderPolls woertlich, samt der Zeile, die die Knoepfe nach dem Neubau
// wieder malt. Ein nachgebautes zeichne() waere hier das Falscheste ueberhaupt:
// Der Fehler steckte genau in dieser Funktion, ein Nachbau haette ihn nie
// gehabt und der Test waere von Anfang an gruen gewesen.
const renderer = schneide('/**\n * Woran ein Knopf in der Liste',
  '\n/* Eine Kette, kein Teilen-Pfeil');

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
           <body><div id="poll-list" class="poll-list"></div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 1100, height: 700 } });
await seite.goto(`http://127.0.0.1:${server.address().port}/`);

await seite.addScriptTag({
  content: `
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const nfGanz = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
    const vollUsd = (n) => '$' + nfGanz.format(Math.round(Number(n) || 0));
    ${ganzeZahl}
    window.tosts = [];
    const toast = (m, err) => window.tosts.push({ m, err: Boolean(err) });
    const LINK_SVG = '<i></i>', DOWNLOAD_SVG = '<i></i>';
    ${TRASH_SVG}
    ${CHECK_SVG}
    // Woran man die beiden im Test auseinanderhaelt: Der Papierkorb hat den
    // Deckelstrich M4 6.5h16, das Haekchen den einen Zug M4.5 12.5.
    window.istHaken = (b) => b.innerHTML.includes('M4.5 12.5');
    window.istKorb = (b) => b.innerHTML.includes('M4 6.5h16');

    // Eine Attrappe der Datenbank: Sie merkt sich, WAS gelöscht werden sollte.
    // Genau darum geht es hier – ob ein einzelner Klick sie überhaupt erreicht.
    window.geloescht = [];
    window.dbFehler = null;
    const state = {
      me: { isAdmin: true },
      cfg: { symbol: 'ANSEM' },
      polls: [],
      db: {
        from: () => ({
          delete: () => ({
            eq: async (_spalte, wert) => {
              if (window.dbFehler) return { error: { message: window.dbFehler } };
              window.geloescht.push(wert);
              return { error: null };
            },
          }),
        }),
      },
    };
    window.state = state;
    window.neuGeladen = 0;
    const loadPolls = async () => { window.neuGeladen++; };

    // Was renderPolls sonst noch anfasst und was hier nichts zur Sache tut.
    let fristT = null;
    const fristTakt = () => {};
    const vote = () => {};
    const teilePoll = () => {};
    const ladePollBild = () => {};

    ${knopfStand}
    ${fuehrend}
    ${pollBauer}
    ${loescher}
    ${renderer}
    window.loeschePoll = loeschePoll;
    window.renderPolls = renderPolls;
    window.knopfAktiv = knopfAktiv;
    // Der Neubau der Liste ist hier NICHT nachgebaut: Es ist derselbe Aufruf,
    // den auch eine fremde Stimme ueber Realtime ausloest.
    window.zeichne = () => renderPolls();
  `,
});

const POLL = {
  id: 7, closed: false, totalVotes: 191, totalUsd: 781420,
  question: 'Should we open the token gate to smaller holders?',
  myOptionId: null,
  options: [
    { id: 1, label: 'Ship it this week', votes: 128, usd: 482900, share: .618 },
    { id: 2, label: 'Wait for the audit', votes: 63, usd: 298520, share: .382 },
  ],
};

const befunde = [];
const pruefe = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

console.log('\nLöschknopf bei den Abstimmungen\n');

const aufbauen = (admin = true) => seite.evaluate(({ p, admin }) => {
  window.state.me.isAdmin = admin;
  window.state.polls = [p];
  window.geloescht = [];
  window.tosts = [];
  window.neuGeladen = 0;
  window.dbFehler = null;
  // Der scharfe Zustand muss hier AUSDRUECKLICH geloescht werden, und dass er
  // das muss, ist der ganze Punkt dieser Fassung: Frueher raeumte ihn der
  // Neubau der Liste von selbst weg, weil er am Knopf hing und der Knopf
  // verschwand. Genau das war der Fehler. Jetzt ueberlebt er den Neubau – also
  // auch den zwischen zwei Abschnitten dieses Tests, und ein Abschnitt fienge
  // mit einem scharfen Knopf aus dem vorigen an.
  window.knopfAktiv.clear();
  window.zeichne();
}, { p: POLL, admin });

// --- 1. Nur Ansem sieht ihn ------------------------------------------------
await aufbauen(false);
pruefe('Ohne Adminrechte gibt es den Knopf nicht',
  await seite.evaluate(() => !document.querySelector('.poll-delete')));
pruefe('Die harmlosen Knöpfe sind trotzdem da',
  await seite.evaluate(() =>
    Boolean(document.querySelector('.poll-share') && document.querySelector('.poll-image'))));

await aufbauen(true);
pruefe('Als Ansem ist er da',
  await seite.evaluate(() => Boolean(document.querySelector('.poll-delete'))));

// --- 2. Im Ruhezustand ein Papierkorb --------------------------------------
pruefe('Vorher steht dort ein Papierkorb',
  await seite.evaluate(() => window.istKorb(document.querySelector('.poll-delete'))));

// --- 3. Ein Tipper löscht nicht, sondern macht ein Häkchen -----------------
await seite.click('.poll-delete');
await seite.waitForTimeout(120);
const nachEins = await seite.evaluate(() => {
  const b = document.querySelector('.poll-delete');
  return {
    geloescht: window.geloescht,
    tosts: window.tosts,
    haken: window.istHaken(b),
    korb: window.istKorb(b),
    titel: b.title,
    farbe: getComputedStyle(b).backgroundColor,
  };
});
pruefe('Ein einzelner Tipper löscht nichts',
  nachEins.geloescht.length === 0, JSON.stringify(nachEins.geloescht));
pruefe('Aus dem Papierkorb wird ein Häkchen',
  nachEins.haken && !nachEins.korb,
  `Haken: ${nachEins.haken}, Korb: ${nachEins.korb}`);
pruefe('Es poppt nichts auf', nachEins.tosts.length === 0,
  nachEins.tosts.map((t) => t.m).join(' | '));
// Rot war der vorherige Stand und ist ausdrücklich nicht mehr gewollt.
pruefe('Der Knopf wird nicht eingefärbt',
  !/rgb\(2[0-9][0-9]/.test(nachEins.farbe), nachEins.farbe);
pruefe('Der Tooltip sagt, was der zweite Tipper tut',
  /again/i.test(nachEins.titel), nachEins.titel);

// --- 4. Der zweite Tipper löscht -------------------------------------------
await seite.click('.poll-delete');
await seite.waitForTimeout(150);
const nachZwei = await seite.evaluate(() => {
  const b = document.querySelector('.poll-delete');
  return {
    geloescht: window.geloescht,
    tosts: window.tosts,
    neuGeladen: window.neuGeladen,
    korb: b ? window.istKorb(b) : null,
  };
});
pruefe('Der zweite Tipper löscht – und die richtige Abstimmung',
  nachZwei.geloescht.length === 1 && nachZwei.geloescht[0] === 7,
  JSON.stringify(nachZwei.geloescht));
pruefe('Danach wird die Liste neu geladen', nachZwei.neuGeladen === 1,
  String(nachZwei.neuGeladen));
pruefe('Auch beim Erfolg poppt nichts auf', nachZwei.tosts.length === 0,
  nachZwei.tosts.map((t) => t.m).join(' | '));
pruefe('Das Häkchen ist wieder ein Papierkorb', nachZwei.korb === true);

// --- 5. Das Häkchen verfällt -----------------------------------------------
// Ohne das bliebe ein scharfer Knopf im Blatt stehen, von dem niemand mehr
// weiß – und der nächste beiläufige Tipper löscht.
await aufbauen(true);
await seite.click('.poll-delete');
await seite.waitForTimeout(5400);
pruefe('Nach fünf Sekunden ist wieder der Papierkorb da',
  await seite.evaluate(() => window.istKorb(document.querySelector('.poll-delete'))));
await seite.click('.poll-delete');
await seite.waitForTimeout(120);
pruefe('Der nächste Tipper macht nur wieder ein Häkchen, statt zu löschen',
  (await seite.evaluate(() => window.geloescht.length)) === 0);

// --- 6. Wenn die Datenbank ablehnt -----------------------------------------
await aufbauen(true);
await seite.evaluate(() => { window.dbFehler = 'new row violates row-level security policy'; });
await seite.click('.poll-delete');
await seite.waitForTimeout(80);
await seite.click('.poll-delete');
await seite.waitForTimeout(150);
const abgelehnt = await seite.evaluate(() => ({
  tosts: window.tosts,
  neuGeladen: window.neuGeladen,
  bedienbar: !document.querySelector('.poll-delete').disabled,
}));
pruefe('Eine Ablehnung der Datenbank wird sehr wohl gemeldet',
  abgelehnt.tosts.some((t) => t.err && /row-level/.test(t.m)),
  abgelehnt.tosts.map((t) => t.m).join(' | '));
pruefe('Und die Liste wird dann NICHT neu geladen', abgelehnt.neuGeladen === 0,
  String(abgelehnt.neuGeladen));
pruefe('Der Knopf bleibt bedienbar', abgelehnt.bedienbar);

// --- 7. Ein Neubau der Liste darf das Häkchen nicht wegnehmen -------------
//
// Der Fehler, um den es hier geht, und warum er nur "manchmal" auftrat:
//
//   Der scharfe Zustand hing als btn._scharf AM KNOPF. renderPolls() baut die
//   Liste mit innerHTML komplett neu, jeder Knopf ist danach ein anderer
//   Knoten – ohne _scharf und mit einem Papierkorb statt dem Häkchen.
//
//   Neu gebaut wird bei jeder fremden Stimme: Realtime meldet votes,
//   reloadSoon wartet 400 ms, loadPolls lädt. Zwischen dem ersten und dem
//   zweiten Tipper liegen aber ein bis zwei Sekunden. Fiel eine Stimme
//   dazwischen, schärfte der zweite Tipper nur wieder scharf, statt zu
//   löschen – und es sah aus, als klemme der Knopf.
//
// Geprüft wird deshalb genau diese Reihenfolge, und der Neubau ist der ECHTE
// Aufruf von renderPolls, nicht ein nachgebauter.
console.log('\nEine fremde Stimme mittendrin\n');

await aufbauen(true);
await seite.click('.poll-delete');
await seite.waitForTimeout(80);
const dazwischen = await seite.evaluate(() => {
  const vorher = document.querySelector('.poll-delete');
  window.renderPolls();                       // wie eine fremde Stimme
  const nachher = document.querySelector('.poll-delete');
  return {
    // Gegenprobe auf den Test selbst: Wäre es derselbe Knoten, prüfte er gar
    // nichts – dann hätte auch die alte Fassung bestanden.
    neuerKnoten: vorher !== nachher,
    haken: window.istHaken(nachher),
    korb: window.istKorb(nachher),
  };
});
pruefe('Vorprobe: der Neubau tauscht den Knopf wirklich aus', dazwischen.neuerKnoten);
pruefe('Das Häkchen steht nach dem Neubau immer noch da',
  dazwischen.haken && !dazwischen.korb,
  `Haken: ${dazwischen.haken}, Korb: ${dazwischen.korb}`);

await seite.click('.poll-delete');
await seite.waitForTimeout(150);
pruefe('Und der zweite Tipper löscht, als wäre nichts gewesen',
  (await seite.evaluate(() => window.geloescht)).join() === '7',
  JSON.stringify(await seite.evaluate(() => window.geloescht)));

// Die Gegenrichtung gehört dazu: Der Zustand darf den Neubau überleben, aber
// nicht die fünf Sekunden. Sonst hätte man den einen Fehler gegen einen
// schlimmeren getauscht – einen scharfen Knopf, von dem niemand mehr weiß.
await aufbauen(true);
await seite.click('.poll-delete');
await seite.waitForTimeout(80);
await seite.evaluate(() => window.renderPolls());
await seite.waitForTimeout(5400);
await seite.evaluate(() => window.renderPolls());
pruefe('Nach fünf Sekunden ist er trotzdem stumpf – auch über Neubauten hinweg',
  await seite.evaluate(() => window.istKorb(document.querySelector('.poll-delete'))));
pruefe('Und der Zustand ist wirklich weg, nicht nur unsichtbar',
  await seite.evaluate(() => window.knopfAktiv.size === 0));

// Der Tastaturfokus ist derselbe Fall in leise: innerHTML wirft ihn auf
// <body>, und wer sich mit der Tabulatortaste zum Löschknopf vorgearbeitet
// hat, drückt danach Enter ins Leere.
await aufbauen(true);
await seite.evaluate(() => document.querySelector('.poll-delete').focus());
await seite.evaluate(() => window.renderPolls());
pruefe('Der Tastaturfokus bleibt auf dem Knopf, wenn die Liste neu gebaut wird',
  await seite.evaluate(() =>
    document.activeElement === document.querySelector('.poll-delete')),
  await seite.evaluate(() => document.activeElement?.className || 'body'));

// --- Bild ------------------------------------------------------------------
await aufbauen(true);
await seite.click('.poll-delete');
await seite.waitForTimeout(150);
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
await seite.screenshot({ path: path.join(root, 'preview', 'poll-loeschen.png') });

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
