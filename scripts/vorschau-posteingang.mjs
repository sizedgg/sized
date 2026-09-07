// ============================================================================
// Ansem's inbox, full.
//
// The list has always been pictured with four rows so far - in
// preview-mobile.mjs, in the tests, in every preview. But four rows say
// nothing about the questions a list actually raises: how does a column of
// forty amounts read? Does an unread conversation still stand out when ten
// of them are unread? Does the preview text have room when the amount is
// seven digits?
//
// renderThreads() is cut LITERALLY from app.js. A rebuilt row would look
// good here while the real one does something else.
//
//   node scripts/vorschau-posteingang.mjs
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
// Everything that builds the list - from the real file.
const parts = [
  cut('const HANDLE_TONES', '\n'),
  cut('const handleOf =', '\n'),
  cut('function toneOf(wallet) {', '\n}') + '\n}',
  cut('const esc =', '\n\n'),
  // TIERS belongs with it: shortUsd() reads it, and without it the
  // function collapses on the first amount.
  cut('const TIERS =', '\n'),
  cut('function shortUsd(', '\n}') + '\n}',
  // Up to the closing brace at the start of a line - before, the cut ended
  // mid-function, so it was present but never actually defined.
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
  // app.js gets replaced: the real application would try to log in. The
  // parts that actually matter here get spliced in literally further
  // down.
  if (pfad === '/app.js') {
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('/* Vorschau */');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(file)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));

// ---------------------------------------------------------------------------
// The data - the awkward cases included on purpose
// ---------------------------------------------------------------------------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
let saat = 20260831;
const zufall = () => (saat = (saat * 1103515245 + 12345) % 2147483648) / 2147483648;
const adresse = () => Array.from({ length: 44 }, () => B58[Math.floor(zufall() * 58)]).join('');

const TEXTE = [
  'gm', 'checking', 'wen poll', 'thanks for the reply',
  'I sold half my bag last week and now I am not sure that was right',
  'Is the unlock linear or cliff based? I have been trying to work this out from the docs and cannot tell',
  'can you look at this', 'will cover it in the next stream',
  'any chance you do an AMA this month', 'appreciate the answer earlier',
  'sent you the details', 'quick one about the vesting schedule',
];

// Amounts across the whole range: from seven digits down to under the
// threshold.
const AMOUNTS = [
  4_820_000, 1_204_880, 892_400, 512_000, 388_120, 251_400, 180_900, 142_300,
  98_400, 76_200, 61_050, 48_900, 39_400, 31_500, 26_800, 21_400, 18_200,
  15_600, 12_400, 9_820, 8_820, 7_400, 6_100, 5_050, 4_200, 3_600, 2_900,
  2_400, 1_980, 1_620, 1_302, 1_050, 860, 640, 480, 320, 210, 120, 45, 3,
];

const THREADS = AMOUNTS.map((usd, i) => ({
  wallet: adresse(),
  usd,
  preview: TEXTE[Math.floor(zufall() * TEXTE.length)],
  // Unread ones deliberately scattered, not bunched at the top: the
  // question is whether a faint blue fill even stands out among forty
  // rows.
  unread: [2, 3, 7, 8, 15, 22, 23, 31].includes(i) ? 1 : 0,
}));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });

const construct = async (width, height, name, schwelle) => {
  const page = await browser.newPage({ viewport: { width: width, height: height } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForTimeout(250);
  await page.addScriptTag({
    content: `
      const $ = (s, r = document) => r.querySelector(s);
      const $$ = (s, r = document) => [...r.querySelectorAll(s)];
      const fmtUsd = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');
      const openThread = () => {};
      const state = {
        cfg: { symbol: 'ANSEM', min_dm_usd: ${schwelle} },
        dmMinEntwurf: null,
        dmThreads: ${JSON.stringify(THREADS)},
        activeThread: ${JSON.stringify(THREADS[4].wallet)},
      };
      ${parts}
      window.renderThreads = renderThreads;
    `,
  });
  const measurements = await page.evaluate(() => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    for (const p of document.querySelectorAll('.pane')) p.hidden = true;
    document.querySelectorAll('.tab')[0].classList.remove('is-active');
    document.querySelectorAll('.tab')[1].classList.add('is-active');
    document.querySelector('[data-tab="dms"]').classList.add('zeigt-s');
    document.querySelector('#pane-dms').hidden = false;
    document.querySelector('#dm-user').hidden = true;
    document.querySelector('#dm-admin').hidden = false;
    document.querySelector('#dm-min-box').hidden = false;
    document.querySelector('#dm-min-input').value = '10';
    document.querySelector('#dm-min-unit').textContent = 'in $ANSEM';
    document.querySelector('#me-handle').outerHTML =
      '<span id="me-handle" class="handle h admin-name" aria-describedby="me-info">'
      + '<span class="kuerzel">4bo</span></span>';
    document.querySelector('#me-holdings').textContent = '$14,204,880';
    window.renderThreads();

    // Grab a few numbers that don't show up in a screenshot.
    const d = document.documentElement;
    // What scrolls is .thread-list, NOT #thread-items - the inner box
    // just grows along with the content, so it would always report
    // "doesn't scroll". That's what stood here first, and with forty rows
    // the measurement said "list scrolls: no" while it actually hid over
    // 900px of content.
    const liste = document.querySelector('.thread-list');
    const lines = [...document.querySelectorAll('.thread')];
    const widths = lines.map((z) => {
      const prev = z.querySelector('.thread-prev');
      return prev.scrollWidth > prev.clientWidth + 1;
    });
    return {
      lines: lines.length,
      height: lines.length ? Math.round(lines[0].getBoundingClientRect().height) : 0,
      abgeschnitten: widths.filter(Boolean).length,
      seiteScrollt: d.scrollHeight > d.clientHeight,
      listeScrollt: liste.scrollHeight > liste.clientHeight + 1,
      sichtbar: liste.clientHeight,
      gesamt: liste.scrollHeight,
      // Can you even reach the last row? Scroll all the way down and
      // check whether the bottom row then sits inside the box.
      letzteErreichbar: (() => {
        liste.scrollTop = 1e6;
        const lines = document.querySelectorAll('.thread');
        if (!lines.length) return true;
        const u = lines[lines.length - 1].getBoundingClientRect();
        const k = liste.getBoundingClientRect();
        const ok = u.bottom <= k.bottom + 1 && u.top >= k.top - 1;
        liste.scrollTop = 0;
        return ok;
      })(),
      // The threshold counter is gone - what's filtered out shows in the
      // slider above it. What's reported instead is how much the
      // threshold actually removes: the number you don't see in the
      // image.
      wegGefiltert: 40 - lines.length,
    };
  });
  await page.screenshot({ path: path.join(root, 'preview', `posteingang-${name}.png`) });
  await page.close();
  return measurements;
};

console.log('\nAnsems Posteingang, full\n');
for (const [name, b, h, schwelle] of [
  ['computer', 1280, 860, 0],
  ['rechner-schwelle', 1280, 860, 1000],
  ['handy', 390, 780, 0],
]) {
  const m = await construct(b, h, name, schwelle);
  console.log(`  ${name} (${b}×${h}, Schwelle ${schwelle ? '$' + schwelle : 'keine'})`);
  console.log(`    ${m.lines} Zeilen à ${m.height} px`
    + `  ·  Vorschau gekürzt in ${m.abgeschnitten}`
    + `  ·  sichtbar ${m.sichtbar} von ${m.gesamt} px`
    + `  ·  last Zeile erreichbar: ${m.letzteErreichbar ? 'ja' : 'NEIN – Fehler'}`
    + `  ·  Seite rollt: ${m.seiteScrollt ? 'JA – Fehler' : 'nein'}`);
  if (m.wegGefiltert) console.log(`    Die Schwelle nimmt ${m.wegGefiltert} Gespräche weg`);
}

await browser.close();
server.close();
console.log('\nBilder in preview/posteingang-*.png\n');
