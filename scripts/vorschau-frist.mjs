// ============================================================================
// Sanity check on the deadline: the form and four states of the header line.
//
// Cuts the stylesheet and markup verbatim from the source and changes nothing.
//
//   node scripts/vorschau-frist.mjs
// ============================================================================

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

const cut = (von, bis) => {
  const a = appJs.indexOf(von);
  const b = appJs.indexOf(bis, a);
  if (a < 0 || b < 0) throw new Error(`Nicht gefunden in app.js: ${von}`);
  return appJs.slice(a, b);
};
const zeit = cut('function fristText(closesAt)', 'const BALD_MS = 60 * 60 * 1000;');
const line = cut('const BALD_MS =', 'let fristT = null;');
const markup = cut('function pollHtml(p) {', 'async function deletePoll(id) {');
const formate = cut('const nfGanz =', 'const wholeNumber')
  + cut('const wholeNumber =', '\n');
const escFn = cut('const esc = (s) =>', '\n\n');
const symbole = cut('const LINK_SVG =', 'const pollLink = (id) => `${location.origin}/p/${id}`;');

const formular = /<div id="poll-admin"[\s\S]*?\n    <\/div>/.exec(html);
if (!formular) throw new Error('Das Anlegeformular sieht anders aus als erwartet');

const M = 60_000, H = 60 * M, T = 24 * H;
const CASES = [
  { name: '3 Tage', ms: 3 * T + 5 * H + 2000 },
  { name: '5 Stunden', ms: 5 * H + 12 * M + 2000 },
  { name: 'Unter einer Stunde', ms: 20 * M + 2000 },
  { name: 'Ohne Frist', ms: null },
  { name: 'Geschlossen', ms: 3 * T, zu: true },
];

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body style="background:var(--bg);padding:18px">
       <div id="peek">${formular[0].replace('hidden', '')}</div>
       <div class="polls-panel" id="ziel"></div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

const page = await browser.newPage({ viewport: { width: Number(process.env.WIDTH || 780), height: 900 }, deviceScaleFactor: 2 });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.addScriptTag({
  content: `
    const state = { cfg: { symbol: 'ANSEM' }, me: { isAdmin: true }, polls: [] };
    const toast = () => {};
    ${escFn}
    ${formate}
    ${symbole}
    ${zeit}
    ${line}
    ${markup}
    window.pollHtml = pollHtml;`,
});
// Fill in the question, so the form looks like it does right before creating a poll.
await page.fill('#poll-question', 'Should we open the token gate to smaller holders?');
await page.locator('.poll-option').nth(0).fill('Ship it this week');
await page.locator('.poll-option').nth(1).fill('Wait for the audit');
await page.mouse.move(0, 0);
await page.waitForTimeout(300);
await page.locator('#peek').screenshot({ path: path.join(ausgabe, (process.env.WIDTH ? 'frist-formular-handy.png' : 'frist-formular.png')) });

await page.evaluate((cases) => {
  document.querySelector('#ziel').innerHTML = cases.map((f, i) => window.pollHtml({
    id: i + 1, closed: !!f.zu,
    closesAt: f.ms === null ? null : new Date(Date.now() + f.ms).toISOString(),
    totalVotes: 191, totalUsd: 781420,
    question: f.name,
    options: [{ id: 1, label: 'Ship it this week', votes: 128, usd: 482900, share: .618 },
              { id: 2, label: 'Wait for the audit', votes: 63, usd: 298520, share: .382 }],
  })).join('');
}, CASES);
await page.waitForTimeout(200);
await page.locator('#ziel').screenshot({ path: path.join(ausgabe, (process.env.WIDTH ? 'frist-zeilen-handy.png' : 'frist-zeilen.png')) });

console.log('\n  ' + CASES.map((f) => f.name).join('  ·  '));
await browser.close();
server.close();
console.log(`\n  ${path.join(ausgabe, (process.env.WIDTH ? 'frist-formular-handy.png' : 'frist-formular.png'))}`);
console.log(`  ${path.join(ausgabe, (process.env.WIDTH ? 'frist-zeilen-handy.png' : 'frist-zeilen.png'))}\n`);
