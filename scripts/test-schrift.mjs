// ============================================================================
// Checks the two decisions behind the site's new look: one typeface, and
// a background with no gradient.
//
// "One typeface" means: on the images too. The poll card that gets posted
// to X is a canvas and inherits nothing from the stylesheet - it fetches
// its own font in code. It was therefore the last surface still in the
// grotesque, and of all things the one that goes out into the world.
// Stragglers like that are exactly what this test checks for.
//
// The second trap sits right next to it: a card image is generated ONCE
// and then served by X for years afterward. Whoever changes the card's
// look without bumping CARD_VERSION only changes future cards - every
// existing one silently keeps its old face. And because the number lives
// in TWO places (app.js and the edge function), it's doubly easy to touch
// only one of them. Keeping the two in sync is checked in
// test-poll-bild.mjs; here what's checked is that the card no longer uses
// a second typeface at all.
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
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`);

const befunde = [];
const check = (name, ok, zusatz = '') => {
  befunde.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FEHL'}  ${name}${zusatz ? '  – ' + zusatz : ''}`);
};

console.log('\nEine Schrift\n');

const measured = await page.evaluate(() => {
  const first = (el) => getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
  // Across the whole page: header, tabs, button, input, threshold field,
  // poll field, login. If any one of them strays, it shows up here.
  const stellen = {
    body: document.body,
    reiter: document.querySelector('.tab'),
    button: document.querySelector('.btn-primary'),
    marker: document.querySelector('.brand'),
    dmEingabe: document.querySelector('#dm-input'),
    filterText: document.querySelector('.filters-label'),
    abstimmung: document.querySelector('#poll-question'),
    loginFeld: document.querySelector('#wallet-input'),
  };
  const out = {};
  for (const [k, el] of Object.entries(stellen)) out[k] = el ? first(el) : null;
  return {
    familien: out,
    grund: getComputedStyle(document.body).backgroundImage,
    sans: getComputedStyle(document.documentElement).getPropertyValue('--sans').trim(),
  };
});

const einzig = [...new Set(Object.values(measured.familien).filter(Boolean))];
check('Die ganze Seite benutzt genau eine Schrift',
  einzig.length === 1, einzig.join(' / '));

// "ui-monospace" is the first entry of --mono. If something else shows up
// there, the page has fallen back to the grotesque.
check('Und zwar die Schreibmaschinenschrift',
  einzig[0] === 'ui-monospace', String(einzig[0]));

for (const [wo, fam] of Object.entries(measured.familien)) {
  if (fam === null) check(`Stelle "${wo}" ist im Blatt nicht mehr zu finden`, false);
}

console.log('\nGrund ohne Farbverlauf\n');
check('Der Hintergrund trägt kein Bild mehr',
  measured.grund === 'none', measured.grund);
check('Kein Rest der beiden Lichter im Blatt',
  !/body\s*\{[^}]*radial-gradient/s.test(css));

console.log('\nAuch die Bilder\n');

// The canvas inherits nothing from the sheet. Every font line in
// drawPoll() sits in the code, and every single one has to name the
// mono.
const zeichnen = (() => {
  const a = appJs.indexOf('async function drawPoll');
  const b = appJs.indexOf('\nasync function', a + 10);
  if (a < 0) throw new Error('drawPoll nicht in app.js gefunden');
  return appJs.slice(a, b < 0 ? undefined : b);
})();
const schriftzeilen = zeichnen.match(/font = `[^`]+`/g) || [];
check('Die Karte setzt überhaupt Schriften', schriftzeilen.length > 0,
  `${schriftzeilen.length} Stellen`);
check('Und jede davon nennt die Mono',
  schriftzeilen.every((z) => z.includes('${mono}')),
  schriftzeilen.filter((z) => !z.includes('${mono}')).join(' | ') || 'alle');

// And now the reason the whole repo is searched here, not just app.js and
// the sheet.
//
// One spot got missed during the switchover: scripts/og-karte.mjs draws
// the fallback card - the one X shows when a link points to a deleted poll
// - and it fetched its font via --sans too. Once the variable was removed,
// that produced an empty string, the font declaration became invalid, and
// the canvas fell back to its default of 10 px. The script ran without
// error and wrote a card where "SIZED" sat in matchstick-sized type.
//
// That's exactly the nature of a canvas: an unknown font isn't an error
// there, it's a silent fallback choice. So this doesn't just check the one
// known spot, it checks every file that could possibly draw.
const files = [
  ...fs.readdirSync(path.join(root, 'public'))
      .filter((f) => /\.(js|css|html)$/.test(f))
      .map((f) => path.join('public', f)),
  ...fs.readdirSync(path.join(root, 'scripts'))
      .filter((f) => f.endsWith('.mjs') && f !== 'test-schrift.mjs')
      .map((f) => path.join('scripts', f)),
];

// Comments don't count: the sheet DOES explain why --sans is gone, and
// that sentence mustn't trip the test.
const ohneKommentare = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const treffer = files.filter((rel) =>
  /--sans/.test(ohneKommentare(fs.readFileSync(path.join(root, rel), 'utf8'))));

check('Keine Datei benutzt oder definiert --sans mehr',
  treffer.length === 0, treffer.join(', ') || `${files.length} Dateien geprüft`);
check('Auch der Browser kennt sie nicht mehr', !measured.sans, measured.sans || 'empty');

await browser.close();
server.close();

const durch = befunde.filter((b) => !b.ok);
console.log(durch.length
  ? `\n  ${durch.length} von ${befunde.length} fehlgeschlagen\n`
  : `\n  Alle ${befunde.length} bestanden\n`);
process.exit(durch.length ? 1 : 0);
