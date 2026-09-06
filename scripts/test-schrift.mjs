// ============================================================================
// Prüft die beiden Entscheidungen hinter dem neuen Aussehen der Seite:
// eine Schrift, und ein Grund ohne Farbverlauf.
//
// "Eine Schrift" heißt: auch auf den Bildern. Die Abstimmungskarte, die auf X
// gepostet wird, ist eine Leinwand und erbt nichts aus dem Stilblatt – sie
// holt sich ihre Schrift im Code. Sie war deshalb die letzte Fläche in
// Grotesk, und ausgerechnet die, die nach draußen geht. Genau solche
// Nachzügler prüft dieser Test.
//
// Die zweite Falle sitzt daneben: Ein Kartenbild wird EINMAL erzeugt und
// danach jahrelang von X ausgeliefert. Wer das Aussehen der Karte ändert,
// ohne KARTEN_VERSION hochzuzählen, ändert damit nur die künftigen Karten –
// alle bestehenden behalten stumm ihr altes Gesicht. Und weil die Zahl an
// ZWEI Stellen steht (app.js und die Edge Function), fällt es doppelt leicht,
// nur eine davon anzufassen. Der Abgleich der beiden liegt in
// test-poll-bild.mjs; hier wird geprüft, dass die Karte überhaupt keine
// zweite Schrift mehr benutzt.
//
//   node scripts/test-schrift.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/ hidden(?=[ >])/g, '');

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(html.replace('</head>', `<style>${css}</style></head>`)));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const seite = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await seite.goto(`http://127.0.0.1:${server.address().port}/`);

const befunde = [];
const pruefe = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

console.log('\nEine Schrift\n');

const gemessen = await seite.evaluate(() => {
  const erste = (el) => getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
  // Quer durch die Seite: Kopfzeile, Reiter, Knopf, Eingabe, Schwellenfeld,
  // Abstimmungsfeld, Login. Wenn eine davon ausschert, sieht man es hier.
  const stellen = {
    body: document.body,
    reiter: document.querySelector('.tab'),
    knopf: document.querySelector('.btn-primary'),
    marke: document.querySelector('.brand'),
    dmEingabe: document.querySelector('#dm-input'),
    filterText: document.querySelector('.filters-label'),
    abstimmung: document.querySelector('#poll-question'),
    loginFeld: document.querySelector('#wallet-input'),
  };
  const out = {};
  for (const [k, el] of Object.entries(stellen)) out[k] = el ? erste(el) : null;
  return {
    familien: out,
    grund: getComputedStyle(document.body).backgroundImage,
    sans: getComputedStyle(document.documentElement).getPropertyValue('--sans').trim(),
  };
});

const einzig = [...new Set(Object.values(gemessen.familien).filter(Boolean))];
pruefe('Die ganze Seite benutzt genau eine Schrift',
  einzig.length === 1, einzig.join(' / '));

// "ui-monospace" ist der erste Eintrag von --mono. Steht dort etwas anderes,
// ist die Seite auf die Grotesk zurueckgefallen.
pruefe('Und zwar die Schreibmaschinenschrift',
  einzig[0] === 'ui-monospace', String(einzig[0]));

for (const [wo, fam] of Object.entries(gemessen.familien)) {
  if (fam === null) pruefe(`Stelle "${wo}" ist im Blatt nicht mehr zu finden`, false);
}

console.log('\nGrund ohne Farbverlauf\n');
pruefe('Der Hintergrund trägt kein Bild mehr',
  gemessen.grund === 'none', gemessen.grund);
pruefe('Kein Rest der beiden Lichter im Blatt',
  !/body\s*\{[^}]*radial-gradient/s.test(css));

console.log('\nAuch die Bilder\n');

// Die Leinwand erbt nichts aus dem Blatt. Jede Schriftzeile in zeichnePoll()
// steht im Code, und jede einzelne muss die Mono nennen.
const zeichnen = (() => {
  const a = appJs.indexOf('async function zeichnePoll');
  const b = appJs.indexOf('\nasync function', a + 10);
  if (a < 0) throw new Error('zeichnePoll nicht in app.js gefunden');
  return appJs.slice(a, b < 0 ? undefined : b);
})();
const schriftzeilen = zeichnen.match(/font = `[^`]+`/g) || [];
pruefe('Die Karte setzt überhaupt Schriften', schriftzeilen.length > 0,
  `${schriftzeilen.length} Stellen`);
pruefe('Und jede davon nennt die Mono',
  schriftzeilen.every((z) => z.includes('${mono}')),
  schriftzeilen.filter((z) => !z.includes('${mono}')).join(' | ') || 'alle');

// Und jetzt der Grund, warum hier ueber die ganze Ablage gesucht wird und
// nicht nur in app.js und im Blatt.
//
// Beim Umstellen wurde eine Stelle uebersehen: scripts/og-karte.mjs zeichnet
// die Ersatzkarte – die, die X zeigt, wenn ein Link auf eine geloeschte
// Abstimmung geht – und holte sich ihre Schrift ebenfalls ueber --sans. Nach
// dem Entfernen der Variablen lieferte das einen leeren String, der Schriftsatz
// wurde ungueltig, und die Leinwand fiel auf ihre Grundeinstellung von 10 px
// zurueck. Das Skript lief ohne Fehler durch und schrieb eine Karte, auf der
// "SIZED" als Streichholzschrift stand.
//
// Genau das ist die Eigenart einer Leinwand: Eine unbekannte Schrift ist dort
// kein Fehler, sondern eine stille Ersatzwahl. Deshalb wird hier nicht die
// eine bekannte Stelle geprueft, sondern jede Datei, die zeichnen koennte.
const dateien = [
  ...fs.readdirSync(path.join(root, 'public'))
      .filter((f) => /\.(js|css|html)$/.test(f))
      .map((f) => path.join('public', f)),
  ...fs.readdirSync(path.join(root, 'scripts'))
      .filter((f) => f.endsWith('.mjs') && f !== 'test-schrift.mjs')
      .map((f) => path.join('scripts', f)),
];

// Kommentare zaehlen nicht: Im Blatt STEHT erklaert, warum --sans weg ist, und
// dieser Satz darf den Test nicht ausloesen.
const ohneKommentare = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const treffer = dateien.filter((rel) =>
  /--sans/.test(ohneKommentare(fs.readFileSync(path.join(root, rel), 'utf8'))));

pruefe('Keine Datei benutzt oder definiert --sans mehr',
  treffer.length === 0, treffer.join(', ') || `${dateien.length} Dateien geprüft`);
pruefe('Auch der Browser kennt sie nicht mehr', !gemessen.sans, gemessen.sans || 'leer');

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
