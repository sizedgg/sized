// ============================================================================
// Preview images: a different color for the bar that fills the answers
//
// Today the bar is bone-white at 24% opacity - the same color as
// everything else in the stylesheet, just more transparent. That gives it
// no voice of its own; it's "the page, a little lighter".
//
// ----------------------------------------------------------------------------
// What can go wrong on a switch, and why this computes instead of guesses
//
// Three things sit ON TOP OF or NEXT TO this area, and a new color can
// break all three without it being obvious at a glance:
//
//  1. The answer text (--text) sits on the fill and gets crossed by the
//     hard edge. It must stay equally readable on both sides of that edge -
//     otherwise the reason the old gradient faded out softly comes back.
//  2. The vote count (--votes) sits on the fill for the leading answer
//     almost always. It once measured 1.3:1 and was invisible; --votes
//     was specifically tuned against the CURRENT mix to reach 4.3:1. A
//     different fill color shifts exactly that number.
//  3. The edge itself has to be visible. So the fill must stand apart
//     from the row background (--bg-3) - that's the actual point of it.
//
// That's why opacity here is NOT a fixed value, but set per hue so the
// brightness jump against the row background stays the same as it is
// today. Otherwise we'd be comparing colors of different loudness and end
// up deciding based on volume instead of hue. A blue at 24% is
// noticeably darker than a white at 24%; left untuned, every dark blue
// would look "too weak", when that's really only the opacity.
//
// Computed using WCAG contrast (relative luminance), not estimated.
//
// Purple doesn't appear: explicitly rejected ("the purple has to go").
//
// Produces preview/balkenfarbe-*.png and preview/balkenfarbe-uebersicht.png
//   node scripts/vorschau-balken-farbe.mjs
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

// Verbatim from the source, not rebuilt: drawer, markup, formats, icons.
const drawSource = cut('const cssWert =', '\nasync function ladeOgBildHoch');
const markup = cut('function pollHtml(p) {', 'async function deletePoll(id) {');
const formate = cut('const nfGanz =', 'const wholeNumber')
  + cut('const wholeNumber =', '\n');
const escFn = cut('const esc = (s) =>', '\n\n');
const symbole = cut('const LINK_SVG =', 'const pollLink = (id) => `${location.origin}/p/${id}`;');

// The two places where the same decision is written down.
const CSS_STELLE = 'background: rgba(var(--accent-rgb), .24);';
const JS_STELLE = 'ctx.fillStyle = `rgba(${color.akzentRgb}, .24)`;';
if (!css.includes(CSS_STELLE)) throw new Error('Die Füllung im Blatt sieht anders aus als erwartet');
if (!drawSource.includes(JS_STELLE)) throw new Error('Die Füllung im Zeichner sieht anders aus als erwartet');

// ---------------------------------------------------------------------------
// Color math
// ---------------------------------------------------------------------------
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
const mix = (vorne, alpha, hinten) =>
  vorne.map((c, i) => Math.round(alpha * c + (1 - alpha) * hinten[i]));

const cssVar = (name) => {
  const m = new RegExp(`\\n\\s*${name}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`${name} nicht im Blatt gefunden`);
  return m[1].trim();
};

const GRUND = hex(cssVar('--bg-3'));     // row background under the fill
const TEXT = hex(cssVar('--text'));      // answer text on the fill
const VOTES = hex(cssVar('--votes'));    // vote count on the fill
const AKZENT = hex(cssVar('--accent'));  // today's fill color
const LINIE = hex(cssVar('--line'));     // the row's border

// The yardstick: the brightness jump the current fill makes.
const NOW_MIX = mix(AKZENT, 0.24, GRUND);
const ZIEL_SPRUNG = kontrast(NOW_MIX, GRUND);

// The opacity at which a hue makes the same jump. Binary search, because
// contrast can't be solved for alpha in closed form.
const alphaFor = (color) => {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (kontrast(mix(color, m, GRUND), GRUND) < ZIEL_SPRUNG) lo = m; else hi = m;
  }
  return Math.round(((lo + hi) / 2) * 100) / 100;
};

// ---------------------------------------------------------------------------
// The hues
// ---------------------------------------------------------------------------
const TONES = [
  { file: 'jetzt', name: 'Jetzt: Knochenweiss', hex: null, feste: 0.24,
    hinweis: 'Die Füllung ist dieselbe Farbe wie der Text, nur durchsichtig. Sie hat keinen eigenen Klang – der Balken ist "die Seite, etwas heller". Zum Vergleich hier peek.' },
  { file: 'mint', name: 'Solana-Mint', hex: '#14f195',
    hinweis: 'Der Grünton aus dem Solana-Logo. Der einzige Vorschlag, der von aussen etwas mitbringt: Wer die Karte auf X sieht, ordnet sie ohne Text ein. Das Violett aus demselben Logo bleibt draussen.' },
  { file: 'gruen', name: 'Ruhiges Grün', hex: '#3ddc84',
    hinweis: 'Dasselbe Feld, aber weniger elektrisch. Grün heisst hier nicht "richtig", sondern nur "so viel steht dahinter" – das trägt, solange nirgends sonst im Blatt Grün für "erledigt" steht.' },
  { file: 'blau', name: 'Kühles Blau', hex: '#4d8dff',
    hinweis: 'Der klassische Balkenton. Sitzt am nächsten am jetzigen Grau und fällt am wenigsten auf – das ist Vor- und Nachteil zugleich.' },
  { file: 'stahl', name: 'Stahlblau', hex: '#5ac8e0',
    hinweis: 'Blau mit einem Stich ins Türkis. Näher am jetzigen Weiss als das kräftige Blau, aber deutlich als Farbe erkennbar.' },
  { file: 'gold', name: 'Gold', hex: cssVar('--gold'),
    hinweis: 'Die einzige warme Farbe, die das Blatt schon kennt – --gold steckt bereits in der Palette. Warm liest sich neben Dollarbeträgen naheliegend; es zieht aber auch am meisten Aufmerksamkeit.' },
  { file: 'bernstein', name: 'Gedämpftes Bernstein', hex: '#c9964a',
    hinweis: 'Dasselbe Feld, ohne den Leuchtstift. Wirkt gedruckt statt beleuchtet und passt zum flachen Kartenhintergrund.' },
  { file: 'schiefer', name: 'Heller Schiefer', hex: '#7f8ba6',
    hinweis: 'Kein Farbton, sondern ein eigener Grauwert: Die Füllung ist nicht mehr "der Text, durchsichtig", sondern eine Fläche mit eigener Herkunft. Der leiseste Schritt weg vom Jetzt.' },
];

console.log(`\n  Zeilengrund --bg-3 ${cssVar('--bg-3')}`);
console.log(`  Maßstab: die jetzige Füllung springt ${ZIEL_SPRUNG.toFixed(2)}:1 vom Grund ab.`);
console.log('  Jede Farbe bekommt die Deckkraft, die denselben Sprung macht.\n');

const header = ['Ton', 'Deckkraft', 'Sprung', 'Antwort', 'Stimmen', 'Kante'];
console.log('  ' + header[0].padEnd(24) + header[1].padEnd(11) + header[2].padEnd(9)
  + header[3].padEnd(10) + header[4].padEnd(10) + header[5]);

for (const t of TONES) {
  const color = t.hex ? hex(t.hex) : AKZENT;
  t.alpha = t.feste ?? alphaFor(color);
  t.rgb = color.join(', ');
  t.mischung = mix(color, t.alpha, GRUND);
  t.sprung = kontrast(t.mischung, GRUND);
  t.aufText = kontrast(TEXT, t.mischung);        // answer text on the fill
  t.aufVotes = kontrast(VOTES, t.mischung);      // vote count on the fill
  t.kante = kontrast(t.mischung, LINIE);         // fill against the border
  console.log('  ' + t.name.padEnd(24)
    + `${(t.alpha * 100).toFixed(0)} %`.padEnd(11)
    + `${t.sprung.toFixed(2)}:1`.padEnd(9)
    + `${t.aufText.toFixed(1)}:1`.padEnd(10)
    + `${t.aufVotes.toFixed(1)}:1`.padEnd(10)
    + `${t.kante.toFixed(2)}:1`);
}

// The thresholds that must not be undercut.
const eng = TONES.filter((t) => t.aufVotes < 4);
console.log(eng.length
  ? `\n  ACHTUNG: Stimmenzahl under 4:1 bei – ${eng.map((t) => t.name).join(', ')}`
  : '\n  Alle Töne halten die Stimmenzahl über 4:1 und den Antworttext far über 4,5:1.');

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------
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
for (const t of TONES) {
  const newCss = `rgba(${t.rgb}, ${t.alpha})`;
  const page = await browser.newPage({ viewport: { width: 760, height: 420 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);

  // Only this one declaration gets replaced - the rest of the stylesheet
  // stays real.
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
    card: (await window.drawPoll(p, { fuerKarte: true })).toDataURL('image/png'),
  }), POLL);
  await page.close();

  const roh = (d) => Buffer.from(d.split(',')[1], 'base64');
  fs.writeFileSync(path.join(ausgabe, `balkenfarbe-${t.file}-seite.png`), pageImage);
  fs.writeFileSync(path.join(ausgabe, `balkenfarbe-${t.file}-download.png`), roh(daten.big));
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
  p.t { margin: .3rem 0 .8rem; font-size: .84rem; color: #8b93a7; line-height: 1.55; max-width: 118ch; }
  .paar { display: grid; grid-template-columns: 1.05fr 1fr; gap: 20px; align-items: start; }
  .caption { font-size: .72rem; color: var(--dimmer); margin: 0 0 .35rem; }
  img { width: 100%; display: block; border-radius: 8px; }
  .buehne { background: #16181c; padding: 12px; border-radius: 12px; }
</style>
<h1>Die Farbe der Balkenfüllung</h1>
<p class="lead">Links die Abstimmung auf der Seite, right das Bild zum Herunterladen – dieselbe Zahl steuert beides.
Jeder Ton hat die Deckkraft bekommen, bei der er genauso far vom Zeilengrund abspringt wie die jetzige Füllung
(${ZIEL_SPRUNG.toFixed(2)}:1). So unterscheiden sich die Fassungen im Ton und nicht in der Lautstärke.
Unter jeder Überschrift steht, wie gut Antworttext und Stimmenzahl auf der Füllung noch lesbar sind;
die Stimmenzahl ist die kritische – sie stand schon einmal bei 1,3:1 und war unsichtbar.</p>
${TONES.map((t, i) => `
<section>
  <h2><span class="nr">${i}</span>
    <span class="probe" style="background: rgba(${t.rgb}, ${t.alpha})"></span>${t.name}
    <span class="werte">${t.hex ? t.hex + ' · ' : ''}${(t.alpha * 100).toFixed(0)} %
      · Antwort ${t.aufText.toFixed(1)}:1 · Stimmen ${t.aufVotes.toFixed(1)}:1</span></h2>
  <p class="t">${t.hinweis}</p>
  <div class="paar">
    <div><p class="caption">Auf der Seite</p><div class="buehne"><img src="${ergebnisse[i].page}"></div></div>
    <div><p class="caption">Bild zum Herunterladen</p><div class="buehne"><img src="${ergebnisse[i].big}"></div></div>
  </div>
</section>`).join('')}`;

const page = await browser.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 1.5 });
await page.setContent(blatt);
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(ausgabe, 'balkenfarbe-uebersicht.png'), fullPage: true });
await browser.close();
server.close();

console.log(`\n  ${path.join(ausgabe, 'balkenfarbe-uebersicht.png')}\n`);
