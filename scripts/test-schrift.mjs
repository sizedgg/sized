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

// The font files have to be served for real.
//
// This server used to answer EVERY request with the page, which was fine as
// long as the page fetched nothing. Since the sheet carries @font-face, the
// browser asked for /fonts/ibm-plex-mono-400.woff2 and got HTML back - the
// font never loaded, and the check below that measures a glyph width was
// comparing the fallback against the fallback. It reported a difference
// anyway, because a font-family with no fallback of its own falls through to
// the browser's DEFAULT font, which is proportional. Two fallbacks, two
// different widths, one green check measuring nothing.
const server = http.createServer((q, res) => {
  const pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad.startsWith('/fonts/')) {
    const datei = path.join(root, 'public', 'fonts', path.basename(pfad));
    if (!fs.existsSync(datei)) return res.writeHead(404).end('');
    return res.writeHead(200, { 'content-type': 'font/woff2' }).end(fs.readFileSync(datei));
  }
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(html.replace('</head>', `<style>${css}</style></head>`));
});
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

// "IBM Plex Mono" is the first entry of --mono. If something else shows up
// there, the page has fallen back - either to the system's monospace or,
// worse, to the grotesque.
check('Und zwar die Schreibmaschinenschrift',
  einzig[0] === 'IBM Plex Mono', String(einzig[0]));

// The NAME being right proves nothing about the file.
//
// A computed font-family says what was asked for, not what was drawn. Delete
// the four .woff2 files and every check above stays green: the name is still
// in the stylesheet, the browser silently falls through to ui-monospace, and
// the page runs on the system font again without a word.
//
// So this measures a glyph. The same string is set twice, once in the shipped
// face and once in the pure fallback, and their widths are compared. Equal
// widths mean the file never arrived.
const geladen = await page.evaluate(async () => {
  await document.fonts.ready;
  const mess = (fam) => {
    const s = document.createElement('span');
    s.textContent = '0123456789 $1,640,000';
    s.style.cssText = `position:absolute;visibility:hidden;font:400 40px ${fam}`;
    document.body.appendChild(s);
    const w = s.getBoundingClientRect().width;
    s.remove();
    return Math.round(w * 100) / 100;
  };
  return {
    geladen: document.fonts.check('400 15px "IBM Plex Mono"'),
    plex: mess("'IBM Plex Mono', monospace"),
    ersatz: mess('monospace'),
  };
});
check('Die Schriftdatei ist wirklich angekommen', geladen.geladen);
check('Und wird auch benutzt, nicht nur genannt',
  geladen.plex !== geladen.ersatz,
  `Plex ${geladen.plex}px, Ersatz ${geladen.ersatz}px`);

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

// The weights, and this is a new kind of trap since the page ships its own
// font. A canvas does not load a font - it draws whatever is already there
// and falls back silently for anything else. drawPoll therefore requests
// every cut it uses up front, from the list in KARTEN_SCHNITTE. If a font
// line asks for a weight that is not on that list, that one line is drawn in
// the fallback, in an image that then sits on X for years.
//
// Reading the weight is not just "the number after the backtick": one line
// picks it with a ternary - `${spitze ? '650' : '500'} ...` - and a regex
// anchored at the start read 650 and quietly missed 500. So the line is cut
// at the first "px" (everything before it is weight and size) and every
// three-digit number in that part is taken.
const genannt = [...new Set(schriftzeilen
  .flatMap((z) => (z.split('px')[0].match(/\d{3}/g) || []))
  .filter(Boolean))].sort();
const geladenListe = (/const KARTEN_SCHNITTE = \[([^\]]+)\]/.exec(appJs)?.[1] ?? '')
  .split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean).sort();
check('Die Karte sagt, welche Schnitte sie braucht', geladenListe.length > 0,
  geladenListe.join(', ') || 'keine Liste');
const vergessen = genannt.filter((g) => !geladenListe.includes(g));
check('Und jeder Schnitt, den sie zeichnet, steht auch drin',
  vergessen.length === 0,
  vergessen.length ? `fehlt: ${vergessen.join(', ')}` : `gezeichnet: ${genannt.join(', ')}`);
// The other direction is not an error, only waste - a cut loaded and never
// drawn costs a request. Worth reporting, not worth failing on.
const ueberfluessig = geladenListe.filter((g) => !genannt.includes(g));
if (ueberfluessig.length) {
  console.log(`  note  Geladen, aber nie gezeichnet: ${ueberfluessig.join(', ')}`);
}

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
