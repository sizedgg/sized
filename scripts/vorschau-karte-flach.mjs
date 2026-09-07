// ============================================================================
// Preview images: the poll card without a gradient
//
// The card currently has exactly one spot with a gradient: a very faint
// glow in the bottom right. The reasoning in the code reads:
//
//     "Without it the area is completely flat, and among a bunch of other
//      dark tiles in the timeline, a flat area disappears."
//
// The problem is real and doesn't go away just because the gradient does.
// A link card on X sits among other people's posts; it has to set itself
// apart from the timeline background, or it looks like a hole. So the
// question isn't "with or without", it's: WITH WHAT instead.
//
// Three means are available, all without a gradient:
//
//   * Make the area itself lighter - the difference against the background
//     gets bigger, but it stays a single flat color.
//   * Draw the border more strongly - the edge does the separating, not
//     the area.
//   * A light line along the upper inner edge - the oldest trick for depth
//     without a gradient, one edge of light instead of a cloud.
//
// Both formats are shown, because they serve different purposes: the image
// to download (16:9, posted as an image and seen in full) and the preview
// card (1.91:1, cropped by X and shown small). What holds up on one can
// vanish on the other.
//
// File size is measured too. The gradient is the most expensive part of a
// PNG: soft transitions can't be packed as flat areas, they get rasterized.
// That's exactly why the card once weighed in at 1.5 MB.
//
// Produces preview/flach-*.png and preview/flach-uebersicht.png
// ============================================================================

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

// Verbatim from app.js, like in test-poll-bild.mjs: a rebuilt copy would
// show something the app doesn't actually draw.
const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
// Starting from cssWert, not from IMAGE_WIDTH: drawPoll() gets its colors
// and fonts via this helper, and without it the canvas bails on the first call.
const drawSource = cut('const cssWert =', '\nasync function ladeOgBildHoch');
const formate = cut('const nfGanz =', 'const wholeNumber')
  + cut('const wholeNumber =', '\n');

// --- The spots the versions hook into ---------------------------------------
const GLOW = `  const schein = ctx.createRadialGradient(B * .82, H * .9, 0, B * .82, H * .9, Math.max(B, H) * .8);
  schein.addColorStop(0, \`rgba(\${color.akzentRgb}, .055)\`);
  schein.addColorStop(.55, \`rgba(\${color.akzentRgb}, .018)\`);
  schein.addColorStop(1, \`rgba(\${color.akzentRgb}, 0)\`);
  ctx.fillStyle = schein;
  ctx.fillRect(0, 0, B, H);`;
if (!drawSource.includes(GLOW)) throw new Error('Der Lichtschein sieht in app.js anders aus als hier erwartet');

const FILL_LEVEL = `  ctx.fillStyle = color.card;
  ctx.fillRect(m, m, B - m * 2, cardH);`;
if (!drawSource.includes(FILL_LEVEL)) throw new Error('Die Kartenfuellung sieht anders aus als erwartet');

const MARGIN = `  ctx.strokeStyle = color.linie;
  ctx.lineWidth = 1.5;`;
if (!drawSource.includes(MARGIN)) throw new Error('Der Rand sieht anders aus als erwartet');

const withoutGlow = (q) => q.replace(GLOW, '  // kein Lichtschein');

const FASSUNGEN = [
  { file: 'jetzt', name: 'Jetzt',
    short: 'Mit Lichtschein',
    text: 'Der Stand von heute: ein sehr schwacher Verlauf bottom right. Er ist das Einzige, was die Fläche im Bild nicht ganz flach macht – und die einzige Stelle, die dem flachen Grund der Seite widerspricht.',
    patch: (q) => q },

  { file: 'flach', name: 'Einfach flach',
    short: 'Der Verlauf fällt ersatzlos weg',
    text: 'Sonst nichts geändert. Die Karte ist damit eine einzige Farbe, abgesetzt nur durch die Haarlinie am Rand. Am nächsten an der Seite – die Frage ist, ob sie sich in einer Zeitleiste noch behauptet.',
    patch: withoutGlow },

  { file: 'heller', name: 'Flach, Fläche heller',
    short: 'Der Unterschied zum Grund wird größer',
    text: 'Statt eines Verlaufs eine hellere Fläche: --bg-2 statt --bg-1. Ein einziger Farbwert, kein Übergang. Der Abstand zum Bildgrund verdoppelt sich ungefähr, die Karte bleibt aber eine ruhige Fläche.',
    patch: (q) => withoutGlow(q).replace(FILL_LEVEL,
      `  ctx.fillStyle = color.balken;\n  ctx.fillRect(m, m, B - m * 2, cardH);`) },

  { file: 'margin', name: 'Flach, Rand kräftiger',
    short: 'Die Kante trennt, nicht die Fläche',
    text: 'Der Rand wird heller und doppelt so stark. Das ist das Mittel, das den Weg durch X am besten übersteht: Eine Fläche kann bei der Umrechnung in JPEG in ihrer Umgebung untergehen, ein Strich bleibt ein Strich.',
    patch: (q) => withoutGlow(q).replace(MARGIN,
      `  ctx.strokeStyle = color.dimmer;\n  ctx.lineWidth = 3;`) },

  { file: 'kante', name: 'Flach, Lichtkante peek',
    short: 'Eine Linie statt einer Wolke',
    text: 'Eine helle Linie an der oberen Innenkante, wie bei einer Fläche, auf die Licht von peek fällt. Gibt Tiefe ohne Verlauf – das älteste Mittel dafür. Auf der zugeschnittenen Vorschaukarte ist sie allerdings nah am oberen Schnittrand.',
    patch: (q) => withoutGlow(q).replace(FILL_LEVEL,
      `  ctx.fillStyle = color.card;
  ctx.fillRect(m, m, B - m * 2, cardH);
  ctx.save();
  ctx.strokeStyle = \`rgba(\${color.akzentRgb}, .16)\`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(m + 30, m + 1); ctx.lineTo(B - m - 30, m + 1);
  ctx.stroke();
  ctx.restore();`) },

  { file: 'beides', name: 'Flach, heller + Rand',
    short: 'Die zwei stärksten Mittel zusammen',
    text: 'Hellere Fläche und kräftigerer Rand gemeinsam. Setzt sich am deutlichsten ab und übersteht die Umrechnung durch X am sichersten. Auch die lauteste Fassung – zwischen ruhigen Beiträgen fällt sie auf.',
    patch: (q) => withoutGlow(q)
      .replace(FILL_LEVEL, `  ctx.fillStyle = color.balken;\n  ctx.fillRect(m, m, B - m * 2, cardH);`)
      .replace(MARGIN, `  ctx.strokeStyle = color.dimmer;\n  ctx.lineWidth = 3;`) },
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

  const daten = await page.evaluate(async (p) => {
    const big = await window.drawPoll(p);
    const card = await window.drawPoll(p, { fuerKarte: true });
    return { big: big.toDataURL('image/png'), card: card.toDataURL('image/png') };
  }, POLL);
  await page.close();

  const roh = (d) => Buffer.from(d.split(',')[1], 'base64');
  const [g, k] = [roh(daten.big), roh(daten.card)];
  fs.writeFileSync(path.join(ausgabe, `flach-${f.file}-download.png`), g);
  fs.writeFileSync(path.join(ausgabe, `flach-${f.file}-karte.png`), k);
  ergebnisse.push({ big: daten.big, card: daten.card, kb: { g: g.length / 1024, k: k.length / 1024 } });
  console.log(`  ${f.name.padEnd(24)} Download ${(g.length / 1024).toFixed(0).padStart(4)} KB   Karte ${(k.length / 1024).toFixed(0).padStart(4)} KB`);
}

// --- Overview sheet ----------------------------------------------------------
// Side by side, because that's exactly the question: what holds up on the
// large image can vanish on the small cropped tile.
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
  .short { color: var(--dim); font-weight: 400; font-size: .86rem; }
  .werte { font-size: .7rem; color: var(--dimmer); font-weight: 400; }
  p.t { margin: .35rem 0 .8rem; font-size: .84rem; color: #8b93a7; line-height: 1.55; max-width: 118ch; }
  .paar { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
  .caption { font-size: .72rem; color: var(--dimmer); margin: 0 0 .35rem; }
  img { width: 100%; display: block; border-radius: 8px; }
  /* The background behind the images is deliberately NOT the page
     background, but the gray of a timeline - that's where the tile ends up
     later. Every dark card looks good on black. */
  .buehne { background: #16181c; padding: 14px; border-radius: 12px; }
</style>
<h1>Die Abstimmungskarte ohne Verlauf</h1>
<p class="lead">Links jeweils das Bild zum Herunterladen, right die Vorschaukarte für X. Der Rahmen dahinter ist bewusst nicht schwarz, sondern das Grau einer Zeitleiste – auf schwarzem Grund sieht jede dunkle Karte gut aus, und genau dort steht sie später nicht.</p>
${FASSUNGEN.map((f, i) => `
<section>
  <h2><span class="nr">${i}</span>${f.name}<span class="short">${f.short}</span>
    <span class="werte">${ergebnisse[i].kb.g.toFixed(0)} KB / ${ergebnisse[i].kb.k.toFixed(0)} KB</span></h2>
  <p class="t">${f.text}</p>
  <div class="paar">
    <div><p class="caption">Herunterladen · 16:9</p>
      <div class="buehne"><img src="${ergebnisse[i].big}"></div></div>
    <div><p class="caption">Vorschau bei X · 1,91:1</p>
      <div class="buehne"><img src="${ergebnisse[i].card}"></div></div>
  </div>
</section>`).join('')}`;

const blatt = await browser.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 1.5 });
await blatt.setContent(blattHtml);
await blatt.waitForTimeout(600);
await blatt.screenshot({ path: path.join(ausgabe, 'flach-uebersicht.png'), fullPage: true });
await browser.close();
server.close();

console.log(`\n  ${path.join(ausgabe, 'flach-uebersicht.png')}\n`);
