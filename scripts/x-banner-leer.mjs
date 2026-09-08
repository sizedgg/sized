/**
 * Ein leeres Banner, 5:2, mit zwei Zeichen in der Mitte.
 *
 * Derselbe Grund wie Profilbild und Kopfleiste - und zwar nicht "derselbe
 * Farbton", sondern derselbe Wert: --bg aus public/styles.css, ueber die
 * var()-Ketten aufgeloest. Nach dem Zeichnen wird die Ecke des fertigen
 * Bildes gegen den Grund der beiden anderen Dateien gehalten, damit ein
 * Tippfehler nicht als "sieht doch gleich aus" durchgeht.
 *
 * 1600 x 640, also 5:2, in doppelter Aufloesung: 3200 x 1280.
 *
 *   node scripts/x-banner-leer.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');
const OUT = path.join(root, 'post', 'x');
fs.mkdirSync(OUT, { recursive: true });

const css = fs.readFileSync(path.join(pub, 'styles.css'), 'utf8');

/** Ein Farbwert aus styles.css, ueber var()-Ketten hinweg aufgeloest. */
const farbe = (name, tiefe = 0) => {
  if (tiefe > 8) throw new Error(`--${name}: Verweis dreht sich im Kreis`);
  const t = new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm').exec(css);
  if (!t) throw new Error(`--${name} nicht in styles.css gefunden`);
  const wert = t[1].trim();
  const verweis = /^var\(--([\w-]+)\)$/.exec(wert);
  return verweis ? farbe(verweis[1], tiefe + 1) : wert;
};
const GRUND = farbe('bg');

// Die Zeichen. Das zweite traegt eine Variantenauswahl (U+FE0F) hinter sich -
// ohne sie zeichnen manche Systeme das Mahjong-Zeichen als schwarze
// Schriftglyphe statt als farbiges Bild.
const ZEICHEN = '🐂🀄️';

// In welchem Satz.
// ---------------------------------------------------------------------------
// In einem PNG ist der Stil eingebrannt: wer das Bild ansieht, sieht den
// Satz, der hier gezeichnet wurde, und nicht die Emoji seines Geraets.
//
//   twemoji  der Satz, den X selbst zeichnet. Fuer ein Bild, das auf X
//            landet, ist das der einzige, bei dem die Zeichen im Banner
//            genauso aussehen wie dieselben Zeichen im Text daneben.
//            CC-BY, aus @twemoji/svg.
//   noto     was auf diesem Rechner installiert ist.
//
// Apples Satz ist bewusst nicht dabei: die Schrift gehoert Apple und liegt
// nur auf Apple-Geraeten. Sie hier einzubauen hiesse, sie mitzuliefern.
const SATZ = process.env.EMOJI_SATZ || 'twemoji';

/** Ein Twemoji-Bild als data:-URI, aus dem npm-Paket gelesen. */
const twemojiSvg = (zeichen) => {
  // Die Variantenauswahl gehoert nicht in den Dateinamen.
  const punkte = [...zeichen]
    .map((z) => z.codePointAt(0))
    .filter((c) => c !== 0xfe0f)
    .map((c) => c.toString(16))
    .join('-');
  const datei = path.join(root, 'node_modules', '@twemoji', 'svg', punkte + '.svg');
  if (!fs.existsSync(datei)) throw new Error(`Twemoji fehlt fuer ${zeichen} (${punkte}.svg)`);
  return 'data:image/svg+xml;base64,' + fs.readFileSync(datei).toString('base64');
};

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars', '--force-color-profile=srgb'],
});

const ctx = await browser.newContext({
  viewport: { width: 1600, height: 640 }, deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body { background: ${GRUND}; display: grid; place-items: center; }
  /* Noto Color Emoji zuerst, damit die Zeichen als Bild und nicht als
     Schriftglyphe kommen. line-height 1, sonst sitzt die Zeile durch die
     Vorgabe der Schrift ein Stueck ueber der Mitte statt in ihr. */
  .zeichen {
    font-family: 'Noto Color Emoji', sans-serif;
    font-size: 180px; line-height: 1; letter-spacing: .06em;
    /* Die Laufweite haengt auch HINTER dem letzten Zeichen. Der Kasten ist
       damit breiter als die Tinte darin, und ein mittiger Kasten heisst
       nicht mittige Zeichen - gemessen sass die Mitte 42 Punkte zu weit
       links. Der negative Rand nimmt genau den einen Abstand wieder weg. */
    margin-right: -.06em;
  }
  /* Als Bilder gibt es das Problem nicht - der Abstand steht ZWISCHEN
     ihnen und nicht dahinter. */
  .bilder { display: flex; align-items: center; gap: 44px; }
  .bilder img { display: block; height: 180px; width: auto; }
</style>${SATZ === 'twemoji'
    ? `<div class="bilder">${[...'🐂', '🀄️'].length && ''}`
      + `<img src="${twemojiSvg('🐂')}" alt=""><img src="${twemojiSvg('🀄️')}" alt=""></div>`
    : `<div class="zeichen">${ZEICHEN}</div>`}`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
const datei = path.join(OUT, SATZ === 'twemoji'
  ? 'sized-x-banner-leer.png' : 'sized-x-banner-leer-noto.png');
await page.screenshot({ path: datei });
await ctx.close();

// --- Nachmessen -------------------------------------------------------------
const pruef = await browser.newContext({ deviceScaleFactor: 1 });
const pp = await pruef.newPage();

const lies = async (d) => {
  const b64 = fs.readFileSync(d).toString('base64');
  return pp.evaluate(async (q) => {
    const img = new Image();
    await new Promise((ok) => { img.onload = ok; img.src = 'data:image/png;base64,' + q; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d2 = g.getImageData(0, 0, c.width, c.height).data;
    const eck = [d2[0], d2[1], d2[2]];
    let minX = c.width, maxX = -1, minY = c.height, maxY = -1, bunt = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (Math.abs(d2[i] - eck[0]) > 6 || Math.abs(d2[i + 1] - eck[1]) > 6
          || Math.abs(d2[i + 2] - eck[2]) > 6) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          // Farbig heisst: die Kanaele liegen weit auseinander. Ein
          // Ersatzkaestchen oder eine schwarze Glyphe waere grau.
          const max = Math.max(d2[i], d2[i + 1], d2[i + 2]);
          const min = Math.min(d2[i], d2[i + 1], d2[i + 2]);
          if (max - min > 40) bunt++;
        }
      }
    }
    return { grund: eck, breite: c.width, hoehe: c.height, minX, maxX, minY, maxY, bunt };
  }, b64);
};

const m = await lies(datei);
console.log(`\n  Satz: ${SATZ}`);
console.log(`  ${m.breite} x ${m.hoehe}  (${(m.breite / m.hoehe).toFixed(2)} : 1)`);
console.log(`  Grund rgb(${m.grund.join(', ')})  aus --bg ${GRUND}`);

const proben = [];
let schlecht = 0;
const pruefe = (name, ok, zusatz) => {
  proben.push(ok);
  if (!ok) schlecht++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${zusatz ? '  — ' + zusatz : ''}`);
};

pruefe('Format 5:2', Math.abs(m.breite / m.hoehe - 2.5) < 0.001,
  `${(m.breite / m.hoehe).toFixed(4)}`);

// Derselbe Grund wie die beiden anderen Dateien - gemessen, nicht behauptet.
for (const nachbar of ['sized-x-profil.png', 'sized-x-kopf.png']) {
  const pfad = path.join(OUT, nachbar);
  if (!fs.existsSync(pfad)) { pruefe(`${nachbar} liegt daneben`, false, 'fehlt'); continue; }
  const n = await lies(pfad);
  pruefe(`Grund wie ${nachbar}`, n.grund.every((v, i) => v === m.grund[i]),
    `rgb(${n.grund.join(', ')})`);
}

// Die Zeichen sind wirklich da, wirklich farbig und wirklich in der Mitte.
// Ohne diese drei waere ein leeres Blatt, ein Paar schwarzer Kaestchen oder
// eine aus der Mitte gerutschte Zeile genauso durchgegangen.
pruefe('Die Zeichen stehen im Bild', m.maxX > 0, `${m.maxX - m.minX} x ${m.maxY - m.minY} Punkte`);
pruefe('Und sind farbig, keine Ersatzkaestchen', m.bunt > 5000, `${m.bunt} bunte Punkte`);
const mitteX = (m.minX + m.maxX) / 2;
const mitteY = (m.minY + m.maxY) / 2;
pruefe('Waagerecht mittig', Math.abs(mitteX - m.breite / 2) < m.breite * 0.01,
  `Mitte bei ${Math.round(mitteX)} von ${m.breite / 2}`);
pruefe('Senkrecht mittig', Math.abs(mitteY - m.hoehe / 2) < m.hoehe * 0.02,
  `Mitte bei ${Math.round(mitteY)} von ${m.hoehe / 2}`);

await pp.close();
await pruef.close();
await browser.close();
console.log(`\n  ${path.relative(root, datei)}\n`);
if (schlecht) process.exit(1);
