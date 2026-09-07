// ============================================================================
// Preview images: the counter's green as the bar fill
//
// The hue isn't estimated, it's measured from a screenshot: the digits' core
// pixels, of those the brightest tenth, of those the median. Anti-aliasing
// against the dark background pulls the edge pixels down and skews any
// average taken over the whole glyph - hence only the core.
//
//   Median of the brightest tenth: #7cdb68   (740 pixels)
//
// Four loudness levels of the same hue are shown. The middle one is the one
// where the fill lifts off the row background by exactly as much as today's
// white - same loudness, different color. The upper limit isn't a matter of
// taste: the answer text and the vote count sit on the fill, and the vote
// count once stood at 1.3:1 here and was invisible.
//
// This script CHANGES NOTHING. It cuts the stylesheet and the drawing
// function verbatim out of the source and only swaps the one declaration in
// the browser.
//
// Produces preview/zaehler-*.png and preview/zaehler-uebersicht.png
//   node scripts/vorschau-balken-zaehler.mjs
// ============================================================================

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const drawSource = cut('const cssWert =', '\nasync function ladeOgBildHoch');
const markup = cut('function pollHtml(p) {', 'async function deletePoll(id) {');
const formate = cut('const nfGanz =', 'const wholeNumber')
  + cut('const wholeNumber =', '\n');
const escFn = cut('const esc = (s) =>', '\n\n');
const symbole = cut('const LINK_SVG =', 'const pollLink = (id) => `${location.origin}/p/${id}`;');

const JS_STELLE = 'ctx.fillStyle = `rgba(${color.akzentRgb}, .24)`;';
if (!drawSource.includes(JS_STELLE)) throw new Error('Die Füllung im Zeichner sieht anders aus als erwartet');
if (!css.includes('background: rgba(var(--accent-rgb), .24);')) {
  throw new Error('Die Füllung im Blatt sieht anders aus als erwartet');
}

// --- Color math ----------------------------------------------------------
const hex = (h) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const lum = ([r, g, b]) => {
  const f = (c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const kontrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mix = (v, a, h) => v.map((c, i) => Math.round(a * c + (1 - a) * h[i]));
const cssVar = (name) => {
  const m = new RegExp(`\\n\\s*${name}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`${name} nicht im Blatt gefunden`);
  return m[1].trim();
};

const GRUND = hex(cssVar('--bg-3'));
const TEXT = hex(cssVar('--text'));
const VOTES = hex(cssVar('--votes'));
const ZIEL_SPRUNG = kontrast(mix(hex(cssVar('--accent')), 0.24, GRUND), GRUND);

const COUNTER = '#7cdb68';   // measured, see header

const FASSUNGEN = [
  { file: 'leise', name: 'Leiser', alpha: 0.22,
    hinweis: 'Die Farbe ist da, der Balken bleibt Hintergrund. Leiser als das Weiss von heute.' },
  { file: 'gleich', name: 'Gleich laut wie heute', alpha: 0.30,
    hinweis: `Derselbe Helligkeitssprung wie die weisse Füllung (${ZIEL_SPRUNG.toFixed(2)}:1). Die Farbe ändert sich, die Lautstärke nicht – der ehrlichste Vergleich mit dem Jetzt.` },
  { file: 'kraeftig', name: 'Kräftiger', alpha: 0.38,
    hinweis: 'Der Balken wird zur Hauptsache in der Zeile, die harte Kante quer durch ein Wort tritt stärker hervor.' },
  { file: 'satt', name: 'Satt', alpha: 0.50,
    hinweis: 'Nahe an der reinen Farbe. Hier zeigt sich, wo es kippt – die Zahlen an der Überschrift sagen, ob es noch trägt.' },
];

console.log(`\n  Gemessener Ton: ${COUNTER}`);
console.log(`  Die heutige weisse Füllung springt ${ZIEL_SPRUNG.toFixed(2)}:1 vom Zeilengrund ab.\n`);
console.log('  ' + 'Fassung'.padEnd(24) + 'Deckkraft'.padEnd(11) + 'Sprung'.padEnd(9)
  + 'Antwort'.padEnd(10) + 'Stimmen');

for (const f of FASSUNGEN) {
  const color = hex(COUNTER);
  f.rgb = color.join(', ');
  const m = mix(color, f.alpha, GRUND);
  f.sprung = kontrast(m, GRUND);
  f.aufText = kontrast(TEXT, m);
  f.aufVotes = kontrast(VOTES, m);
  f.knapp = f.aufVotes < 4;
  console.log('  ' + f.name.padEnd(24)
    + `${(f.alpha * 100).toFixed(0)} %`.padEnd(11)
    + `${f.sprung.toFixed(2)}:1`.padEnd(9)
    + `${f.aufText.toFixed(1)}:1`.padEnd(10)
    + `${f.aufVotes.toFixed(1)}:1${f.knapp ? '   <- under 4:1' : ''}`);
}

// --- Images ----------------------------------------------------------------
const opt = (id, label, votes, usd, share) => ({ id, label, votes, usd, share });
const POLL = {
  id: 1, closed: false, myOptionId: 2, totalVotes: 191, totalUsd: 781420,
  question: 'Should we open the token gate to smaller holders?',
  options: [
    opt(1, 'Ship it this week', 128, 482900, 4829 / 7814.2),
    opt(2, 'Wait for the audit', 44, 210400, 2104 / 7814.2),
    opt(3, 'Do neither and keep building quietly', 19, 88120, 881.2 / 7814.2),
  ],
};

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body style="background:var(--bg);padding:18px"><div class="polls-panel" id="ziel"></div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

const ergebnisse = [];
for (const f of FASSUNGEN) {
  const newCss = `rgba(${f.rgb}, ${f.alpha})`;
  const page = await browser.newPage({ viewport: { width: 760, height: 420 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addStyleTag({ content: `.opt-fill { background: ${newCss} !important; }` });
  await page.addScriptTag({
    content: `
      const state = { cfg: { symbol: 'ANSEM' }, me: { isAdmin: false }, polls: [] };
      const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
      const toast = () => {};
      ${escFn}
      ${formate}
      ${symbole}
      ${markup}
      ${drawSource.replace(JS_STELLE, 'ctx.fillStyle = ' + JSON.stringify(newCss) + ';')}
      window.pollHtml = pollHtml;
      window.drawPoll = drawPoll;`,
  });
  await page.evaluate((p) => { document.querySelector('#ziel').innerHTML = window.pollHtml(p); }, POLL);
  await page.waitForTimeout(120);

  const pageImage = await page.locator('#ziel').screenshot();
  const daten = await page.evaluate(async (p) => ({
    big: (await window.drawPoll(p)).toDataURL('image/png'),
  }), POLL);
  await page.close();

  fs.writeFileSync(path.join(ausgabe, `zaehler-${f.file}-seite.png`), pageImage);
  fs.writeFileSync(path.join(ausgabe, `zaehler-${f.file}-download.png`),
    Buffer.from(daten.big.split(',')[1], 'base64'));
  ergebnisse.push({ page: 'data:image/png;base64,' + pageImage.toString('base64'), ...daten });
}

const blatt = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>
  body { background: #07080b; padding: 30px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 112ch; line-height: 1.6; }
  section { margin-bottom: 40px; }
  h2 { margin: 0 0 .1rem; font-size: 1rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.6rem; height: 1.6rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-size: .8rem; }
  .probe { width: 1.1rem; height: 1.1rem; border-radius: 4px; border: 1px solid var(--line); }
  .werte { font-size: .7rem; color: var(--dimmer); font-weight: 400; }
  .knapp { color: var(--warn); }
  p.t { margin: .3rem 0 .8rem; font-size: .84rem; color: #8b93a7; line-height: 1.55; max-width: 118ch; }
  .paar { display: grid; grid-template-columns: 1.05fr 1fr; gap: 20px; align-items: start; }
  .caption { font-size: .72rem; color: var(--dimmer); margin: 0 0 .35rem; }
  img { width: 100%; display: block; border-radius: 8px; }
  .buehne { background: #16181c; padding: 12px; border-radius: 12px; }
</style>
<h1>Das Grün aus dem Zähler als Balkenfüllung</h1>
<p class="lead">Der Ton ist aus dem Bildschirmfoto measured – Kernpixel der Ziffern, hellstes Zehntel, Median:
<b>${COUNTER}</b>. Vier Lautstärken desselben Tons. Fassung 1 springt genauso far vom Zeilengrund ab wie die
weisse Füllung von heute; dort ändert sich also nur die Farbe. An jeder Überschrift steht, wie gut Antworttext
und Stimmenzahl auf der Füllung noch lesbar sind – die Stimmenzahl ist die kritische.</p>
${FASSUNGEN.map((f, i) => `
<section>
  <h2><span class="nr">${i}</span>
    <span class="probe" style="background: rgba(${f.rgb}, ${f.alpha})"></span>${f.name}
    <span class="werte">${COUNTER} · ${(f.alpha * 100).toFixed(0)} %
      · Antwort ${f.aufText.toFixed(1)}:1
      · <span class="${f.knapp ? 'knapp' : ''}">Stimmen ${f.aufVotes.toFixed(1)}:1${f.knapp ? ' – zu knapp' : ''}</span></span></h2>
  <p class="t">${f.hinweis}</p>
  <div class="paar">
    <div><p class="caption">Auf der Seite</p><div class="buehne"><img src="${ergebnisse[i].page}"></div></div>
    <div><p class="caption">Bild zum Herunterladen</p><div class="buehne"><img src="${ergebnisse[i].big}"></div></div>
  </div>
</section>`).join('')}`;

const page = await browser.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 1.5 });
await page.setContent(blatt);
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(ausgabe, 'zaehler-uebersicht.png'), fullPage: true });
await browser.close();
server.close();

console.log(`\n  ${path.join(ausgabe, 'zaehler-uebersicht.png')}\n`);
