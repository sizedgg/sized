// ============================================================================
// How does the inbox show where you currently are?
//
// Five versions of the same list, each scrolled to the middle so the
// indicator is visible. Rendered with the real markup, the real
// styles.css, and the real rows from renderThreads() - only the
// indicator on the right changes.
//
// The difference between the versions isn't just size, it's the question
// of WHAT it's meant to say:
//
//   A fixed-size marker says: this is where you are.
//   A bar sized by share additionally says: this is how much there is in
//   total.
//   An edge fade says only: there's more that way.
//
// All three are defensible. What doesn't work is being both small and
// informative at once: a bar sized by share is almost as long as the
// track with only three conversations, and no color changes that.
//
//   node scripts/vorschau-strich.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
// Real source code, not rebuilt.
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

// ---------------------------------------------------------------------------
// The versions
// ---------------------------------------------------------------------------
// css  - what changes about the indicator
// build  - runs in the page after scrolling; sets height and position
const CENTER = 0.45;

const FASSUNGEN = [
  {
    nr: 1, name: 'Kurze Marke',
    was: 'Wie es gerade ist: 20 x 2 px, immer gleich big. Sagt nur, wo man '
       + 'steht – nicht, wie viel es ist.',
    css: '',
    build: '',
  },
  {
    nr: 2, name: 'Punkt',
    was: 'Dasselbe, nur noch kleiner: 5 px rund. Am wenigsten im Weg, sagt '
       + 'aber auch am wenigsten.',
    css: `#thread-strich { height: 5px; width: 5px; border-radius: 50%; right: 3px; }`,
    build: '',
  },
  {
    nr: 3, name: 'Balken nach Anteil',
    was: 'Wie ein gewoehnlicher Rollbalken, nur selbst gezeichnet und ueberall '
       + 'gleich: 2 px wide, Laenge = sichtbarer Anteil. Bei wenigen '
       + 'Gespraechen fast so long wie die Bahn.',
    css: '',
    build: `const anteil = liste.clientHeight / liste.scrollHeight;
          strich.style.height = Math.round(liste.clientHeight * anteil) + 'px';`,
  },
  {
    nr: 4, name: 'Anteil, aber gedeckelt',
    was: 'Nach Anteil, hoechstens 40 px. Sagt bei langen Listen etwas ueber die '
       + 'Menge und wird bei kurzen trotzdem nicht zum Block.',
    css: `#thread-strich { width: 3px; border-radius: 2px; }`,
    build: `const anteil = liste.clientHeight / liste.scrollHeight;
          strich.style.height =
            Math.min(40, Math.max(14, Math.round(liste.clientHeight * anteil))) + 'px';`,
  },
  {
    nr: 5, name: 'Kante statt Marke',
    was: 'Gar keine Anzeige right. Stattdessen running die Liste peek und bottom '
       + 'weich aus, solange dort noch etwas ist. Sagt nur: da geht es next.',
    css: `#thread-strich { display: none; }
          .thread-roll::before, .thread-roll::after {
            content: ''; position: absolute; left: 0; right: 0; height: 34px;
            pointer-events: none; z-index: 1;
          }
          .thread-roll::before {
            top: 0; background: linear-gradient(var(--bg-1), transparent);
          }
          .thread-roll::after {
            bottom: 0; background: linear-gradient(transparent, var(--bg-1));
          }`,
    build: '',
  },
];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
const bilder = [];

for (const f of FASSUNGEN) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2,
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({
    content: `
      const $ = (s, r = document) => r.querySelector(s);
      const $$ = (s, r = document) => [...r.querySelectorAll(s)];
      const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
      const openThread = () => {};
      const state = {
        cfg: { symbol: 'ANSEM', min_dm_usd: 0 }, dmMinEntwurf: null,
        zeigeVerborgene: false, activeThread: null, dmHideAvailable: true,
        dmThreads: [],
      };
      ${parts}
      state.dmThreads = demoThreads(40);
      window.renderThreads = renderThreads;
    `,
  });
  if (f.css) await page.addStyleTag({ content: f.css });
  await page.evaluate(({ build, center }) => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    for (const p of document.querySelectorAll('.pane')) p.hidden = true;
    document.querySelector('#pane-dms').hidden = false;
    document.querySelector('#dm-admin').hidden = false;
    window.renderThreads();

    const liste = document.querySelector('#thread-items');
    const strich = document.querySelector('#thread-strich');
    liste.scrollTop = (liste.scrollHeight - liste.clientHeight) * center;

    // Height first, then position - the calculation needs it.
    // eslint-disable-next-line no-new-func
    if (build) new Function('liste', 'strich', build)(liste, strich);

    const weg = liste.scrollHeight - liste.clientHeight;
    const anteil = liste.scrollTop / weg;
    strich.style.top =
      Math.round(anteil * (liste.clientHeight - strich.offsetHeight)) + 'px';
    // Always visible in the preview: in real use it appears while
    // scrolling.
    liste.classList.add('rollt');
    strich.style.opacity = '1';
  }, { build: f.build, center: CENTER });

  const panel = await page.evaluate(() => {
    const b = document.querySelector('.thread-list').getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  const puffer = await page.screenshot({ clip: panel });

  // And the same spot again, up close. Without this you'd be deciding
  // about two pixels you can barely see on the overview image.
  const nah = await page.evaluate(() => {
    const liste = document.querySelector('#thread-items').getBoundingClientRect();
    const m = document.querySelector('#thread-strich');
    const s = m.offsetParent ? m.getBoundingClientRect() : null;
    const center = s && s.height ? s.top + s.height / 2 : liste.top + liste.height / 2;
    return {
      x: liste.right - 58, y: Math.max(liste.top, center - 55),
      width: 58, height: 110,
    };
  });
  const puffer2 = await page.screenshot({ clip: nah });

  bilder.push({
    ...f,
    daten: `data:image/png;base64,${puffer.toString('base64')}`,
    nah: `data:image/png;base64,${puffer2.toString('base64')}`,
  });
  await page.close();
}

// ---------------------------------------------------------------------------
// Everything side by side in one image
// ---------------------------------------------------------------------------
const blatt = await browser.newPage({
  viewport: { width: 1700, height: 640 }, deviceScaleFactor: 2,
});
await blatt.setContent(`
<style>
  body { margin: 0; padding: 18px; background: #0d0d0f; color: #e6e6e6;
         font-family: system-ui, sans-serif; }
  .row { display: flex; gap: 16px; align-items: flex-start; }
  .f { width: 300px; }
  h2 { font-size: 13px; margin: 0 0 4px; }
  p { font-size: 11px; line-height: 1.5; color: #8b8b93; margin: 0 0 8px;
      min-height: 62px; }
  img.full { width: 290px; display: block; border-radius: 10px; }
  .nah { margin-top: 10px; }
  .nah span { font-size: 10px; color: #6b6b74; display: block; margin-bottom: 4px; }
  /* Scaled up 4x, without smoothing: two pixels should look like two
     pixels, not like a blur. */
  img.zoom { width: 232px; display: block; border-radius: 6px;
             image-rendering: pixelated; border: 1px solid #23232a; }
</style>
<div class="row">
${bilder.map((b) => `
  <div class="f">
    <h2>${b.nr}. ${b.name}</h2>
    <p>${b.was}</p>
    <img class="full" src="${b.daten}">
    <div class="nah"><span>rechter Rand, 4x</span><img class="zoom" src="${b.nah}"></div>
  </div>`).join('')}
</div>`);
await blatt.waitForTimeout(300);
const ziel = path.join(root, 'preview', 'strich-optionen.png');
await blatt.screenshot({ path: ziel, fullPage: true });

console.log(`\n  ${FASSUNGEN.length} Fassungen in ${path.relative(root, ziel)}\n`);
await browser.close();
server.close();
