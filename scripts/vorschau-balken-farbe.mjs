// ============================================================================
// Vorschaubilder: Eine andere Farbe für den Balken, der die Antworten füllt
//
// Der Balken ist heute knochenweiss bei 24 % Deckkraft – dieselbe Farbe wie
// alles andere im Blatt, nur durchsichtiger. Er hat damit keinen eigenen
// Klang; er ist "die Seite, etwas heller".
//
// ----------------------------------------------------------------------------
// Was beim Wechsel schiefgehen kann, und warum hier gerechnet wird
//
// Drei Dinge liegen ÜBER oder NEBEN dieser Fläche, und alle drei kann eine
// neue Farbe kaputtmachen, ohne dass man es beim Hinsehen sofort merkt:
//
//  1. Der Antworttext (--text) liegt auf der Füllung und wird von der harten
//     Kante gekreuzt. Er muss links und rechts der Kante gleich gut lesbar
//     bleiben – sonst kommt der Grund zurück, aus dem der alte Verlauf weich
//     auslief.
//  2. Die Stimmenzahl (--votes) liegt bei der führenden Antwort fast immer auf
//     der Füllung. Sie stand schon einmal bei 1,3:1 und war unsichtbar; --votes
//     ist eigens gegen die JETZIGE Mischung auf 4,3:1 gestellt worden. Eine
//     andere Füllfarbe verschiebt genau diese Zahl.
//  3. Die Kante selbst muss man sehen. Die Füllung muss sich also vom
//     Zeilengrund (--bg-3) absetzen – das ist der eigentliche Zweck.
//
// Deshalb ist die Deckkraft hier KEIN fester Wert, sondern wird je Farbton so
// eingestellt, dass der Helligkeitssprung gegenüber dem Zeilengrund derselbe
// ist wie heute. Sonst verglichen wir Farben, die verschieden laut sind, und
// entschieden am Ende über die Lautstärke statt über den Ton. Ein Blau bei
// 24 % ist deutlich dunkler als ein Weiss bei 24 %; ungetunt sähe jedes
// dunkle Blau "zu schwach" aus, obwohl das nur an der Deckkraft liegt.
//
// Gerechnet wird mit WCAG-Kontrast (relative Luminanz), nicht geschätzt.
//
// Violett kommt nicht vor: ausdrücklich abgelehnt ("das lila soll weg").
//
// Erzeugt preview/balkenfarbe-*.png und preview/balkenfarbe-uebersicht.png
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

const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};

// Wörtlich aus der Quelle, nicht nachgebaut: Zeichner, Markup, Formate, Symbole.
const zeichner = schneide('const cssWert =', '\nasync function ladeOgBildHoch');
const markup = schneide('function pollHtml(p) {', '\n/**\n * Eine Abstimmung löschen');
const formate = schneide('const nfGanz =', 'const ganzeZahl')
  + schneide('const ganzeZahl =', '\n');
const escFn = schneide('const esc = (s) =>', '\n\n');
const symbole = schneide('const LINK_SVG =', '\n/**\n * Die Adresse einer einzelnen');

// Die beiden Stellen, an denen dieselbe Entscheidung steht.
const CSS_STELLE = 'background: rgba(var(--accent-rgb), .24);';
const JS_STELLE = 'ctx.fillStyle = `rgba(${farbe.akzentRgb}, .24)`;';
if (!css.includes(CSS_STELLE)) throw new Error('Die Füllung im Blatt sieht anders aus als erwartet');
if (!zeichner.includes(JS_STELLE)) throw new Error('Die Füllung im Zeichner sieht anders aus als erwartet');

// ---------------------------------------------------------------------------
// Farbrechnung
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
const mische = (vorne, alpha, hinten) =>
  vorne.map((c, i) => Math.round(alpha * c + (1 - alpha) * hinten[i]));

const cssVar = (name) => {
  const m = new RegExp(`\\n\\s*${name}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`${name} nicht im Blatt gefunden`);
  return m[1].trim();
};

const GRUND = hex(cssVar('--bg-3'));     // Zeilengrund unter der Füllung
const TEXT = hex(cssVar('--text'));      // Antworttext auf der Füllung
const VOTES = hex(cssVar('--votes'));    // Stimmenzahl auf der Füllung
const AKZENT = hex(cssVar('--accent'));  // heutige Füllfarbe
const LINIE = hex(cssVar('--line'));     // Rahmen der Zeile

// Der Maßstab: der Helligkeitssprung, den die jetzige Füllung macht.
const JETZT_MISCHUNG = mische(AKZENT, 0.24, GRUND);
const ZIEL_SPRUNG = kontrast(JETZT_MISCHUNG, GRUND);

// Die Deckkraft, bei der ein Farbton denselben Sprung macht. Binäre Suche,
// weil sich der Kontrast nicht geschlossen nach alpha auflösen lässt.
const alphaFuer = (farbe) => {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (kontrast(mische(farbe, m, GRUND), GRUND) < ZIEL_SPRUNG) lo = m; else hi = m;
  }
  return Math.round(((lo + hi) / 2) * 100) / 100;
};

// ---------------------------------------------------------------------------
// Die Töne
// ---------------------------------------------------------------------------
const TOENE = [
  { datei: 'jetzt', name: 'Jetzt: Knochenweiss', hex: null, feste: 0.24,
    hinweis: 'Die Füllung ist dieselbe Farbe wie der Text, nur durchsichtig. Sie hat keinen eigenen Klang – der Balken ist "die Seite, etwas heller". Zum Vergleich hier oben.' },
  { datei: 'mint', name: 'Solana-Mint', hex: '#14f195',
    hinweis: 'Der Grünton aus dem Solana-Logo. Der einzige Vorschlag, der von aussen etwas mitbringt: Wer die Karte auf X sieht, ordnet sie ohne Text ein. Das Violett aus demselben Logo bleibt draussen.' },
  { datei: 'gruen', name: 'Ruhiges Grün', hex: '#3ddc84',
    hinweis: 'Dasselbe Feld, aber weniger elektrisch. Grün heisst hier nicht "richtig", sondern nur "so viel steht dahinter" – das trägt, solange nirgends sonst im Blatt Grün für "erledigt" steht.' },
  { datei: 'blau', name: 'Kühles Blau', hex: '#4d8dff',
    hinweis: 'Der klassische Balkenton. Sitzt am nächsten am jetzigen Grau und fällt am wenigsten auf – das ist Vor- und Nachteil zugleich.' },
  { datei: 'stahl', name: 'Stahlblau', hex: '#5ac8e0',
    hinweis: 'Blau mit einem Stich ins Türkis. Näher am jetzigen Weiss als das kräftige Blau, aber deutlich als Farbe erkennbar.' },
  { datei: 'gold', name: 'Gold', hex: cssVar('--gold'),
    hinweis: 'Die einzige warme Farbe, die das Blatt schon kennt – --gold steckt bereits in der Palette. Warm liest sich neben Dollarbeträgen naheliegend; es zieht aber auch am meisten Aufmerksamkeit.' },
  { datei: 'bernstein', name: 'Gedämpftes Bernstein', hex: '#c9964a',
    hinweis: 'Dasselbe Feld, ohne den Leuchtstift. Wirkt gedruckt statt beleuchtet und passt zum flachen Kartenhintergrund.' },
  { datei: 'schiefer', name: 'Heller Schiefer', hex: '#7f8ba6',
    hinweis: 'Kein Farbton, sondern ein eigener Grauwert: Die Füllung ist nicht mehr "der Text, durchsichtig", sondern eine Fläche mit eigener Herkunft. Der leiseste Schritt weg vom Jetzt.' },
];

console.log(`\n  Zeilengrund --bg-3 ${cssVar('--bg-3')}`);
console.log(`  Maßstab: die jetzige Füllung springt ${ZIEL_SPRUNG.toFixed(2)}:1 vom Grund ab.`);
console.log('  Jede Farbe bekommt die Deckkraft, die denselben Sprung macht.\n');

const kopf = ['Ton', 'Deckkraft', 'Sprung', 'Antwort', 'Stimmen', 'Kante'];
console.log('  ' + kopf[0].padEnd(24) + kopf[1].padEnd(11) + kopf[2].padEnd(9)
  + kopf[3].padEnd(10) + kopf[4].padEnd(10) + kopf[5]);

for (const t of TOENE) {
  const farbe = t.hex ? hex(t.hex) : AKZENT;
  t.alpha = t.feste ?? alphaFuer(farbe);
  t.rgb = farbe.join(', ');
  t.mischung = mische(farbe, t.alpha, GRUND);
  t.sprung = kontrast(t.mischung, GRUND);
  t.aufText = kontrast(TEXT, t.mischung);        // Antworttext auf der Füllung
  t.aufVotes = kontrast(VOTES, t.mischung);      // Stimmenzahl auf der Füllung
  t.kante = kontrast(t.mischung, LINIE);         // Füllung gegen den Rahmen
  console.log('  ' + t.name.padEnd(24)
    + `${(t.alpha * 100).toFixed(0)} %`.padEnd(11)
    + `${t.sprung.toFixed(2)}:1`.padEnd(9)
    + `${t.aufText.toFixed(1)}:1`.padEnd(10)
    + `${t.aufVotes.toFixed(1)}:1`.padEnd(10)
    + `${t.kante.toFixed(2)}:1`);
}

// Die Schwellen, die nicht unterschritten werden dürfen.
const eng = TOENE.filter((t) => t.aufVotes < 4);
console.log(eng.length
  ? `\n  ACHTUNG: Stimmenzahl unter 4:1 bei – ${eng.map((t) => t.name).join(', ')}`
  : '\n  Alle Töne halten die Stimmenzahl über 4:1 und den Antworttext weit über 4,5:1.');

// ---------------------------------------------------------------------------
// Bilder
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
for (const t of TOENE) {
  const neuCss = `rgba(${t.rgb}, ${t.alpha})`;
  const seite = await browser.newPage({ viewport: { width: 760, height: 420 } });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);

  // Nur die eine Deklaration wird ersetzt – der Rest des Blattes bleibt echt.
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
    karte: (await window.zeichnePoll(p, { fuerKarte: true })).toDataURL('image/png'),
  }), POLL);
  await seite.close();

  const roh = (d) => Buffer.from(d.split(',')[1], 'base64');
  fs.writeFileSync(path.join(ausgabe, `balkenfarbe-${t.datei}-seite.png`), seitenBild);
  fs.writeFileSync(path.join(ausgabe, `balkenfarbe-${t.datei}-download.png`), roh(daten.gross));
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
  p.t { margin: .3rem 0 .8rem; font-size: .84rem; color: #8b93a7; line-height: 1.55; max-width: 118ch; }
  .paar { display: grid; grid-template-columns: 1.05fr 1fr; gap: 20px; align-items: start; }
  .beschriftung { font-size: .72rem; color: var(--dimmer); margin: 0 0 .35rem; }
  img { width: 100%; display: block; border-radius: 8px; }
  .buehne { background: #16181c; padding: 12px; border-radius: 12px; }
</style>
<h1>Die Farbe der Balkenfüllung</h1>
<p class="lead">Links die Abstimmung auf der Seite, rechts das Bild zum Herunterladen – dieselbe Zahl steuert beides.
Jeder Ton hat die Deckkraft bekommen, bei der er genauso weit vom Zeilengrund abspringt wie die jetzige Füllung
(${ZIEL_SPRUNG.toFixed(2)}:1). So unterscheiden sich die Fassungen im Ton und nicht in der Lautstärke.
Unter jeder Überschrift steht, wie gut Antworttext und Stimmenzahl auf der Füllung noch lesbar sind;
die Stimmenzahl ist die kritische – sie stand schon einmal bei 1,3:1 und war unsichtbar.</p>
${TOENE.map((t, i) => `
<section>
  <h2><span class="nr">${i}</span>
    <span class="probe" style="background: rgba(${t.rgb}, ${t.alpha})"></span>${t.name}
    <span class="werte">${t.hex ? t.hex + ' · ' : ''}${(t.alpha * 100).toFixed(0)} %
      · Antwort ${t.aufText.toFixed(1)}:1 · Stimmen ${t.aufVotes.toFixed(1)}:1</span></h2>
  <p class="t">${t.hinweis}</p>
  <div class="paar">
    <div><p class="beschriftung">Auf der Seite</p><div class="buehne"><img src="${ergebnisse[i].seite}"></div></div>
    <div><p class="beschriftung">Bild zum Herunterladen</p><div class="buehne"><img src="${ergebnisse[i].gross}"></div></div>
  </div>
</section>`).join('')}`;

const seite = await browser.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 1.5 });
await seite.setContent(blatt);
await seite.waitForTimeout(700);
await seite.screenshot({ path: path.join(ausgabe, 'balkenfarbe-uebersicht.png'), fullPage: true });
await browser.close();
server.close();

console.log(`\n  ${path.join(ausgabe, 'balkenfarbe-uebersicht.png')}\n`);
