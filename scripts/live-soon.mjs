// ============================================================================
// Das Ankuendigungsbild fuer den Beitrag auf @Sizedgg
//
// Die Marke, darunter "LIVE SOON". Sonst nichts.
//
// Zwei Formate, weil X sie verschieden zeigt:
//
//   16:9 (1600 x 900)  – das Standardformat fuer ein einzelnes Bild
//   1:1  (1200 x 1200) – nimmt in der Zeitleiste mehr Hoehe ein und faellt
//                        dadurch staerker auf
//
// Farben, Schrift und Zeichen kommen aus derselben Quelle wie das Banner:
// public/styles.css und public/index.html. Die Begruendung steht dort
// ausfuehrlich; kurz: Ein Grau eine Spur neben dem Grau der Seite sieht neben
// den Bildschirmfotos falsch aus, und niemand kann sagen warum.
//
//   node scripts/live-soon.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');

const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(pub, 'styles.css'), 'utf8');

const MARKE = (() => {
  const a = html.indexOf('<svg viewBox="29 16 42 64"');
  const b = html.indexOf('</svg>', a) + 6;
  if (a < 0) throw new Error('Zeichen nicht in index.html gefunden');
  return html.slice(a, b);
})();

const farbe = (name) => {
  const t = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!t) throw new Error(`--${name} nicht in styles.css gefunden`);
  return t[1].trim();
};
const C = { bg: farbe('bg'), text: farbe('text'), dim: farbe('dim'),
  accent: farbe('accent') };

// Der Satz.
//
// Auf der geschlossenen Seite steht "Launching soon." – hier steht "LIVE
// SOON", weil es so gewuenscht war. Das ist kein Widerspruch, solange man
// es weiss: Der eine Satz steht auf der Seite, der andere auf dem Konto.
const SATZ = 'LIVE SOON';

// Mit und ohne Zeichen.
//
// Ohne wird der Satz groesser und heller: Allein auf der Flaeche ist er das
// Bild und nicht mehr die Beschriftung darunter. In --dim und 30 px waere er
// ein Zettel, den jemand vergessen hat.
const FORMATE = [
  { nr: 1, name: '16:9, mit Zeichen', w: 1600, h: 900, marke: 96, satz: 30 },
  { nr: 2, name: '1:1, mit Zeichen', w: 1200, h: 1200, marke: 88, satz: 28 },
  { nr: 3, name: '16:9, nur der Satz', w: 1600, h: 900, marke: 0, satz: 84 },
  { nr: 4, name: '1:1, nur der Satz', w: 1200, h: 1200, marke: 0, satz: 72 },
];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });

console.log('\nAnkuendigungsbild fuer @Sizedgg\n');

for (const f of FORMATE) {
  const seite = await browser.newPage({
    viewport: { width: f.w, height: f.h }, deviceScaleFactor: 2,
  });
  await seite.setContent(`
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: ${f.w}px; height: ${f.h}px; overflow: hidden;
        background: ${C.bg}; color: ${C.text};
        font-family: "DejaVu Sans Mono", ui-monospace, monospace;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        /* Der Abstand zwischen Marke und Satz haengt an der Schriftgroesse
           und nicht an einer festen Zahl: So bleibt das Verhaeltnis gleich,
           wenn jemand die Groessen oben aendert. */
        gap: ${Math.round((f.marke || f.satz) * 0.42)}px;
      }
      .marke { display: flex; align-items: center; gap: .42em;
        font-size: ${f.marke}px; font-weight: 700; letter-spacing: .18em; }
      .marke svg { width: .82em; height: 1.18em; fill: ${C.accent}; }
      /* Weiter gesperrt als die Marke und deutlich kleiner: Es ist die
         Beschriftung unter dem Zeichen, nicht die zweite Zeile eines Titels.
         Gleiche Groesse haette zwei Marken ergeben. */
      .satz { font-size: ${f.satz}px; letter-spacing: .38em;
        color: ${f.marke ? C.dim : C.text}; text-indent: .38em;
        ${f.marke ? '' : 'font-weight: 700;'} }
    </style>
    ${f.marke ? `<div class="marke">${MARKE}SIZED</div>` : ''}
    <div class="satz">${SATZ}</div>`, { waitUntil: 'load' });

  // Nachmessen: Die Gruppe muss wirklich mittig stehen. Ein text-indent, ein
  // Sperrsatz, ein Rand – jedes davon kann sie um ein paar Pixel verschieben,
  // und auf einer leeren Flaeche sieht man genau das.
  const lage = await seite.evaluate(() => {
    const r = [...document.body.children].map((t) => t.getBoundingClientRect());
    const links = Math.min(...r.map((x) => x.left));
    const rechts = innerWidth - Math.max(...r.map((x) => x.right));
    return {
      seitlich: Math.round(links - rechts),
      oben: Math.round(Math.min(...r.map((x) => x.top))),
      unten: Math.round(innerHeight - Math.max(...r.map((x) => x.bottom))),
    };
  });

  const datei = path.join(root, 'preview', `live-soon-${f.nr}.png`);
  await seite.screenshot({ path: datei });
  await seite.close();

  console.log(`  ${f.nr}. ${f.name}  ${f.w * 2}x${f.h * 2}`);
  console.log(`     mittig: ${Math.abs(lage.seitlich)} px Unterschied links/rechts`
    + `, ${lage.oben} oben / ${lage.unten} unten`);
  console.log(`     ${path.relative(root, datei)}\n`);
}

await browser.close();
