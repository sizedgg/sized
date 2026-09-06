// ============================================================================
// Vorschaubilder: Die Abstimmungskarte ohne Farbverlauf
//
// In der Karte steckt bis jetzt genau eine Stelle mit einem Verlauf: ein sehr
// schwacher Lichtschein unten rechts. Die Begründung im Code lautet:
//
//     "Ohne ihn ist die Fläche vollkommen flach, und zwischen lauter anderen
//      dunklen Kacheln in der Zeitleiste verschwindet eine flache Fläche."
//
// Das Problem ist echt und verschwindet nicht dadurch, dass der Verlauf geht.
// Eine Linkkarte auf X steht zwischen fremden Beiträgen; sie muss sich vom
// Grund der Zeitleiste absetzen, sonst sieht sie aus wie ein Loch. Die Frage
// ist deshalb nicht "mit oder ohne", sondern: WOMIT sonst.
//
// Drei Mittel stehen zur Verfügung, alle ohne Verlauf:
//
//   * Die Fläche selbst heller stellen – der Unterschied zum Grund wird
//     größer, bleibt aber eine einzige Farbe.
//   * Den Rand kräftiger ziehen – die Kante trennt, nicht die Fläche.
//   * Eine helle Linie an der oberen Innenkante – das älteste Mittel für
//     Tiefe ohne Verlauf, eine Kante Licht statt einer Wolke.
//
// Beide Formate werden gezeigt, weil sie verschiedene Aufgaben haben:
// das Bild zum Herunterladen (16:9, wird als Bild gepostet und ganz gesehen)
// und die Vorschaukarte (1,91:1, wird von X zugeschnitten und klein gezeigt).
// Was auf dem einen trägt, kann auf dem anderen verschwinden.
//
// Gemessen wird außerdem die Dateigröße. Der Verlauf ist der teuerste Teil
// eines PNG: Weiche Übergänge lassen sich nicht als Flächen packen, sie
// werden gerastert. Genau daran lag es, dass die Karte einmal 1,5 MB wog.
//
// Erzeugt preview/flach-*.png und preview/flach-uebersicht.png
// ============================================================================

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

// Woertlich aus app.js, wie in test-poll-bild.mjs: Eine nachgebaute Kopie
// wuerde etwas zeigen, das die App nicht zeichnet.
const schneide = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
// Ab cssWert, nicht ab BILD_BREITE: zeichnePoll() holt sich Farben und Schrift
// ueber diesen Helfer, und ohne ihn bricht die Leinwand beim ersten Aufruf ab.
const zeichner = schneide('const cssWert =', '\nasync function ladeOgBildHoch');
const formate = schneide('const nfGanz =', 'const ganzeZahl')
  + schneide('const ganzeZahl =', '\n');

// --- Die Stellen, an denen die Fassungen ansetzen --------------------------
const SCHEIN = `  const schein = ctx.createRadialGradient(B * .82, H * .9, 0, B * .82, H * .9, Math.max(B, H) * .8);
  schein.addColorStop(0, \`rgba(\${farbe.akzentRgb}, .055)\`);
  schein.addColorStop(.55, \`rgba(\${farbe.akzentRgb}, .018)\`);
  schein.addColorStop(1, \`rgba(\${farbe.akzentRgb}, 0)\`);
  ctx.fillStyle = schein;
  ctx.fillRect(0, 0, B, H);`;
if (!zeichner.includes(SCHEIN)) throw new Error('Der Lichtschein sieht in app.js anders aus als hier erwartet');

const FUELLUNG = `  ctx.fillStyle = farbe.karte;
  ctx.fillRect(m, m, B - m * 2, karteH);`;
if (!zeichner.includes(FUELLUNG)) throw new Error('Die Kartenfuellung sieht anders aus als erwartet');

const RAND = `  ctx.strokeStyle = farbe.linie;
  ctx.lineWidth = 1.5;`;
if (!zeichner.includes(RAND)) throw new Error('Der Rand sieht anders aus als erwartet');

const ohneSchein = (q) => q.replace(SCHEIN, '  // kein Lichtschein');

const FASSUNGEN = [
  { datei: 'jetzt', name: 'Jetzt',
    kurz: 'Mit Lichtschein',
    text: 'Der Stand von heute: ein sehr schwacher Verlauf unten rechts. Er ist das Einzige, was die Fläche im Bild nicht ganz flach macht – und die einzige Stelle, die dem flachen Grund der Seite widerspricht.',
    patch: (q) => q },

  { datei: 'flach', name: 'Einfach flach',
    kurz: 'Der Verlauf fällt ersatzlos weg',
    text: 'Sonst nichts geändert. Die Karte ist damit eine einzige Farbe, abgesetzt nur durch die Haarlinie am Rand. Am nächsten an der Seite – die Frage ist, ob sie sich in einer Zeitleiste noch behauptet.',
    patch: ohneSchein },

  { datei: 'heller', name: 'Flach, Fläche heller',
    kurz: 'Der Unterschied zum Grund wird größer',
    text: 'Statt eines Verlaufs eine hellere Fläche: --bg-2 statt --bg-1. Ein einziger Farbwert, kein Übergang. Der Abstand zum Bildgrund verdoppelt sich ungefähr, die Karte bleibt aber eine ruhige Fläche.',
    patch: (q) => ohneSchein(q).replace(FUELLUNG,
      `  ctx.fillStyle = farbe.balken;\n  ctx.fillRect(m, m, B - m * 2, karteH);`) },

  { datei: 'rand', name: 'Flach, Rand kräftiger',
    kurz: 'Die Kante trennt, nicht die Fläche',
    text: 'Der Rand wird heller und doppelt so stark. Das ist das Mittel, das den Weg durch X am besten übersteht: Eine Fläche kann bei der Umrechnung in JPEG in ihrer Umgebung untergehen, ein Strich bleibt ein Strich.',
    patch: (q) => ohneSchein(q).replace(RAND,
      `  ctx.strokeStyle = farbe.dimmer;\n  ctx.lineWidth = 3;`) },

  { datei: 'kante', name: 'Flach, Lichtkante oben',
    kurz: 'Eine Linie statt einer Wolke',
    text: 'Eine helle Linie an der oberen Innenkante, wie bei einer Fläche, auf die Licht von oben fällt. Gibt Tiefe ohne Verlauf – das älteste Mittel dafür. Auf der zugeschnittenen Vorschaukarte ist sie allerdings nah am oberen Schnittrand.',
    patch: (q) => ohneSchein(q).replace(FUELLUNG,
      `  ctx.fillStyle = farbe.karte;
  ctx.fillRect(m, m, B - m * 2, karteH);
  ctx.save();
  ctx.strokeStyle = \`rgba(\${farbe.akzentRgb}, .16)\`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(m + 30, m + 1); ctx.lineTo(B - m - 30, m + 1);
  ctx.stroke();
  ctx.restore();`) },

  { datei: 'beides', name: 'Flach, heller + Rand',
    kurz: 'Die zwei stärksten Mittel zusammen',
    text: 'Hellere Fläche und kräftigerer Rand gemeinsam. Setzt sich am deutlichsten ab und übersteht die Umrechnung durch X am sichersten. Auch die lauteste Fassung – zwischen ruhigen Beiträgen fällt sie auf.',
    patch: (q) => ohneSchein(q)
      .replace(FUELLUNG, `  ctx.fillStyle = farbe.balken;\n  ctx.fillRect(m, m, B - m * 2, karteH);`)
      .replace(RAND, `  ctx.strokeStyle = farbe.dimmer;\n  ctx.lineWidth = 3;`) },
];

const POLL = {
  id: 1, closed: false, totalVotes: 191, totalUsd: 781420,
  question: 'Should we open the token gate to smaller holders?',
  options: [
    { id: 0, label: 'Ship it this week', votes: 128, usd: 482900, share: 4829 / 7814.2 },
    { id: 1, label: 'Wait for the audit', votes: 44, usd: 210400, share: 2104 / 7814.2 },
    { id: 2, label: 'Do neither and keep building quietly', votes: 19, usd: 88120, share: 881.2 / 7814.2 },
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
  const seite = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.addScriptTag({
    content: `
      const state = { cfg: { symbol: 'ANSEM' }, polls: [] };
      const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
      const toast = () => {};
      ${formate}
      ${f.patch(zeichner)}
      window.zeichnePoll = zeichnePoll;
    `,
  });

  const daten = await seite.evaluate(async (p) => {
    const gross = await window.zeichnePoll(p);
    const karte = await window.zeichnePoll(p, { fuerKarte: true });
    return { gross: gross.toDataURL('image/png'), karte: karte.toDataURL('image/png') };
  }, POLL);
  await seite.close();

  const roh = (d) => Buffer.from(d.split(',')[1], 'base64');
  const [g, k] = [roh(daten.gross), roh(daten.karte)];
  fs.writeFileSync(path.join(ausgabe, `flach-${f.datei}-download.png`), g);
  fs.writeFileSync(path.join(ausgabe, `flach-${f.datei}-karte.png`), k);
  ergebnisse.push({ gross: daten.gross, karte: daten.karte, kb: { g: g.length / 1024, k: k.length / 1024 } });
  console.log(`  ${f.name.padEnd(24)} Download ${(g.length / 1024).toFixed(0).padStart(4)} KB   Karte ${(k.length / 1024).toFixed(0).padStart(4)} KB`);
}

// --- Übersichtsblatt -------------------------------------------------------
// Nebeneinander, weil genau das die Frage ist: Was auf dem grossen Bild traegt,
// kann auf der kleinen zugeschnittenen Kachel verschwinden.
const blattHtml = `<!doctype html>
<meta charset="utf-8">
<style>${css}</style>
<style>
  body { background: #07080b; padding: 30px; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .lead { margin: 0 0 1.7rem; font-size: .86rem; color: var(--dim); max-width: 108ch; }
  section { margin-bottom: 40px; }
  h2 { margin: 0 0 .1rem; font-size: 1rem; font-weight: 600; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .nr { display: inline-flex; align-items: center; justify-content: center;
        width: 1.6rem; height: 1.6rem; border-radius: 999px; background: var(--bg-3);
        color: var(--dim); font-size: .8rem; }
  .kurz { color: var(--dim); font-weight: 400; font-size: .86rem; }
  .werte { font-size: .7rem; color: var(--dimmer); font-weight: 400; }
  p.t { margin: .35rem 0 .8rem; font-size: .84rem; color: #8b93a7; line-height: 1.55; max-width: 118ch; }
  .paar { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
  .beschriftung { font-size: .72rem; color: var(--dimmer); margin: 0 0 .35rem; }
  img { width: 100%; display: block; border-radius: 8px; }
  /* Der Grund hinter den Bildern ist absichtlich NICHT der Seitengrund, sondern
     das Grau einer Zeitleiste – dort steht die Kachel spaeter. Auf Schwarz
     sieht jede dunkle Karte gut aus. */
  .buehne { background: #16181c; padding: 14px; border-radius: 12px; }
</style>
<h1>Die Abstimmungskarte ohne Verlauf</h1>
<p class="lead">Links jeweils das Bild zum Herunterladen, rechts die Vorschaukarte für X. Der Rahmen dahinter ist bewusst nicht schwarz, sondern das Grau einer Zeitleiste – auf schwarzem Grund sieht jede dunkle Karte gut aus, und genau dort steht sie später nicht.</p>
${FASSUNGEN.map((f, i) => `
<section>
  <h2><span class="nr">${i}</span>${f.name}<span class="kurz">${f.kurz}</span>
    <span class="werte">${ergebnisse[i].kb.g.toFixed(0)} KB / ${ergebnisse[i].kb.k.toFixed(0)} KB</span></h2>
  <p class="t">${f.text}</p>
  <div class="paar">
    <div><p class="beschriftung">Herunterladen · 16:9</p>
      <div class="buehne"><img src="${ergebnisse[i].gross}"></div></div>
    <div><p class="beschriftung">Vorschau bei X · 1,91:1</p>
      <div class="buehne"><img src="${ergebnisse[i].karte}"></div></div>
  </div>
</section>`).join('')}`;

const blatt = await browser.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 1.5 });
await blatt.setContent(blattHtml);
await blatt.waitForTimeout(600);
await blatt.screenshot({ path: path.join(ausgabe, 'flach-uebersicht.png'), fullPage: true });
await browser.close();
server.close();

console.log(`\n  ${path.join(ausgabe, 'flach-uebersicht.png')}\n`);
