// ============================================================================
// Profile picture and header image for the X account - with the site's mark
//
// The mark has existed for a long time: it sits in index.html next to the
// word SIZED, on the login screen, and in the header. Two upright bars on a
// baseline, the short one on the left.
//
// It's cut VERBATIM out of index.html here, not rebuilt. That's exactly what
// the whole detour would have skipped past: a second, hand-drawn mark looks
// the same at first and drifts apart on the first touch-up - and then X
// shows a different logo than the site does, without anyone noticing.
//
// That leaves only one thing open: how big the mark sits inside the circle.
// X crops a circle out of the square and shows it in the timeline at about
// 40 px - so every version stands next to itself at original size too.
//
//   node scripts/vorschau-logo.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

// Colors from styles.css, not copied by hand.
const fetch = (name) => {
  const t = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!t) throw new Error(`Farbe fehlt in styles.css: ${name}`);
  return t[1].trim();
};
const F = { bg: fetch('--bg-1'), akzent: fetch('--accent'), dimmer: fetch('--dimmer') };

// The mark, exactly as it stands in the markup.
const CHARACTERS = (html.match(/<svg viewBox="[^"]*"[^>]*>.*?<\/svg>/s) || [])[0];
if (!CHARACTERS || !CHARACTERS.includes('<rect')) {
  throw new Error('Das Zeichen steht nicht mehr so in index.html – bitte nachsehen.');
}
// Counter-check: all three spots in the markup carry the same thing. If one
// of them were different, the question "which one is the logo" wouldn't
// even be settled.
const wieOft = (html.match(/<svg viewBox="29 16 42 64"/g) || []).length;
if (wieOft < 3) throw new Error(`Zeichen nur ${wieOft}x im Blatt – erwartet 3.`);

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ziel = path.join(root, 'preview', 'logo');
fs.mkdirSync(ziel, { recursive: true });

const PLATTE = `
  body { margin: 0; }
  .platte { display: flex; align-items: center; justify-content: center;
            overflow: hidden; background: ${F.bg}; }
  .zeichen { display: block; color: ${F.akzent}; }
  .zeichen svg { display: block; height: 100%; width: auto; }
`;

// ---------------------------------------------------------------------------
// Profile picture: 400 x 400, three sizes of the mark inside the circle
// ---------------------------------------------------------------------------
const FASSUNGEN = [
  { nr: 1, name: 'Ruhig', height: 200,
    was: 'Halbe Bildhoehe. Viel Grund ringsum – wirkt gesetzt, verliert aber '
       + 'im Zeitstrahl an Praesenz.' },
  { nr: 2, name: 'Mittig', height: 240,
    was: 'Etwas groesser. Der Kompromiss zwischen Ruhe und Fernwirkung.' },
  { nr: 3, name: 'Kraeftig', height: 280,
    was: 'Fuellt den Kreis fast aus. Traegt bei 40 px am weitesten, laesst dem '
       + 'Zeichen aber kaum Luft.' },
];

const bilder = [];
for (const f of FASSUNGEN) {
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  await page.setContent(`<style>${PLATTE}</style>
    <div class="platte" style="width:400px; height:400px">
      <span class="zeichen" style="height:${f.height}px">${CHARACTERS}</span>
    </div>`);
  const file = path.join(ziel, `sized-avatar-${f.nr}.png`);
  const puffer = await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 400, height: 400 } });
  bilder.push({ ...f, daten: `data:image/png;base64,${puffer.toString('base64')}` });
  await page.close();
}

// ---------------------------------------------------------------------------
// Header image: 1500 x 500
// ---------------------------------------------------------------------------
// Mark and word on the left, like on the login screen. Not centered: X
// overlays the profile picture on the bottom left, and whatever sat there
// would be half covered.
{
  const page = await browser.newPage({ viewport: { width: 1500, height: 500 } });
  await page.setContent(`<style>${PLATTE}
    .row { display: flex; align-items: center; gap: 34px;
             font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
             font-weight: 700; letter-spacing: .16em; font-size: 96px;
             color: ${F.akzent}; padding-left: 300px; }
    .zusatz { font-size: 30px; letter-spacing: .08em; color: ${F.dimmer};
              font-weight: 400; margin-top: 18px; }
  </style>
    <div class="platte" style="width:1500px; height:500px; justify-content:flex-start">
      <div class="row">
        <span class="zeichen" style="height:118px">${CHARACTERS}</span>
        <div>SIZED<div class="zusatz">sized.gg</div></div>
      </div>
    </div>`);
  await page.screenshot({ path: path.join(ziel, 'sized-kopfbild.png'),
    clip: { x: 0, y: 0, width: 1500, height: 500 } });
  await page.close();
}

// ---------------------------------------------------------------------------
// Comparison sheet
// ---------------------------------------------------------------------------
const blatt = await browser.newPage({ viewport: { width: 1180, height: 560 }, deviceScaleFactor: 2 });
await blatt.setContent(`
<style>
  body { margin: 0; padding: 24px; background: #0d0d0f; color: #e6e6e6;
         font-family: system-ui, sans-serif; }
  .gitter { display: grid; grid-template-columns: repeat(3, 340px); gap: 26px; }
  h2 { font-size: 14px; margin: 0 0 4px; }
  p { font-size: 11.5px; line-height: 1.55; color: #8b8b93; margin: 0 0 10px;
      min-height: 48px; }
  .line { display: flex; align-items: center; gap: 14px; }
  .big { width: 190px; height: 190px; border-radius: 50%; display: block; }
  .mittel { width: 68px; height: 68px; border-radius: 50%; display: block; }
  .klein { width: 40px; height: 40px; border-radius: 50%; display: block; }
  .masse { font-size: 10px; color: #6b6b74; margin-top: 6px; }
</style>
<div class="gitter">
${bilder.map((b) => `
  <div>
    <h2>${b.nr}. ${b.name} — ${b.height} px</h2>
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
await blatt.waitForTimeout(250);
await blatt.screenshot({ path: path.join(root, 'preview', 'logo-optionen.png'), fullPage: true });

console.log(`\n  Zeichen aus index.html geschnitten (${wieOft}x dort, alle gleich).`);
console.log(`  3 Profilbilder + Kopfbild in ${path.relative(root, ziel)}/`);
console.log(`  Vergleich: preview/logo-optionen.png\n`);
await browser.close();
