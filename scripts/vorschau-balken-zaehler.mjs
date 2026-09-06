// ============================================================================
// Vorschaubilder: Das Grün aus dem Zähler als Balkenfüllung
//
// Der Ton ist nicht geschätzt, sondern aus dem Bildschirmfoto gemessen: die
// Kernpixel der Ziffern, davon das hellste Zehntel, davon der Median. Die
// Kantenglättung gegen den dunklen Grund zieht die Randpixel nach unten und
// verfälscht jeden Mittelwert über die ganze Glyphe – deshalb nur der Kern.
//
//   Median des hellsten Zehntels: #7cdb68   (740 Pixel)
//
// Gezeigt werden vier Lautstärken desselben Tons. Die mittlere ist die, bei
// der die Füllung genauso weit vom Zeilengrund abspringt wie die weisse von
// heute – gleiche Lautstärke, andere Farbe. Nach oben ist die Grenze nicht
// Geschmack: Auf der Füllung liegen der Antworttext und die Stimmenzahl, und
// die Stimmenzahl stand hier schon einmal bei 1,3:1 und war unsichtbar.
//
// Dieses Skript ÄNDERT NICHTS. Es schneidet Blatt und Zeichner wörtlich aus
// der Quelle und tauscht die eine Deklaration nur im Browser aus.
//
// Erzeugt preview/zaehler-*.png und preview/zaehler-uebersicht.png
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

const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const zeichner = schneide('const cssWert =', '\nasync function ladeOgBildHoch');
const markup = schneide('function pollHtml(p) {', '\n/**\n * Eine Abstimmung löschen');
const formate = schneide('const nfGanz =', 'const ganzeZahl')
  + schneide('const ganzeZahl =', '\n');
const escFn = schneide('const esc = (s) =>', '\n\n');
const symbole = schneide('const LINK_SVG =', '\n/**\n * Die Adresse einer einzelnen');

const JS_STELLE = 'ctx.fillStyle = `rgba(${farbe.akzentRgb}, .24)`;';
if (!zeichner.includes(JS_STELLE)) throw new Error('Die Füllung im Zeichner sieht anders aus als erwartet');
if (!css.includes('background: rgba(var(--accent-rgb), .24);')) {
  throw new Error('Die Füllung im Blatt sieht anders aus als erwartet');
}

// --- Farbrechnung ----------------------------------------------------------
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
const mische = (v, a, h) => v.map((c, i) => Math.round(a * c + (1 - a) * h[i]));
const cssVar = (name) => {
  const m = new RegExp(`\\n\\s*${name}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`${name} nicht im Blatt gefunden`);
  return m[1].trim();
};

const GRUND = hex(cssVar('--bg-3'));
const TEXT = hex(cssVar('--text'));
const VOTES = hex(cssVar('--votes'));
const ZIEL_SPRUNG = kontrast(mische(hex(cssVar('--accent')), 0.24, GRUND), GRUND);

const ZAEHLER = '#7cdb68';   // gemessen, siehe Kopf

const FASSUNGEN = [
  { datei: 'leise', name: 'Leiser', alpha: 0.22,
    hinweis: 'Die Farbe ist da, der Balken bleibt Hintergrund. Leiser als das Weiss von heute.' },
  { datei: 'gleich', name: 'Gleich laut wie heute', alpha: 0.30,
    hinweis: `Derselbe Helligkeitssprung wie die weisse Füllung (${ZIEL_SPRUNG.toFixed(2)}:1). Die Farbe ändert sich, die Lautstärke nicht – der ehrlichste Vergleich mit dem Jetzt.` },
  { datei: 'kraeftig', name: 'Kräftiger', alpha: 0.38,
    hinweis: 'Der Balken wird zur Hauptsache in der Zeile, die harte Kante quer durch ein Wort tritt stärker hervor.' },
  { datei: 'satt', name: 'Satt', alpha: 0.50,
    hinweis: 'Nahe an der reinen Farbe. Hier zeigt sich, wo es kippt – die Zahlen an der Überschrift sagen, ob es noch trägt.' },
];

console.log(`\n  Gemessener Ton: ${ZAEHLER}`);
console.log(`  Die heutige weisse Füllung springt ${ZIEL_SPRUNG.toFixed(2)}:1 vom Zeilengrund ab.\n`);
console.log('  ' + 'Fassung'.padEnd(24) + 'Deckkraft'.padEnd(11) + 'Sprung'.padEnd(9)
  + 'Antwort'.padEnd(10) + 'Stimmen');

for (const f of FASSUNGEN) {
  const farbe = hex(ZAEHLER);
  f.rgb = farbe.join(', ');
  const m = mische(farbe, f.alpha, GRUND);
  f.sprung = kontrast(m, GRUND);
  f.aufText = kontrast(TEXT, m);
  f.aufVotes = kontrast(VOTES, m);
  f.knapp = f.aufVotes < 4;
  console.log('  ' + f.name.padEnd(24)
    + `${(f.alpha * 100).toFixed(0)} %`.padEnd(11)
    + `${f.sprung.toFixed(2)}:1`.padEnd(9)
    + `${f.aufText.toFixed(1)}:1`.padEnd(10)
    + `${f.aufVotes.toFixed(1)}:1${f.knapp ? '   <- unter 4:1' : ''}`);
}

// --- Bilder ----------------------------------------------------------------
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
  const neuCss = `rgba(${f.rgb}, ${f.alpha})`;
  const seite = await browser.newPage({ viewport: { width: 760, height: 420 } });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.addStyleTag({ content: `.opt-fill { background: ${neuCss} !important; }` });
  await seite.addScriptTag({
    content: `
      const state = { cfg: { symbol: 'ANSEM' }, me: { isAdmin: false }, polls: [] };
      const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
      const toast = () => {};
      ${escFn}
      ${formate}
      ${symbole}
      ${markup}
      ${zeichner.replace(JS_STELLE, 'ctx.fillStyle = ' + JSON.stringify(neuCss) + ';')}
      window.pollHtml = pollHtml;
      window.zeichnePoll = zeichnePoll;`,
  });
  await seite.evaluate((p) => { document.querySelector('#ziel').innerHTML = window.pollHtml(p); }, POLL);
  await seite.waitForTimeout(120);

  const seitenBild = await seite.locator('#ziel').screenshot();
  const daten = await seite.evaluate(async (p) => ({
    gross: (await window.zeichnePoll(p)).toDataURL('image/png'),
  }), POLL);
  await seite.close();

  fs.writeFileSync(path.join(ausgabe, `zaehler-${f.datei}-seite.png`), seitenBild);
  fs.writeFileSync(path.join(ausgabe, `zaehler-${f.datei}-download.png`),
    Buffer.from(daten.gross.split(',')[1], 'base64'));
  ergebnisse.push({ seite: 'data:image/png;base64,' + seitenBild.toString('base64'), ...daten });
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
  .beschriftung { font-size: .72rem; color: var(--dimmer); margin: 0 0 .35rem; }
  img { width: 100%; display: block; border-radius: 8px; }
  .buehne { background: #16181c; padding: 12px; border-radius: 12px; }
</style>
<h1>Das Grün aus dem Zähler als Balkenfüllung</h1>
<p class="lead">Der Ton ist aus dem Bildschirmfoto gemessen – Kernpixel der Ziffern, hellstes Zehntel, Median:
<b>${ZAEHLER}</b>. Vier Lautstärken desselben Tons. Fassung 1 springt genauso weit vom Zeilengrund ab wie die
weisse Füllung von heute; dort ändert sich also nur die Farbe. An jeder Überschrift steht, wie gut Antworttext
und Stimmenzahl auf der Füllung noch lesbar sind – die Stimmenzahl ist die kritische.</p>
${FASSUNGEN.map((f, i) => `
<section>
  <h2><span class="nr">${i}</span>
    <span class="probe" style="background: rgba(${f.rgb}, ${f.alpha})"></span>${f.name}
    <span class="werte">${ZAEHLER} · ${(f.alpha * 100).toFixed(0)} %
      · Antwort ${f.aufText.toFixed(1)}:1
      · <span class="${f.knapp ? 'knapp' : ''}">Stimmen ${f.aufVotes.toFixed(1)}:1${f.knapp ? ' – zu knapp' : ''}</span></span></h2>
  <p class="t">${f.hinweis}</p>
  <div class="paar">
    <div><p class="beschriftung">Auf der Seite</p><div class="buehne"><img src="${ergebnisse[i].seite}"></div></div>
    <div><p class="beschriftung">Bild zum Herunterladen</p><div class="buehne"><img src="${ergebnisse[i].gross}"></div></div>
  </div>
</section>`).join('')}`;

const seite = await browser.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 1.5 });
await seite.setContent(blatt);
await seite.waitForTimeout(700);
await seite.screenshot({ path: path.join(ausgabe, 'zaehler-uebersicht.png'), fullPage: true });
await browser.close();
server.close();

console.log(`\n  ${path.join(ausgabe, 'zaehler-uebersicht.png')}\n`);
