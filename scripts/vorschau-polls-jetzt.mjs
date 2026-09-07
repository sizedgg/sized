// ============================================================================
// Sanity check on the shipped state of the Polls tab.
//
// Three views: Ansem with the box collapsed, Ansem with the box open, and a
// regular user who doesn't have the box at all.
//
// Changes nothing - cuts the page and markup verbatim from the source.
//
//   node scripts/vorschau-polls-jetzt.mjs
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

const panel = /<div id="poll-admin"[\s\S]*?\n {4}<\/div>/.exec(html);
if (!panel) throw new Error('poll-admin nicht in index.html gefunden');
const sichtbar = panel[0].replace('class="poll-admin" hidden', 'class="poll-admin"');
const offen = sichtbar
  .replace('class="poll-admin"', 'class="poll-admin offen"')
  .replace('id="poll-admin-felder" hidden', 'id="poll-admin-felder"')
  .replace('aria-expanded="false"', 'aria-expanded="true"');

const opt = (id, label, votes, usd, share) => ({ id, label, votes, usd, share });
const POLLS = [
  { id: 1, closed: false, myOptionId: null, totalVotes: 191, totalUsd: 781420, stunden: 29,
    question: 'Should we open the token gate to smaller holders?',
    options: [opt(1, 'Ship it this week', 128, 482900, .618),
              opt(2, 'Wait for the audit', 63, 298520, .382)] },
  { id: 2, closed: false, myOptionId: 4, totalVotes: 88, totalUsd: 214300, stunden: 0.6,
    question: 'Next AMA: Thursday or Sunday?',
    options: [opt(3, 'Thursday', 51, 142100, .663), opt(4, 'Sunday', 37, 72200, .337)] },
  { id: 3, closed: true, myOptionId: 5, totalVotes: 240, totalUsd: 998400, stunden: null,
    question: 'Should the chat minimum go up?',
    options: [opt(5, 'Yes, to $50', 96, 612000, .613), opt(6, 'No, leave it', 144, 386400, .387)] },
];

const server = http.createServer((q, res) => {
  const form = q.url.includes('offen') ? offen : q.url.includes('nutzer') ? '' : sichtbar;
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body><main class="pane" id="pane" style="background:var(--bg);padding:14px">
       ${form}<div id="poll-list" class="poll-list"></div></main>`);
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

for (const [pfad, file, admin] of [
  ['zu', 'polls-jetzt-zu.png', true],
  ['offen', 'polls-jetzt-offen.png', true],
  ['nutzer', 'polls-jetzt-nutzer.png', false],
]) {
  // 900 and not 760: at exactly 760 the phone block already kicks in
  // (@media max-width: 760px), and then the image would show the phone
  // version while the heading promises "at the desk".
  const page = await browser.newPage({ viewport: { width: 900, height: 880 }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:${server.address().port}/?${pfad}`);
  await page.addScriptTag({
    content: `
      const state = { cfg: { symbol: 'ANSEM' }, me: { isAdmin: ${admin} }, polls: [] };
      const toast = () => {};
      ${escFn}
      ${formate}
      ${symbole}
      ${zeit}
      ${line}
      ${markup}
      window.pollHtml = pollHtml;`,
  });
  // Ansem never has a vote of his own - the database rejects it. A preview
  // image showing him with a checkmark on an answer would be a state that
  // can't exist, and images like that are exactly what misleads people
  // later.
  await page.evaluate(([ps, ist]) => {
    document.querySelector('#poll-list').innerHTML = ps.map((p) => window.pollHtml({
      ...p,
      myOptionId: ist ? null : p.myOptionId,
      closesAt: p.stunden === null ? null : new Date(Date.now() + p.stunden * 3600e3 + 2000).toISOString(),
    })).join('');
  }, [POLLS, admin]);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(350);
  await page.locator('#pane').screenshot({ path: path.join(ausgabe, file) });
  await page.close();
  console.log(`  ${path.join(ausgabe, file)}`);
}

await browser.close();
server.close();
