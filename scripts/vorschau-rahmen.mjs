// ============================================================================
// A frame around the polls - but which one?
//
// In the DM tab, everything sits inside one box: 1px --line, --radius,
// --bg-1. The polls don't have that; they float free on the page
// background.
//
// The catch: EVERY single poll already carries that exact same frame.
// Wrapping a second one around them means setting --bg-1 on --bg-1 - boxes
// inside boxes, with no difference between them. So here are two readings
// of the same instruction, rather than me guessing which one is meant.
//
// Drawn with the real index.html and the real styles.css.
//
//   node scripts/vorschau-rahmen.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

// pollHtml verbatim - the cards have to be the real ones, otherwise you'd
// be comparing two reconstructions against each other.
const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const parts = [
  cut('const esc = (s) =>', '\n\n'),
  cut('const nfGanz =', 'const wholeNumber'),
  cut('const wholeNumber =', '\n'),
  cut('const LINK_SVG =', 'const pollLink = (id) => `${location.origin}/p/${id}`;'),
  cut('function fristText(closesAt)', 'const BALD_MS = 60 * 60 * 1000;'),
  cut('const BALD_MS =', 'let fristT = null;'),
  cut('const leadingShare =', '\nasync function drawPoll'),
  cut('function pollHtml(p) {', 'async function deletePoll(id) {'),
].join('\n');

const POLLS = [
  { id: 1, closed: false, myOptionId: 2, totalUsd: 781420,
    closesAt: new Date(Date.now() + 29 * 3600e3).toISOString(),
    question: 'Should we open the token gate to smaller holders?',
    options: [{ id: 1, label: 'Ship it this week', usd: 482900, share: .618 },
              { id: 2, label: 'Wait for the audit', usd: 298520, share: .382 }] },
  { id: 2, closed: true, myOptionId: null, totalUsd: 998400, closesAt: null,
    question: 'Next AMA time?',
    options: [{ id: 3, label: 'Friday 8pm ET', usd: 612000, share: .613 },
              { id: 4, label: 'Sunday 2pm ET', usd: 386400, share: .387 }] },
];

const FASSUNGEN = [
  {
    nr: 1, name: 'Wie es jetzt ist',
    was: 'Die Abstimmungen schweben auf dem Seitengrund. Im DM-Tab daneben '
       + 'steht alles in einem Kasten – die beiden Reiter sehen aus wie zwei '
       + 'verschiedene Programme.',
    css: '',
  },
  {
    nr: 2, name: 'Rahmen darum, Karten bleiben',
    was: 'Der Kasten kommt dazu, die Abstimmungen behalten ihren eigenen. Das '
       + 'ist die wörtliche Umsetzung – und man sieht das Problem: --bg-1 auf '
       + '--bg-1, Kästen in Kästen ohne Unterschied between.',
    css: `.poll-list {
            border: 1px solid var(--line); border-radius: var(--radius);
            background: var(--bg-1); padding: .9rem;
          }`,
  },
  {
    nr: 3, name: 'Rahmen darum, Karten werden Zeilen',
    was: 'Der Kasten kommt dazu, und die Abstimmungen geben ihren eigenen '
       + 'Rahmen ab – so wie die Zeilen in Ansems Posteingang. Ein Kasten pro '
       + 'Reiter, Inhalt darin durch Linien getrennt.',
    css: `.poll-list {
            border: 1px solid var(--line); border-radius: var(--radius);
            background: var(--bg-1); padding: 0; gap: 0;
          }
          .poll { border: 0; border-radius: 0; background: transparent;
                  border-bottom: 1px solid var(--line); }
          .poll:last-child { border-bottom: 0; }`,
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

async function shoot(f, width) {
  const page = await browser.newPage({
    viewport: { width: width, height: width < 500 ? 720 : 600 }, deviceScaleFactor: 2,
  });
  await page.goto(base);
  if (f.css) await page.addStyleTag({ content: f.css });
  await page.addScriptTag({ content: `
    const state = { cfg: { symbol: 'ANSEM' }, me: { isAdmin: false } };
    ${parts}
    window.pollHtml = pollHtml;
  ` });
  await page.evaluate((polls) => {
    document.querySelector('#login').hidden = true;
    document.querySelector('#app').hidden = false;
    document.querySelector('#me-handle').outerHTML =
      '<span id="me-handle" class="handle h t0">7xK</span>';
    document.querySelector('#me-holdings').textContent = '$5,208';
    document.querySelector('#poll-list').innerHTML = polls.map(window.pollHtml).join('');
  }, POLLS);
  await page.waitForTimeout(160);
  const puffer = await page.screenshot();
  await page.close();
  return `data:image/png;base64,${puffer.toString('base64')}`;
}

fs.mkdirSync(path.join(root, 'preview'), { recursive: true });
const bilder = [];
for (const f of FASSUNGEN) bilder.push({ ...f, big: await shoot(f, 1000) });

const blatt = await browser.newPage({ viewport: { width: 1120, height: 1600 }, deviceScaleFactor: 2 });
await blatt.setContent(`
<style>
  body { margin: 0; padding: 24px; background: #0d0d0f; color: #e6e6e6;
         font-family: system-ui, sans-serif; }
  .fall { margin-bottom: 26px; }
  h2 { font-size: 14px; margin: 0 0 3px; }
  p { font-size: 11.5px; line-height: 1.5; color: #8b8b93; margin: 0 0 8px;
      max-width: 64rem; }
  img { width: 1040px; display: block; border-radius: 8px; border: 1px solid #23232a; }
</style>
${bilder.map((b) => `
  <div class="fall">
    <h2>${b.nr}. ${b.name}</h2>
    <p>${b.was}</p>
    <img src="${b.big}">
  </div>`).join('')}
`);
await blatt.waitForTimeout(300);
await blatt.screenshot({ path: path.join(root, 'preview', 'rahmen-optionen.png'), fullPage: true });

console.log(`\n  ${FASSUNGEN.length} Fassungen in preview/rahmen-optionen.png\n`);
await browser.close();
server.close();
