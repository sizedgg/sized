// ============================================================================
// Header image (banner) for SIZED's X account
//
// 1500 x 500. What matters here and isn't a matter of taste:
//
//   Bottom left, the profile picture sits on top of it. On desktop it
//   reaches about 130 px into the header image's height and is roughly
//   200 px wide - whatever's there is half covered.
//
//   On the phone, the name sits along the bottom edge. So the bottom
//   ~90 px are unreliable too.
//
//   Left and right get cropped on narrow windows: X holds to 3:1 and uses
//   the width as the measure. Whatever's at the outer edge can fall away.
//
// So in every draft, everything sits in the middle band, and the
// comparison sheet overlays the covered areas visibly - otherwise you'd be
// deciding on an image that's never actually seen that way.
//
// The content: a header image isn't a poster. It gets one line's worth of
// time while someone decides whether to hit "Follow". The four drafts
// differ in WHAT that line says - brand, promise, mechanics, or the
// product itself.
//
//   node scripts/vorschau-banner.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

const fetch = (name) => {
  const t = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!t) throw new Error(`Farbe fehlt in styles.css: ${name}`);
  return t[1].trim();
};
const F = {
  bg: fetch('--bg-1'), bg2: fetch('--bg-2'), linie: fetch('--line'),
  akzent: fetch('--accent'), text: fetch('--text'),
  dim: fetch('--dim'), dimmer: fetch('--dimmer'),
};

// The icon verbatim from the sheet - not rebuilt by hand.
const CHARACTERS = (html.match(/<svg viewBox="[^"]*"[^>]*>.*?<\/svg>/s) || [])[0];
if (!CHARACTERS?.includes('<rect')) throw new Error('Zeichen nicht in index.html gefunden');

const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const parts = [
  cut('const HANDLE_TONES', '\n'),
  cut('const handleOf =', '\n'),
  cut('function toneOf(wallet) {', '\n}') + '\n}',
  cut('const esc =', '\n\n'),
  cut('const TIERS =', '\n'),
  cut('function shortUsd(', '\n}') + '\n}',
  cut('function demoThreads(n) {', '\n}\n') + '\n}',
  cut('function renderThreads() {', '\n}\n') + '\n}',
].join('\n');

// ---------------------------------------------------------------------------
// Server for the real inbox (draft 4)
// ---------------------------------------------------------------------------
const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const file = path.join(root, 'public', pfad);
  if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file)) {
    return res.writeHead(404).end('');
  }
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('/* Vorschau */');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(file)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

// Real rows from renderThreads(), as an image.
const posteingang = await (async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({ content: `
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
    const openThread = () => {};
    const state = { cfg: { symbol: 'ANSEM', min_dm_usd: 0 }, dmMinEntwurf: null,
      zeigeVerborgene: false, activeThread: null, dmHideAvailable: false, dmThreads: [] };
    ${parts}
    state.dmThreads = demoThreads(9);
    window.renderThreads = renderThreads;` });
  await page.evaluate(() => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    for (const p of document.querySelectorAll('.pane')) p.hidden = true;
    document.querySelector('#pane-dms').hidden = false;
    document.querySelector('#dm-admin').hidden = false;
    // Just the rows: the slider and header belong in the app, not on a
    // header image - there they'd be a control nobody can operate.
    document.querySelector('.thread-top-bar').hidden = true;
    window.renderThreads();
  });
  const panel = await page.evaluate(() => {
    const b = document.querySelector('#thread-items').getBoundingClientRect();
    // Down to the BOTTOM EDGE of the fourth row, not to some estimated
    // pixel count: a half-cut-off row looks like a bug, not like a crop.
    // Row height depends on the font and padding and isn't something you
    // should be guessing at.
    const vierte = document.querySelectorAll('.thread')[3].getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: vierte.bottom - b.top };
  });
  const puffer = await page.screenshot({ clip: panel });
  await page.close();
  return `data:image/png;base64,${puffer.toString('base64')}`;
})();

// ---------------------------------------------------------------------------
// The drafts
// ---------------------------------------------------------------------------
const STIL = `
  body { margin: 0; }
  .band { width: 1500px; height: 500px; background: ${F.bg};
          display: flex; align-items: center; overflow: hidden; position: relative;
          font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace; }
  .zeichen { display: block; color: ${F.akzent}; flex: none; }
  .zeichen svg { display: block; height: 100%; width: auto; }
  .wort { font-weight: 700; letter-spacing: .16em; color: ${F.akzent}; }
  .under { color: ${F.dimmer}; font-weight: 400; letter-spacing: .08em; }
  .satz { color: ${F.text}; font-weight: 400; letter-spacing: .01em; line-height: 1.5; }
  .punkte { color: ${F.dim}; font-size: 30px; line-height: 2.1; letter-spacing: .01em; }
  .punkte b { color: ${F.text}; font-weight: 700; }
`;

const DRAFTS = [
  {
    nr: 1, name: 'Nur die Marke',
    was: 'Zeichen, Wort, Adresse. Sagt nichts ueber das Produkt – und muss nie '
       + 'geaendert werden. Die sichere Wahl.',
    html: `<div class="band" style="padding-left:300px">
             <div style="display:flex; align-items:center; gap:34px">
               <span class="zeichen" style="height:118px">${CHARACTERS}</span>
               <div>
                 <div class="wort" style="font-size:96px">SIZED</div>
                 <div class="under" style="font-size:30px; margin-top:16px">sized.gg</div>
               </div>
             </div>
           </div>`,
  },
  {
    nr: 2, name: 'Ein Satz',
    was: 'Die Marke left, right das Versprechen in einer Zeile. Wer hier '
       + 'landet, weiss nach zwei Sekunden, worum es geht.',
    html: `<div class="band" style="padding-left:230px; gap:90px">
             <div style="display:flex; align-items:center; gap:26px; flex:none">
               <span class="zeichen" style="height:86px">${CHARACTERS}</span>
               <div class="wort" style="font-size:64px">SIZED</div>
             </div>
             <div class="satz" style="font-size:33px; white-space:nowrap">
               A community you get into by holding,<br>not by connecting a wallet.
             </div>
           </div>`,
  },
  {
    nr: 3, name: 'Die Mechanik',
    was: 'Drei Zeilen, was die Seite tut. Am meisten Inhalt – und am ehesten '
       + 'zu viel fuer ein Bild, das man im Vorbeigehen sieht.',
    html: `<div class="band" style="padding-left:230px; gap:80px">
             <div style="display:flex; align-items:center; gap:26px; flex:none">
               <span class="zeichen" style="height:86px">${CHARACTERS}</span>
               <div class="wort" style="font-size:64px">SIZED</div>
             </div>
             <div class="punkte" style="font-size:27px; white-space:nowrap">
               <b>No wallet connect</b> &mdash; you pay to prove it<br>
               Polls <b>weighted by holdings</b><br>
               DMs <b>behind a threshold</b>
             </div>
           </div>`,
  },
  {
    nr: 4, name: 'Das Produkt',
    was: 'Links die Marke, right echte Zeilen aus dem Posteingang. Zeigt statt '
       + 'zu behaupten – kostet aber die Ruhe der anderen drei.',
    html: `<div class="band" style="padding-left:230px; gap:70px">
             <div style="flex:none">
               <div style="display:flex; align-items:center; gap:26px">
                 <span class="zeichen" style="height:86px">${CHARACTERS}</span>
                 <div class="wort" style="font-size:64px">SIZED</div>
               </div>
               <div class="under" style="font-size:26px; margin-top:20px; padding-left:4px">sized.gg</div>
             </div>
             <div style="width:470px; border:1px solid ${F.linie}; border-radius:16px;
                         overflow:hidden; background:${F.bg}; flex:none">
               <img src="${posteingang}" style="display:block; width:100%">
             </div>
           </div>`,
  },
];

const ziel = path.join(root, 'preview', 'banner');
fs.mkdirSync(ziel, { recursive: true });

const bilder = [];
for (const e of DRAFTS) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 500 } });
  await page.setContent(`<style>${STIL}</style>${e.html}`);
  await page.waitForTimeout(120);
  const file = path.join(ziel, `banner-${e.nr}.png`);
  const puffer = await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1500, height: 500 } });
  bilder.push({ ...e, daten: `data:image/png;base64,${puffer.toString('base64')}` });
  await page.close();
}

// ---------------------------------------------------------------------------
// Comparison sheet - with the areas X covers
// ---------------------------------------------------------------------------
const blatt = await browser.newPage({ viewport: { width: 1120, height: 1400 }, deviceScaleFactor: 2 });
await blatt.setContent(`
<style>
  body { margin: 0; padding: 24px; background: #0d0d0f; color: #e6e6e6;
         font-family: system-ui, sans-serif; }
  h1 { font-size: 15px; margin: 0 0 4px; }
  .hinweis { font-size: 11.5px; color: #8b8b93; margin: 0 0 20px; line-height: 1.6; }
  .fall { margin-bottom: 26px; }
  h2 { font-size: 14px; margin: 0 0 4px; }
  p { font-size: 11.5px; line-height: 1.55; color: #8b8b93; margin: 0 0 10px; }
  .rahmen { position: relative; width: 1040px; height: 346.6px; border-radius: 10px;
            overflow: hidden; }
  .rahmen img { display: block; width: 1040px; }
  /* What X lays over it: profile picture bottom left, name row at the bottom. */
  .avatar { position: absolute; left: 22px; bottom: -46px; width: 152px; height: 152px;
            border-radius: 50%; border: 6px solid #0d0d0f; background: rgba(220,60,60,.35); }
  .fuss { position: absolute; left: 0; right: 0; bottom: 0; height: 62px;
          background: rgba(220,60,60,.18); }
  .legende { font-size: 10.5px; color: #6b6b74; margin-top: 8px; }
</style>
<h1>Kopfbilder — die roten Flaechen verdeckt X selbst</h1>
<p class="hinweis">Unten left das Profilbild, am unteren Rand die Namenszeile.
Beides liegt ueber dem Kopfbild, in jedem Entwurf an derselben Stelle.</p>
${bilder.map((b) => `
  <div class="fall">
    <h2>${b.nr}. ${b.name}</h2>
    <p>${b.was}</p>
    <div class="rahmen">
      <img src="${b.daten}">
      <div class="fuss"></div>
      <div class="avatar"></div>
    </div>
  </div>`).join('')}
`);
await blatt.waitForTimeout(300);
await blatt.screenshot({ path: path.join(root, 'preview', 'banner-optionen.png'), fullPage: true });

console.log(`\n  ${DRAFTS.length} Kopfbilder in ${path.relative(root, ziel)}/`);
console.log(`  Vergleich: preview/banner-optionen.png\n`);
await browser.close();
server.close();
