// ============================================================================
// The bottom edge of the DM frame on the home screen - four variants
//
// The report from the device: "the outline of the DM tab does not reach
// far enough down, there's too much empty space there."
//
// This is the flip side of the previous fix. Before, the safe zone at the
// bottom hung off .composer - which sits INSIDE the frame and could not
// lift it, so its bottom corners disappeared under the home-indicator bar.
// The rule was therefore moved to .pane. That lifts the whole frame - but
// it ADDS to the existing inner padding:
//
//   padding-bottom: calc(.8rem + env(safe-area-inset-bottom))
//                       12.8 px  +  34 px          =  47 px
//
// 47 px of empty ground under the frame. That is the space the report means.
//
// ----------------------------------------------------------------------------
// Why this can be drawn here even though the test can't measure it
//
// Chromium does not know env(safe-area-inset-*) without a real device
// notch; the values there are always 0. That's why test-pwa.mjs only
// checks the RULE TEXT and takes no measurement.
//
// This preview replaces the env() calls in the shipped styles.css with the
// real values of an iPhone 14 in portrait (top 47, bottom 34) - and only
// those, via text substitution on the way to the browser. Everything else
// is the file as it is. So the image is not a reconstruction but the same
// page under the condition where the bug occurs.
//
//   node scripts/vorschau-dm-unten.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');

// iPhone 14, portrait, launched from the home screen.
const SICHER = { top: 47, bottom: 34, left: 0, right: 0 };

// ---------------------------------------------------------------------------
// The four variants
// ---------------------------------------------------------------------------
//
// Common to all of them: the input row must stay above the home-indicator
// bar. What differs is WHERE the frame ends - and who carries the gap.

const FASSUNGEN = [
  {
    nr: 1,
    name: 'As it is now',
    was: 'The state as shipped - since variant 3 was adopted, this is the '
       + 'same as below. Kept as a reference point.',
    css: '',
  },
  {
    nr: 2,
    name: 'Frame reaches the home-indicator bar',
    was: 'The extra padding is dropped, the safe zone stays. The frame '
       + 'ends exactly where the bar begins - 34 px. Nothing sits below '
       + 'it, and nothing sits around unused.',
    css: `.pane { padding-bottom: env(safe-area-inset-bottom, 0px); }`,
  },
  {
    nr: 3,
    name: 'Frame runs through, input keeps its distance',
    was: 'The frame reaches to within 12.8 px of the edge - so it runs '
       + 'under the home-indicator bar - and the input row inside it keeps '
       + 'clear of it. Most apps do it this way: the bar sits ON the app\'s '
       + 'ground, not beside it. The bottom corners stay visible because '
       + '12.8 px of margin remain.',
    css: `.pane { padding-bottom: .8rem; }
          .composer { padding-bottom: env(safe-area-inset-bottom, 0px); }`,
  },
  {
    nr: 4,
    name: 'Frame reaches the edge',
    was: 'No more bottom padding at all. The frame sits at the device '
       + 'edge, its bottom corners get clipped by it. The most room for '
       + 'messages - and that is the reason to show it at all. The price '
       + 'is that the frame is no longer recognizable as a frame at the '
       + 'bottom.',
    css: `.pane { padding-bottom: 0; }
          .dm-user { padding-bottom: 0; border-bottom: 0;
                     border-radius: var(--radius) var(--radius) 0 0; }
          .composer { padding-bottom: calc(.6rem + env(safe-area-inset-bottom, 0px)); }`,
  },
];

// ---------------------------------------------------------------------------
// The server - styles.css with real values for the safe zone
// ---------------------------------------------------------------------------

const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json' };

/**
 * Replaces env(safe-area-inset-X, …) with the device's value.
 *
 * Only this function, nothing else: otherwise the file reaches the
 * browser character for character exactly as shipped. Otherwise the
 * image would be a reconstruction and not the page.
 */
function mitSicherenZonen(css) {
  return css.replace(
    /env\(\s*safe-area-inset-(top|bottom|left|right)\s*(?:,[^)]*)?\)/g,
    (_, page) => `${SICHER[page]}px`);
}

const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const file = path.join(pub, pfad);
  if (!file.startsWith(pub) || !fs.existsSync(file)) return res.writeHead(404).end('');
  // app.js stays empty - the preview sets the state itself. Otherwise the
  // script would immediately start the login flow and hide everything again.
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  }
  if (pfad === '/styles.css') {
    return res.writeHead(200, { 'content-type': 'text/css' })
      .end(mitSicherenZonen(fs.readFileSync(file, 'utf8')));
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(file)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------------------
// The messages - from dmHtml in app.js, verbatim
// ---------------------------------------------------------------------------
// Not reconstructed: the blueprint is cut from app.js and run here. If the
// bubble changes there, this image changes too - and a preview that shows
// something other than the page is worse than no preview at all.

const appSource = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
const dmHtmlSource = (() => {
  const a = appSource.indexOf('function dmHtml(row) {');
  if (a < 0) throw new Error('dmHtml nicht in app.js gefunden');
  const b = appSource.indexOf('\n}', a) + 2;
  return appSource.slice(a, b);
})();

const MESSAGES = [
  { id: 1, from_admin: false, body: 'yo ansem, when is the next call?', created_at: '2026-09-04T18:12:00Z' },
  { id: 2, from_admin: true, body: 'thursday, same link as last time', created_at: '2026-09-04T18:20:00Z' },
  { id: 3, from_admin: false, body: 'perfect, see you there', created_at: '2026-09-04T18:21:00Z' },
  { id: 4, from_admin: true, body: 'bring questions, we have an hour', created_at: '2026-09-04T18:44:00Z' },
];

const DEVICE = { width: 390, height: 844, dpr: 2 };   // iPhone 14

async function shoot(f) {
  const page = await browser.newPage({
    viewport: { width: DEVICE.width, height: DEVICE.height },
    deviceScaleFactor: DEVICE.dpr, isMobile: true, hasTouch: true,
  });
  await page.goto(base);
  // The variant CSS must also run through the substitution. On the first
  // attempt it didn't - env() stayed at 0 there, and the measurement
  // showed a frame reaching the device edge for all three proposals. So
  // three images that showed something other than the rule they were
  // supposed to represent.
  if (f.css) await page.addStyleTag({ content: mitSicherenZonen(f.css) });

  const mass = await page.evaluate(({ bauplan, rows }) => {
    // The real function, cut from app.js - along with the handful of
    // helpers it needs. The helpers are simplified here; they return
    // text, not layout, and layout is what's being measured.
    const state = { me: { isAdmin: false } };
    const esc = (s) => String(s);
    const withLinks = (s) => String(s);
    const fmtTime = (t) => new Date(t).toISOString().slice(11, 16);
    const dmQuoteHtml = () => '';
    void esc;
    // eslint-disable-next-line no-eval
    const dmHtml = eval(`(${bauplan.replace(/^function dmHtml/, 'function')})`);

    document.querySelector('#login').hidden = true;
    document.querySelector('#app').hidden = false;
    document.querySelector('#pane-polls').hidden = true;
    document.querySelector('#pane-dms').hidden = false;
    document.querySelector('#dm-user').hidden = false;
    document.querySelector('#dm-thread').innerHTML = rows.map(dmHtml).join('');

    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const rahmen = r('#dm-user');
    const eingabe = r('#dm-input');
    return {
      // How much empty ground read below the frame?
      unterRahmen: Math.round(innerHeight - rahmen.bottom),
      // And how far is the input from the edge? It must stay above the
      // home-indicator bar - which is 34 px tall.
      eingabeUeberKante: Math.round(innerHeight - eingabe.bottom),
      rahmenHoehe: Math.round(rahmen.height),
    };
  }, { bauplan: dmHtmlSource, rows: MESSAGES });

  // The home-indicator bar is drawn in - otherwise the image doesn't show
  // what "too much space" refers to.
  await page.addStyleTag({ content: `
    body::after { content: ''; position: fixed; left: 50%; bottom: 8px;
      transform: translateX(-50%); width: 140px; height: 5px; border-radius: 3px;
      background: rgba(255,255,255,.55); z-index: 99; pointer-events: none; }
    body::before { content: ''; position: fixed; left: 0; right: 0; bottom: 0;
      height: ${SICHER.bottom}px; z-index: 98; pointer-events: none;
      background: rgba(255,80,80,.10);
      border-top: 1px dashed rgba(255,80,80,.5); }` });

  fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
  const bild = path.join(root, 'preview', `dm-unten-${f.nr}.png`);
  await page.screenshot({ path: bild });
  await page.close();
  return { ...mass, bild };
}

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

console.log('\nUnterer Rand des DM-Rahmens – iPhone 14 vom Startbildschirm');
console.log(`Sichere Zone bottom: ${SICHER.bottom} px (rot gestrichelt im Bild)\n`);

for (const f of FASSUNGEN) {
  const m = await shoot(f);
  console.log(`  ${f.nr}. ${f.name}`);
  console.log(`     empty under dem Rahmen: ${m.unterRahmen} px`
    + `   Rahmenhoehe: ${m.rahmenHoehe} px`
    + `   Eingabe ueber der Kante: ${m.eingabeUeberKante} px`
    + `${m.eingabeUeberKante < SICHER.bottom ? '   << under dem Balken!' : ''}`);
  console.log(`     ${f.was}`);
  console.log(`     ${path.relative(root, m.bild)}\n`);
}

await browser.close();
server.close();
