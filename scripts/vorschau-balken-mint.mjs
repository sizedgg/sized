// ============================================================================
// Vorschaubilder: Rund um das Solana-Mint
//
// Aus der ersten Runde ist Fassung 1 übrig geblieben – der Grünton aus dem
// Solana-Logo. Hier wird ausgefächert, was "in diese Richtung" alles heissen
// kann, und zwar entlang von ZWEI Achsen, die man sonst durcheinanderwirft:
//
//   Der TON  – wo genau zwischen Türkis, Mint und Gras die Farbe sitzt.
//   Die LAUTSTÄRKE – wie kräftig die Fläche gegenüber dem Zeilengrund steht.
//
// Beides gleichzeitig zu ändern führt beim Vergleichen in die Irre: Ein
// wärmeres Grün, das nebenbei dichter aufgetragen ist, wirkt "besser", und
// man weiss hinterher nicht, was davon der Grund war. Deshalb:
//
//   Fassungen 0–4 haben ALLE denselben Helligkeitssprung wie die heutige
//   Füllung (2,06:1). Sie unterscheiden sich nur im Ton.
//   Fassungen 5–8 sind derselbe Ton (das reine Solana-Mint) in vier
//   Lautstärken. Sie unterscheiden sich nur in der Deckkraft.
//
// Die Grenze nach oben ist keine Geschmacksfrage. Auf der Füllung liegen zwei
// Dinge: der Antworttext (--text) und die Stimmenzahl (--votes). Je dichter
// die Fläche, desto knapper wird beides – die Stimmenzahl zuerst, weil sie
// die dunklere der beiden ist. Sie stand hier schon einmal bei 1,3:1 und war
// unsichtbar. Dieses Blatt rechnet jede Fassung nach und schreibt es an die
// Überschrift; was unter 4:1 fällt, ist ausdrücklich markiert.
//
// Erzeugt preview/mint-*.png und preview/mint-uebersicht.png
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

const CSS_STELLE = 'background: rgba(var(--accent-rgb), .24);';
const JS_STELLE = 'ctx.fillStyle = `rgba(${farbe.akzentRgb}, .24)`;';
if (!css.includes(CSS_STELLE)) throw new Error('Die Füllung im Blatt sieht anders aus als erwartet');
if (!zeichner.includes(JS_STELLE)) throw new Error('Die Füllung im Zeichner sieht anders aus als erwartet');

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
const AKZENT = hex(cssVar('--accent'));
const ZIEL_SPRUNG = kontrast(mische(AKZENT, 0.24, GRUND), GRUND);

const alphaFuer = (farbe) => {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (kontrast(mische(farbe, m, GRUND), GRUND) < ZIEL_SPRUNG) lo = m; else hi = m;
  }
  return Math.round(((lo + hi) / 2) * 100) / 100;
};

const MINT = '#14f195';

const FASSUNGEN = [
  // --- Der Ton, alle gleich laut -------------------------------------------
  { gruppe: 'Der Ton – alle gleich laut', datei: 'pur', name: 'Solana-Mint, unverändert', hex: MINT,
    hinweis: 'Der Ton aus der ersten Runde, unangetastet. Der Bezugspunkt für alles darunter.' },
  { gruppe: 'Der Ton – alle gleich laut', datei: 'tuerkis', name: 'Richtung Türkis', hex: '#12e8c4',
    hinweis: 'Ein Stück ins Blaugrüne. Sitzt näher am kühlen Rest des Blattes und liest sich weniger als "Signalfarbe" – dafür ist die Herkunft aus dem Solana-Logo nicht mehr abzulesen.' },
  { gruppe: 'Der Ton – alle gleich laut', datei: 'gras', name: 'Richtung Gras', hex: '#5cf07a',
    hinweis: 'Ein Stück ins Gelbgrüne. Wärmer und freundlicher, aber genau dieser Bereich ist der, in dem Grün als "erledigt, richtig, bestanden" gelesen wird – bei einer Abstimmung ohne richtige Antwort eine Aussage, die niemand gemeint hat.' },
  { gruppe: 'Der Ton – alle gleich laut', datei: 'gedeckt', name: 'Gedecktes Mint', hex: '#5cc9a2',
    hinweis: 'Derselbe Ton, aus dem der Leuchtstift heraus ist. Wirkt gedruckt statt beleuchtet und passt damit zum flachen Kartenhintergrund; das Logo klingt noch an, drängt sich aber nicht auf.' },
  { gruppe: 'Der Ton – alle gleich laut', datei: 'tief', name: 'Tiefes Sattgrün', hex: '#0aa96f',
    hinweis: 'Dunkler und satter. Weil alle Fassungen auf denselben Helligkeitssprung gestellt sind, braucht dieser Ton am meisten Deckkraft – die Fläche ist dadurch fast deckend und die Farbe entsprechend rein.' },

  // --- Die Lautstärke, ein Ton ---------------------------------------------
  { gruppe: 'Die Lautstärke – alles Solana-Mint', datei: 'leise', name: 'Leiser', hex: MINT, feste: 0.20,
    hinweis: 'Deutlich zurückgenommen: Die Farbe ist zu erkennen, der Balken bleibt aber Hintergrund. Die Kante, an der der Anteil endet, wird dabei weicher ablesbar.' },
  { gruppe: 'Die Lautstärke – alles Solana-Mint', datei: 'gleich', name: 'Wie in der ersten Runde', hex: MINT, feste: 0.29,
    hinweis: 'Derselbe Helligkeitssprung wie die heutige weisse Füllung. Identisch mit Fassung 0 – hier nur noch einmal in der Reihe, damit man die Nachbarn daneben halten kann.' },
  { gruppe: 'Die Lautstärke – alles Solana-Mint', datei: 'laut', name: 'Kräftiger', hex: MINT, feste: 0.42,
    hinweis: 'Der Balken wird zur Hauptsache in der Zeile. Der Antworttext liegt jetzt auf einer deutlich helleren Fläche – die harte Kante quer durch ein Wort tritt entsprechend stärker hervor.' },
  { gruppe: 'Die Lautstärke – alles Solana-Mint', datei: 'sehrlaut', name: 'Sehr kräftig', hex: MINT, feste: 0.60,
    hinweis: 'Die Obergrenze, um zu zeigen, wo es kippt. Ab hier gewinnt die Fläche gegen den Text, der darauf steht – die Zahlen an der Überschrift sagen, ob das noch trägt.' },
];

console.log(`\n  Maßstab: die heutige weisse Füllung springt ${ZIEL_SPRUNG.toFixed(2)}:1 vom Zeilengrund ab.\n`);
console.log('  ' + 'Fassung'.padEnd(28) + 'Deckkraft'.padEnd(11) + 'Sprung'.padEnd(9)
  + 'Antwort'.padEnd(10) + 'Stimmen');

for (const f of FASSUNGEN) {
  const farbe = hex(f.hex);
  f.alpha = f.feste ?? alphaFuer(farbe);
  f.rgb = farbe.join(', ');
  const m = mische(farbe, f.alpha, GRUND);
  f.mischung = m;
  f.sprung = kontrast(m, GRUND);
  f.aufText = kontrast(TEXT, m);
  f.aufVotes = kontrast(VOTES, m);
  f.knapp = f.aufVotes < 4;
  console.log('  ' + f.name.padEnd(28)
    + `${(f.alpha * 100).toFixed(0)} %`.padEnd(11)
    + `${f.sprung.toFixed(2)}:1`.padEnd(9)
    + `${f.aufText.toFixed(1)}:1`.padEnd(10)
    + `${f.aufVotes.toFixed(1)}:1${f.knapp ? '   <- unter 4:1' : ''}`);
}

const eng = FASSUNGEN.filter((f) => f.knapp);
console.log(eng.length
  ? `\n  Unter 4:1 bei der Stimmenzahl: ${eng.map((f) => f.name).join(', ')}`
  : '\n  Alle Fassungen halten die Stimmenzahl über 4:1.');

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

  fs.writeFileSync(path.join(ausgabe, `mint-${f.datei}-seite.png`), seitenBild);
  fs.writeFileSync(path.join(ausgabe, `mint-${f.datei}-download.png`),
    Buffer.from(daten.gross.split(',')[1], 'base64'));
  ergebnisse.push({ seite: 'data:image/png;base64,' + seitenBild.toString('base64'), ...daten });
}

let letzteGruppe = null;
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
  .beschriftung { font-size: .72rem; color: var(--dimmer); margin: 0 0 .35rem; }
  img { width: 100%; display: block; border-radius: 8px; }
  .buehne { background: #16181c; padding: 12px; border-radius: 12px; }
</style>
<h1>Rund um das Solana-Mint</h1>
<p class="lead">Zwei Achsen, getrennt gehalten. Oben ändert sich nur der <b>Ton</b> – alle fünf Fassungen springen
gleich weit vom Zeilengrund ab (${ZIEL_SPRUNG.toFixed(2)}:1), sind also gleich laut. Unten ändert sich nur die
<b>Lautstärke</b>, bei ein und demselben Ton. An jeder Überschrift steht, wie gut Antworttext und Stimmenzahl auf
der Füllung noch lesbar sind; die Stimmenzahl ist die kritische.</p>
${FASSUNGEN.map((f, i) => {
  const kopf = f.gruppe !== letzteGruppe ? `<h3>${(letzteGruppe = f.gruppe)}</h3>` : '';
  return `${kopf}
<section>
  <h2><span class="nr">${i}</span>
    <span class="probe" style="background: rgba(${f.rgb}, ${f.alpha})"></span>${f.name}
    <span class="werte">${f.hex} · ${(f.alpha * 100).toFixed(0)} %
      · Antwort ${f.aufText.toFixed(1)}:1
      · <span class="${f.knapp ? 'knapp' : ''}">Stimmen ${f.aufVotes.toFixed(1)}:1${f.knapp ? ' – zu knapp' : ''}</span></span></h2>
  <p class="t">${f.hinweis}</p>
  <div class="paar">
    <div><p class="beschriftung">Auf der Seite</p><div class="buehne"><img src="${ergebnisse[i].seite}"></div></div>
    <div><p class="beschriftung">Bild zum Herunterladen</p><div class="buehne"><img src="${ergebnisse[i].gross}"></div></div>
  </div>
</section>`;
}).join('')}`;

const seite = await browser.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 1.5 });
await seite.setContent(blatt);
await seite.waitForTimeout(700);
await seite.screenshot({ path: path.join(ausgabe, 'mint-uebersicht.png'), fullPage: true });
await browser.close();
server.close();

console.log(`\n  ${path.join(ausgabe, 'mint-uebersicht.png')}\n`);
