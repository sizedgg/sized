// ============================================================================
// Preview images: the fill of the answer bars on the card
//
// The bar is the only part of the card that COMPUTES anything. Everything
// else shows text; it shows a ratio. And it carries a rule that breaks
// easily when you refactor: its width is the share of the total amount, so
// the filled portions of all options together add up to exactly one full
// bar. test-poll-bild.mjs checks that.
//
// Two decisions are already made and stay fixed across all variants:
//
//   * The edge ends hard, no falloff. On the site the same fill fades out
//     softly - there the bar is clickable and changes on voting, and a
//     hard edge that jumps through a word on click reads as a bug. The
//     image is static; there the edge says something a soft falloff would
//     swallow: exactly here is where the share ends.
//
//   * No percentage value. The amount is the statement, the bar shows it.
//
// Open is HOW the filled part sets itself off from the empty one. The
// option's text sits on top and gets crossed by the edge - every variant
// has to leave it equally readable on both sides. That is the real limit
// going up: a bolder fill looks better at first glance and then eats the
// word sitting over the edge.
//
// Both formats side by side again, and the cases are deliberately
// different: once three options with a clear leader, once ten close
// together - that shows whether a variant still says something even with
// small shares.
//
// Produces preview/balken-*.png and preview/balken-uebersicht.png
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
const formate = cut('const nfGanz =', 'const wholeNumber')
  + cut('const wholeNumber =', '\n');

// --- The spot every variant works from --------------------------------
const FILL_LEVEL = `      ctx.fillStyle = \`rgba(\${color.akzentRgb}, .24)\`;
      ctx.fillRect(margin, y, fillB, optH);`;
if (!drawSource.includes(FILL_LEVEL)) throw new Error('Die Balkenfuellung sieht in app.js anders aus als erwartet');

// The row itself - ground and outline - for the variants that touch it.
const LINE = `    ctx.fillStyle = color.balken;
    roundedRect(ctx, margin, y, content, optH, 13);
    ctx.fill();`;
if (!drawSource.includes(LINE)) throw new Error('Der Zeilengrund sieht anders aus als erwartet');

const fill = (js) => (q) => q.replace(FILL_LEVEL, js);

const FASSUNGEN = [
  { file: 'jetzt', name: 'Jetzt', short: 'Fläche bei 24 %',
    text: 'Der Stand von heute. Die gefüllte Fläche liegt bei 24 % Deckkraft über dem Zeilengrund. Bei kleinen Anteilen ist das Stück narrow und leise – siehe die letzten Antworten im Zehnerfall.',
    patch: (q) => q },

  { file: 'kraeftig', name: 'Kräftiger', short: '36 % statt 24 %',
    text: 'Dieselbe Fläche, deutlich sichtbarer. Der Anteil springt schon beim Überfliegen ins Auge. Zu prüfen ist der Text: Wo die Kante durch ein Wort läuft, wird der Unterschied zwischen den beiden Hälften des Wortes größer.',
    patch: fill(`      ctx.fillStyle = \`rgba(\${color.akzentRgb}, .36)\`;
      ctx.fillRect(margin, y, fillB, optH);`) },

  { file: 'leise', name: 'Leiser', short: '16 % statt 24 %',
    text: 'Die Gegenrichtung: Die Zeile wird ruhiger, der Betrag right übernimmt mehr Gewicht. Passt zur Haltung "der Balken ist die Nebenauskunft, die Zahl die Hauptsache" – kostet aber genau das, wofür der Balken da ist.',
    patch: fill(`      ctx.fillStyle = \`rgba(\${color.akzentRgb}, .16)\`;
      ctx.fillRect(margin, y, fillB, optH);`) },

  { file: 'kante', name: 'Fläche + Kantenstrich', short: 'Das Ende bekommt eine Linie',
    text: 'Die Füllung bleibt zurückhaltend, aber ihr Ende wird als heller Strich markiert. Damit ist der Anteil auf den Millimeter ablesbar, ohne dass die Fläche lauter wird – die Kante trägt die Aussage, nicht die Helligkeit.',
    patch: fill(`      ctx.fillStyle = \`rgba(\${color.akzentRgb}, .20)\`;
      ctx.fillRect(margin, y, fillB, optH);
      ctx.fillStyle = \`rgba(\${color.akzentRgb}, .75)\`;
      ctx.fillRect(margin + fillB - 3, y, 3, optH);`) },

  { file: 'streifen', name: 'Streifen bottom', short: 'Kein Feld, sondern eine Leiste',
    text: 'Statt die ganze Zeile zu füllen, läuft ein kräftiger Streifen am unteren Rand. Der Text steht damit nie auf der Füllung und wird nie von einer Kante gekreuzt – das Lesbarkeitsproblem verschwindet ganz. Dafür wirkt der Anteil kleiner, als er ist.',
    patch: fill(`      ctx.fillStyle = \`rgba(\${color.akzentRgb}, .85)\`;
      ctx.fillRect(margin, y + optH - 7, fillB, 7);`) },

  { file: 'spitze', name: 'Führende hervorgehoben', short: 'Eine Antwort lauter als die anderen',
    text: 'Die führende Antwort wird bei 38 % gefüllt, alle übrigen bei 18 %. Die Karte sagt damit auf einen Blick, was gewinnt, und ordnet den Rest under. Zu bedenken: Bei einem knappen Rennen behauptet die Karte einen Abstand, den es so nicht gibt.',
    patch: fill(`      ctx.fillStyle = \`rgba(\${color.akzentRgb}, \${spitze ? '.38' : '.18'})\`;
      ctx.fillRect(margin, y, fillB, optH);`) },
];

const opt = (label, votes, usd, share) => ({ id: 0, label, votes, usd, share });
const CASES = {
  drei: {
    id: 1, closed: false, totalVotes: 191, totalUsd: 781420,
    question: 'Should we open the token gate to smaller holders?',
    options: [
      opt('Ship it this week', 128, 482900, 4829 / 7814.2),
      opt('Wait for the audit', 44, 210400, 2104 / 7814.2),
      opt('Do neither and keep building quietly', 19, 88120, 881.2 / 7814.2),
    ],
  },
  zehn: (() => {
    const usd = Array.from({ length: 10 }, (_, i) => 400000 - i * 30000);
    const gesamt = usd.reduce((a, b) => a + b, 0);
    return {
      id: 4, closed: false, totalVotes: 235, totalUsd: gesamt,
      question: 'Pick the next AMA guest',
      options: usd.map((u, i) => opt(`Guest number ${i + 1}`, 55 - i * 4, u, u / gesamt)),
    };
  })(),
};

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style><body>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

const ergebnisse = [];
for (const f of FASSUNGEN) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({
    content: `
      const state = { cfg: { symbol: 'ANSEM' }, polls: [] };
      const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
      const toast = () => {};
      ${formate}
      ${f.patch(drawSource)}
      window.drawPoll = drawPoll;
    `,
  });

  const daten = await page.evaluate(async (cases) => {
    const drei = await window.drawPoll(cases.drei);
    const card = await window.drawPoll(cases.drei, { fuerKarte: true });
    const zehn = await window.drawPoll(cases.zehn);
    return {
      drei: drei.toDataURL('image/png'),
      card: card.toDataURL('image/png'),
      zehn: zehn.toDataURL('image/png'),
      // The rule that must not break: the fill widths of all options
      // together add up to exactly one full bar.
      summe: drei.geometrie.fuellungen.reduce((a, b) => a + b, 0) / drei.geometrie.content,
    };
  }, CASES);
  await page.close();

  const roh = (d) => Buffer.from(d.split(',')[1], 'base64');
  for (const [was, d] of Object.entries({ download: daten.drei, card: daten.card, zehn: daten.zehn })) {
    fs.writeFileSync(path.join(ausgabe, `balken-${f.file}-${was}.png`), roh(d));
  }
  ergebnisse.push({ ...daten, kb: roh(daten.card).length / 1024 });
  console.log(`  ${f.name.padEnd(26)} Karte ${(roh(daten.card).length / 1024).toFixed(0).padStart(4)} KB`
    + `   Summe der Fuellungen ${daten.summe.toFixed(4)}`);
}

// If a variant shifts this sum, it shows a wrong ratio. Better to flag it
// loudly here than miss it in the image.
const skewed = ergebnisse.filter((e) => Math.abs(e.summe - 1) > 0.002);
if (skewed.length) {
  console.log(`\n  ACHTUNG: ${skewed.length} Fassung(en) populate nicht mehr auf genau einen Balken.\n`);
}

const blattHtml = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>
  body { background: #07080b; padding: 30px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 110ch; }
  section { margin-bottom: 42px; }
  h2 { margin: 0 0 .1rem; font-size: 1rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.6rem; height: 1.6rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-size: .8rem; }
  .short { color: var(--dim); font-weight: 400; font-size: .86rem; }
  p.t { margin: .35rem 0 .8rem; font-size: .84rem; color: #8b93a7; line-height: 1.55; max-width: 120ch; }
  .row { display: grid; grid-template-columns: 1.1fr 1.1fr .8fr; gap: 18px; align-items: start; }
  .caption { font-size: .72rem; color: var(--dimmer); margin: 0 0 .35rem; }
  img { width: 100%; display: block; border-radius: 8px; }
  .buehne { background: #16181c; padding: 12px; border-radius: 12px; }
</style>
<h1>Die Füllung der Antwortbalken</h1>
<p class="lead">Links das Bild zum Herunterladen, in der Mitte die Vorschaukarte für X, right derselbe Entwurf mit zehn eng beieinanderliegenden Antworten – dort zeigt sich, ob eine Fassung auch bei kleinen Anteilen noch etwas sagt. Der Rahmen ist wieder das Grau einer Zeitleiste. Fassung 3 vom letzten Mal ist überall schon drin: flach, kräftiger Rand.</p>
${FASSUNGEN.map((f, i) => `
<section>
  <h2><span class="nr">${i}</span>${f.name}<span class="short">${f.short}</span></h2>
  <p class="t">${f.text}</p>
  <div class="row">
    <div><p class="caption">Herunterladen · 16:9</p><div class="buehne"><img src="${ergebnisse[i].drei}"></div></div>
    <div><p class="caption">Vorschau bei X · 1,91:1</p><div class="buehne"><img src="${ergebnisse[i].card}"></div></div>
    <div><p class="caption">Zehn Antworten</p><div class="buehne"><img src="${ergebnisse[i].zehn}"></div></div>
  </div>
</section>`).join('')}`;

const blatt = await browser.newPage({ viewport: { width: 1900, height: 1200 }, deviceScaleFactor: 1.4 });
await blatt.setContent(blattHtml);
await blatt.waitForTimeout(700);
await blatt.screenshot({ path: path.join(ausgabe, 'balken-uebersicht.png'), fullPage: true });
await browser.close();
server.close();

console.log(`\n  ${path.join(ausgabe, 'balken-uebersicht.png')}\n`);
