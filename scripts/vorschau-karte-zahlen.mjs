// ============================================================================
// Preview images: the gap between the amount and the vote count on the card
//
// Working it out on paper, something doesn't match the visual impression of
// the current layout. The two lines actually sit cleanly centered within
// the answer row:
//
//   row height 82, amount with cap height ~26 on baseline mid-8,
//   vote count with descender ~4 on mid+30
//   -> 7 px free above, 7 px free below.
//
// So the amount does NOT sit too high - it only looks that way. The reason
// is the gap between them: 26 px between the amount's baseline and the top
// edge of the vote count. With that much space, the eye stops reading the
// two as a pair and reads them as two separate things, and then the top one
// looks like it's drifted upward.
//
// So closing the gap pulls the two toward each other - the amount moves
// down, the vote count moves up, and the center stays the center. Here's
// the math behind it:
//
//   Amount at mid+a, vote count at mid+b.
//   It stays centered as long as a + b = 22.
//   The visible gap is then g = 10 - 2a.
//
// That's why only ONE value is adjustable here. Setting two values by hand
// would mean re-establishing the centering by hand after every change - and
// by the third time, someone forgets.
//
// A warning, because this has already gone the other way once: the gap was
// deliberately increased back then, because the vote count sat "too close
// to the $ figure" and read like a decimal of the amount. So too tight is a
// real bug, not a theoretical one. The last version here shows where that
// starts.
//
// Produces preview/zahlen-*.png and preview/zahlen-uebersicht.png
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

const AMOUNT = `ctx.fillText(fullUsd(o.usd), B - margin - 26, center - 8);`;
const VOTES = "ctx.fillText(`${wholeNumber(o.votes)} vote${o.votes === 1 ? '' : 's'}`, B - margin - 26, center + 30);";
if (!drawSource.includes(AMOUNT)) throw new Error('Die Betragszeile sieht anders aus als erwartet');
if (!drawSource.includes(VOTES)) throw new Error('Die Stimmenzeile sieht anders aus als erwartet');

// a is the only dial. b follows from it, so the pair stays centered.
const assign = (a) => (q) => q
  .replace(AMOUNT, `ctx.fillText(fullUsd(o.usd), B - margin - 26, center + ${a});`)
  .replace(VOTES, "ctx.fillText(`${wholeNumber(o.votes)} vote${o.votes === 1 ? '' : 's'}`, B - margin - 26, center + " + (22 - a) + ');');

const FASSUNGEN = [
  { file: 'jetzt', a: -8, name: 'Jetzt', hinweis: 'Lücke 26 px. Mittig gerechnet – wirkt trotzdem, als säße der Betrag zu hoch, weil das Paar zu far auseinandersteht, um als Paar gelesen zu werden.' },
  { file: 'a20', a: -5, name: 'Etwas enger', hinweis: 'Lücke 20 px. Der minSize Schritt, den man überhaupt sieht.' },
  { file: 'a16', a: -3, name: 'Enger', hinweis: 'Lücke 16 px. Die beiden fangen an, als ein Block zu wirken; der Betrag rutscht sichtbar nach bottom in die Zeile.' },
  { file: 'a12', a: -1, name: 'Deutlich enger', hinweis: 'Lücke 12 px. Betrag und Stimmenzahl gehören klar zusammen, stehen aber noch als zwei Zeilen da.' },
  { file: 'a8', a: 1, name: 'Eng', hinweis: 'Lücke 8 px. Hier fängt das alte Problem wieder an: Die Stimmenzahl beginnt, sich wie eine Nachkommastelle des Betrags zu lesen.' },
];

const opt = (label, votes, usd, share) => ({ id: 0, label, votes, usd, share });
const POLL = {
  id: 1, closed: false, totalVotes: 191, totalUsd: 781420,
  question: 'Should we open the token gate to smaller holders?',
  options: [
    opt('Ship it this week', 128, 482900, 4829 / 7814.2),
    opt('Wait for the audit', 44, 210400, 2104 / 7814.2),
    opt('Do neither and keep building quietly', 19, 88120, 881.2 / 7814.2),
  ],
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
      ${assign(f.a)(drawSource)}
      window.drawPoll = drawPoll;`,
  });
  const daten = await page.evaluate(async (p) => ({
    big: (await window.drawPoll(p)).toDataURL('image/png'),
    card: (await window.drawPoll(p, { fuerKarte: true })).toDataURL('image/png'),
  }), POLL);
  await page.close();

  const roh = (d) => Buffer.from(d.split(',')[1], 'base64');
  fs.writeFileSync(path.join(ausgabe, `zahlen-${f.file}-download.png`), roh(daten.big));
  fs.writeFileSync(path.join(ausgabe, `zahlen-${f.file}-karte.png`), roh(daten.card));
  ergebnisse.push(daten);
  console.log(`  ${f.name.padEnd(16)} Betrag mitte${f.a >= 0 ? '+' : ''}${f.a}`
    + `   Stimmen center+${22 - f.a}   Lücke ${10 - 2 * f.a} px`);
}

const blatt = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>
  body { background: #07080b; padding: 30px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 108ch; }
  section { margin-bottom: 38px; }
  h2 { margin: 0 0 .1rem; font-size: 1rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.6rem; height: 1.6rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-size: .8rem; }
  .werte { font-size: .7rem; color: var(--dimmer); font-weight: 400; }
  p.t { margin: .3rem 0 .7rem; font-size: .84rem; color: #8b93a7; line-height: 1.55; max-width: 118ch; }
  .paar { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
  .caption { font-size: .72rem; color: var(--dimmer); margin: 0 0 .35rem; }
  img { width: 100%; display: block; border-radius: 8px; }
  .buehne { background: #16181c; padding: 12px; border-radius: 12px; }
</style>
<h1>Betrag und Stimmenzahl auf der Karte</h1>
<p class="lead">Nur der Abstand zwischen den beiden ändert sich. Das Paar bleibt in jeder Fassung mittig in der Antwortzeile – der Betrag wandert nach bottom, die Stimmenzahl im selben Maß nach peek. Links das Bild zum Herunterladen, right die Vorschaukarte für X.</p>
${FASSUNGEN.map((f, i) => `
<section>
  <h2><span class="nr">${i}</span>${f.name}
    <span class="werte">Lücke ${10 - 2 * f.a} px</span></h2>
  <p class="t">${f.hinweis}</p>
  <div class="paar">
    <div><p class="caption">Herunterladen</p><div class="buehne"><img src="${ergebnisse[i].big}"></div></div>
    <div><p class="caption">Vorschau bei X</p><div class="buehne"><img src="${ergebnisse[i].card}"></div></div>
  </div>
</section>`).join('')}`;

const page = await browser.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 1.5 });
await page.setContent(blatt);
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(ausgabe, 'zahlen-uebersicht.png'), fullPage: true });
await browser.close();
server.close();

console.log(`\n  ${path.join(ausgabe, 'zahlen-uebersicht.png')}\n`);
