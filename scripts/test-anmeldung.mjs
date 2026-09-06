// ============================================================================
// Was beim Kopieren von Betrag und Adresse in der Zwischenablage landet.
//
// Die beiden Zeilen auf dem Anmeldeschirm sind Kopierknoepfe – aber nicht
// jeder benutzt sie. Viele markieren die Adresse von Hand, und dabei rutscht
// die Markierung leicht auf "SEND TO" oder "Tap to copy" mit.
//
// Warum das eine eigene Pruefung wert ist: Hier haengt Geld dran. Eine
// Ueberweisung an eine Adresse mit angehaengtem Text geht ins Leere, und das
// Geld ist weg – es gibt keine Rueckbuchung. Ein falsch markierter Betrag ist
// harmloser, kostet aber die Anmeldung: Die Treasury horcht auf genau eine
// Zahl.
//
// Geprueft wird deshalb nicht die CSS-Regel, sondern was der Browser
// tatsaechlich markiert – mit echten Maus- und Doppelklicks. Eine Regel kann
// dastehen und trotzdem wirkungslos sein; das sagt nur die Messung.
//
//   node scripts/test-anmeldung.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

// Die echte Kopierlogik, woertlich herausgeschnitten. Eine nachgebaute Kopie
// wuerde diesen Test bestehen, waehrend die Seite den blauen Block weiter
// zeigt – und genau darum geht es hier.
const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const kopierCode = schneide('async function copyText(', '\n// ---');

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const datei = path.join(root, 'public', pfad);
  if (!datei.startsWith(path.join(root, 'public')) || !fs.existsSync(datei)) {
    return res.writeHead(404).end('');
  }
  // app.js braucht eine Datenbank; hier geht es nur um Blatt und Stil.
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('/* Test */');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(datei));
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

// Neben "Waiting for payment" sass einmal ein pulsierender Punkt in der
// Akzentfarbe. Er ist raus – und damit er nicht bei der naechsten Umarbeitung
// unbemerkt zurueckkehrt, steht es hier fest. Die Akzentfarbe ist die
// auffaelligste der Seite; blinkend liest sie sich als Warnung, ausgerechnet
// dort, wo jemand gerade Geld verschickt hat.
const blattQuelle = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const stilQuelle = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

const befunde = [];
const pruefe = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

const BETRAG = '0.002042779 SOL';
const ADRESSE = '4boaBdaCkqtgPmWV4JzwJ81azM9XTNhgVPqCZW7b7Kyo';

const kontext = await browser.newContext({ viewport: { width: 520, height: 900 } });
await kontext.grantPermissions(['clipboard-read', 'clipboard-write']);
const seite = await kontext.newPage();
await seite.goto(`http://127.0.0.1:${server.address().port}/`);
await seite.evaluate(([betrag, adresse]) => {
  document.querySelector('#login').hidden = false;
  document.querySelector('#step-address').hidden = true;
  document.querySelector('#step-pay').hidden = false;
  document.querySelector('#pay-amount').textContent = betrag;
  document.querySelector('#pay-treasury').textContent = adresse;
}, [BETRAG, ADRESSE]);

// Erst jetzt die Zuhoerer anhaengen, mit gefuellten Feldern.
await seite.addScriptTag({ content: `
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  window.meldungen = [];
  const toast = (m, err) => window.meldungen.push({ m, err: Boolean(err) });
  ${kopierCode}
  window.copyText = copyText;
` });

const leeren = () => seite.evaluate(() => getSelection().removeAllRanges());
const markiert = () => seite.evaluate(() => String(getSelection()));

/**
 * Zieht mit gedrueckter Maustaste ueber die Zeile.
 *
 * `vonOben` entscheidet, wo der Zug beginnt – und das ist der Unterschied
 * zwischen den beiden Regeln, die hier zusammenwirken:
 *
 *   Beginnt er IM Wert, haelt ihn user-select: all zusammen.
 *   Beginnt er auf der BESCHRIFTUNG, greift das nicht mehr; dort haelt nur
 *   user-select: none das Beiwerk aus der Markierung.
 *
 * Beide Faelle kommen vor: Wer eine lange Adresse markieren will, setzt gern
 * ein Stueck darueber an.
 */
const ziehen = async (sel, { vonOben = false } = {}) => {
  await leeren();
  const k = await seite.evaluate(([s, oben]) => {
    const wert = document.querySelector(s).getBoundingClientRect();
    const zeile = document.querySelector(s).closest('.pay-row').getBoundingClientRect();
    return oben
      ? { x1: zeile.left + 4, y1: zeile.top + 4, x2: wert.right - 3, y2: wert.bottom - 3 }
      : { x1: wert.left + 3, y1: wert.top + wert.height / 2,
          x2: zeile.right - 3, y2: zeile.top + 3 };
  }, [sel, vonOben]);
  await seite.mouse.move(k.x1, k.y1);
  await seite.mouse.down();
  await seite.mouse.move(k.x2, k.y2, { steps: 14 });
  await seite.mouse.up();
  return markiert();
};

console.log('\nBetrag und Adresse kopieren\n');

const leseZwischenablage = () => seite.evaluate(() => navigator.clipboard.readText());

// --- 1. Antippen kopiert – und markiert nichts ----------------------------
//
// Das ist der Punkt: Die Zeile IST der Kopierknopf. Eine blaue Markierung
// daneben ist keine zweite Hilfe, sondern eine zweite Antwort auf dasselbe
// Antippen – man tippt einmal und bekommt "Copied ✓" UND einen blauen Block.
for (const [sel, erwartet, name] of [
  ['#pay-treasury', ADRESSE, 'die Adresse'],
  ['#pay-amount', BETRAG.replace(' SOL', ''), 'den Betrag'],
]) {
  await leeren();
  await seite.click(sel);
  pruefe(`Antippen kopiert ${name}`,
    (await leseZwischenablage()) === erwartet,
    JSON.stringify(await leseZwischenablage()));
  pruefe(`Und markiert dabei nichts (${name.slice(4)})`,
    (await markiert()) === '', JSON.stringify(await markiert()));
}

// Der Betrag wird OHNE " SOL" kopiert – in ein Wallet-Feld gehoert die Zahl,
// nicht die Einheit. Das steht schon in der Pruefung darueber; hier noch
// einmal ausdruecklich, weil es leicht beim Umbau verlorengeht.
pruefe('Beim Betrag bleibt die Einheit aussen vor',
  !(await leseZwischenablage()).includes('SOL'), await leseZwischenablage());

// --- 2. Auch Ziehen holt nichts hervor ------------------------------------
pruefe('Ueber die Zeile zu ziehen markiert nichts (Adresse)',
  (await ziehen('#pay-treasury')) === '');
pruefe('Und von der Beschriftung aus auch nicht',
  (await ziehen('#pay-treasury', { vonOben: true })) === '');

// --- 3. Doppelklick ebenfalls nicht ---------------------------------------
await leeren();
await seite.dblclick('#pay-treasury');
pruefe('Doppelklick markiert nichts', (await markiert()) === '',
  JSON.stringify(await markiert()));

// --- 4. Aber der Notfall muss markieren koennen ---------------------------
//
// Schlaegt das Kopieren fehl – kein HTTPS, ein eingebetteter Browser ohne
// Zwischenablage –, markiert app.js den Wert selbst und sagt es. Waere die
// Zeile dann immer noch nicht markierbar, zeigte diese Meldung auf nichts:
// die schlechteste aller Varianten, weil sie behauptet, geholfen zu haben.
//
// Nachgestellt wird der Fehlschlag an der Wurzel: Beide Wege der
// Zwischenablage werden abgeschaltet.
{
  await leeren();
  await seite.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = () => false;
    window.meldungen = [];
  });
  await seite.click('#pay-treasury');
  await seite.waitForTimeout(60);

  const zeile = await seite.evaluate(() =>
    document.querySelector('[data-copy="#pay-treasury"]').className);
  pruefe('Im Fehlerfall wird die Zeile markierbar gemacht',
    /zum-markieren/.test(zeile), zeile);
  pruefe('Und der Wert ist dann wirklich markiert',
    (await markiert()) === ADRESSE, JSON.stringify(await markiert()));
  pruefe('Die Meldung sagt es auch',
    await seite.evaluate(() => window.meldungen.some((m) => m.err && /selected/i.test(m.m))));
}

pruefe('Kein pulsierender Punkt neben "Waiting for payment"',
  !/class="pulse"/.test(blattQuelle) && !/@keyframes pulse/.test(stilQuelle));

// Kopiert: nur der Umriss, kurz, und nicht grell.
// ---------------------------------------------------------------------------
// Hier stand die Akzentfarbe auf dem Umriss UND ein gefuellter Grund – zwei
// Signale in der hellsten Farbe der Seite. Auf dem Handy blitzte damit die
// ganze Zeile auf.
const kopiertRegel = stilQuelle.slice(
  stilQuelle.indexOf('.pay-row.is-copied {'),
  stilQuelle.indexOf('}', stilQuelle.indexOf('.pay-row.is-copied {')) + 1);
pruefe('Beim Kopieren wird nur der Umriss hell',
  /border-color/.test(kopiertRegel) && !/background/.test(kopiertRegel),
  kopiertRegel.trim());
pruefe('Und nicht in der Akzentfarbe',
  !/var\(--accent/.test(kopiertRegel), kopiertRegel.trim());
// Gegenprobe zum Ausschnitt: Ohne ihn wuerde oben in der ganzen Datei gesucht,
// und "background" steht dort hundertfach – die Pruefung waere immer rot,
// und "--accent" ebenso.
pruefe('Gegenprobe: der Ausschnitt ist wirklich nur diese eine Regel',
  kopiertRegel.length < 200 && kopiertRegel.startsWith('.pay-row.is-copied'),
  `${kopiertRegel.length} Zeichen`);
// Und die Dauer. Der Rahmen ist bewusst weit: Geprueft wird nicht die eine
// richtige Zahl – die entscheidet sich am Geraet –, sondern dass es
// ueberhaupt ein kurzer Blitz bleibt. 1800 ms sahen aus wie ein Zustand,
// unter 500 bemerkt man sie nicht, seit der Umriss nur noch dezent hell wird.
const dauer = Number(/const KOPIERT_MS = (\d+);/.exec(
  fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8'))?.[1]);
pruefe('Der Umriss wird nach kurzer Zeit wieder normal',
  dauer >= 500 && dauer <= 1600, `${dauer} ms`);

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
