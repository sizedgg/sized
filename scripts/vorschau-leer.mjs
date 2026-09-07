// ============================================================================
// Sanity check: the empty poll list - as Ansem and as a regular user.
//
// Changes nothing, cuts the page and scaffolding verbatim from the source.
//
//   node scripts/vorschau-leer.mjs
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

const sn = (v, b) => { const i = appJs.indexOf(v), j = appJs.indexOf(b, i); return appJs.slice(i, j); };
// The observer that maintains --poll-kopf: without it, the notice would sit
// in the middle of the LIST instead of the middle of the page, and the image
// wouldn't show what the page actually does.
const beobachter = sn('function observeHeaderHeight()', 'const LZ_MAX_MINUTEN = 7 * 24 * 60;');

const a = html.indexOf('<main id="pane-polls"');
const b = html.indexOf('</main>', a);
if (a < 0 || b < 0) throw new Error('pane-polls nicht in index.html gefunden');
const scaffold = html.slice(a, b + 7).replace('class="pane" hidden', 'class="pane"');

// The sentence taken verbatim from app.js - not retyped.
const empty = /list\.innerHTML = '(<div class="empty">[^']*<\/div>)'/.exec(appJs);
if (!empty) throw new Error('Der Hinweis auf die leere Liste sieht anders aus als erwartet');

const server = http.createServer((_q, res) =>
  res.writeHead(200, { 'content-type': 'text/html' })
     .end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
       <body style="margin:0"><div style="display:flex;flex-direction:column;
         height:100vh;background:var(--bg)">${scaffold}</div>`));
await new Promise((r) => server.listen(0, r));

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
const ausgabe = path.join(root, 'preview');
fs.mkdirSync(ausgabe, { recursive: true });

for (const [file, width, admin, offen] of [
  ['leer-polls-nutzer.png', 900, false, false],
  ['leer-polls-ansem.png', 900, true, false],
  ['leer-polls-ansem-offen.png', 900, true, true],
  ['leer-polls-handy.png', 390, false, false],
]) {
  const page = await browser.newPage({
    viewport: { width: width, height: width < 500 ? 780 : 800 }, deviceScaleFactor: 2,
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({ content: `const $ = (s, r = document) => r.querySelector(s);\n${beobachter}` });
  await page.evaluate(([content, ist, offen]) => {
    const k = document.querySelector('#poll-admin');
    k.hidden = !ist;
    k.classList.toggle('offen', offen);
    document.querySelector('#poll-admin-felder').hidden = !offen;
    document.querySelector('#poll-list').innerHTML = content;
  }, [empty[1], admin, !!offen]);
  await page.waitForTimeout(250);

  // Measured, not eyeballed, and against the middle of the PAGE, not the
  // list. That's the whole point of this version: the sentence should stay
  // put whether the create-poll box above it is open or closed. If a
  // deviation remains, either the upper clamp kicked in (short screen) or the
  // page's padding differs top to bottom - on a phone .pane has none at the
  // top.
  const abstand = await page.evaluate(() => {
    const p = document.querySelector('#pane-polls').getBoundingClientRect();
    const e = document.querySelector('.empty').getBoundingClientRect();
    return Math.round(Math.abs((p.top + p.bottom) / 2 - (e.top + e.height / 2)));
  });
  await page.screenshot({ path: path.join(ausgabe, file) });
  await page.close();
  console.log(`  ${file.padEnd(30)} Abweichung von der Seitenmitte: ${abstand} px`);
}

await browser.close();
server.close();
