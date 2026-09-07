// ============================================================================
// A poll's answer rows on a phone
//
// The problem, in the picture at 375 px:
//
//   "Wait for | the audit"     <- the fill's edge runs right through the word
//   "Do | neither and keep building quietly"
//
// The answer text sits ON TOP of the bar. When the fill ends mid-line, a
// vertical brightness edge cuts straight through the text there. On wide
// screens this hardly shows, because the label then fits on one line and the
// edge usually lands beside it. On a phone it wraps and hits the edge
// several times.
//
// The stylesheet already has a justification for this: the text is readable
// on both sides of the edge, measured in contrast values. That's true too -
// but readability isn't the objection. The objection is that it looks like a
// rendering bug.
//
// ----------------------------------------------------------------------------
// What's actually measured here
//
// Not "looks better", but: HOW OFTEN does the fill's edge fall inside a text
// line? That number has to hit zero, everything else is taste. Plus the
// heights of the three answer rows - equal-height rows are the second half
// of "tidy".
//
// Rendered with the real index.html, the real styles.css, and the real
// pollHtml() from app.js.
//
//   node scripts/vorschau-antwortzeilen.mjs
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
const POLL_CODE = [
  cut('const esc = (s) =>', '\n\n'),
  cut('const nfGanz =', 'const wholeNumber'),
  cut('const wholeNumber =', '\n'),
  cut('const LINK_SVG =', 'const pollLink = (id) => `${location.origin}/p/${id}`;'),
  cut('function fristText(closesAt)', 'const BALD_MS = 60 * 60 * 1000;'),
  cut('const BALD_MS =', 'let fristT = null;'),
  cut('const leadingShare =', '\nasync function drawPoll'),
  cut('function pollHtml(p) {', 'async function deletePoll(id) {'),
].join('\n');

// The edge case the database is built for - not a comfortable example. 60
// characters is the upper bound for an answer (the check constraint in
// poll_options), and an eight-figure amount is normal for a poll with large
// holders. Testing only with "Ship it this week" tests the case that never
// causes trouble anyway.
const GRENZFALL = process.env.GRENZFALL === '1';

const POLLS = GRENZFALL ? [
  { id: 1, closed: false, myOptionId: 1, totalUsd: 42881420,
    closesAt: new Date(Date.now() + 29 * 3600e3).toISOString(),
    question: 'Should we open the token gate to smaller holders?',
    options: [
      { id: 1, label: 'Extend the vesting cliff by six months for everyone', usd: 28429000, share: 0.663 },
      { id: 2, label: 'Keep the current schedule exactly as it is written', usd: 12105400, share: 0.282 },
      { id: 3, label: 'Do neither and keep building quietly for a while yet', usd: 2347020, share: 0.055 },
    ] },
] : [
  { id: 1, closed: false, myOptionId: 1, totalUsd: 781420,
    closesAt: new Date(Date.now() + 29 * 3600e3).toISOString(),
    question: 'Should we open the token gate to smaller holders?',
    options: [
      { id: 1, label: 'Ship it this week', usd: 482900, share: 0.618 },
      { id: 2, label: 'Wait for the audit', usd: 210400, share: 0.269 },
      { id: 3, label: 'Do neither and keep building quietly', usd: 88120, share: 0.113 },
    ] },
];

// The phone rules that undo the desktop layout. They live in styles.css in
// the block below 900 px:
//
//   .opt-text { flex-direction: column; align-items: flex-start; }
//   .opt-num  { margin-left: 0; text-align: left; display: flex; }
//
// This CSS reverts them - the row is then built exactly as it is on
// desktop.
const WIE_AM_COMPUTER = `
  .opt-text { flex-direction: row; align-items: center; gap: .8rem; }
  .opt-num { margin-left: auto; text-align: right; display: block; }
  .opt-num .held { display: block; font-size: .95rem; }`;

const FASSUNGEN = [
  {
    nr: 1, name: 'Der Computer – so expected es aussehen', width: 1280,
    was: 'Zum Vergleich, in echter Schreibtischbreite: Antwort left, Betrag '
       + 'right, alle Zeilen gleich hoch.',
    css: '',
  },
  {
    nr: 2, name: 'Handy heute', width: 375,
    was: 'Auf dem Handy stehen Antwort und Betrag untereinander. Das war '
       + 'Absicht – eine lange Antwort und ein sechsstelliger Betrag passen '
       + 'nicht nebeneinander. Der Preis: verschieden hohe Zeilen.',
    css: '',
  },
  {
    nr: 3, name: 'Handy mit dem Aufbau vom Computer', width: 375,
    was: 'Dieselben Regeln wie am Schreibtisch, ohne jede Anpassung. Genau '
       + 'das, wonach du gefragt hast – und hier zeigt sich, ob der '
       + 'ursprüngliche Einwand trägt.',
    css: WIE_AM_COMPUTER,
  },
  {
    nr: 4, name: 'Wie 3, aber der Betrag kann nicht squeezed werden', width: 375,
    was: 'Aufbau wie am Computer, mit einer einzigen Zutat: Der Betrag behält '
       + 'seine Breite (er darf nicht schrumpfen), die Antwort bricht davor '
       + 'um. Damit kann keine Zahl mehr zusammengedrückt oder abgeschnitten '
       + 'werden, egal wie long die Antwort ist.',
    css: `${WIE_AM_COMPUTER}
      .opt-num { flex: none; }
      .opt-label { min-width: 0; }
      .opt-text { align-items: flex-start; }`,
  },
];

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
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(file)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});

async function shoot(f) {
  const wide = f.width ?? 375;
  const page = await browser.newPage({
    viewport: { width: wide, height: wide < 700 ? 667 : 900 },
    deviceScaleFactor: 2,
    isMobile: wide < 700, hasTouch: wide < 700,
  });
  await page.goto(base);
  await page.addScriptTag({ content:
    `const state = { cfg: { symbol: 'ANSEM' }, me: { isAdmin: false } };
     ${POLL_CODE}
     window.pollHtml = pollHtml;` });
  await page.evaluate((polls) => {
    document.querySelector('#login').hidden = true;
    document.querySelector('#app').hidden = false;
    document.querySelector('#me-handle').outerHTML =
      '<span id="me-handle" class="handle h t0">7xK</span>';
    document.querySelector('#me-holdings').textContent = '$5,208';
    document.querySelector('#pane-polls').hidden = false;
    document.querySelector('#poll-list').innerHTML = polls.map(window.pollHtml).join('');
  }, POLLS);
  if (f.css) await page.addStyleTag({ content: f.css });
  await page.waitForTimeout(700);   // the fill grows with an animation

  // The actual measurement.
  //
  // For each answer row: where does the fill end, and does that edge fall
  // INSIDE a text line? For that, the individual line boxes of the text are
  // fetched (getClientRects, not getBoundingClientRect - only that way do
  // wrapped lines show up separately).
  const mass = await page.evaluate(() => {
    const treffer = [];
    const heights = [];
    for (const opt of document.querySelectorAll('.opt')) {
      const fill = opt.querySelector('.opt-fill');
      const bar = opt.querySelector('.opt-bar');
      heights.push(Math.round(bar.getBoundingClientRect().height));
      const fr = fill.getBoundingClientRect();
      // A strip along the bottom edge can't hit the text at all.
      const kanteX = fr.right;
      const edgeTop = fr.top, kanteUnten = fr.bottom;
      for (const el of opt.querySelectorAll('.opt-label, .opt-num, .held')) {
        for (const z of el.getClientRects()) {
          const vertical = z.bottom > edgeTop + 1 && z.top < kanteUnten - 1;
          if (vertical && kanteX > z.left + 2 && kanteX < z.right - 2) {
            treffer.push(el.textContent.trim().slice(0, 28));
          }
        }
      }
    }
    // Is a number getting squeezed? That's the original objection to the
    // desktop layout on a phone, and you can barely see it in a screenshot:
    // the box ends up narrower than the text inside it.
    const squeezed = [];
    for (const held of document.querySelectorAll('.opt-num .held')) {
      const b = held.getBoundingClientRect().width;
      if (held.scrollWidth > Math.ceil(b) + 1) {
        squeezed.push(`${held.textContent.trim()} (${Math.round(b)} statt ${held.scrollWidth} px)`);
      }
    }
    return { treffer, heights, squeezed };
  });

  const puffer = await page.screenshot({
    clip: await page.evaluate(() => {
      const r = document.querySelector('.poll').getBoundingClientRect();
      return { x: r.x - 6, y: r.y - 6, width: r.width + 12, height: r.height + 12 };
    }),
  });
  await page.close();
  return { bild: `data:image/png;base64,${puffer.toString('base64')}`, ...mass };
}

fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
const bilder = [];
for (const f of FASSUNGEN) bilder.push({ ...f, ...(await shoot(f)) });

const blatt = await browser.newPage({ viewport: { width: 1400, height: 1100 }, deviceScaleFactor: 2 });
await blatt.setContent(`
<style>
  body { margin: 0; padding: 26px; background: #0d0d0f; color: #e6e6e6;
         font-family: system-ui, sans-serif; }
  .row { display: flex; gap: 22px; align-items: flex-start; }
  .fall { width: 262px; }
  .fall.wide { width: 430px; }
  .fall.wide img { width: 430px; }
  h2 { font-size: 13.5px; margin: 0 0 3px; line-height: 1.3; }
  p { font-size: 11px; line-height: 1.5; color: #8b8b93; margin: 0 0 8px; }
  .mass { font-family: ui-monospace, Menlo, monospace; font-size: 10px; margin: 0 0 8px; }
  .gut { color: #6cc79a; } .bad { color: #e8b45c; }
  img { width: 262px; display: block; border-radius: 10px; border: 1px solid #23232a; }
</style>
<div class="row">
${bilder.map((b) => `
  <div class="fall${b.width > 700 ? ' wide' : ''}">
    <h2>${b.nr}. ${b.name}</h2>
    <p>${b.was}</p>
    <p class="mass ${b.treffer.length ? 'bad' : 'gut'}">
      ${b.treffer.length
        ? `Kante schneidet ${b.treffer.length}x durch Text`
        : 'Kante schneidet durch keinen Text'}<br>
      Zeilenhöhen ${b.heights.join(' / ')} px<br>
      <span class="${b.squeezed.length ? 'bad' : 'gut'}">${b.squeezed.length
        ? `Betrag squeezed: ${b.squeezed.join(', ')}`
        : 'kein Betrag squeezed'}</span></p>
    <img src="${b.bild}">
  </div>`).join('')}
</div>
`);
await blatt.waitForTimeout(300);
await blatt.screenshot({ path: path.join(root, 'preview', 'antwortzeilen.png'), fullPage: true });

console.log('');
for (const b of bilder) {
  console.log(`  ${b.nr}. ${b.name}`);
  console.log(`     Kante durch Text: ${b.treffer.length}x`
    + (b.treffer.length ? ` (${b.treffer.join(', ')})` : '')
    + `   Höhen: ${b.heights.join(' / ')} px`
    + (b.squeezed.length ? `\n     GEQUETSCHT: ${b.squeezed.join(', ')}` : ''));
}
console.log(`\n  ${FASSUNGEN.length} Fassungen in preview/antwortzeilen.png\n`);
await browser.close();
server.close();
