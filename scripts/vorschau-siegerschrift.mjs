/**
 * How heavy the winning answer's label is - and how heavy it could be.
 *
 * Simulation only; public/styles.css is untouched.
 *
 * The sheet asks for font-weight 650 on .opt.leads .opt-label. There is no
 * 650 cut: the four faces shipped are 400, 500, 600 and 700, and CSS matching
 * for a desired weight above 500 searches UPWARD first. So 650 draws as 700.
 * Measured on real elements, ink per label: 600 -> 1793, 650 -> 2002,
 * 700 -> 2002. Identical.
 *
 * This puts the three candidates next to each other in the actual closed poll,
 * so the step can be judged instead of argued about.
 *
 *   psql "$PGURL" -f scripts/seed-ansem-voll.sql     (once)
 *   node scripts/vorschau-siegerschrift.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'preview', 'siegerschrift');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:4000';
const ADMIN = 'EJswhvmzNccfpMXAhBgPNkFiFTV6rrYEygtzPjfDfxBw';
const HIDE = '#btn-mock-pay,#toast,#preview-flag{display:none!important}';

const STUFEN = [
  { key: 'a-500', name: 'gar nicht fetter (wie die anderen)', gewicht: 500 },
  { key: 'b-600', name: 'eine Stufe fetter', gewicht: 600 },
  { key: 'c-700', name: 'wie es jetzt ist (650 zeichnet 700)', gewicht: 700 },
];

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
  args: ['--hide-scrollbars'],
});

const ctx0 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const p0 = await ctx0.newPage();
await p0.goto(BASE, { waitUntil: 'networkidle' });
await p0.fill('#wallet-input', ADMIN);
await p0.click('#btn-challenge');
await p0.waitForSelector('#step-pay:not([hidden])', { timeout: 15_000 });
const cid = await p0.evaluate(() =>
  JSON.parse(localStorage.getItem('ansem_challenge') || 'null')?.challengeId ?? null);
await p0.evaluate(async (c) => {
  await fetch('/functions/v1/verify', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'mock-pay', challengeId: c }),
  });
}, cid);
await p0.waitForSelector('#app:not([hidden])', { timeout: 25_000 });
const JWT = await p0.evaluate(() => localStorage.getItem('ansem_jwt'));
await ctx0.close();

for (const s of STUFEN) {
  const style = `${HIDE}\n.opt.leads .opt-label { font-weight: ${s.gewicht} !important; }`;
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 700 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  await page.addInitScript((t) => { try { localStorage.setItem('ansem_jwt', t); } catch { /* egal */ } }, JWT);
  page.on('load', () => page.addStyleTag({ content: style }).catch(() => {}));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: style });
  await page.waitForSelector('.poll', { timeout: 25_000 });
  const zu = await page.evaluate(() => {
    let n = 0;
    for (const k of document.querySelectorAll('.poll')) {
      if (k.querySelector('.closed-tag')) { n += 1; } else { k.hidden = true; }
    }
    return n;
  });
  if (!zu) throw new Error('Keine geschlossene Poll - Datenbank neu befuellen?');
  await page.waitForTimeout(500);
  // The two top rows: the winner and the one under it, which is what the
  // weight is being compared against.
  // Scoped to the poll that is still SHOWN: the open ones are hidden above,
  // and '.poll .opt' happily returns an option inside a hidden card, whose
  // bounding box is null.
  const kasten = await page.locator('.poll:not([hidden]) .opt').first().boundingBox();
  await page.screenshot({
    path: path.join(OUT, `${s.key}.png`),
    clip: { x: 20, y: kasten.y - 8, width: 900, height: 200 },
  });
  await ctx.close();
  console.log(`  ${s.key.padEnd(8)} ${s.name}`);
}

const sheet = await browser.newContext({ deviceScaleFactor: 1 });
const p = await sheet.newPage();
const reihen = STUFEN.map((s) => {
  const b64 = fs.readFileSync(path.join(OUT, `${s.key}.png`)).toString('base64');
  return `<figure>
    <figcaption>${s.key.replace(/^([a-z])-/, '$1) ')} · ${s.name}</figcaption>
    <img src="data:image/png;base64,${b64}">
  </figure>`;
}).join('');
await p.setContent(`<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; background: #101218; width: 940px; }
  figure { margin: 0 0 10px; }
  figcaption { font: 600 15px ui-monospace, monospace; color: #e7e9ee;
               padding: 10px 14px 6px; letter-spacing: .02em; }
  img { width: 940px; display: block; }
</style>${reihen}`);
await p.waitForTimeout(400);
await p.screenshot({ path: path.join(OUT, 'vergleich.png'), fullPage: true });
await p.close();
await sheet.close();

await browser.close();
console.log(`\n  Bilder in ${path.relative(root, OUT)}/\n`);
