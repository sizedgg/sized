// Bild vom Anlegekasten mit dem Zeichenzaehler: leer, im Feld, knapp, voll.
//   node scripts/vorschau-zaehler.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const oeffentlich = path.join(root, 'public');
const TYPEN = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, res) => {
  let pfad = decodeURIComponent(q.url.split('?')[0]);
  if (pfad === '/') pfad = '/index.html';
  const datei = path.join(oeffentlich, pfad);
  if (!datei.startsWith(oeffentlich) || !fs.existsSync(datei) || !fs.statSync(datei).isFile()) {
    return res.writeHead(404).end('');
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] ?? 'application/octet-stream' })
     .end(fs.readFileSync(datei));
});
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
fs.mkdirSync(path.join(root, 'preview'), { recursive: true });

for (const [name, breite] of [['rechner', 900], ['handy', 390]]) {
  const seite = await browser.newPage({ viewport: { width: breite, height: 900 } });
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.waitForTimeout(400);
  await seite.evaluate(() => {
    document.querySelector('#login').hidden = true;
    document.querySelector('.app').hidden = false;
    for (const p of document.querySelectorAll('.pane')) p.hidden = true;
    document.querySelector('#pane-polls').hidden = false;
    document.querySelector('#poll-admin').hidden = false;
    document.querySelector('#poll-admin').classList.add('offen');
    document.querySelector('#poll-admin-felder').hidden = false;
    const setz = (feld, text) => {
      feld.value = text.slice(0, feld.maxLength);
      feld.dispatchEvent(new Event('input'));
    };
    // Bis zur Obergrenze auffuellen, damit das Plus verschwunden ist.
    for (let i = 0; i < 8; i++) {
      const plus = document.querySelector('#btn-add-option');
      if (plus.hidden) break;
      plus.click();
    }
    const opts = [...document.querySelectorAll('.poll-option')];
    setz(document.querySelector('#poll-question'),
      'Should we open the token gate to smaller holders before the next AMA?');
    setz(opts[0], 'Ship it this week');
    setz(opts[1], 'Wait until the audit is finished and then decide together');
    if (opts[2]) setz(opts[2], 'Do neither and keep building quietly');
    if (opts[3]) setz(opts[3], 'Ask again in a month');
  });
  // Ein Feld im Fokus, damit der Zaehler dort auch ohne "knapp" zu sehen ist.
  await seite.focus('#poll-question');
  const kasten = await seite.$('#poll-admin');
  await kasten.screenshot({ path: path.join(root, 'preview', `zaehler-${name}.png`) });
  await seite.close();
}

await browser.close();
server.close();
console.log('preview/zaehler-rechner.png, preview/zaehler-handy.png');
