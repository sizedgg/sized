// ============================================================================
// Profile pictures for SIZED's X account
//
// Built from the site's palette (styles.css) and in its typeface - an
// image that looked out of place next to it would be wrong for that
// reason alone.
//
// The yardstick everything here succeeds or fails by: X shows the image
// in the timeline as a CIRCLE of about 40 px. What isn't legible there
// doesn't exist - a five-letter wordmark is a gray smudge at 40 px. That's
// why every variant has the same file shown again at full size next to it.
//
// Output is 400 x 400 px (X downscales it anyway) plus a comparison sheet.
//
//   node scripts/vorschau-profilbild.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

// The colors come from styles.css and are not copied out by hand: whoever
// recolors the site recolors the image along with it.
const fetch = (name) => {
  const t = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!t) throw new Error(`Farbe fehlt in styles.css: ${name}`);
  return t[1].trim();
};
const COLOR = {
  bg: fetch('--bg-1'),
  bg2: fetch('--bg-2'),
  linie: fetch('--line'),
  text: fetch('--text'),
  dim: fetch('--dim'),
  dimmer: fetch('--dimmer'),
  akzent: fetch('--accent'),
  gold: fetch('--gold'),
  t0: (css.match(/\.h\.t0 \{ color: (#\w+); \}/) || [])[1],
  t1: (css.match(/\.h\.t1 \{ color: (#\w+); \}/) || [])[1],
  t2: (css.match(/\.h\.t2 \{ color: (#\w+); \}/) || [])[1],
  t3: (css.match(/\.h\.t3 \{ color: (#\w+); \}/) || [])[1],
};
// The typeface sits as a class in the style block and NOT in the style
// attribute: the font stack contains double quotes ("SF Mono"), and those
// end a style="..." halfway through. Everything after that - size, color
// - fell out of the attribute and became inert attributes. In the image
// you saw a tiny, nearly black S and no error.

// ---------------------------------------------------------------------------
// The drafts
// ---------------------------------------------------------------------------
// Each is a 400 px square; X cuts a circle out of it.
const DRAFTS = [
  {
    nr: 1, name: 'S',
    was: 'Ein Buchstabe in der Schrift der Seite. Traegt bei 40 px am '
       + 'weitesten, sagt aber nichts ueber das Produkt.',
    html: `<div class="platte" style="background:${COLOR.bg}">
             <span class="mono" style="font-size:230px; color:${COLOR.akzent}">S</span>
           </div>`,
  },
  {
    nr: 2, name: 'Sortiert nach Groesse',
    was: 'Vier Balken, absteigend – der Posteingang und die Abstimmung sind '
       + 'beide danach geordnet. Nur Form, keine Schrift: haelt jede Groesse aus.',
    html: `<div class="platte" style="background:${COLOR.bg}">
             <div style="display:flex; flex-direction:column; gap:26px; align-items:flex-start">
               ${[[210, COLOR.t3], [160, COLOR.t2], [110, COLOR.t1], [60, COLOR.t0]]
                 .map(([b, f]) => `<div style="width:${b}px; height:26px; border-radius:13px; background:${f}"></div>`)
                 .join('')}
             </div>
           </div>`,
  },
  {
    nr: 3, name: 'Die Schwelle',
    was: 'Eine Linie, darueber die Punkte, die durchkommen, darunter die, die '
       + 'es nicht tun. Das ist der Kern der Seite in einem Bild.',
    html: `<div class="platte" style="background:${COLOR.bg}; position:relative">
             <div style="position:absolute; left:70px; right:70px; top:200px;
                         height:5px; border-radius:3px; background:${COLOR.akzent}"></div>
             ${[[110, 130, 34, COLOR.t3], [190, 120, 26, COLOR.t2], [265, 145, 30, COLOR.t0]]
               .map(([x, y, d, f]) => `<div style="position:absolute; left:${x}px; top:${y}px;
                     width:${d}px; height:${d}px; border-radius:50%; background:${f}"></div>`).join('')}
             ${[[130, 245, 22], [215, 275, 18], [280, 240, 20]]
               .map(([x, y, d]) => `<div style="position:absolute; left:${x}px; top:${y}px;
                     width:${d}px; height:${d}px; border-radius:50%; background:${COLOR.linie}"></div>`).join('')}
           </div>`,
  },
  {
    nr: 4, name: 'S im Rahmen',
    was: 'Derselbe Buchstabe, aber im Kasten der Seite: Rahmen und Grund wie '
       + 'ein Panel. Wirkt als Produkt, nicht als Marke.',
    html: `<div class="platte" style="background:${COLOR.bg}">
             <div style="width:250px; height:250px; border-radius:44px;
                         border:6px solid ${COLOR.linie}; background:${COLOR.bg2};
                         display:flex; align-items:center; justify-content:center">
               <span class="mono" style="font-size:150px; color:${COLOR.akzent}">S</span>
             </div>
           </div>`,
  },
  {
    nr: 5, name: 'SIZED',
    was: 'Das Wortzeichen. Haelt bei 40 px besser als erwartet – das Bild hat '
       + 'meine Vorhersage widerlegt –, bleibt dort aber das schwaechste.',
    html: `<div class="platte" style="background:${COLOR.bg}">
             <span class="mono" style="font-size:74px; color:${COLOR.akzent}; letter-spacing:.04em">SIZED</span>
           </div>`,
  },
  {
    nr: 6, name: 'S in Gold',
    was: 'Wie 1, nur in Ansems Farbe – dem einzigen Ton, der auf der Seite ihm '
       + 'gehoert. Naeher an ihm, next weg von einer eigenen Marke.',
    html: `<div class="platte" style="background:${COLOR.bg}">
             <span class="mono" style="font-size:230px; color:${COLOR.gold}">S</span>
           </div>`,
  },
];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

const ziel = path.join(root, 'preview', 'profilbild');
fs.mkdirSync(ziel, { recursive: true });

const PLATTE = `
  .platte { width: 400px; height: 400px; display: flex;
            align-items: center; justify-content: center; overflow: hidden; }
  .mono { font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo,
                       Consolas, monospace;
          font-weight: 700; letter-spacing: -.02em; line-height: 1; }
  body { margin: 0; }
`;

const bilder = [];
for (const e of DRAFTS) {
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  await page.setContent(`<style>${PLATTE}</style>${e.html}`);
  const file = path.join(ziel, `sized-${e.nr}.png`);
  const puffer = await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 400, height: 400 } });
  bilder.push({ ...e, daten: `data:image/png;base64,${puffer.toString('base64')}`, file });
  await page.close();
}

// ---------------------------------------------------------------------------
// Comparison sheet: large, and beside it as small as in the timeline
// ---------------------------------------------------------------------------
const blatt = await browser.newPage({
  viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2,
});
await blatt.setContent(`
<style>
  body { margin: 0; padding: 24px; background: #0d0d0f; color: #e6e6e6;
         font-family: system-ui, sans-serif; }
  .gitter { display: grid; grid-template-columns: repeat(3, 340px); gap: 26px; }
  h2 { font-size: 14px; margin: 0 0 4px; }
  p { font-size: 11.5px; line-height: 1.55; color: #8b8b93; margin: 0 0 10px;
      min-height: 50px; }
  .line { display: flex; align-items: center; gap: 14px; }
  .big { width: 190px; height: 190px; border-radius: 50%; display: block; }
  .klein { width: 40px; height: 40px; border-radius: 50%; display: block; }
  .mittel { width: 68px; height: 68px; border-radius: 50%; display: block; }
  .masse { font-size: 10px; color: #6b6b74; margin-top: 6px; }
</style>
<div class="gitter">
${bilder.map((b) => `
  <div>
    <h2>${b.nr}. ${b.name}</h2>
    <p>${b.was}</p>
    <div class="line">
      <img class="big" src="${b.daten}">
      <div>
        <img class="mittel" src="${b.daten}">
        <div class="masse">Profilseite</div>
        <img class="klein" src="${b.daten}" style="margin-top:10px">
        <div class="masse">Zeitstrahl</div>
      </div>
    </div>
  </div>`).join('')}
</div>`);
await blatt.waitForTimeout(300);
const overview = path.join(root, 'preview', 'profilbild-optionen.png');
await blatt.screenshot({ path: overview, fullPage: true });

console.log(`\n  ${DRAFTS.length} Entwuerfe in ${path.relative(root, ziel)}/`);
console.log(`  Vergleich: ${path.relative(root, overview)}\n`);
await browser.close();
