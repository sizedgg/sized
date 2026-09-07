// ============================================================================
// Preview images: around the Solana mint color
//
// Version 1 is what's left from the first round - the green pulled from the
// Solana logo. This one fans out what "in that direction" can mean, along
// TWO axes that otherwise get mixed up:
//
//   The HUE - exactly where between turquoise, mint and grass the color sits.
//   The LOUDNESS - how forcefully the area stands out against the row
//   background.
//
// Changing both at once is misleading when comparing: a warmer green that's
// also laid on more densely looks "better", and afterwards you don't know
// which of the two caused it. Hence:
//
//   Versions 0-4 ALL have the same brightness jump as today's fill (2.06:1).
//   They differ only in hue.
//   Versions 5-8 are the same hue (pure Solana mint) at four loudness
//   levels. They differ only in opacity.
//
// The upper limit isn't a matter of taste. Two things sit on the fill: the
// answer text (--text) and the vote count (--votes). The denser the area,
// the tighter both get - the vote count first, since it's the darker of the
// two. It stood at 1.3:1 here once before and was invisible. This sheet
// computes every version and writes it into the heading; anything falling
// below 4:1 is marked explicitly.
//
// Produces preview/mint-*.png and preview/mint-uebersicht.png
//   node scripts/vorschau-balken-mint.mjs
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

const CSS_STELLE = 'background: rgba(var(--accent-rgb), .24);';
const JS_STELLE = 'ctx.fillStyle = `rgba(${color.akzentRgb}, .24)`;';
if (!css.includes(CSS_STELLE)) throw new Error('Die Füllung im Blatt sieht anders aus als erwartet');
if (!drawSource.includes(JS_STELLE)) throw new Error('Die Füllung im Zeichner sieht anders aus als erwartet');

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
const AKZENT = hex(cssVar('--accent'));
const ZIEL_SPRUNG = kontrast(mix(AKZENT, 0.24, GRUND), GRUND);

const alphaFor = (color) => {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (kontrast(mix(color, m, GRUND), GRUND) < ZIEL_SPRUNG) lo = m; else hi = m;
  }
  return Math.round(((lo + hi) / 2) * 100) / 100;
};

const MINT = '#14f195';

const FASSUNGEN = [
  // --- The hue, all equally loud -------------------------------------------
  { gruppe: 'Der Ton – alle gleich laut', file: 'pur', name: 'Solana-Mint, unverändert', hex: MINT,
    hinweis: 'Der Ton aus der ersten Runde, unangetastet. Der Bezugspunkt für alles darunter.' },
  { gruppe: 'Der Ton – alle gleich laut', file: 'tuerkis', name: 'Richtung Türkis', hex: '#12e8c4',
    hinweis: 'Ein Stück ins Blaugrüne. Sitzt näher am kühlen Rest des Blattes und liest sich weniger als "Signalfarbe" – dafür ist die Herkunft aus dem Solana-Logo nicht mehr abzulesen.' },
  { gruppe: 'Der Ton – alle gleich laut', file: 'gras', name: 'Richtung Gras', hex: '#5cf07a',
    hinweis: 'Ein Stück ins Gelbgrüne. Wärmer und freundlicher, aber genau dieser Bereich ist der, in dem Grün als "erledigt, richtig, bestanden" gelesen wird – bei einer Abstimmung ohne richtige Antwort eine Aussage, die niemand gemeint hat.' },
  { gruppe: 'Der Ton – alle gleich laut', file: 'gedeckt', name: 'Gedecktes Mint', hex: '#5cc9a2',
    hinweis: 'Derselbe Ton, aus dem der Leuchtstift heraus ist. Wirkt gedruckt statt beleuchtet und passt damit zum flachen Kartenhintergrund; das Logo klingt noch an, drängt sich aber nicht auf.' },
  { gruppe: 'Der Ton – alle gleich laut', file: 'tief', name: 'Tiefes Sattgrün', hex: '#0aa96f',
    hinweis: 'Dunkler und satter. Weil alle Fassungen auf denselben Helligkeitssprung gestellt sind, braucht dieser Ton am meisten Deckkraft – die Fläche ist dadurch fast deckend und die Farbe entsprechend rein.' },

  // --- The loudness, one hue -----------------------------------------------
  { gruppe: 'Die Lautstärke – alles Solana-Mint', file: 'leise', name: 'Leiser', hex: MINT, feste: 0.20,
    hinweis: 'Deutlich zurückgenommen: Die Farbe ist zu erkennen, der Balken bleibt aber Hintergrund. Die Kante, an der der Anteil endet, wird dabei weicher ablesbar.' },
  { gruppe: 'Die Lautstärke – alles Solana-Mint', file: 'gleich', name: 'Wie in der ersten Runde', hex: MINT, feste: 0.29,
    hinweis: 'Derselbe Helligkeitssprung wie die heutige weisse Füllung. Identisch mit Fassung 0 – hier nur noch einmal in der Reihe, damit man die Nachbarn daneben halten kann.' },
  { gruppe: 'Die Lautstärke – alles Solana-Mint', file: 'laut', name: 'Kräftiger', hex: MINT, feste: 0.42,
    hinweis: 'Der Balken wird zur Hauptsache in der Zeile. Der Antworttext liegt jetzt auf einer deutlich helleren Fläche – die harte Kante quer durch ein Wort tritt entsprechend stärker hervor.' },
  { gruppe: 'Die Lautstärke – alles Solana-Mint', file: 'sehrlaut', name: 'Sehr kräftig', hex: MINT, feste: 0.60,
    hinweis: 'Die Obergrenze, um zu show, wo es kippt. Ab hier gewinnt die Fläche gegen den Text, der darauf steht – die Zahlen an der Überschrift sagen, ob das noch trägt.' },
];

console.log(`\n  Maßstab: die heutige weisse Füllung springt ${ZIEL_SPRUNG.toFixed(2)}:1 vom Zeilengrund ab.\n`);
console.log('  ' + 'Fassung'.padEnd(28) + 'Deckkraft'.padEnd(11) + 'Sprung'.padEnd(9)
  + 'Antwort'.padEnd(10) + 'Stimmen');

for (const f of FASSUNGEN) {
  const color = hex(f.hex);
  f.alpha = f.feste ?? alphaFor(color);
  f.rgb = color.join(', ');
  const m = mix(color, f.alpha, GRUND);
  f.mischung = m;
  f.sprung = kontrast(m, GRUND);
  f.aufText = kontrast(TEXT, m);
  f.aufVotes = kontrast(VOTES, m);
  f.knapp = f.aufVotes < 4;
  console.log('  ' + f.name.padEnd(28)
    + `${(f.alpha * 100).toFixed(0)} %`.padEnd(11)
    + `${f.sprung.toFixed(2)}:1`.padEnd(9)
    + `${f.aufText.toFixed(1)}:1`.padEnd(10)
    + `${f.aufVotes.toFixed(1)}:1${f.knapp ? '   <- under 4:1' : ''}`);
}

const eng = FASSUNGEN.filter((f) => f.knapp);
console.log(eng.length
  ? `\n  Unter 4:1 bei der Stimmenzahl: ${eng.map((f) => f.name).join(', ')}`
  : '\n  Alle Fassungen halten die Stimmenzahl über 4:1.');

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

  fs.writeFileSync(path.join(ausgabe, `mint-${f.file}-seite.png`), pageImage);
  fs.writeFileSync(path.join(ausgabe, `mint-${f.file}-download.png`),
    Buffer.from(daten.big.split(',')[1], 'base64'));
  ergebnisse.push({ page: 'data:image/png;base64,' + pageImage.toString('base64'), ...daten });
}

let lastGroup = null;
const blatt = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>
  body { background: #07080b; padding: 30px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.9rem; font-size: .86rem; color: var(--dim); max-width: 112ch; line-height: 1.6; }
  h3 { margin: 2.2rem 0 1.1rem; font-size: .78rem; letter-spacing: .09em; text-transform: uppercase;
       color: var(--dimmer); border-top: 1px solid var(--line); padding-top: .9rem; }
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
<h1>Rund um das Solana-Mint</h1>
<p class="lead">Zwei Achsen, getrennt gehalten. Oben ändert sich nur der <b>Ton</b> – alle fünf Fassungen springen
gleich far vom Zeilengrund ab (${ZIEL_SPRUNG.toFixed(2)}:1), sind also gleich laut. Unten ändert sich nur die
<b>Lautstärke</b>, bei ein und demselben Ton. An jeder Überschrift steht, wie gut Antworttext und Stimmenzahl auf
der Füllung noch lesbar sind; die Stimmenzahl ist die kritische.</p>
${FASSUNGEN.map((f, i) => {
  const header = f.gruppe !== lastGroup ? `<h3>${(lastGroup = f.gruppe)}</h3>` : '';
  return `${header}
<section>
  <h2><span class="nr">${i}</span>
    <span class="probe" style="background: rgba(${f.rgb}, ${f.alpha})"></span>${f.name}
    <span class="werte">${f.hex} · ${(f.alpha * 100).toFixed(0)} %
      · Antwort ${f.aufText.toFixed(1)}:1
      · <span class="${f.knapp ? 'knapp' : ''}">Stimmen ${f.aufVotes.toFixed(1)}:1${f.knapp ? ' – zu knapp' : ''}</span></span></h2>
  <p class="t">${f.hinweis}</p>
  <div class="paar">
    <div><p class="caption">Auf der Seite</p><div class="buehne"><img src="${ergebnisse[i].page}"></div></div>
    <div><p class="caption">Bild zum Herunterladen</p><div class="buehne"><img src="${ergebnisse[i].big}"></div></div>
  </div>
</section>`;
}).join('')}`;

const page = await browser.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 1.5 });
await page.setContent(blatt);
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(ausgabe, 'mint-uebersicht.png'), fullPage: true });
await browser.close();
server.close();

console.log(`\n  ${path.join(ausgabe, 'mint-uebersicht.png')}\n`);
