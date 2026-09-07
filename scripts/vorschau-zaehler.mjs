// Image of the create box with the character counter: empty, in the field,
// close to the limit, full.
//   node scripts/vorschau-zaehler.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(root, 'public');
const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const file = path.join(publicDir, pfad);
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return res.writeHead(404).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(file)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });

for (const [name, width] of [['computer', 900], ['handy', 390]]) {
  const page = await browser.newPage({ viewport: { width: width, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    for (const p of document.querySelectorAll('.pane')) p.hidden = true;
    document.querySelector('#pane-polls').hidden = false;
    document.querySelector('#poll-admin').hidden = false;
    document.querySelector('#poll-admin').classList.add('offen');
    document.querySelector('#poll-admin-felder').hidden = false;
    const set = (field, text) => {
      field.value = text.slice(0, field.maxLength);
      field.dispatchEvent(new Event('input'));
    };
    // Fill up to the limit, so the plus button is gone.
    for (let i = 0; i < 8; i++) {
      const plus = document.querySelector('#btn-add-option');
      if (plus.hidden) break;
      plus.click();
    }
    const opts = [...document.querySelectorAll('.poll-option')];
    set(document.querySelector('#poll-question'),
      'Should we open the token gate to smaller holders before the next AMA?');
    set(opts[0], 'Ship it this week');
    set(opts[1], 'Wait until the audit is finished and then decide together');
    if (opts[2]) set(opts[2], 'Do neither and keep building quietly');
    if (opts[3]) set(opts[3], 'Ask again in a month');
  });
  // One field focused, so the counter is visible there even without "close".
  await page.focus('#poll-question');
  const panel = await page.$('#poll-admin');
  await panel.screenshot({ path: path.join(root, 'preview', `zaehler-${name}.png`) });
  await page.close();
}

await browser.close();
server.close();
console.log('preview/zaehler-rechner.png, preview/zaehler-handy.png');
